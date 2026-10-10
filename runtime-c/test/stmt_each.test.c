/*
 * Tests for src/stmt/each.c (the spec's Properties > Walking contents): `each`
 * visits what a container directly holds that is in range of `self`, in the
 * container's order, kept to those composing a kind where one is written; a
 * shut chest seen from outside is walked as empty. What is walked is fixed
 * before the first visit, each iteration is a step, and a refused `move` in
 * the body ends the whole `each`.
 */
#include "exec_fixture.h"

static void each_visits_what_a_container_holds_that_composes_the_kind(void) {
  exec_bench b;
  exec_case c;
  sprout_run run;
  sprout_ended ended = {0};
  exec_bench_open(&b);
  exec_case_open(&b, &c, exec_named(&b, "each visits what a container holds that composes the kind"));
  run = exec_run(&c);
  CHECK_INT(stmt_each(&run, &c.frame, exec_first_statement(&c), &ended), SPROUT_EVAL_OK);
  /* The shelf holds a jar and a cup; only the jar is a Jar. */
  CHECK_INT(exec_property(&c, "exec_bench.hall.runner", "count"), 1);
  exec_case_close(&c);
  exec_bench_close(&b);
}

static void each_without_a_filter_visits_every_thing_in_range(void) {
  exec_bench b;
  exec_case c;
  sprout_run run;
  sprout_ended ended = {0};
  exec_bench_open(&b);
  exec_case_open(&b, &c, exec_named(&b, "each visits every thing without a filter"));
  run = exec_run(&c);
  CHECK_INT(stmt_each(&run, &c.frame, exec_first_statement(&c), &ended), SPROUT_EVAL_OK);
  CHECK_INT(exec_property(&c, "exec_bench.hall.runner", "count"), 2);
  exec_case_close(&c);
  exec_bench_close(&b);
}

static void a_shut_chest_is_walked_as_empty_and_an_open_one_is_not(void) {
  exec_bench b;
  exec_case shut, open;
  sprout_run run;
  sprout_ended ended = {0};
  exec_bench_open(&b);
  exec_case_open(&b, &shut, exec_named(&b, "each walks a shut chest as empty"));
  run = exec_run(&shut);
  CHECK_INT(stmt_each(&run, &shut.frame, exec_first_statement(&shut), &ended), SPROUT_EVAL_OK);
  CHECK_INT(exec_property(&shut, "exec_bench.hall.runner", "count"), 0);
  exec_case_open(&b, &open, exec_named(&b, "each walks an open chest"));
  run = exec_run(&open);
  CHECK_INT(stmt_each(&run, &open.frame, exec_first_statement(&open), &ended), SPROUT_EVAL_OK);
  /* The worn runner starts at 4; the open chest holds a coin and a bin. */
  CHECK_INT(exec_property(&open, "exec_bench.hall.runner", "count"), 8);
  exec_case_close(&open);
  exec_case_close(&shut);
  exec_bench_close(&b);
}

static void each_stops_at_a_container_that_refuses_the_question(void) {
  exec_bench b;
  exec_case c;
  sprout_run run;
  sprout_ended ended = {0};
  exec_bench_open(&b);
  exec_case_open(&b, &c, exec_named(&b, "an each stops at a container that refuses the question"));
  run = exec_run(&c);
  CHECK_INT(stmt_each(&run, &c.frame, exec_first_statement(&c), &ended), SPROUT_EVAL_OK);
  CHECK_INT(exec_property(&c, "exec_bench.hall.runner", "count"), 0);
  exec_case_close(&c);
  exec_bench_close(&b);
}

static void a_refused_move_in_the_body_ends_the_each(void) {
  exec_bench b;
  exec_case c;
  sprout_run run;
  sprout_ended ended = {0};
  exec_bench_open(&b);
  exec_case_open(&b, &c, exec_named(&b, "a refused move in an each ends the body"));
  run = exec_run(&c);
  CHECK_INT(stmt_each(&run, &c.frame, exec_first_statement(&c), &ended), SPROUT_EVAL_OK);
  CHECK_INT(run.stopped, SPROUT_STOPPED_REFUSED);
  /* The jar went into the gate and counted; the cup was refused and ended the walk. */
  CHECK_INT(exec_property(&c, "exec_bench.hall.runner", "count"), 1);
  CHECK_INT(c.x.effect_count, 1);
  exec_case_close(&c);
  exec_bench_close(&b);
}

static void every_iteration_is_a_step(void) {
  exec_bench b;
  exec_case c;
  sprout_run run;
  sprout_ended ended = {0};
  exec_bench_open(&b);
  exec_case_open(&b, &c, exec_named(&b, "an each past the step budget faults"));
  run = exec_run(&c);
  CHECK_INT(stmt_each(&run, &c.frame, exec_first_statement(&c), &ended), SPROUT_EVAL_FAULT);
  CHECK_STR(c.fault.name, "BudgetExhausted");
  CHECK_STR(c.meter.fault.budget, "steps");
  exec_case_close(&c);
  exec_bench_close(&b);
}

static void the_golden_each_cases_end_as_the_typescript_runtime_did(void) {
  exec_bench b;
  exec_bench_open(&b);
  CHECK(exec_replay_area(&b, "each") >= 9);
  exec_bench_close(&b);
  CHECK_INT(b.heap.pages, 0);
}

int main(void) {
  RUN(each_visits_what_a_container_holds_that_composes_the_kind);
  RUN(each_without_a_filter_visits_every_thing_in_range);
  RUN(a_shut_chest_is_walked_as_empty_and_an_open_one_is_not);
  RUN(each_stops_at_a_container_that_refuses_the_question);
  RUN(a_refused_move_in_the_body_ends_the_each);
  RUN(every_iteration_is_a_step);
  RUN(the_golden_each_cases_end_as_the_typescript_runtime_did);
  return REPORT();
}
