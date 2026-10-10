/*
 * Tests for src/engine-verbs.c (the spec's Verbs > Engine verbs, Exits):
 * `go`, `look`, `examine`, `inventory`, `wait` and `help` are the standard
 * library's verbs the engine answers, and only `go` has a role an exit
 * fills. A reading of `go` takes the actor through the exit named, a refusal
 * of the move is said as a refused `move` is, and what the exit says is said
 * to a person who went as the move is made.
 */
#include "reading_fixture.h"

static void the_engine_verbs_are_the_standard_librarys_six(void) {
  exec_bench b;
  exec_case c;
  const char *engine[] = {"sprout.go", "sprout.look", "sprout.examine", "sprout.inventory", "sprout.wait", "sprout.help"};
  const char *library[] = {"sprout.take", "sprout.drop", "sprout.put", "sprout.give", "sprout.open", "sprout.unlock",
                           "sprout.ask", "bench.nod", "bench.prop"};
  size_t i;
  reading_bench_open(&b);
  reading_case_in(&b, &c, "fresh");
  for (i = 0; i < sizeof engine / sizeof *engine; i++) CHECK(sprout_is_engine_verb(reading_verb(c.world, engine[i])));
  for (i = 0; i < sizeof library / sizeof *library; i++) CHECK(!sprout_is_engine_verb(reading_verb(c.world, library[i])));
  exec_case_close(&c);
  exec_bench_close(&b);
}

static void the_engine_answers_all_but_go_once_the_queue_is_empty(void) {
  exec_bench b;
  exec_case c;
  const char *answered[] = {"sprout.look", "sprout.examine", "sprout.inventory", "sprout.wait", "sprout.help"};
  const char *not_answered[] = {"sprout.go", "sprout.take", "sprout.unlock", "bench.nod"};
  size_t i;
  reading_bench_open(&b);
  reading_case_in(&b, &c, "fresh");
  for (i = 0; i < sizeof answered / sizeof *answered; i++) CHECK(sprout_answered_by_engine(reading_verb(c.world, answered[i])));
  for (i = 0; i < sizeof not_answered / sizeof *not_answered; i++)
    CHECK(!sprout_answered_by_engine(reading_verb(c.world, not_answered[i])));
  exec_case_close(&c);
  exec_bench_close(&b);
}

static void only_a_reading_of_go_has_an_exit_to_take(void) {
  exec_bench b;
  exec_case c;
  sprout_resolved reading;
  const sprout_stored_bound *way;
  reading_bench_open(&b);
  reading_case_open(&b, &c, reading_named(&b, "go through a link"));
  reading = reading_of(&c, sprout_json_get(c.golden, "reading"));
  way = sprout_exit_of(&reading);
  CHECK(way != NULL);
  CHECK_INT(way->kind, SPROUT_BOUND_EXIT);
  CHECK(!way->has_direction);
  CHECK_STR(way->label.bytes, "onward");
  CHECK(sprout_str_same(way->to, exec_str("bench.yard")));
  exec_case_close(&c);
  reading_case_open(&b, &c, reading_named(&b, "take a book from the floor"));
  reading = reading_of(&c, sprout_json_get(c.golden, "reading"));
  CHECK(sprout_exit_of(&reading) == NULL);
  exec_case_close(&c);
  exec_bench_close(&b);
}

static void go_moves_the_actor_through_the_exit_and_the_exit_speaks_as_the_move_is_made(void) {
  exec_bench b;
  exec_case c;
  sprout_resolved reading;
  sprout_went went = SPROUT_WENT_REFUSED;
  const sprout_stored_instance *marta;
  reading_bench_open(&b);
  reading_case_open(&b, &c, reading_named(&b, "go through an exit that says something as it is taken"));
  reading = reading_of(&c, sprout_json_get(c.golden, "reading"));
  CHECK_INT(sprout_go(&c.x, &c.frame, &reading, sprout_exit_of(&reading), true, &went), SPROUT_EVAL_OK);
  CHECK_INT(went, SPROUT_WENT_DONE);
  marta = sprout_draft_instance(&c.draft, exec_str("bench#1"));
  CHECK(sprout_str_same(marta->container, exec_str("bench.vault")));
  CHECK_INT(c.x.effect_count, 1);
  CHECK_INT(c.x.effects[0].kind, SPROUT_EFFECT_SAID);
  CHECK(sprout_str_same(c.x.effects[0].by, exec_str("bench.shop")));
  CHECK_INT(c.x.effects[0].said.kind, SPROUT_SPEECH_TEXT);
  CHECK_INT(c.x.effects[0].binding_count, 2);
  CHECK(sprout_str_same(c.x.effects[0].bindings[1].bound.id, exec_str("bench.shop")));
  exec_case_close(&c);
  exec_bench_close(&b);
}

static void go_that_is_refused_says_the_refusal_and_leaves_the_actor_where_it_was(void) {
  exec_bench b;
  exec_case c;
  sprout_resolved reading;
  sprout_went went = SPROUT_WENT_DONE;
  const sprout_stored_instance *marta;
  reading_bench_open(&b);
  reading_case_open(&b, &c, reading_named(&b, "go through an exit to a place whose accept refuses"));
  reading = reading_of(&c, sprout_json_get(c.golden, "reading"));
  CHECK_INT(sprout_go(&c.x, &c.frame, &reading, sprout_exit_of(&reading), true, &went), SPROUT_EVAL_OK);
  CHECK_INT(went, SPROUT_WENT_REFUSED);
  marta = sprout_draft_instance(&c.draft, exec_str("bench#1"));
  CHECK(sprout_str_same(marta->container, exec_str("bench.shop")));
  CHECK_INT(c.x.effect_count, 1);
  CHECK_INT(c.x.effects[0].kind, SPROUT_EFFECT_REFUSED);
  CHECK(sprout_str_same(c.x.effects[0].by, exec_str("bench.vault")));
  exec_case_close(&c);
  exec_bench_close(&b);
}

static void the_golden_go_readings_end_as_the_typescript_runtime_did(void) {
  exec_bench b;
  reading_bench_open(&b);
  CHECK(reading_replay_area(&b, "go") >= 7);
  exec_bench_close(&b);
  CHECK_INT(b.heap.pages, 0);
}

int main(void) {
  RUN(the_engine_verbs_are_the_standard_librarys_six);
  RUN(the_engine_answers_all_but_go_once_the_queue_is_empty);
  RUN(only_a_reading_of_go_has_an_exit_to_take);
  RUN(go_moves_the_actor_through_the_exit_and_the_exit_speaks_as_the_move_is_made);
  RUN(go_that_is_refused_says_the_refusal_and_leaves_the_actor_where_it_was);
  RUN(the_golden_go_readings_end_as_the_typescript_runtime_did);
  return REPORT();
}
