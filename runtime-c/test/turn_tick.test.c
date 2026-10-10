/*
 * Tests for src/turn/tick.c: a tick runs a place's `on :tick` handler with the seconds since its last tick,
 * only while a visitor is there to hear it; time that runs backwards is refused with text, and a tick that
 * faults leaves the world as it was (the spec's The runtime > Turns).
 */
#include "turn_fixture.h"

static sprout_turn_input tick_of(const char *place, uint64_t instant) {
  sprout_turn_input input = tw_input(SPROUT_TURN_TICK, instant);
  input.place = place;
  return input;
}

static void a_tick_tells_the_visitors_there_and_hands_the_place_the_seconds_since_its_last(void) {
  turn_world w;
  sprout_outcome out;
  tw_open(&w, "turn-faults");
  tw_arrive(&w, "v-marta", "Marta", 1000, &out);
  sprout_outcome_free(&out);
  CHECK_INT(tw_run(&w, tick_of("turn_faults.porch", 1010), 0, &out), SPROUT_OK);
  CHECK_INT(out.result, SPROUT_RESULT_DONE);
  CHECK(tw_told(&out, "v-marta", "The porch boards creak."));
  CHECK_INT(out.elapsed, 0);
  CHECK_INT(out.log.kind, SPROUT_TURN_TICK);
  CHECK_INT(tw_instance(&w, "turn_faults.porch")->last_tick, 1010);
  sprout_outcome_free(&out);
  CHECK_INT(tw_run(&w, tick_of("turn_faults.porch", 1040), 0, &out), SPROUT_OK);
  CHECK_INT(out.elapsed, 30);
  sprout_outcome_free(&out);
  tw_close(&w);
}

static void a_place_nobody_stands_in_is_not_ticked(void) {
  turn_world w;
  sprout_outcome out;
  char *before, *after;
  tw_open(&w, "turn-faults");
  tw_arrive(&w, "v-marta", "Marta", 1000, &out);
  sprout_outcome_free(&out);
  before = tw_bytes(&w);
  CHECK_INT(tw_run(&w, tick_of("turn_faults.cellar", 1010), 0, &out), SPROUT_OK);
  after = tw_bytes(&w);
  CHECK_INT(out.result, SPROUT_RESULT_IDLE);
  CHECK(!out.committed && !out.has_log);
  CHECK(strcmp(before, after) == 0);
  sprout_outcome_free(&out);
  free(before);
  free(after);
  tw_close(&w);
}

static void time_that_runs_backwards_and_things_that_are_not_places_are_refused_with_text(void) {
  turn_world w;
  sprout_outcome out;
  tw_open(&w, "turn-faults");
  tw_arrive(&w, "v-marta", "Marta", 1000, &out);
  sprout_outcome_free(&out);
  CHECK_INT(tw_run(&w, tick_of("turn_faults.porch", 1100), 0, &out), SPROUT_OK);
  sprout_outcome_free(&out);
  CHECK_INT(tw_run(&w, tick_of("turn_faults.porch", 1099), 0, &out), SPROUT_BAD_INPUT);
  CHECK(strstr(out.fault.text, "time does not run backwards") != NULL);
  sprout_outcome_free(&out);
  CHECK_INT(tw_run(&w, tick_of("turn_faults.porch.fuse", 1200), 0, &out), SPROUT_BAD_INPUT);
  CHECK(strstr(out.fault.text, "holds no actors") != NULL);
  sprout_outcome_free(&out);
  CHECK_INT(tw_run(&w, tick_of("turn_faults.nowhere", 1200), 0, &out), SPROUT_BAD_INPUT);
  CHECK(strstr(out.fault.text, "turn_faults.nowhere") != NULL);
  sprout_outcome_free(&out);
  CHECK_INT(tw_run(&w, tw_input(SPROUT_TURN_TICK, 1200), 0, &out), SPROUT_BAD_INPUT);
  CHECK(strlen(out.fault.text) > 0);
  sprout_outcome_free(&out);
  tw_close(&w);
}

static void a_tick_that_faults_leaves_the_world_byte_for_byte_as_it_was(void) {
  turn_world w;
  sprout_outcome out;
  char *before, *after;
  tw_open(&w, "turn-faults");
  tw_arrive(&w, "v-marta", "Marta", 1000, &out);
  sprout_outcome_free(&out);
  tw_go(&w, "v-marta", "down", "down the stair", "cellar", 1001, &out);
  sprout_outcome_free(&out);
  tw_do(&w, "v-marta", "rot", "cellar", 1002, &out);
  sprout_outcome_free(&out);
  before = tw_bytes(&w);
  CHECK_INT(tw_run(&w, tick_of("turn_faults.cellar", 1010), 0, &out), SPROUT_OK);
  after = tw_bytes(&w);
  CHECK_INT(out.result, SPROUT_RESULT_FAULTED);
  CHECK(out.faulted && !out.committed && !out.state_changed);
  CHECK_STR(out.fault_name, "IntegerOverflow");
  CHECK_INT(out.line_count, 0);
  CHECK(strcmp(before, after) == 0);
  sprout_outcome_free(&out);
  free(before);
  free(after);
  tw_close(&w);
}

int main(void) {
  RUN(a_tick_tells_the_visitors_there_and_hands_the_place_the_seconds_since_its_last);
  RUN(a_place_nobody_stands_in_is_not_ticked);
  RUN(time_that_runs_backwards_and_things_that_are_not_places_are_refused_with_text);
  RUN(a_tick_that_faults_leaves_the_world_byte_for_byte_as_it_was);
  return REPORT();
}
