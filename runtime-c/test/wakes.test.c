/*
 * Tests for src/wakes.c (the spec's Time > Wakes; Limits > Runtime budgets):
 * a `wake` asks for one wake under the world's next serial, due no sooner
 * than the host's floor; one past the host's cap faults; wakes are kept
 * oldest first; `cancel wakes` takes back every wake the object has pending
 * and with none does nothing. Nothing reads a clock: the instant is the one
 * the turn was handed.
 */
#include "exec_fixture.h"
#include "stmt/stmt.h"

static const sprout_stored_instance *runner(exec_case *c) {
  return sprout_draft_instance(&c->draft, exec_str("exec_bench.hall.runner"));
}

static void a_wake_is_raised_to_the_hosts_shortest_and_due_from_the_turns_instant(void) {
  exec_bench b;
  exec_case c;
  exec_bench_open(&b);
  exec_case_open(&b, &c, exec_named(&b, "a wake is raised to the host’s shortest"));
  CHECK_INT(sprout_wake_ask(&c.x, &c.frame, 5), SPROUT_EVAL_OK);
  CHECK_INT(runner(&c)->wake_count, 1);
  CHECK_INT(runner(&c)->wakes[0].asked_at, 1000);
  CHECK_INT(runner(&c)->wakes[0].due_at, 1060);
  exec_case_close(&c);
  exec_bench_close(&b);
}

static void a_wake_asked_for_longer_than_the_floor_is_kept(void) {
  exec_bench b;
  exec_case c;
  exec_bench_open(&b);
  exec_case_open(&b, &c, exec_named(&b, "a wake asked for longer is kept"));
  CHECK_INT(sprout_wake_ask(&c.x, &c.frame, 3 * 3600), SPROUT_EVAL_OK);
  CHECK_INT(runner(&c)->wakes[0].due_at, 1000 + 3 * 3600);
  exec_case_close(&c);
  exec_bench_close(&b);
}

static void a_wake_past_the_pending_cap_faults_and_writes_nothing(void) {
  exec_bench b;
  exec_case c;
  exec_bench_open(&b);
  exec_case_open(&b, &c, exec_named(&b, "a wake past the pending cap faults"));
  CHECK_INT(sprout_wake_ask(&c.x, &c.frame, 120), SPROUT_EVAL_OK);
  CHECK_INT(sprout_wake_ask(&c.x, &c.frame, 180), SPROUT_EVAL_FAULT);
  CHECK_STR(c.fault.name, "WakeFault");
  CHECK_STR(c.fault.text, "`exec_bench.hall.runner` asked for a wake with 1 pending, and this host allows 1.");
  CHECK_INT(runner(&c)->wake_count, 1);
  exec_case_close(&c);
  exec_bench_close(&b);
}

static void wakes_are_kept_oldest_first_by_when_they_fall_due(void) {
  exec_bench b;
  exec_case c;
  exec_bench_open(&b);
  exec_case_open(&b, &c, exec_named(&b, "wakes are kept oldest first"));
  CHECK_INT(sprout_wake_ask(&c.x, &c.frame, 3 * 3600), SPROUT_EVAL_OK);
  CHECK_INT(sprout_wake_ask(&c.x, &c.frame, 120), SPROUT_EVAL_OK);
  CHECK_INT(runner(&c)->wake_count, 2);
  CHECK_INT(runner(&c)->wakes[0].due_at, 1120);
  CHECK_INT(runner(&c)->wakes[1].due_at, 1000 + 3 * 3600);
  CHECK(runner(&c)->wakes[0].serial > runner(&c)->wakes[1].serial);
  exec_case_close(&c);
  exec_bench_close(&b);
}

static void cancel_wakes_takes_back_every_pending_wake(void) {
  exec_bench b;
  exec_case c;
  exec_bench_open(&b);
  exec_case_open(&b, &c, exec_named(&b, "cancel wakes takes back every pending wake"));
  CHECK_INT(runner(&c)->wake_count, 1);
  CHECK_INT(sprout_wake_cancel(&c.x, &c.frame), SPROUT_EVAL_OK);
  CHECK_INT(runner(&c)->wake_count, 0);
  /* With none pending it does nothing, and a wake may be asked again. */
  CHECK_INT(sprout_wake_cancel(&c.x, &c.frame), SPROUT_EVAL_OK);
  CHECK_INT(sprout_wake_ask(&c.x, &c.frame, 180), SPROUT_EVAL_OK);
  CHECK_INT(runner(&c)->wake_count, 1);
  exec_case_close(&c);
  exec_bench_close(&b);
}

static void the_golden_wake_cases_end_as_the_typescript_runtime_did(void) {
  exec_bench b;
  exec_bench_open(&b);
  CHECK(exec_replay_area(&b, "wake") >= 8);
  exec_bench_close(&b);
  CHECK_INT(b.heap.pages, 0);
}

int main(void) {
  RUN(a_wake_is_raised_to_the_hosts_shortest_and_due_from_the_turns_instant);
  RUN(a_wake_asked_for_longer_than_the_floor_is_kept);
  RUN(a_wake_past_the_pending_cap_faults_and_writes_nothing);
  RUN(wakes_are_kept_oldest_first_by_when_they_fall_due);
  RUN(cancel_wakes_takes_back_every_pending_wake);
  RUN(the_golden_wake_cases_end_as_the_typescript_runtime_did);
  return REPORT();
}
