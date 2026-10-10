/* Tests for host/readings.c: a readings file read into steps and turns, a skipped turn marked, a bad file refused in words. */
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
    "{\"index\":0,\"line\":\"@arrive Ines\",\"now\":0,\"seed\":3,\"kind\":\"arrive\",\"nickname\":\"Ines\"},"
    "{\"index\":1,\"line\":\"Ines> north\",\"now\":0,\"seed\":3,\"kind\":\"command\",\"nickname\":\"Ines\",\"turns\":["
    "{\"typed\":\"north\",\"seed\":3,\"skip\":false,\"verb\":\"sprout.go\",\"actor\":\"w#1\",\"fillers\":["
    "{\"role\":\"way\",\"binds\":\"exit\",\"direction\":\"north\",\"label\":\"into the cave\",\"to\":\"w.cave\"}],"
    "\"refused\":false},"
    "{\"typed\":\"sing\",\"seed\":4,\"skip\":true,\"why\":\"unknown\"}]},"
    "{\"index\":2,\"line\":\"@advance 40 minutes\",\"now\":0,\"seed\":3,\"kind\":\"advance\",\"seconds\":2400}]}";

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
  CHECK_INT(step.seconds, 2400);
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

int main(void) {
  RUN(steps_read_with_their_clock_seed_kind_and_nickname);
  RUN(a_read_turn_carries_its_verb_and_fillers_and_a_skipped_turn_says_why);
  RUN(a_missing_or_unreadable_file_is_refused_in_words);
  return REPORT();
}
