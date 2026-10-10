/*
 * Tests for src/turn/wake.c: a wake runs the `on :woke` handler of the object that asked for it, with the seconds
 * since it asked; it is consumed whether or not it faults, so it is never tried twice (the spec's The runtime >
 * Turns and Wakes).
 */
#include "turn_fixture.h"

static sprout_turn_input wake_of(const char *object, uint64_t serial, uint64_t instant) {
  sprout_turn_input input = tw_input(SPROUT_TURN_WAKE, instant);
  input.object = object;
  input.serial = serial;
  return input;
}

static uint64_t light(turn_world *w, const char *target, uint64_t instant) {
  sprout_outcome out;
  char id[64];
  const sprout_stored_instance *fuse;
  tw_do(w, "v-marta", "light", target, instant, &out);
  sprout_outcome_free(&out);
  snprintf(id, sizeof id, "turn_faults.%s", target);
  fuse = tw_instance(w, id);
  CHECK(fuse != NULL && fuse->wake_count == 1);
  return fuse != NULL && fuse->wake_count == 1 ? fuse->wakes[0].serial : 0;
}

static void a_wake_is_delivered_with_the_seconds_since_it_was_asked_and_is_consumed(void) {
  turn_world w;
  sprout_outcome out;
  uint64_t serial;
  tw_open(&w, "turn-faults");
  tw_arrive(&w, "v-marta", "Marta", 1000, &out);
  sprout_outcome_free(&out);
  serial = light(&w, "porch.fuse", 1000);
  CHECK_INT(tw_run(&w, wake_of("turn_faults.porch.fuse", serial, 1065), 0, &out), SPROUT_OK);
  CHECK_INT(out.result, SPROUT_RESULT_DONE);
  CHECK(out.committed && out.state_changed);
  CHECK(tw_told(&out, "v-marta", "The fuse burns down."));
  CHECK_INT(out.elapsed, 65);
  CHECK_INT(out.log.kind, SPROUT_TURN_WAKE);
  CHECK_INT(out.log.wake_serial, serial);
  CHECK_INT(tw_instance(&w, "turn_faults.porch.fuse")->wake_count, 0);
  sprout_outcome_free(&out);
  /* The same wake again finds nothing pending: idle, and nothing is written. */
  CHECK_INT(tw_run(&w, wake_of("turn_faults.porch.fuse", serial, 1070), 0, &out), SPROUT_OK);
  CHECK_INT(out.result, SPROUT_RESULT_IDLE);
  CHECK(!out.committed && !out.has_log);
  sprout_outcome_free(&out);
  tw_close(&w);
}

static void a_wake_before_it_is_due_is_the_hosts_defect_and_stays_pending(void) {
  turn_world w;
  sprout_outcome out;
  uint64_t serial;
  tw_open(&w, "turn-faults");
  tw_arrive(&w, "v-marta", "Marta", 1000, &out);
  sprout_outcome_free(&out);
  serial = light(&w, "porch.fuse", 1000);
  CHECK_INT(tw_run(&w, wake_of("turn_faults.porch.fuse", serial, 1059), 0, &out), SPROUT_BAD_INPUT);
  CHECK(strstr(out.fault.text, "due later") != NULL);
  CHECK_INT(tw_instance(&w, "turn_faults.porch.fuse")->wake_count, 1);
  sprout_outcome_free(&out);
  tw_close(&w);
}

static void a_wake_that_faults_is_consumed_and_nothing_else_is_written(void) {
  turn_world w;
  sprout_outcome out;
  uint64_t serial;
  tw_open(&w, "turn-faults");
  tw_arrive(&w, "v-marta", "Marta", 1000, &out);
  sprout_outcome_free(&out);
  tw_do(&w, "v-marta", "crack", "porch.dud", 1000, &out);
  sprout_outcome_free(&out);
  serial = light(&w, "porch.dud", 1001);
  CHECK_INT(tw_run(&w, wake_of("turn_faults.porch.dud", serial, 1100), 0, &out), SPROUT_OK);
  CHECK_INT(out.result, SPROUT_RESULT_FAULTED);
  CHECK(out.faulted && !out.committed && out.state_changed);
  CHECK_STR(out.fault_name, "IntegerOverflow");
  CHECK_INT(out.line_count, 0);
  CHECK_INT(tw_instance(&w, "turn_faults.porch.dud")->wake_count, 0);
  CHECK_INT(tw_property(&w, "turn_faults.porch.dud", "cracked"), 1);
  sprout_outcome_free(&out);
  tw_close(&w);
}

int main(void) {
  RUN(a_wake_is_delivered_with_the_seconds_since_it_was_asked_and_is_consumed);
  RUN(a_wake_before_it_is_due_is_the_hosts_defect_and_stays_pending);
  RUN(a_wake_that_faults_is_consumed_and_nothing_else_is_written);
  return REPORT();
}
