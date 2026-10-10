/*
 * Tests for src/expr/passes.c: a container with no rule relays, except the
 * world's, which refuses; one with a rule answers by evaluating it with the
 * container as `self`, and the rule's steps are the turn's.
 */
#include "eval_fixture.h"
#include "expr/expr.h"

static void a_container_with_no_rule_relays_and_the_world_refuses(void) {
  bench b;
  bench_turn t;
  bool open = false;
  bench_open(&b);
  bench_turn_for(&b, &t, "get reads the property");
  CHECK_INT(expr_passes(&t.frame, bench_id("eval_bench.hall"), NULL, &open), SPROUT_EVAL_OK);
  CHECK(open);
  CHECK_INT(expr_passes(&t.frame, bench_id("eval_bench"), NULL, &open), SPROUT_EVAL_OK);
  CHECK(!open);
  CHECK_INT(t.meter.steps, 0);
  bench_turn_close(&t);
  bench_close(&b);
}

static void a_rule_is_evaluated_with_the_container_as_self(void) {
  bench b;
  bench_turn t;
  bool open = true;
  bench_open(&b);
  bench_turn_for(&b, &t, "a name behind a closed container");
  CHECK_INT(expr_passes(&t.frame, bench_id("eval_bench.hall.vault"), NULL, &open), SPROUT_EVAL_OK);
  CHECK(!open);
  /* `self.get(:open)`: `self`, the call, and the property named. */
  CHECK_INT(t.meter.steps, 3);
  /* The frame's own self is untouched. */
  CHECK_BYTES(t.frame.self.bytes, t.frame.self.length, "eval_bench.hall.probe");
  bench_turn_close(&t);
  bench_turn_for(&b, &t, "a name reached through a container that passes");
  CHECK_INT(expr_passes(&t.frame, bench_id("eval_bench.hall.vault"), NULL, &open), SPROUT_EVAL_OK);
  CHECK(open);
  bench_turn_close(&t);
  bench_close(&b);
}

static void a_rule_on_a_message_it_does_not_name_answers_with_pass_any(void) {
  bench b;
  bench_turn t;
  bool open = true;
  bench_open(&b);
  bench_turn_for(&b, &t, "a name behind a closed container");
  CHECK_INT(expr_passes(&t.frame, bench_id("eval_bench.hall.vault"), "sprout.illuminating", &open), SPROUT_EVAL_OK);
  CHECK(!open);
  bench_turn_close(&t);
  bench_close(&b);
}

static void a_rule_that_runs_out_the_budget_faults_the_turn(void) {
  bench b;
  bench_turn t;
  bool open = true;
  bench_open(&b);
  bench_turn_for(&b, &t, "a name behind a rule is charged to the turn");
  /* The host allows 6 steps; four are spent, and the rule needs three. */
  t.meter.steps = 4;
  CHECK_INT(expr_passes(&t.frame, bench_id("eval_bench.hall.vault"), NULL, &open), SPROUT_EVAL_FAULT);
  CHECK_STR(t.fault.name, "BudgetExhausted");
  CHECK_INT(t.meter.fault.limit, 6);
  bench_turn_close(&t);
  bench_close(&b);
}

int main(void) {
  RUN(a_container_with_no_rule_relays_and_the_world_refuses);
  RUN(a_rule_is_evaluated_with_the_container_as_self);
  RUN(a_rule_on_a_message_it_does_not_name_answers_with_pass_any);
  RUN(a_rule_that_runs_out_the_budget_faults_the_turn);
  return REPORT();
}
