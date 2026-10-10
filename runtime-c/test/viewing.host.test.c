/*
 * Tests for host/viewing.c: `sproutc view` polls the view of a visitor in a stored world and prints the page
 * `sprout view` prints (corpus/good/chip-tree/view.txt is that page for the visitor arriving in the chip-tree
 * world), or, with --json, the view's canonical JSON and the chip tree over it; a poll that faults is shown as the
 * visitor would see it, then the fault, and exits 1; a command line or a stored world it cannot follow exits 2
 * with words for what is wrong.
 */
#include <stdio.h>

#include "check.h"
#include "corpus.h"
#include "json.h"
#include "play.h"

typedef struct run {
  int code;
  char *out, *err;
} run;

/* Reads a tmpfile back into a buffer the caller frees. */
static char *drain(FILE *file) {
  long size;
  char *bytes;
  fflush(file);
  size = ftell(file);
  rewind(file);
  bytes = (char *)malloc((size_t)size + 1);
  bytes[fread(bytes, 1, (size_t)size, file)] = '\0';
  fclose(file);
  return bytes;
}

static run sproutc(int argc, char **argv) {
  run r;
  FILE *out = tmpfile(), *err = tmpfile();
  r.code = sproutc_main(argc, argv, out, err);
  r.out = drain(out);
  r.err = drain(err);
  return r;
}

static void release(run *r) {
  free(r->out);
  free(r->err);
}

/* The page of `corpus/good/<world>/view.txt`, which the TypeScript runtime writes. */
static char *page_of(const char *world) {
  char path[1024];
  size_t length;
  snprintf(path, sizeof path, "%s/../good/%s/view.txt", SPROUT_GOLDENS, world);
  return corpus_read(path, &length);
}

/* The stored world a visitor arrives into in a corpus world, written to a file in the working folder. */
static const char *state_file(const char *world) {
  static char path[128];
  size_t length;
  char *text = test_golden("views.json", &length);
  sprout_arena arena;
  test_heap heap;
  sprout_host host = test_host(&heap);
  sprout_json *root = NULL;
  sprout_json_error error;
  const sprout_json *corpus;
  size_t i;
  FILE *file;
  host.page_bytes = 65536;
  sprout_arena_init(&arena, &host);
  if (sprout_json_read(&arena, text, length, &root, &error) != SPROUT_OK) exit(2);
  corpus = sprout_json_get(root, "corpus");
  snprintf(path, sizeof path, "viewing-host-%s.json", world);
  for (i = 0; i < corpus->count; i++) {
    const sprout_json *one = corpus->items[i];
    const sprout_json *stored = sprout_json_get(one, "state");
    if (strcmp(sprout_json_get(one, "world")->bytes, world) != 0) continue;
    file = fopen(path, "wb");
    fwrite(stored->bytes, 1, stored->length, file);
    fclose(file);
  }
  sprout_arena_reset(&arena);
  free(text);
  return path;
}

static char *cartridge_of(const char *world) {
  static char path[1024];
  snprintf(path, sizeof path, "%s/%s.sproutworld", SPROUT_CARTRIDGES, world);
  return path;
}

static void the_page_is_the_page_sprout_view_prints(void) {
  char *argv[] = {"view", cartridge_of("chip-tree"), "--state", (char *)state_file("chip-tree")};
  char *wanted = page_of("chip-tree");
  run r = sproutc(4, argv);
  CHECK_INT(r.code, 0);
  CHECK_STR(r.out, wanted);
  CHECK_STR(r.err, "");
  free(wanted);
  release(&r);
}

static void a_value_role_is_written_as_its_options_and_a_refusal_under_its_reading(void) {
  char *argv[] = {"view", cartridge_of("chip-tree"), "--state", (char *)state_file("chip-tree")};
  run r = sproutc(4, argv);
  CHECK(strstr(r.out, "  turn dial to \xe2\x80\xa6  (chip_tree.turn)\n    knob: a dial (hall.dial)\n    notch: 0 to 9\n") != NULL);
  CHECK(strstr(r.out, "  drop guard  (sprout.drop)\n    refused: You are not holding a guard.\n") != NULL);
  CHECK(strstr(r.out, "    topic: bridge, toll, weather\n") != NULL);
  release(&r);
}

static void json_prints_the_view_and_the_chip_tree_over_it(void) {
  char *argv[] = {"view", cartridge_of("chip-tree"), "--state", (char *)state_file("chip-tree"), "--json"};
  run r = sproutc(5, argv);
  char *second;
  CHECK_INT(r.code, 0);
  CHECK(strncmp(r.out, "{\"description\":[\"There is nothing special about a hall.\"],\"effects\":[],\"exits\":[", 78) == 0);
  second = strstr(r.out, "}\n[{\"verb\":");
  CHECK(second != NULL);
  release(&r);
}

static void a_picture_in_the_description_is_an_effect_with_its_payload_and_its_transcript_line(void) {
  char *argv[] = {"view", cartridge_of("media-room"), "--state", (char *)state_file("media-room"), "--json"};
  run r = sproutc(5, argv);
  CHECK_INT(r.code, 0);
  CHECK(strstr(r.out,
               "{\"description\":[\"A damp cellar.\"],\"effects\":[{\"extension\":\"media\",\"statement\":\"show\","
               "\"payload\":{\"image\":\"cellar.png\"},\"transcript\":\"[cellar.png]\"}],\"exits\":[") == r.out);
  release(&r);
}

static void the_page_lists_the_effect_after_the_description(void) {
  char *argv[] = {"view", cartridge_of("media-room"), "--state", (char *)state_file("media-room")};
  char *wanted = page_of("media-room");
  run r = sproutc(4, argv);
  CHECK_INT(r.code, 0);
  CHECK_STR(r.out, wanted);
  CHECK(strstr(r.out, "\neffects\n  media.show {\"image\":\"cellar.png\"} reads [cellar.png]\n") != NULL);
  free(wanted);
  release(&r);
}

static void a_poll_that_faults_is_shown_as_the_visitor_sees_it_then_the_fault_and_exits_1(void) {
  char *argv[] = {"view", cartridge_of("chip-tree"), "--state", (char *)state_file("chip-tree"), "--poll-steps", "30"};
  run r = sproutc(6, argv);
  CHECK_INT(r.code, 1);
  CHECK(strstr(r.out, "description\n  Something here is too much to take in.\n") != NULL);
  CHECK(strstr(r.out, "\nthe poll faulted, against hall, BudgetExhausted: ") != NULL);
  release(&r);
}

static void a_command_line_it_cannot_follow_exits_2_with_words(void) {
  char *none[] = {"view"};
  char *no_state[] = {"view", cartridge_of("chip-tree")};
  char *flag[] = {"view", cartridge_of("chip-tree"), "--state", (char *)state_file("chip-tree"), "--loud"};
  char *steps[] = {"view", cartridge_of("chip-tree"), "--state", (char *)state_file("chip-tree"), "--poll-steps", "many"};
  char *dangling[] = {"view", cartridge_of("chip-tree"), "--visit"};
  char *nobody[] = {"view", cartridge_of("chip-tree"), "--state", (char *)state_file("chip-tree"), "--visit", "nobody"};
  char *missing[] = {"view", "no-such-world.sproutworld", "--state", (char *)state_file("chip-tree")};
  run r = sproutc(1, none);
  CHECK_INT(r.code, 2);
  CHECK(strstr(r.err, "write `sproutc view <world.sproutworld> --state save.json`.") != NULL);
  release(&r);
  r = sproutc(2, no_state);
  CHECK_INT(r.code, 2);
  CHECK(strstr(r.err, "write --state, the stored world the visitor stands in.") != NULL);
  release(&r);
  r = sproutc(5, flag);
  CHECK_INT(r.code, 2);
  CHECK(strstr(r.err, "`--loud` is not something `sproutc view` takes.") != NULL);
  release(&r);
  r = sproutc(6, steps);
  CHECK_INT(r.code, 2);
  CHECK(strstr(r.err, "--poll-steps wants a whole number after it") != NULL);
  release(&r);
  r = sproutc(3, dangling);
  CHECK_INT(r.code, 2);
  CHECK(strstr(r.err, "--visit wants a value after it.") != NULL);
  release(&r);
  r = sproutc(6, nobody);
  CHECK_INT(r.code, 2);
  CHECK(strstr(r.err, "`nobody` has never visited this world.") != NULL);
  release(&r);
  r = sproutc(4, missing);
  CHECK_INT(r.code, 2);
  CHECK(strstr(r.err, "cannot read no-such-world.sproutworld.") != NULL);
  release(&r);
}

int main(void) {
  RUN(the_page_is_the_page_sprout_view_prints);
  RUN(a_value_role_is_written_as_its_options_and_a_refusal_under_its_reading);
  RUN(json_prints_the_view_and_the_chip_tree_over_it);
  RUN(a_picture_in_the_description_is_an_effect_with_its_payload_and_its_transcript_line);
  RUN(the_page_lists_the_effect_after_the_description);
  RUN(a_poll_that_faults_is_shown_as_the_visitor_sees_it_then_the_fault_and_exits_1);
  RUN(a_command_line_it_cannot_follow_exits_2_with_words);
  return REPORT();
}
