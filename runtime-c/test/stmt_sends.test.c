/*
 * Tests for src/stmt/sends.c (the spec's Events, messages and the bus >
 * Sending): a directed `send` is queued to its target where the target is
 * live and in the sender's range for that message, and to no one otherwise;
 * a `broadcast` is queued to everything the sender's range walk reaches but
 * the sender itself and a container that refuses, which the walk reaches only
 * as a surface. Nothing is delivered by the statement.
 */
#include "exec_fixture.h"

static bool queued_to(const exec_case *c, const char *id) {
  size_t i;
  for (i = 0; i < c->x.queued_count; i++)
    if (sprout_str_same(c->x.queued[i].recipient, exec_str(id))) return true;
  return false;
}

static void a_send_queues_one_message_to_a_target_in_range(void) {
  exec_bench b;
  exec_case c;
  sprout_run run;
  exec_bench_open(&b);
  exec_case_open(&b, &c, exec_named(&b, "a send is delivered once the body has ended, and answered"));
  run = exec_run(&c);
  CHECK_INT(stmt_send(&run, &c.frame, exec_first_statement(&c)), SPROUT_EVAL_OK);
  CHECK_INT(c.x.queued_count, 1);
  CHECK_INT(c.x.queued[0].message, SPROUT_MSG_AUTHORED);
  CHECK_STR(c.x.queued[0].declared->name, "ping");
  CHECK(queued_to(&c, "exec_bench.hall.bell"));
  CHECK(c.x.queued[0].has_from && sprout_str_same(c.x.queued[0].from, exec_str("exec_bench.hall.runner")));
  CHECK(!c.x.queued[0].has_value);
  /* Nothing is delivered: the bell has not run. */
  CHECK_INT(c.x.events, 0);
  exec_case_close(&c);
  exec_bench_close(&b);
}

static void a_send_to_what_is_out_of_range_goes_nowhere_and_nothing_else_happens(void) {
  exec_bench b;
  exec_case shut, open;
  sprout_run run;
  exec_bench_open(&b);
  exec_case_open(&b, &shut, exec_named(&b, "a send to what is out of range goes nowhere"));
  run = exec_run(&shut);
  CHECK_INT(stmt_send(&run, &shut.frame, exec_first_statement(&shut)), SPROUT_EVAL_OK);
  CHECK_INT(shut.x.queued_count, 0);
  exec_case_open(&b, &open, exec_named(&b, "a send to what is in range of an open chest is delivered"));
  run = exec_run(&open);
  CHECK_INT(stmt_send(&run, &open.frame, exec_first_statement(&open)), SPROUT_EVAL_OK);
  CHECK_INT(open.x.queued_count, 1);
  exec_case_close(&open);
  exec_case_close(&shut);
  exec_bench_close(&b);
}

static void a_send_carries_the_value_it_is_given(void) {
  exec_bench b;
  exec_case c;
  sprout_run run;
  exec_bench_open(&b);
  exec_case_open(&b, &c, exec_named(&b, "a cascade within a smaller depth budget faults at it"));
  run = exec_run(&c);
  CHECK_INT(stmt_send(&run, &c.frame, exec_first_statement(&c)), SPROUT_EVAL_OK);
  CHECK_INT(c.x.queued_count, 1);
  CHECK(c.x.queued[0].has_value);
  CHECK(c.x.queued[0].value.kind == SPROUT_NUMBER && c.x.queued[0].value.as.number == 2);
  exec_case_close(&c);
  exec_bench_close(&b);
}

static void a_broadcast_reaches_what_the_walk_reaches_but_the_sender_and_surfaces(void) {
  exec_bench b;
  exec_case shut, open;
  sprout_run run;
  exec_bench_open(&b);
  exec_case_open(&b, &shut, exec_named(&b, "a broadcast walks the sender’s range, into a container that passes the message"));
  run = exec_run(&shut);
  CHECK_INT(stmt_broadcast(&run, &shut.frame, exec_first_statement(&shut)), SPROUT_EVAL_OK);
  CHECK(queued_to(&shut, "exec_bench.hall.bell"));
  CHECK(queued_to(&shut, "exec_bench.hall.glass.moth"));
  CHECK(!queued_to(&shut, "exec_bench.hall.runner"));
  CHECK(!queued_to(&shut, "exec_bench.hall.chest.coin"));
  /* The world refuses and is only a surface: it is not sent to. */
  CHECK(!queued_to(&shut, "exec_bench"));
  exec_case_open(&b, &open, exec_named(&b, "a broadcast reaches into an open chest"));
  run = exec_run(&open);
  CHECK_INT(stmt_broadcast(&run, &open.frame, exec_first_statement(&open)), SPROUT_EVAL_OK);
  CHECK(queued_to(&open, "exec_bench.hall.chest.coin"));
  exec_case_close(&open);
  exec_case_close(&shut);
  exec_bench_close(&b);
}

static void a_send_in_a_body_that_decides_is_the_engines_defect(void) {
  exec_bench b;
  exec_case c;
  sprout_run run;
  exec_bench_open(&b);
  exec_case_open(&b, &c, exec_named(&b, "a send is delivered once the body has ended, and answered"));
  run = exec_run(&c);
  run.mode = SPROUT_BODY_DECIDE;
  CHECK_INT(stmt_send(&run, &c.frame, exec_first_statement(&c)), SPROUT_EVAL_ENGINE);
  CHECK_INT(stmt_broadcast(&run, &c.frame, exec_first_statement(&c)), SPROUT_EVAL_ENGINE);
  exec_case_close(&c);
  exec_bench_close(&b);
}

static void the_golden_send_cases_end_as_the_typescript_runtime_did(void) {
  exec_bench b;
  exec_bench_open(&b);
  CHECK(exec_replay_area(&b, "send") >= 6);
  exec_bench_close(&b);
  CHECK_INT(b.heap.pages, 0);
}

int main(void) {
  RUN(a_send_queues_one_message_to_a_target_in_range);
  RUN(a_send_to_what_is_out_of_range_goes_nowhere_and_nothing_else_happens);
  RUN(a_send_carries_the_value_it_is_given);
  RUN(a_broadcast_reaches_what_the_walk_reaches_but_the_sender_and_surfaces);
  RUN(a_send_in_a_body_that_decides_is_the_engines_defect);
  RUN(the_golden_send_cases_end_as_the_typescript_runtime_did);
  return REPORT();
}
