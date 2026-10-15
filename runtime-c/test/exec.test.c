/*
 * Tests for src/exec.c: every case the golden holds
 * (corpus/goldens/exec.json) is run here against the same cartridge and
 * stored worlds, and must end as the golden holds: the same committed state or
 * the same fault, the same steps, the same effects in the same order, the
 * same handlers run and descriptions owed. The nineteen kinds of statement
 * are all among them. A `wake` whose count is worked out is run through the
 * corpus world `wake-delay`, whose timer waits as many minutes as it was
 * wound to: the count is evaluated as the statement runs.
 */
#include "exec_fixture.h"
#include "turn_fixture.h"

static void every_golden_case_ends_as_the_typescript_runtime_did(void) {
  exec_bench b;
  size_t replayed;
  exec_bench_open(&b);
  replayed = exec_replay_area(&b, NULL);
  CHECK(replayed > 90);
  exec_bench_close(&b);
  CHECK_INT(b.heap.pages, 0);
}

static const sprout_stored_instance *timer(turn_world *w) { return tw_instance(w, "wake_delay.kitchen.timer"); }

static void a_worked_out_count_is_evaluated_as_the_wake_runs(void) {
  turn_world w;
  sprout_outcome out;
  tw_open(&w, "wake-delay");
  tw_arrive(&w, "v-marta", "Marta", 1000, &out);
  sprout_outcome_free(&out);
  tw_do(&w, "v-marta", "wind", "kitchen.timer", 1000, &out);
  sprout_outcome_free(&out);
  tw_do(&w, "v-marta", "start", "kitchen.timer", 1000, &out);
  CHECK_INT(out.result, SPROUT_RESULT_DONE);
  CHECK(tw_told(&out, "v-marta", "The timer starts ticking."));
  sprout_outcome_free(&out);
  CHECK_INT(timer(&w)->wake_count, 1);
  CHECK_INT(timer(&w)->wakes[0].due_at, 1000 + 2 * 60);
  tw_close(&w);
}

static void a_short_worked_out_count_is_raised_to_the_hosts_shortest(void) {
  turn_world w;
  sprout_outcome out;
  tw_open(&w, "wake-delay");
  tw_arrive(&w, "v-marta", "Marta", 1000, &out);
  sprout_outcome_free(&out);
  tw_do(&w, "v-marta", "start", "kitchen.timer", 1000, &out);
  CHECK_INT(out.result, SPROUT_RESULT_DONE);
  sprout_outcome_free(&out);
  CHECK_INT(timer(&w)->wake_count, 1);
  CHECK_INT(timer(&w)->wakes[0].due_at, 1060);
  tw_close(&w);
}

static void a_worked_out_count_below_nothing_faults_and_asks_for_nothing(void) {
  turn_world w;
  sprout_outcome out;
  tw_open(&w, "wake-delay");
  tw_arrive(&w, "v-marta", "Marta", 1000, &out);
  sprout_outcome_free(&out);
  tw_do(&w, "v-marta", "unwind", "kitchen.timer", 1000, &out);
  sprout_outcome_free(&out);
  tw_do(&w, "v-marta", "start", "kitchen.timer", 1000, &out);
  CHECK_INT(out.result, SPROUT_RESULT_FAULTED);
  CHECK_STR(out.fault_name, "WakeFault");
  CHECK(strstr(out.fault.text, "asked for a wake in -1 minutes") != NULL);
  CHECK(!out.committed);
  sprout_outcome_free(&out);
  CHECK_INT(timer(&w)->wake_count, 0);
  CHECK_INT(tw_property(&w, "wake_delay.kitchen.timer", "minutes"), -1);
  tw_close(&w);
}

int main(void) {
  RUN(every_golden_case_ends_as_the_typescript_runtime_did);
  RUN(a_worked_out_count_is_evaluated_as_the_wake_runs);
  RUN(a_short_worked_out_count_is_raised_to_the_hosts_shortest);
  RUN(a_worked_out_count_below_nothing_faults_and_asks_for_nothing);
  return REPORT();
}
