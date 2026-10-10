/*
 * Tests for src/stmt/propose.c (the spec's Verbs > Moving something,
 * Acting): a `move` is a proposal the engine puts to everyone with standing;
 * a refusal is said to whoever the body speaks to and ends the body. An `act`
 * is a reading with `self` as the actor and each named role filled, run on
 * the spot by the reading pass; the body goes on after it unless the reading
 * was refused or the actor is gone.
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

/* A reading pass that ends as the test says. */
static sprout_reading_end ending = SPROUT_READING_ACTED;
static const char *ran_verb = NULL;
static size_t ran_roles = 0;

static sprout_eval_status fake_reading(sprout_exec *x, const sprout_frame *frame, sprout_str actor, const char *verb,
                                       size_t role_count, const sprout_pending_role *roles, sprout_reading_end *end) {
  (void)x;
  (void)frame;
  CHECK(sprout_str_same(actor, exec_str("exec_bench.hall.dog")));
  ran_verb = verb;
  ran_roles = role_count;
  CHECK_STR(roles[0].role, "target");
  CHECK(sprout_str_same(roles[0].filler.id, exec_str("exec_bench.hall.lamp")));
  *end = ending;
  return SPROUT_EVAL_OK;
}

static sprout_stopped act_with(exec_bench *b, sprout_reading_end how) {
  exec_case c;
  sprout_run run;
  sprout_stopped stopped;
  exec_case_open(b, &c, exec_named(b, "an act names its roles by what they are bound to"));
  c.x.reading = fake_reading;
  ending = how;
  run = exec_run(&c);
  CHECK_INT(stmt_act(&run, &c.frame, exec_first_statement(&c)), SPROUT_EVAL_OK);
  CHECK_STR(ran_verb, "sniff");
  CHECK_INT(ran_roles, 1);
  stopped = run.stopped;
  exec_case_close(&c);
  return stopped;
}

static void an_act_runs_its_reading_on_the_spot_and_the_body_stops_where_the_reading_says(void) {
  exec_bench b;
  exec_bench_open(&b);
  CHECK_INT(act_with(&b, SPROUT_READING_ACTED), SPROUT_RUNNING);
  CHECK_INT(act_with(&b, SPROUT_READING_REFUSED), SPROUT_STOPPED_REFUSED);
  CHECK_INT(act_with(&b, SPROUT_READING_GONE), SPROUT_STOPPED_GONE);
  exec_bench_close(&b);
}

static void an_act_begins_with_the_reading_pass_of_the_engine(void) {
  exec_bench b;
  exec_case c;
  exec_bench_open(&b);
  exec_case_open(&b, &c, exec_named(&b, "an act names its roles by what they are bound to"));
  CHECK(c.x.reading == sprout_run_reading);
  exec_case_close(&c);
  exec_bench_close(&b);
}

static void the_golden_act_cases_end_as_the_typescript_runtime_did(void) {
  exec_bench b;
  exec_bench_open(&b);
  CHECK(exec_replay_area(&b, "act") >= 4);
  exec_bench_close(&b);
  CHECK_INT(b.heap.pages, 0);
}

static void the_golden_move_cases_end_as_the_typescript_runtime_did(void) {
  exec_bench b;
  exec_bench_open(&b);
  CHECK(exec_replay_area(&b, "move") >= 14);
  exec_bench_close(&b);
  CHECK_INT(b.heap.pages, 0);
}

int main(void) {
  RUN(a_move_every_party_allows_does_not_stop_the_body);
  RUN(a_refused_move_is_said_to_whoever_the_body_speaks_to_and_stops_it);
  RUN(a_move_in_a_body_that_decides_is_the_engines_defect);
  RUN(an_act_runs_its_reading_on_the_spot_and_the_body_stops_where_the_reading_says);
  RUN(an_act_begins_with_the_reading_pass_of_the_engine);
  RUN(the_golden_act_cases_end_as_the_typescript_runtime_did);
  RUN(the_golden_move_cases_end_as_the_typescript_runtime_did);
  return REPORT();
}
