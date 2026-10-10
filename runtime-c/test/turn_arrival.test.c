/*
 * Tests for src/turn/arrival.c: a visitor admitted to the world is put at the place visitors arrive at and told
 * what is there; a place that refuses them writes nothing and says so in its own words; an arrival that faults
 * leaves the world as it was (the spec's The runtime > Turns).
 */
#include "turn_fixture.h"

static void an_arrival_puts_the_visitor_at_the_arrival_place_and_describes_it(void) {
  turn_world w;
  sprout_outcome out;
  char *before, *after;
  tw_open(&w, "turn-faults");
  before = tw_bytes(&w);
  tw_arrive(&w, "v-marta", "Marta", 1000, &out);
  after = tw_bytes(&w);
  CHECK_INT(out.result, SPROUT_RESULT_DONE);
  CHECK(out.committed && out.state_changed && !out.faulted);
  CHECK(tw_told(&out, "v-marta", "A stone porch, and a steep stair going down."));
  CHECK(out.has_log);
  CHECK_INT(out.log.kind, SPROUT_TURN_ARRIVAL);
  CHECK_BYTES(out.log.nickname.bytes, out.log.nickname.length, "Marta");
  CHECK_INT(out.log.seconds, 1000);
  CHECK(strcmp(tw_person(&w, "v-marta"), "") != 0);
  CHECK(strcmp(before, after) != 0);
  sprout_outcome_free(&out);
  free(before);
  free(after);
  tw_close(&w);
}

static void a_place_that_refuses_the_arrival_is_heard_and_writes_nothing(void) {
  turn_world w;
  sprout_outcome out, barred;
  sprout_filling filling;
  sprout_reading bar;
  char *before, *after;
  tw_open(&w, "turn-faults");
  tw_arrive(&w, "v-marta", "Marta", 1000, &out);
  sprout_outcome_free(&out);
  bar = tw_reading("turn_faults.bar", tw_person(&w, "v-marta"), &filling, "target", "turn_faults.porch");
  tw_command(&w, "v-marta", &bar, 1001, &barred);
  sprout_outcome_free(&barred);
  before = tw_bytes(&w);
  tw_arrive(&w, "v-ines", "Ines", 1002, &out);
  after = tw_bytes(&w);
  CHECK_INT(out.result, SPROUT_RESULT_REFUSED);
  CHECK(!out.committed && !out.state_changed);
  CHECK(tw_told(&out, "v-ines", "The porch door is barred against you."));
  CHECK(strcmp(after, before) == 0);
  sprout_outcome_free(&out);
  free(before);
  free(after);
  tw_close(&w);
}

int main(void) {
  RUN(an_arrival_puts_the_visitor_at_the_arrival_place_and_describes_it);
  RUN(a_place_that_refuses_the_arrival_is_heard_and_writes_nothing);
  return REPORT();
}
