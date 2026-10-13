/*
 * Tests for host/readings.c: a readings file read into steps and turns, a skipped turn marked, what the parser read
 * beside each turn, a reading's fillers and the budgets a script was played under, and a bad file refused in words.
 */
#include "reading_json.h"
#include "readings.h"
#include "host.h"
#include "check.h"

static const char *PATH = "sproutc-readings-test.json";

static void written(const char *text) {
  FILE *file = fopen(PATH, "wb");
  if (file == NULL) exit(2);
  fputs(text, file);
  fclose(file);
}

static const char *SAMPLE =
    "{\"format\":1,\"script\":\"order.json\",\"steps\":["
    "{\"index\":0,\"line\":\"@arrive Ines\",\"atSeconds\":0,\"seed\":3,\"kind\":\"arrive\",\"nickname\":\"Ines\"},"
    "{\"index\":1,\"line\":\"Ines> north\",\"atSeconds\":0,\"seed\":3,\"kind\":\"command\",\"nickname\":\"Ines\",\"typed\":\"north\",\"turns\":["
    "{\"typed\":\"north\",\"seed\":3,\"skip\":false,\"verb\":\"sprout.go\",\"actor\":\"w#1\",\"fillers\":["
    "{\"role\":\"way\",\"binds\":\"exit\",\"direction\":\"north\",\"label\":\"into the cave\",\"to\":\"w.cave\"}],"
    "\"refused\":false},"
    "{\"typed\":\"sing\",\"seed\":4,\"skip\":true,\"why\":\"unknown\"}]},"
    "{\"index\":2,\"line\":\"@advance 40 minutes\",\"atSeconds\":0,\"seed\":3,\"kind\":\"advance\",\"forSeconds\":2400}]}";

static void steps_read_with_their_clock_seed_kind_and_nickname(void) {
  sproutc_host host;
  sproutc_readings readings;
  sproutc_step step;
  sproutc_host_init(&host, stdout, NULL);
  written(SAMPLE);
  CHECK(sproutc_readings_open(&readings, &host.record, PATH) == NULL);
  CHECK_INT(sproutc_readings_count(&readings), 3);
  CHECK(sproutc_readings_step(&readings, 0, &step) == NULL);
  CHECK_INT(step.kind, SPROUTC_STEP_ARRIVE);
  CHECK_INT(step.seed, 3);
  CHECK_STR(step.nickname, "Ines");
  CHECK_STR(step.line, "@arrive Ines");
  CHECK(sproutc_readings_step(&readings, 2, &step) == NULL);
  CHECK_INT(step.kind, SPROUTC_STEP_ADVANCE);
  CHECK_INT(step.for_seconds, 2400);
  CHECK(sproutc_readings_step(&readings, 3, &step) != NULL);
  sproutc_readings_close(&readings);
  CHECK_INT(host.pages, 0);
  sproutc_host_close(&host);
  remove(PATH);
}

static void a_read_turn_carries_its_verb_and_fillers_and_a_skipped_turn_says_why(void) {
  sproutc_host host;
  sproutc_readings readings;
  sproutc_step step;
  sproutc_turn_reading turn;
  sproutc_host_init(&host, stdout, NULL);
  written(SAMPLE);
  CHECK(sproutc_readings_open(&readings, &host.record, PATH) == NULL);
  CHECK(sproutc_readings_step(&readings, 1, &step) == NULL);
  CHECK_STR(step.typed, "north");
  CHECK_INT(step.turns, 2);
  CHECK(sproutc_readings_turn(&step, 0, &turn) == NULL);
  CHECK(!turn.skip);
  CHECK_STR(turn.typed, "north");
  CHECK_STR(turn.verb, "sprout.go");
  CHECK_INT(turn.fillers->count, 1);
  CHECK_STR(sprout_json_get(turn.fillers->items[0], "binds")->bytes, "exit");
  CHECK(sproutc_readings_turn(&step, 1, &turn) == NULL);
  CHECK(turn.skip);
  CHECK_STR(turn.why, "unknown");
  CHECK_INT(turn.seed, 4);
  CHECK(sproutc_readings_turn(&step, 2, &turn) != NULL);
  sproutc_readings_close(&readings);
  sproutc_host_close(&host);
  remove(PATH);
}

static void a_missing_or_unreadable_file_is_refused_in_words(void) {
  sproutc_host host;
  sproutc_readings readings;
  const char *why;
  sproutc_host_init(&host, stdout, NULL);
  why = sproutc_readings_open(&readings, &host.record, "no-such-readings.json");
  CHECK(why != NULL && strstr(why, "resolve-script") != NULL);
  written("{\"format\":2,\"steps\":[]}");
  why = sproutc_readings_open(&readings, &host.record, PATH);
  CHECK(why != NULL && strstr(why, "format 1") != NULL);
  written("{\"format\":");
  why = sproutc_readings_open(&readings, &host.record, PATH);
  CHECK(why != NULL && strstr(why, "not JSON") != NULL);
  CHECK_INT(host.pages, 0);
  sproutc_host_close(&host);
  remove(PATH);
}

static const char *PARSED =
    "{\"format\":1,\"script\":\"p.json\",\"budgets\":{\"steps\":40},\"steps\":["
    "{\"index\":0,\"line\":\"@arrive Ines\",\"atSeconds\":0,\"seed\":3,\"kind\":\"arrive\",\"nickname\":\"Ines\","
    "\"after\":{\"says\":[],\"turns\":[],\"world\":{\"serial\":1}}},"
    "{\"index\":1,\"line\":\"Ines> sing\",\"atSeconds\":0,\"seed\":3,\"kind\":\"command\",\"nickname\":\"Ines\",\"typed\":\"sing\",\"turns\":["
    "{\"typed\":\"sing\",\"seed\":3,\"skip\":true,\"why\":\"unknown\",\"parsed\":{\"steps\":4}},"
    "{\"typed\":\"sing\",\"seed\":4,\"skip\":true,\"why\":\"unknown\",\"handed\":{\"planned\":{}},"
    "\"before\":{\"serial\":2}}]}]}";

static void a_turn_carries_what_the_parser_read_and_a_step_the_world_it_left(void) {
  sproutc_host host;
  sproutc_readings readings;
  sproutc_step step;
  sproutc_turn_reading turn;
  sproutc_host_init(&host, stdout, NULL);
  written(PARSED);
  CHECK(sproutc_readings_open(&readings, &host.record, PATH) == NULL);
  CHECK(sproutc_readings_step(&readings, 0, &step) == NULL);
  CHECK(step.world != NULL && sprout_json_get(step.world, "serial")->number == 1);
  CHECK(sproutc_readings_step(&readings, 1, &step) == NULL);
  CHECK(step.world == NULL);
  CHECK(sproutc_readings_turn(&step, 0, &turn) == NULL);
  CHECK(turn.parsed != NULL && sprout_json_get(turn.parsed, "steps")->number == 4);
  CHECK(turn.handed == NULL && turn.before == NULL);
  CHECK(sproutc_readings_turn(&step, 1, &turn) == NULL);
  CHECK(turn.parsed == NULL && turn.handed != NULL);
  CHECK(turn.before != NULL && sprout_json_get(turn.before, "serial")->number == 2);
  sproutc_readings_close(&readings);
  sproutc_host_close(&host);
  remove(PATH);
}

static void fillers_and_budgets_are_read_as_the_typescript_runtime_names_them(void) {
  sproutc_host host;
  sproutc_readings readings;
  sproutc_step step;
  sproutc_turn_reading turn;
  sprout_filling *fillings;
  size_t count;
  sprout_budgets budgets;
  sproutc_host_init(&host, stdout, NULL);
  written(SAMPLE);
  CHECK(sproutc_readings_open(&readings, &host.record, PATH) == NULL);
  CHECK(sproutc_readings_step(&readings, 1, &step) == NULL);
  CHECK(sproutc_readings_turn(&step, 0, &turn) == NULL);
  CHECK(sprout_fillings_of_tree(&readings.arena, turn.fillers, &fillings, &count) == NULL);
  CHECK_INT(count, 1);
  CHECK_INT(fillings[0].binds, SPROUT_FILL_EXIT);
  CHECK_STR(fillings[0].id, "w.cave");
  CHECK_STR(fillings[0].direction, "north");
  CHECK_STR(fillings[0].label, "into the cave");
  sproutc_readings_close(&readings);
  written(PARSED);
  CHECK(sproutc_readings_open(&readings, &host.record, PATH) == NULL);
  budgets = host.record.budgets;
  CHECK(sproutc_readings_budgets(&budgets, readings.budgets) == NULL);
  CHECK(budgets.steps.set && budgets.steps.value == 40);
  CHECK_INT(budgets.output.value, host.record.budgets.output.value);
  sproutc_readings_close(&readings);
  written("{\"format\":1,\"script\":\"p.json\",\"budgets\":{\"lanterns\":3},\"steps\":[]}");
  CHECK(sproutc_readings_open(&readings, &host.record, PATH) == NULL);
  CHECK(sproutc_readings_budgets(&budgets, readings.budgets) != NULL);
  sproutc_readings_close(&readings);
  CHECK_INT(host.pages, 0);
  sproutc_host_close(&host);
  remove(PATH);
}

int main(void) {
  RUN(steps_read_with_their_clock_seed_kind_and_nickname);
  RUN(a_turn_carries_what_the_parser_read_and_a_step_the_world_it_left);
  RUN(fillers_and_budgets_are_read_as_the_typescript_runtime_names_them);
  RUN(a_read_turn_carries_its_verb_and_fillers_and_a_skipped_turn_says_why);
  RUN(a_missing_or_unreadable_file_is_refused_in_words);
  return REPORT();
}
