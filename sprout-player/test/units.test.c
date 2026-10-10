/*
 * The glue's small modules, each called directly: text building, whole-file reads and writes,
 * a reading from the sentence builder, and the host's clock and seeds.
 */
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/stat.h>

#include "fake_playdate.h"
#include "files.h"
#include "pd_host.h"
#include "reading_json.h"
#include "text.h"

static int failures, checks;

#define CHECK(condition, ...)                                              \
  do {                                                                     \
    checks++;                                                              \
    if (!(condition)) {                                                    \
      failures++;                                                          \
      fprintf(stderr, "FAIL %s:%d: %s\n  ", __FILE__, __LINE__, #condition); \
      fprintf(stderr, __VA_ARGS__);                                        \
      fputc('\n', stderr);                                                 \
    }                                                                      \
  } while (0)

static fake_playdate *fake;

static void begin(const char *name) {
  char root[300], data[400], clear[500];
  const char *tmp = getenv("TMPDIR");
  snprintf(root, sizeof root, "%s/sprout-player-units", tmp != NULL ? tmp : "/tmp");
  mkdir(root, 0777);
  snprintf(data, sizeof data, "%s/%s", root, name);
  snprintf(clear, sizeof clear, "rm -rf '%s'", data);
  CHECK(system(clear) == 0, "clearing");
  mkdir(data, 0777);
  fake = (fake_playdate *)calloc(1, sizeof *fake);
  fake_init(fake, data, data);
}

static void end(void) {
  CHECK(fake->pages == 0, "%d pages out", fake->pages);
  free(fake);
}

static void text_is_built_into_a_fixed_buffer_and_never_overruns(void) {
  char bytes[12];
  text_buffer out;
  text_begin(&out, bytes, sizeof bytes);
  text_add(&out, "abc");
  text_add_number(&out, 0);
  text_add_number(&out, 4096);
  CHECK(strcmp(bytes, "abc04096") == 0, "%s", bytes);
  text_add(&out, "too long to fit");
  CHECK(strlen(bytes) == sizeof bytes - 1 && bytes[sizeof bytes - 1] == '\0', "%s", bytes);
  text_begin(&out, bytes, sizeof bytes);
  text_add_number(&out, 18446744073709551615ULL);
  CHECK(strcmp(bytes, "18446744073") == 0, "truncated: %s", bytes);
  text_begin(&out, bytes, 0);
  text_add(&out, "nothing fits");
}

static void a_file_is_written_whole_and_read_back(void) {
  size_t length = 0;
  char *bytes;
  begin("files");
  CHECK(player_read_file(&fake->api, "absent", &length) == NULL, "a missing file");
  CHECK(player_write_file(&fake->api, "one.txt", "first", 5), "writing");
  bytes = player_read_file(&fake->api, "one.txt", &length);
  CHECK(bytes != NULL && length == 5 && strcmp(bytes, "first") == 0, "reading");
  player_free(&fake->api, bytes);
  CHECK(player_write_file(&fake->api, "one.txt", "second one", 10), "writing over");
  bytes = player_read_file(&fake->api, "one.txt", &length);
  CHECK(bytes != NULL && length == 10 && strcmp(bytes, "second one") == 0, "replaced");
  player_free(&fake->api, bytes);
  end();
}

static void a_file_bigger_than_a_chunk_is_read_whole(void) {
  size_t length = 0, i;
  char *big = (char *)malloc(70000), *bytes;
  begin("big");
  for (i = 0; i < 70000; i++) big[i] = (char)('a' + i % 26);
  CHECK(player_write_file(&fake->api, "big.bin", big, 70000), "writing");
  bytes = player_read_file(&fake->api, "big.bin", &length);
  CHECK(bytes != NULL && length == 70000 && memcmp(bytes, big, 70000) == 0, "length %zu", length);
  player_free(&fake->api, bytes);
  free(big);
  end();
}

static void a_write_cut_short_before_the_swap_is_found_by_the_read(void) {
  size_t length = 0;
  char *bytes;
  FILE *file;
  char path[600];
  begin("tmp");
  snprintf(path, sizeof path, "%s/save.json.tmp", fake->data);
  file = fopen(path, "wb");
  fputs("whole", file);
  fclose(file);
  bytes = player_read_file(&fake->api, "save.json", &length);
  CHECK(bytes != NULL && strcmp(bytes, "whole") == 0, "the leftover");
  player_free(&fake->api, bytes);
  end();
}

/* ---- readings ---- */

static const char *parse_into(sprout_arena *arena, const char *json, sprout_reading *read, const char **text) {
  return reading_parse(arena, json, strlen(json), "chip_tree.visitor", read, text);
}

static void a_reading_is_read_as_the_sentence_builder_writes_it(void) {
  player_host host;
  sprout_arena arena;
  sprout_reading read;
  const char *text;
  begin("reading");
  player_host_init(&host, &fake->api);
  sprout_arena_init(&arena, &host.record);

  CHECK(parse_into(&arena,
                   "{\"verb\":\"sprout.ask\",\"text\":\"ask guard about weather\",\"fillers\":["
                   "{\"role\":\"target\",\"binds\":\"object\",\"id\":\"w.guard\",\"name\":\"a guard\"},"
                   "{\"role\":\"topic\",\"binds\":\"value\",\"value\":\"weather\"}]}",
                   &read, &text) == NULL, "an ask");
  CHECK(strcmp(read.verb, "sprout.ask") == 0 && strcmp(read.actor, "chip_tree.visitor") == 0, "verb and actor");
  CHECK(read.filling_count == 2 && read.fillings[0].binds == SPROUT_FILL_OBJECT &&
            strcmp(read.fillings[0].id, "w.guard") == 0, "the object");
  CHECK(read.fillings[1].binds == SPROUT_FILL_TEXT && strcmp(read.fillings[1].text, "weather") == 0, "the word");
  CHECK(text != NULL && strcmp(text, "ask guard about weather") == 0, "the line");

  CHECK(parse_into(&arena,
                   "{\"verb\":\"w.turn\",\"fillers\":[{\"role\":\"notch\",\"binds\":\"value\",\"value\":7},"
                   "{\"role\":\"things\",\"binds\":\"set\",\"ids\":[\"a\",\"b\"]},"
                   "{\"role\":\"way\",\"binds\":\"exit\",\"direction\":\"north\",\"label\":\"to the yard\",\"to\":\"w.yard\"},"
                   "{\"role\":\"tool\",\"binds\":\"unbound\"}]}",
                   &read, &text) == NULL, "number, set, exit and unbound");
  CHECK(text == NULL, "no line");
  CHECK(read.fillings[0].binds == SPROUT_FILL_NUMBER && read.fillings[0].number == 7.0, "the number");
  CHECK(read.fillings[1].binds == SPROUT_FILL_SET && read.fillings[1].id_count == 2 &&
            strcmp(read.fillings[1].ids[1], "b") == 0, "the set");
  CHECK(read.fillings[2].binds == SPROUT_FILL_EXIT && strcmp(read.fillings[2].direction, "north") == 0 &&
            strcmp(read.fillings[2].id, "w.yard") == 0 && strcmp(read.fillings[2].label, "to the yard") == 0, "the exit");
  CHECK(read.fillings[3].binds == SPROUT_FILL_UNBOUND, "left out");

  CHECK(parse_into(&arena, "{\"verb\":\"w.link\",\"fillers\":[{\"role\":\"way\",\"binds\":\"exit\",\"direction\":null,"
                           "\"label\":\"the door\",\"to\":\"w.hall\"}]}", &read, &text) == NULL, "a link");
  CHECK(read.fillings[0].direction == NULL, "a link has no direction");

  CHECK(parse_into(&arena, "not json", &read, &text) != NULL, "not JSON");
  CHECK(parse_into(&arena, "[]", &read, &text) != NULL, "not an object");
  CHECK(parse_into(&arena, "{\"fillers\":[]}", &read, &text) != NULL, "no verb");
  CHECK(parse_into(&arena, "{\"verb\":\"w.x\"}", &read, &text) != NULL, "no fillers");
  CHECK(parse_into(&arena, "{\"verb\":\"w.x\",\"fillers\":[{\"role\":\"a\"}]}", &read, &text) != NULL, "no binds");
  CHECK(parse_into(&arena, "{\"verb\":\"w.x\",\"fillers\":[{\"role\":\"a\",\"binds\":\"object\"}]}", &read, &text) != NULL, "an object with no id");
  CHECK(parse_into(&arena, "{\"verb\":\"w.x\",\"fillers\":[{\"role\":\"a\",\"binds\":\"set\",\"ids\":[1]}]}", &read, &text) != NULL, "a set of numbers");
  CHECK(parse_into(&arena, "{\"verb\":\"w.x\",\"fillers\":[{\"role\":\"a\",\"binds\":\"value\"}]}", &read, &text) != NULL, "a value with none");
  CHECK(parse_into(&arena, "{\"verb\":\"w.x\",\"fillers\":[{\"role\":\"a\",\"binds\":\"teleport\"}]}", &read, &text) != NULL, "an unknown way to bind");
  sprout_arena_reset(&arena);
  end();
}

/* ---- the host ---- */

static void a_clock_set_back_is_read_as_the_greatest_time_seen(void) {
  player_host host;
  begin("clock");
  player_host_init(&host, &fake->api);
  fake->seconds = 5000;
  CHECK(player_host_seconds(&host) == 5000, "first");
  fake->seconds = 100;
  CHECK(player_host_seconds(&host) == 5000, "set back");
  host.last_seconds = 9000;
  CHECK(player_host_seconds(&host) == 9000, "the save's seconds");
  fake->seconds = 9001;
  CHECK(player_host_seconds(&host) == 9001, "forward again");
  end();
}

static void each_step_draws_a_seed_in_range_and_no_two_alike(void) {
  player_host host;
  unsigned long long seen[64];
  int i, j;
  begin("seeds");
  player_host_init(&host, &fake->api);
  /* The clock is frozen: the seeds still differ, since each is mixed with how many came before. */
  for (i = 0; i < 64; i++) {
    player_host_begin_step(&host);
    seen[i] = host.record.seed(host.record.ctx);
    CHECK(seen[i] <= 4294967295ULL, "seed %llu out of range", seen[i]);
    for (j = 0; j < i; j++) CHECK(seen[i] != seen[j], "seed %llu twice", seen[i]);
  }
  /* The same clock and count give the same seed: the draw is a rule, not a roll. */
  {
    player_host again;
    player_host_init(&again, &fake->api);
    player_host_begin_step(&again);
    CHECK(again.record.seed(again.record.ctx) == seen[0], "the rule is deterministic");
  }
  end();
}

static void the_wall_clock_counts_from_the_turns_start(void) {
  player_host host;
  uint64_t first;
  begin("now");
  player_host_init(&host, &fake->api);
  player_host_begin_step(&host);
  first = host.record.now(host.record.ctx);
  CHECK(first < 100, "%llu ms", (unsigned long long)first);
  CHECK(host.record.now(host.record.ctx) > first, "it moves on");
  CHECK(!host.record.read(host.record.ctx, "world", NULL, NULL), "the runtime is handed no stored bytes");
  CHECK(host.record.emit(host.record.ctx, "r", 1, "t", 1), "emit takes a line and drops it");
  end();
}

int main(void) {
  text_is_built_into_a_fixed_buffer_and_never_overruns();
  a_file_is_written_whole_and_read_back();
  a_file_bigger_than_a_chunk_is_read_whole();
  a_write_cut_short_before_the_swap_is_found_by_the_read();
  a_reading_is_read_as_the_sentence_builder_writes_it();
  a_clock_set_back_is_read_as_the_greatest_time_seen();
  each_step_draws_a_seed_in_range_and_no_two_alike();
  the_wall_clock_counts_from_the_turns_start();
  printf("player units: %d checks, %d failed\n", checks, failures);
  return failures == 0 ? 0 : 1;
}
