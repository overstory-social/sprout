/*
 * Tests for src/reading.c (the spec's Verbs > The two passes, Acting;
 * Limits > Runtime budgets): every reading the TypeScript runtime's goldens
 * hold (corpus/goldens/readings.json) is run here against the same cartridge
 * and stored worlds, and must end as the oracle did: acted, refused, gone or
 * faulted, with the same steps, effects, handlers run, descriptions owed and
 * committed state. A verb written in a body is reached from its own library
 * first, then the standard library's; a set role is held to the host's cap on
 * what one binds; and a filler a role does not take is the engine's defect.
 */
#include "reading_fixture.h"

static void every_golden_reading_ends_as_the_typescript_runtime_did(void) {
  exec_bench b;
  size_t replayed;
  reading_bench_open(&b);
  replayed = reading_replay_area(&b, NULL);
  CHECK(replayed > 50);
  CHECK_INT(replayed, sprout_json_get(b.golden, "cases")->count);
  exec_bench_close(&b);
  CHECK_INT(b.heap.pages, 0);
}

static void a_verb_is_reached_from_its_own_library_first_and_then_the_standard_library(void) {
  exec_bench b;
  exec_case c;
  reading_bench_open(&b);
  reading_case_open(&b, &c, reading_named(&b, "take a book from the floor"));
  CHECK_STR(sprout_verb_named(c.world, "bench", "prop")->library, "bench");
  CHECK_STR(sprout_verb_named(c.world, "bench", "take")->library, "sprout");
  CHECK_STR(sprout_verb_named(c.world, "bench/rooms/shop", "prop")->library, "bench");
  CHECK(sprout_verb_named(c.world, "bench", "juggle") == NULL);
  CHECK(sprout_verb_named(c.world, "sprout", "prop") == NULL);
  exec_case_close(&c);
  exec_bench_close(&b);
}

static void a_role_takes_a_set_a_value_an_exit_or_a_thing(void) {
  exec_bench b;
  exec_case c;
  reading_bench_open(&b);
  reading_case_open(&b, &c, reading_named(&b, "take a book from the floor"));
  CHECK_INT(sprout_role_takes(&reading_verb(c.world, "sprout.go")->roles[0]), SPROUT_BOUND_EXIT);
  CHECK_INT(sprout_role_takes(&reading_verb(c.world, "bench.dial")->roles[1]), SPROUT_BOUND_VALUE);
  CHECK_INT(sprout_role_takes(&reading_verb(c.world, "sprout.ask")->roles[1]), SPROUT_BOUND_VALUE);
  CHECK_INT(sprout_role_takes(&reading_verb(c.world, "bench.order")->roles[2]), SPROUT_BOUND_SET);
  CHECK_INT(sprout_role_takes(&reading_verb(c.world, "sprout.take")->roles[0]), SPROUT_BOUND_OBJECT);
  exec_case_close(&c);
  exec_bench_close(&b);
}

static void a_set_role_binding_more_than_the_host_allows_exhausts_the_budget(void) {
  exec_bench b;
  exec_case c;
  sprout_resolved reading;
  sprout_reading_end end;
  sprout_permit_refusal refusal;
  reading_bench_open(&b);
  reading_case_open(&b, &c, reading_named(&b, "every part plays: the target’s composed kinds, its tool, then the weights of a set role"));
  c.host.budgets.set_role_objects.set = true;
  c.host.budgets.set_role_objects.value = 1;
  reading = reading_of(&c, sprout_json_get(c.golden, "reading"));
  CHECK_INT(reading_run(&c, &reading, &end, &refusal), SPROUT_EVAL_FAULT);
  CHECK_STR(c.meter.fault.budget, "objects bound by one set role");
  CHECK_INT(c.meter.fault.limit, 1);
  CHECK_INT(c.x.effect_count, 0);
  exec_case_close(&c);
  exec_bench_close(&b);
}

static void a_filler_the_role_does_not_take_is_the_engines_defect(void) {
  exec_bench b;
  exec_case c;
  sprout_resolved reading;
  sprout_reading_end end;
  sprout_permit_refusal refusal;
  sprout_filled *roles;
  reading_bench_open(&b);
  reading_case_open(&b, &c, reading_named(&b, "take a book from the floor"));
  reading = reading_of(&c, sprout_json_get(c.golden, "reading"));
  roles = (sprout_filled *)reading.roles;
  roles[0].bound.kind = SPROUT_BOUND_SET;
  CHECK_INT(reading_run(&c, &reading, &end, &refusal), SPROUT_EVAL_ENGINE);
  CHECK_STR(c.fault.text, "a reading of `take` fills `target` with what it does not take.");
  exec_case_close(&c);
  exec_bench_close(&b);
}

static void a_reading_that_ends_with_its_actor_destroyed_is_gone(void) {
  exec_bench b;
  reading_bench_open(&b);
  reading_replay(&b, reading_named(&b, "an actor that destroys itself in its own do is gone"));
  exec_bench_close(&b);
}

int main(void) {
  RUN(every_golden_reading_ends_as_the_typescript_runtime_did);
  RUN(a_verb_is_reached_from_its_own_library_first_and_then_the_standard_library);
  RUN(a_role_takes_a_set_a_value_an_exit_or_a_thing);
  RUN(a_set_role_binding_more_than_the_host_allows_exhausts_the_budget);
  RUN(a_filler_the_role_does_not_take_is_the_engines_defect);
  RUN(a_reading_that_ends_with_its_actor_destroyed_is_gone);
  return REPORT();
}
