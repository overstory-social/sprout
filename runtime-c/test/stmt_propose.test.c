/*
 * Tests for src/stmt/propose.c (the spec's Verbs > Moving something,
 * Acting): a `move` is a proposal the engine puts to everyone with standing;
 * a refusal is said to whoever the body speaks to and ends the body. An `act`
 * is a reading with `self` as the actor and each named role filled, recorded
 * for the reading pass; the body goes on after it.
 */
#include "exec_fixture.h"

static void a_move_every_party_allows_does_not_stop_the_body(void) {
  exec_bench b;
  exec_case c;
  sprout_run run;
  exec_bench_open(&b);
  exec_case_open(&b, &c, exec_named(&b, "a move that every party allows"));
  run = exec_run(&c);
  CHECK_INT(stmt_move(&run, &c.frame, exec_first_statement(&c)), SPROUT_EVAL_OK);
  CHECK_INT(run.stopped, SPROUT_RUNNING);
  CHECK_INT(c.x.effect_count, 0);
  CHECK_INT(c.x.queued_count, 3);
  exec_case_close(&c);
  exec_bench_close(&b);
}

static void a_refused_move_is_said_to_whoever_the_body_speaks_to_and_stops_it(void) {
  exec_bench b;
  exec_case c;
  sprout_run run;
  exec_bench_open(&b);
  exec_case_open(&b, &c, exec_named(&b, "a refused move ends the body"));
  run = exec_run(&c);
  CHECK_INT(stmt_move(&run, &c.frame, exec_first_statement(&c)), SPROUT_EVAL_OK);
  CHECK_INT(run.stopped, SPROUT_STOPPED_REFUSED);
  CHECK_INT(c.x.effect_count, 1);
  CHECK_INT(c.x.effects[0].kind, SPROUT_EFFECT_REFUSED);
  CHECK_INT(c.x.effects[0].to_count, 1);
  CHECK(sprout_str_same(c.x.effects[0].by, exec_str("exec_bench.hall.shelf")));
  CHECK_STR(c.x.effects[0].said.name, "full");
  CHECK_INT(c.x.queued_count, 0);
  exec_case_close(&c);
  exec_bench_close(&b);
}

static void a_move_in_a_body_that_decides_is_the_engines_defect(void) {
  exec_bench b;
  exec_case c;
  sprout_run run;
  exec_bench_open(&b);
  exec_case_open(&b, &c, exec_named(&b, "a move that every party allows"));
  run = exec_run(&c);
  run.mode = SPROUT_BODY_DECIDE;
  CHECK_INT(stmt_move(&run, &c.frame, exec_first_statement(&c)), SPROUT_EVAL_ENGINE);
  CHECK_STR(c.fault.text, "`move` reached a body that decides, which only reads; the checker refuses it.");
  exec_case_close(&c);
  exec_bench_close(&b);
}

static void an_act_is_recorded_with_its_roles_and_does_not_stop_the_body(void) {
  exec_bench b;
  exec_case c;
  sprout_run run;
  exec_bench_open(&b);
  exec_case_open(&b, &c, exec_named(&b, "an act is recorded for the reading pass"));
  run = exec_run(&c);
  CHECK_INT(stmt_act(&run, &c.frame, exec_first_statement(&c)), SPROUT_EVAL_OK);
  CHECK_INT(run.stopped, SPROUT_RUNNING);
  CHECK_INT(c.x.reading_count, 1);
  CHECK(sprout_str_same(c.x.readings[0].actor, exec_str("exec_bench.hall.dog")));
  CHECK_STR(c.x.readings[0].verb, "sniff");
  CHECK_STR(c.x.readings[0].library, "exec_bench");
  CHECK_INT(c.x.readings[0].role_count, 1);
  CHECK_STR(c.x.readings[0].roles[0].role, "target");
  CHECK_INT(c.x.readings[0].roles[0].filler.binds, SPROUT_BINDS_OBJECT);
  CHECK(sprout_str_same(c.x.readings[0].roles[0].filler.id, exec_str("exec_bench.hall.lamp")));
  exec_case_close(&c);
  exec_bench_close(&b);
}

static void the_golden_act_and_move_cases_end_as_the_typescript_runtime_did(void) {
  exec_bench b;
  exec_bench_open(&b);
  CHECK(exec_replay_area(&b, "act") >= 2);
  CHECK(exec_replay_area(&b, "move") >= 14);
  exec_bench_close(&b);
  CHECK_INT(b.heap.pages, 0);
}

int main(void) {
  RUN(a_move_every_party_allows_does_not_stop_the_body);
  RUN(a_refused_move_is_said_to_whoever_the_body_speaks_to_and_stops_it);
  RUN(a_move_in_a_body_that_decides_is_the_engines_defect);
  RUN(an_act_is_recorded_with_its_roles_and_does_not_stop_the_body);
  RUN(the_golden_act_and_move_cases_end_as_the_typescript_runtime_did);
  return REPORT();
}
