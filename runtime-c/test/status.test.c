/* Tests for src/status.c: every status has words, and the bodies not yet built say so. */
#include "sprout.h"
#include "check.h"

static void every_status_has_text_a_host_can_show(void) {
  sprout_status all[] = {SPROUT_OK,       SPROUT_NOT_YET,   SPROUT_NO_MEMORY, SPROUT_BAD_HOST,
                         SPROUT_BAD_SEED, SPROUT_BAD_INPUT, SPROUT_FAULT};
  for (size_t i = 0; i < sizeof all / sizeof all[0]; i++) {
    const char *words = sprout_status_text(all[i]);
    CHECK(words != NULL && strlen(words) > 10);
    for (size_t j = 0; j < i; j++) CHECK(strcmp(words, sprout_status_text(all[j])) != 0);
  }
  CHECK(strlen(sprout_status_text((sprout_status)99)) > 10);
}

static void loading_and_running_a_turn_say_they_are_not_built_yet(void) {
  sprout_host host;
  sprout_world *world = (sprout_world *)&host;
  sprout_turn turn = {SPROUT_TURN_COMMAND, "v-1", "look", 4};
  sprout_outcome outcome;
  memset(&host, 0, sizeof host);
  outcome.faulted = true;
  CHECK_INT(sprout_load(&host, "{}", 2, &world), SPROUT_NOT_YET);
  CHECK(world == NULL);
  CHECK_INT(sprout_run_turn(NULL, NULL, &turn, &outcome), SPROUT_NOT_YET);
  CHECK(!outcome.faulted);
  CHECK(strstr(sprout_status_text(SPROUT_NOT_YET), "not built yet") != NULL);
}

int main(void) {
  RUN(every_status_has_text_a_host_can_show);
  RUN(loading_and_running_a_turn_say_they_are_not_built_yet);
  return REPORT();
}
