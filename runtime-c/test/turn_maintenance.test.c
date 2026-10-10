/*
 * Tests for src/turn/maintenance.c: catch-up delivers the wakes that fell due while nobody was there, in one
 * turn, and narrates nothing of them; a wake that faults is consumed and the rest are still delivered; a turn
 * with nothing due changes nothing (the spec's The runtime > Catch-up).
 */
#include "turn_fixture.h"

static void catch_up_after_a_long_absence_runs_one_turn_and_narrates_nothing(void) {
  turn_world w;
  sprout_outcome out;
  tw_open(&w, "turn-faults");
  tw_arrive(&w, "v-marta", "Marta", 1000, &out);
  sprout_outcome_free(&out);
  tw_do(&w, "v-marta", "light", "porch.fuse", 1000, &out);
  sprout_outcome_free(&out);
  tw_do(&w, "v-marta", "crack", "porch.dud", 1001, &out);
  sprout_outcome_free(&out);
  tw_do(&w, "v-marta", "light", "porch.dud", 1002, &out);
  sprout_outcome_free(&out);
  CHECK_INT(tw_run(&w, tw_input(SPROUT_TURN_MAINTENANCE, 1000 + 3600), 0, &out), SPROUT_OK);
  CHECK_INT(out.result, SPROUT_RESULT_DONE);
  CHECK(out.committed && out.state_changed);
  CHECK_INT(out.line_count, 0);
  CHECK(out.has_log);
  CHECK_INT(out.log.kind, SPROUT_TURN_MAINTENANCE);
  CHECK_INT(out.log.delivered_count, 1);
  CHECK_INT(out.log.faulted_count, 1);
  CHECK_INT(out.log.abandoned_count, 0);
  if (out.log.delivered_count == 1) CHECK_BYTES(out.log.delivered[0].object.bytes, out.log.delivered[0].object.length, "turn_faults.porch.fuse");
  if (out.log.faulted_count == 1) {
    CHECK_BYTES(out.log.faulted_wakes[0].object.bytes, out.log.faulted_wakes[0].object.length, "turn_faults.porch.dud");
    CHECK_STR(out.log.faulted_wakes[0].fault_name, "IntegerOverflow");
  }
  CHECK_INT(tw_instance(&w, "turn_faults.porch.fuse")->wake_count, 0);
  CHECK_INT(tw_instance(&w, "turn_faults.porch.dud")->wake_count, 0);
  sprout_outcome_free(&out);
  tw_close(&w);
}

static void catch_up_with_nothing_due_writes_nothing_and_changes_nothing(void) {
  turn_world w;
  sprout_outcome out;
  char *before, *after;
  tw_open(&w, "turn-faults");
  tw_arrive(&w, "v-marta", "Marta", 1000, &out);
  sprout_outcome_free(&out);
  tw_do(&w, "v-marta", "light", "porch.fuse", 1000, &out);
  sprout_outcome_free(&out);
  before = tw_bytes(&w);
  CHECK_INT(tw_run(&w, tw_input(SPROUT_TURN_MAINTENANCE, 1030), 0, &out), SPROUT_OK);
  after = tw_bytes(&w);
  CHECK(!out.state_changed && out.has_log);
  CHECK_INT(out.log.delivered_count + out.log.faulted_count + out.log.abandoned_count, 0);
  CHECK_INT(out.line_count, 0);
  CHECK(strcmp(before, after) == 0);
  sprout_outcome_free(&out);
  free(before);
  free(after);
  tw_close(&w);
}

int main(void) {
  RUN(catch_up_after_a_long_absence_runs_one_turn_and_narrates_nothing);
  RUN(catch_up_with_nothing_due_writes_nothing_and_changes_nothing);
  return REPORT();
}
