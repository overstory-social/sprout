/*
 * Tests for host/parsing.c: `sproutc parse` reads each turn the readings file says the TypeScript parser read
 * words for, over the stored world the turn began from, and counts it alike or not by comparing the two as JSON;
 * a turn that read no words is counted apart. What the runtime read is written in the readings file's form
 * (player/src/parsed.ts), and two forms are alike whatever order an object's members come in.
 */
#include "parsing.h"

#include "check.h"
#include "host.h"
#include "play.h"
#include "state.h"

static const char *WORLD = "sproutc-parsing-test.sproutworld";
static const char *READINGS = "sproutc-parsing-test.readings.json";
static const char *OUT = "sproutc-parsing-test.out";
static const char *ERR = "sproutc-parsing-test.err";

static void put(const char *path, const char *bytes, size_t length) {
  FILE *file = fopen(path, "wb");
  if (file == NULL) exit(2);
  fwrite(bytes, 1, length, file);
  fclose(file);
}

static char *slurp(const char *path, size_t *length) {
  FILE *file = fopen(path, "rb");
  char *bytes;
  long size;
  if (file == NULL) exit(2);
  fseek(file, 0, SEEK_END);
  size = ftell(file);
  fseek(file, 0, SEEK_SET);
  bytes = (char *)malloc((size_t)size + 1);
  if (bytes == NULL || fread(bytes, 1, (size_t)size, file) != (size_t)size) exit(2);
  bytes[size] = '\0';
  fclose(file);
  *length = (size_t)size;
  return bytes;
}

static int run(int argc, char **argv) {
  FILE *out = fopen(OUT, "wb"), *err = fopen(ERR, "wb");
  int code = sproutc_main(argc, argv, out, err);
  fclose(out);
  fclose(err);
  return code;
}

/* `text` read as a tree in `arena`. */
static sprout_json *tree(sprout_arena *arena, const char *text) {
  sprout_json *root = NULL;
  sprout_json_error error;
  CHECK_INT(sprout_json_read(arena, text, strlen(text), &root, &error), SPROUT_OK);
  return root;
}

/* The canonical text of `parsed` in the readings file's form, in `arena`. */
static const char *written(sprout_arena *arena, const sprout_parsed *parsed) {
  const char *bytes = "";
  size_t length;
  sprout_json *node = sproutc_parsed_json(arena, parsed);
  CHECK(node != NULL);
  if (node != NULL) CHECK_INT(sprout_json_write_value(arena, node, &bytes, &length), SPROUT_OK);
  return bytes;
}

static void two_forms_are_alike_whatever_order_their_members_come_in(void) {
  sproutc_host host;
  sprout_arena arena;
  sproutc_host_init(&host, stdout, NULL);
  sprout_arena_init(&arena, &host.record);
  CHECK(sproutc_json_same(tree(&arena, "{\"a\":1,\"b\":[true,null,\"x\"]}"), tree(&arena, "{\"b\":[true,null,\"x\"],\"a\":1}")));
  CHECK(!sproutc_json_same(tree(&arena, "{\"a\":1}"), tree(&arena, "{\"a\":2}")));
  CHECK(!sproutc_json_same(tree(&arena, "{\"a\":1}"), tree(&arena, "{\"a\":1,\"b\":1}")));
  CHECK(!sproutc_json_same(tree(&arena, "{\"a\":1,\"c\":1}"), tree(&arena, "{\"a\":1,\"b\":1}")));
  CHECK(!sproutc_json_same(tree(&arena, "[1,2]"), tree(&arena, "[2,1]")));
  CHECK(!sproutc_json_same(tree(&arena, "\"1\""), tree(&arena, "1")));
  CHECK(!sproutc_json_same(tree(&arena, "null"), NULL));
  sprout_arena_reset(&arena);
  sproutc_host_close(&host);
}

static void an_answer_and_a_fault_are_written_as_the_typescript_parser_records_them(void) {
  sproutc_host host;
  sprout_arena arena;
  sprout_parsed parsed;
  sprout_said_binding bindings[2];
  uint64_t draws[1] = {3};
  sproutc_host_init(&host, stdout, NULL);
  sprout_arena_init(&arena, &host.record);
  memset(&parsed, 0, sizeof parsed);
  memset(bindings, 0, sizeof bindings);
  bindings[0].name = "actor";
  bindings[0].object = true;
  bindings[0].text = (sprout_str){"w#1", 3};
  bindings[1].name = "reading";
  bindings[1].text = (sprout_str){"take it", 7};
  parsed.end = SPROUT_PARSED_ANSWERED;
  parsed.line = "cannot";
  parsed.by = (sprout_str){"w", 1};
  parsed.bindings = bindings;
  parsed.binding_count = 2;
  parsed.draws = draws;
  parsed.draw_count = 1;
  parsed.steps = 9;
  CHECK_STR(written(&arena, &parsed),
            "{\"answered\":{\"line\":{\"passage\":\"cannot\"},\"by\":\"w\",\"bindings\":[{\"name\":\"actor\",\"object\":\"w#1\"},"
            "{\"name\":\"reading\",\"value\":\"take it\"}]},\"draws\":[3],\"steps\":9}");
  /* Where nothing writes the line, the engine says its own words, in quotes. */
  parsed.words = "That is not something you can do here.";
  parsed.binding_count = 0;
  parsed.draw_count = 0;
  CHECK_STR(written(&arena, &parsed),
            "{\"answered\":{\"line\":{\"text\":\"That is not something you can do here.\"},\"by\":\"w\",\"bindings\":[]},"
            "\"draws\":[],\"steps\":9}");
  memset(&parsed, 0, sizeof parsed);
  parsed.end = SPROUT_PARSED_FAULTED;
  parsed.fault_name = "BudgetExhausted";
  strcpy(parsed.fault.text, "steps: a command turn may take 1 steps.");
  parsed.steps = 2;
  CHECK_STR(written(&arena, &parsed),
            "{\"faulted\":{\"name\":\"BudgetExhausted\",\"detail\":\"steps: a command turn may take 1 steps.\"},\"draws\":[],"
            "\"steps\":2}");
  sprout_arena_reset(&arena);
  sproutc_host_close(&host);
}

static void a_reading_is_written_with_its_bindings_the_turns_after_it_the_draw_and_the_corrections(void) {
  sproutc_host host;
  sprout_arena arena;
  sprout_parsed parsed;
  sprout_filling fillings[2], planned_filling;
  sprout_aside asides[2];
  sprout_following rest[2];
  sprout_reading planned;
  sprout_reread reread;
  const char *referents[1] = {"w.box"};
  uint64_t draws[1] = {2};
  sproutc_host_init(&host, stdout, NULL);
  sprout_arena_init(&arena, &host.record);
  memset(&parsed, 0, sizeof parsed);
  memset(fillings, 0, sizeof fillings);
  fillings[0].role = "target";
  fillings[0].binds = SPROUT_FILL_OBJECT;
  fillings[0].id = "w.key";
  fillings[1].role = "notch";
  fillings[1].binds = SPROUT_FILL_NUMBER;
  fillings[1].number = 3;
  asides[0] = (sprout_aside){"pronoun_correction", "w.cat", "she"};
  asides[1] = (sprout_aside){"meant", "w.key", NULL};
  memset(&planned, 0, sizeof planned);
  memset(&planned_filling, 0, sizeof planned_filling);
  planned_filling.role = "target";
  planned_filling.binds = SPROUT_FILL_OBJECT;
  planned_filling.id = "w.box";
  planned.verb = "sprout.take";
  planned.actor = "w#1";
  planned.fillings = &planned_filling;
  planned.filling_count = 1;
  memset(&reread, 0, sizeof reread);
  reread.role = "target";
  reread.words = "box";
  reread.referents = referents;
  reread.referent_count = 1;
  memset(rest, 0, sizeof rest);
  rest[0].planned = &planned;
  rest[0].reread = &reread;
  rest[1].text = "look";
  parsed.end = SPROUT_PARSED_READING;
  parsed.reading.verb = "w.turn";
  parsed.reading.actor = "w#1";
  parsed.reading.fillings = fillings;
  parsed.reading.filling_count = 2;
  parsed.reading.asides = asides;
  parsed.reading.aside_count = 2;
  parsed.rest = rest;
  parsed.rest_count = 2;
  parsed.drawn = true;
  parsed.drawn_among = 2;
  parsed.draws = draws;
  parsed.draw_count = 1;
  parsed.steps = 40;
  CHECK_STR(written(&arena, &parsed),
            "{\"reading\":{\"verb\":\"w.turn\",\"actor\":\"w#1\",\"bindings\":[{\"role\":\"target\",\"binds\":\"object\","
            "\"id\":\"w.key\"},{\"role\":\"notch\",\"binds\":\"value\",\"value\":3}]},\"rest\":[{\"planned\":{\"verb\":"
            "\"sprout.take\",\"actor\":\"w#1\",\"bindings\":[{\"role\":\"target\",\"binds\":\"object\",\"id\":\"w.box\"}]},"
            "\"reread\":{\"role\":\"target\",\"words\":\"box\",\"values\":[],\"referents\":[\"w.box\"]}},{\"text\":\"look\"}],"
            "\"drawn\":{\"among\":2,\"meant\":\"w.key\"},\"corrected\":[{\"thing\":\"w.cat\",\"pronoun\":\"she\"}],"
            "\"draws\":[2],\"steps\":40}");
  parsed.end = SPROUT_PARSED_INTENT;
  parsed.reading.verb = "sprout.open_with";
  parsed.rest_count = 0;
  parsed.drawn = false;
  parsed.reading.aside_count = 0;
  parsed.reading.filling_count = 0;
  CHECK_STR(written(&arena, &parsed),
            "{\"intent\":{\"intent\":\"sprout.open_with\",\"actor\":\"w#1\",\"bindings\":[]},\"rest\":[],\"drawn\":null,"
            "\"corrected\":[],\"draws\":[2],\"steps\":40}");
  sprout_arena_reset(&arena);
  sproutc_host_close(&host);
}

/* A stored world with Marta arrived in the unknown-word world, and what `sprout_parse` reads of `line` over it. */
static char *arrived(const char *line, char *parsed, size_t size) {
  sproutc_host host;
  sprout_world *world;
  sprout_state *state;
  sprout_refusal refusal;
  sprout_turn_input input;
  sprout_outcome outcome;
  sprout_arena arena;
  sprout_parsed read;
  const char *bytes;
  size_t length;
  char *cartridge = slurp(WORLD, &length), *stored;
  sproutc_host_init(&host, stdout, NULL);
  CHECK_INT(sprout_load_explained(&host.record, cartridge, length, &world, &refusal), SPROUT_OK);
  CHECK_INT(sprout_state_empty(&host.record, "unknown_word", &state), SPROUT_OK);
  CHECK_INT(sprout_state_open(state, world, NULL, &refusal), SPROUT_OK);
  memset(&input, 0, sizeof input);
  input.kind = SPROUT_TURN_MAINTENANCE;
  CHECK_INT(sprout_run_turn(world, state, &host.record, &input, &outcome), SPROUT_OK);
  sprout_outcome_free(&outcome);
  input.kind = SPROUT_TURN_ARRIVAL;
  input.visit = "visit:Marta";
  input.nickname = "Marta";
  input.nickname_length = 5;
  CHECK_INT(sprout_run_turn(world, state, &host.record, &input, &outcome), SPROUT_OK);
  sprout_outcome_free(&outcome);
  sprout_arena_init(&arena, &host.record);
  CHECK_INT(sprout_state_write(state, &arena, &bytes, &length), SPROUT_OK);
  stored = (char *)malloc(length + 1);
  if (stored == NULL) exit(2);
  memcpy(stored, bytes, length + 1);
  sproutc_host_set_seed(&host, 5);
  CHECK_INT(sprout_parse(world, state, &host.record, "visit:Marta", line, strlen(line), NULL, &arena, &read), SPROUT_OK);
  snprintf(parsed, size, "%s", written(&arena, &read));
  sprout_arena_reset(&arena);
  sprout_state_free(state);
  sprout_world_free(world);
  sproutc_host_close(&host);
  free(cartridge);
  return stored;
}

static void each_turn_that_read_words_is_compared_over_the_world_it_began_from(void) {
  char parsed[1024], text[1 << 16], *stored, *out;
  char *argv[] = {"parse", (char *)WORLD, "--readings", (char *)READINGS, NULL};
  size_t length;
  stored = arrived("again", parsed, sizeof parsed);
  /* `again` read as the runtime reads it; `take unicorn`, which it does not read yet; `look`, a step a line planned. */
  snprintf(text, sizeof text,
           "{\"format\":1,\"script\":\"t.json\",\"steps\":["
           "{\"index\":0,\"line\":\"@arrive Marta\",\"atSeconds\":0,\"seed\":5,\"kind\":\"arrive\",\"nickname\":\"Marta\","
           "\"after\":{\"says\":[],\"turns\":[],\"world\":%s}},"
           "{\"index\":1,\"line\":\"Marta> again\",\"atSeconds\":0,\"seed\":5,\"kind\":\"command\",\"nickname\":\"Marta\","
           "\"turns\":["
           "{\"typed\":\"again\",\"seed\":5,\"skip\":true,\"why\":\"unknown\",\"parsed\":%s},"
           "{\"typed\":\"take unicorn\",\"seed\":6,\"skip\":true,\"why\":\"unknown\",\"parsed\":%s,\"before\":%s},"
           "{\"typed\":\"again\",\"seed\":7,\"skip\":true,\"why\":\"unknown\",\"handed\":{\"planned\":{\"verb\":\"sprout.look\","
           "\"actor\":\"x\",\"bindings\":[]}},\"before\":%s}]}]}",
           stored, parsed, parsed, stored, stored);
  put(READINGS, text, strlen(text));
  CHECK_INT(run(4, argv), 1);
  out = slurp(OUT, &length);
  CHECK(strstr(out, "first difference: step 1, turn 2, `take unicorn`: sproutc does not read it: a noun that names nothing in reach") != NULL);
  CHECK(strstr(out, "parsed: 1 agree, 1 differ, 1 planned\n") != NULL);
  free(out);
  free(stored);
}

static void a_turn_with_no_world_to_begin_from_and_a_bad_command_line_are_refused(void) {
  char *argv[] = {"parse", (char *)WORLD, "--readings", (char *)READINGS, NULL};
  char *bare[] = {"parse", (char *)WORLD, NULL};
  const char *text =
      "{\"format\":1,\"script\":\"t.json\",\"steps\":["
      "{\"index\":0,\"line\":\"Marta> again\",\"atSeconds\":0,\"seed\":5,\"kind\":\"command\",\"nickname\":\"Marta\","
      "\"turns\":[{\"typed\":\"again\",\"seed\":5,\"skip\":true,\"why\":\"unknown\",\"parsed\":{}}]}]}";
  char *err;
  size_t length;
  put(READINGS, text, strlen(text));
  CHECK_INT(run(4, argv), 2);
  err = slurp(ERR, &length);
  CHECK(strstr(err, "no stored world a turn began from") != NULL);
  free(err);
  CHECK_INT(run(2, bare), 2);
  err = slurp(ERR, &length);
  CHECK(strstr(err, "sproutc parse <world.sproutworld> --readings <file>") != NULL);
  free(err);
}

int main(void) {
  char path[1024];
  size_t length;
  char *cartridge;
  snprintf(path, sizeof path, "%s/unknown-word.sproutworld", SPROUT_CARTRIDGES);
  cartridge = slurp(path, &length);
  put(WORLD, cartridge, length);
  free(cartridge);
  RUN(two_forms_are_alike_whatever_order_their_members_come_in);
  RUN(an_answer_and_a_fault_are_written_as_the_typescript_parser_records_them);
  RUN(a_reading_is_written_with_its_bindings_the_turns_after_it_the_draw_and_the_corrections);
  RUN(each_turn_that_read_words_is_compared_over_the_world_it_began_from);
  RUN(a_turn_with_no_world_to_begin_from_and_a_bad_command_line_are_refused);
  remove(WORLD);
  remove(READINGS);
  remove(OUT);
  remove(ERR);
  return REPORT();
}
