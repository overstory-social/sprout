/*
 * Tests for src/turn/departure.c: a visitor who leaves is told so and taken out of the world; a departure that
 * faults still takes them out, quietly, and says what went wrong (the spec's The runtime > Turns).
 */
#include "turn_fixture.h"

static void a_departure_takes_the_visitor_out_of_the_world_and_tells_them_so(void) {
  turn_world w;
  sprout_outcome out;
  sprout_turn_input input = tw_input(SPROUT_TURN_DEPARTURE, 1001);
  tw_open(&w, "turn-faults");
  tw_arrive(&w, "v-marta", "Marta", 1000, &out);
  sprout_outcome_free(&out);
  CHECK(tw_instance(&w, tw_person(&w, "v-marta")) != NULL);
  input.visit = "v-marta";
  CHECK_INT(tw_run(&w, input, 0, &out), SPROUT_OK);
  CHECK_INT(out.result, SPROUT_RESULT_DONE);
  CHECK(out.committed && out.state_changed);
  CHECK(tw_told(&out, "v-marta", "You leave, and take what you carry with you."));
  CHECK(out.has_log);
  CHECK_INT(out.log.kind, SPROUT_TURN_DEPARTURE);
  sprout_outcome_free(&out);
  tw_close(&w);
}

static void a_departure_that_faults_still_removes_the_visitor_and_says_it_faulted(void) {
  turn_world w;
  sprout_outcome out;
  sprout_turn_input input = tw_input(SPROUT_TURN_DEPARTURE, 1003);
  tw_open(&w, "turn-faults");
  tw_arrive(&w, "v-marta", "Marta", 1000, &out);
  sprout_outcome_free(&out);
  tw_go(&w, "v-marta", "down", "down the stair", "cellar", 1001, &out);
  sprout_outcome_free(&out);
  tw_do(&w, "v-marta", "rot", "cellar", 1002, &out);
  sprout_outcome_free(&out);
  input.visit = "v-marta";
  CHECK_INT(tw_run(&w, input, 0, &out), SPROUT_OK);
  CHECK_INT(out.result, SPROUT_RESULT_FAULTED);
  CHECK(out.faulted && out.state_changed);
  CHECK_STR(out.fault_name, "IntegerOverflow");
  CHECK(tw_told(&out, "v-marta", "You leave, and take what you carry with you."));
  sprout_outcome_free(&out);
  CHECK_INT(tw_run(&w, input, 0, &out), SPROUT_BAD_INPUT);
  CHECK(strlen(out.fault.text) > 0);
  sprout_outcome_free(&out);
  tw_close(&w);
}

static void a_departure_of_someone_who_never_came_is_the_hosts_defect(void) {
  turn_world w;
  sprout_outcome out;
  sprout_turn_input input = tw_input(SPROUT_TURN_DEPARTURE, 1000);
  tw_open(&w, "turn-faults");
  input.visit = "v-nobody";
  CHECK_INT(tw_run(&w, input, 0, &out), SPROUT_BAD_INPUT);
  CHECK(strstr(out.fault.text, "v-nobody") != NULL);
  sprout_outcome_free(&out);
  tw_close(&w);
}

int main(void) {
  RUN(a_departure_takes_the_visitor_out_of_the_world_and_tells_them_so);
  RUN(a_departure_that_faults_still_removes_the_visitor_and_says_it_faulted);
  RUN(a_departure_of_someone_who_never_came_is_the_hosts_defect);
  return REPORT();
}
