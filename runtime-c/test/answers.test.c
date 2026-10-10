/*
 * Tests for src/answers.c: a person who moved reads the place they arrived in, and one who typed `look` reads
 * the place they stand in, both after what the turn's bodies said (the spec's Verbs > Engine verbs; The runtime
 * > Effects).
 */
#include "turn_fixture.h"

static void a_person_who_moved_reads_the_place_they_arrived_in(void) {
  turn_world w;
  sprout_outcome out;
  tw_open(&w, "turn-faults");
  tw_arrive(&w, "v-marta", "Marta", 1000, &out);
  sprout_outcome_free(&out);
  tw_go(&w, "v-marta", "down", "down the stair", "cellar", 1001, &out);
  CHECK_INT(out.result, SPROUT_RESULT_DONE);
  CHECK(tw_told(&out, "v-marta", "A cold cellar."));
  CHECK_INT(out.line_count, 1);
  if (out.line_count == 1) CHECK_INT(out.lines[0].kind, SPROUT_LINE_DESCRIBED);
  sprout_outcome_free(&out);
  tw_close(&w);
}

static void a_look_is_answered_with_the_place_and_a_body_that_spoke_is_heard_alone(void) {
  turn_world w;
  sprout_outcome out;
  sprout_reading look;
  sprout_filling none;
  tw_open(&w, "turn-faults");
  tw_arrive(&w, "v-marta", "Marta", 1000, &out);
  sprout_outcome_free(&out);
  look = tw_reading("sprout.look", tw_person(&w, "v-marta"), &none, NULL, NULL);
  tw_command(&w, "v-marta", &look, 1001, &out);
  CHECK_INT(out.result, SPROUT_RESULT_DONE);
  CHECK(tw_told(&out, "v-marta", "A stone porch, and a steep stair going down."));
  sprout_outcome_free(&out);
  tw_do(&w, "v-marta", "crack", "porch.dud", 1002, &out);
  CHECK_INT(out.line_count, 1);
  CHECK(tw_told(&out, "v-marta", "The fuse splits along its length."));
  sprout_outcome_free(&out);
  tw_close(&w);
}

int main(void) {
  RUN(a_person_who_moved_reads_the_place_they_arrived_in);
  RUN(a_look_is_answered_with_the_place_and_a_body_that_spoke_is_heard_alone);
  return REPORT();
}
