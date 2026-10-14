/*
 * Tests for host/steps.c: a script read into steps, each with the line the typed grammar writes for it and the
 * clock and seed it begins under, and a script that is not one refused in words naming the step.
 */
#include "steps.h"
#include "host.h"
#include "check.h"

static const char *PATH = "sproutc-steps-test.json";

static void written(const char *text) {
  FILE *file = fopen(PATH, "wb");
  if (file == NULL) exit(2);
  fputs(text, file);
  fclose(file);
}

static void steps_read_with_their_line_clock_seed_and_kind(void) {
  sproutc_host host;
  sproutc_steps steps;
  sproutc_host_init(&host, stdout, NULL);
  written("{\"about\":\"a walk\",\"steps\":["
          "{\"comment\":\"in\"},"
          "{\"arrive\":\"Ines\"},"
          "{\"seed\":7},"
          "{\"as\":\"Ines\",\"type\":\"north\",\"expect\":[{\"words\":\"A cave.\"}]},"
          "{\"advance\":\"40 minutes\"},"
          "{\"tick\":true},"
          "{\"advance\":\"2 hours\",\"expect\":[]},"
          "{\"leave\":\"Ines\"}]}");
  CHECK(sproutc_steps_open(&steps, &host.record, PATH) == NULL);
  CHECK_INT(steps.count, 8);
  CHECK_INT(steps.steps[0].kind, SPROUTC_STEP_COMMENT);
  CHECK_STR(steps.steps[0].line, "# in");
  CHECK_INT(steps.steps[1].kind, SPROUTC_STEP_ARRIVE);
  CHECK_STR(steps.steps[1].nickname, "Ines");
  CHECK_STR(steps.steps[1].line, "@arrive Ines");
  CHECK_INT(steps.steps[1].seed, 0);
  CHECK_STR(steps.steps[2].line, "@seed 7");
  CHECK_INT(steps.steps[3].kind, SPROUTC_STEP_COMMAND);
  CHECK_STR(steps.steps[3].typed, "north");
  CHECK_STR(steps.steps[3].line, "Ines> north");
  CHECK_INT(steps.steps[3].seed, 7);
  CHECK_INT(steps.steps[3].index, 3);
  CHECK_INT(steps.steps[4].kind, SPROUTC_STEP_ADVANCE);
  CHECK_INT(steps.steps[4].for_seconds, 2400);
  CHECK_INT(steps.steps[4].at_seconds, 0);
  CHECK_STR(steps.steps[5].line, "@tick");
  CHECK_INT(steps.steps[5].at_seconds, 2400);
  CHECK_INT(steps.steps[6].for_seconds, 7200);
  CHECK_INT(steps.steps[7].kind, SPROUTC_STEP_LEAVE);
  CHECK_INT(steps.steps[7].at_seconds, 9600);
  CHECK_INT(steps.steps[7].seed, 7);
  sproutc_steps_close(&steps);
  CHECK_INT(host.pages, 0);
  sproutc_host_close(&host);
  remove(PATH);
}

/* Each refusal names the step and says what to write, as the player's own reader does. */
static void a_script_that_is_not_one_is_refused_in_words(void) {
  sproutc_host host;
  sproutc_steps steps;
  const char *why;
  sproutc_host_init(&host, stdout, NULL);
  CHECK(strstr(sproutc_steps_open(&steps, &host.record, "sproutc-no-such-script.json"), "there is no script at") != NULL);
  written("{\"steps\":[{\"arrive\":\"Ines\"},{\"advance\":\"a while\"}]}");
  why = sproutc_steps_open(&steps, &host.record, PATH);
  CHECK(why != NULL && strstr(why, "step 2: write how long passes, as in") != NULL);
  written("{\"steps\":[{\"arrive\":\"Ines\",\"leave\":\"Ines\"}]}");
  why = sproutc_steps_open(&steps, &host.record, PATH);
  CHECK(why != NULL && strstr(why, "step 1: a step is `{ \"as\": \"Marta\", \"type\": \"look\" }`") != NULL);
  written("{\"steps\":[{\"as\":\"  \",\"type\":\"look\"}]}");
  CHECK(sproutc_steps_open(&steps, &host.record, PATH) != NULL);
  written("{\"steps\":[{\"seed\":-1}]}");
  CHECK(sproutc_steps_open(&steps, &host.record, PATH) != NULL);
  written("{\"turns\":[]}");
  why = sproutc_steps_open(&steps, &host.record, PATH);
  CHECK(why != NULL && strstr(why, "a script is `{ \"steps\": [ … ] }`") != NULL);
  written("{");
  why = sproutc_steps_open(&steps, &host.record, PATH);
  CHECK(why != NULL && strstr(why, "is not JSON, at line 1") != NULL);
  CHECK_INT(host.pages, 0);
  sproutc_host_close(&host);
  remove(PATH);
}

int main(void) {
  RUN(steps_read_with_their_line_clock_seed_and_kind);
  RUN(a_script_that_is_not_one_is_refused_in_words);
  return REPORT();
}
