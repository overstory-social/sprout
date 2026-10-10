/*
 * Tests for src/effects.c (the spec's The runtime > Effects; Other people >
 * Who hears it; Prose > Engine lines): who reads what is told. `tell x`
 * reaches `x` only where it is a person in the teller's range; a plain,
 * `inside` or `outside` `tell` reaches the people around the teller that the
 * pass rules let its voice reach, less whom the reading already addresses.
 * The engine's lines are found on the one they are about, then its place,
 * then the world.
 */
#include "exec_fixture.h"

static bool has(const sprout_str *ids, size_t count, const char *id) {
  size_t i;
  for (i = 0; i < count; i++)
    if (sprout_str_same(ids[i], exec_str(id))) return true;
  return false;
}

static void a_plain_tell_reaches_the_people_in_the_tellers_place(void) {
  exec_bench b;
  exec_case c;
  const sprout_str *ids;
  size_t count;
  exec_bench_open(&b);
  exec_case_open(&b, &c, exec_named(&b, "a tell reaches the people in the teller’s place"));
  CHECK_INT(sprout_told_to(&c.x, &c.frame, exec_str("exec_bench.hall.runner"), SPROUT_TELL_PLACE, &ids, &count),
            SPROUT_EVAL_OK);
  CHECK_INT(count, 1);
  CHECK(has(ids, count, "exec_bench#1"));
  /* A thing that holds no actors has no occupants to tell inside. */
  CHECK_INT(sprout_told_to(&c.x, &c.frame, exec_str("exec_bench.hall.runner"), SPROUT_TELL_INSIDE, &ids, &count),
            SPROUT_EVAL_OK);
  CHECK_INT(count, 0);
  exec_case_close(&c);
  exec_bench_close(&b);
}

static void a_tell_leaves_out_the_people_the_reading_addresses(void) {
  exec_bench b;
  exec_case c;
  const sprout_str *ids;
  size_t count;
  exec_bench_open(&b);
  exec_case_open(&b, &c, exec_named(&b, "a tell leaves out the people the reading addresses"));
  CHECK_INT(sprout_told_to(&c.x, &c.frame, exec_str("exec_bench.hall.runner"), SPROUT_TELL_PLACE, &ids, &count),
            SPROUT_EVAL_OK);
  CHECK_INT(count, 0);
  exec_case_close(&c);
  exec_bench_close(&b);
}

static void a_place_that_holds_actors_has_two_audiences(void) {
  exec_bench b;
  exec_case c;
  const sprout_str *ids;
  size_t count;
  sprout_str wardrobe = exec_str("exec_bench.hall.wardrobe");
  exec_bench_open(&b);
  exec_case_open(&b, &c, exec_named(&b, "a tell inside reaches only the teller’s own occupants"));
  CHECK_INT(sprout_told_to(&c.x, &c.frame, wardrobe, SPROUT_TELL_INSIDE, &ids, &count), SPROUT_EVAL_OK);
  CHECK_INT(count, 1);
  CHECK(has(ids, count, "exec_bench#6"));
  CHECK_INT(sprout_told_to(&c.x, &c.frame, wardrobe, SPROUT_TELL_OUTSIDE, &ids, &count), SPROUT_EVAL_OK);
  CHECK_INT(count, 1);
  CHECK(has(ids, count, "exec_bench#1"));
  CHECK_INT(sprout_told_to(&c.x, &c.frame, wardrobe, SPROUT_TELL_PLACE, &ids, &count), SPROUT_EVAL_OK);
  CHECK_INT(count, 2);
  CHECK(has(ids, count, "exec_bench#6") && has(ids, count, "exec_bench#1"));
  exec_case_close(&c);
  exec_bench_close(&b);
}

static void a_tell_to_one_reaches_a_person_in_range_and_nobody_else(void) {
  exec_bench b;
  exec_case c;
  const sprout_str *ids;
  size_t count;
  sprout_str runner = exec_str("exec_bench.hall.runner");
  exec_bench_open(&b);
  exec_case_open(&b, &c, exec_named(&b, "a tell to one out of range reaches nobody"));
  CHECK_INT(sprout_told_to_one(&c.x, &c.frame, runner, exec_str("exec_bench#1"), &ids, &count), SPROUT_EVAL_OK);
  CHECK_INT(count, 1);
  /* Inside a wardrobe that is shut, and not a person at all. */
  CHECK_INT(sprout_told_to_one(&c.x, &c.frame, runner, exec_str("exec_bench#6"), &ids, &count), SPROUT_EVAL_OK);
  CHECK_INT(count, 0);
  CHECK_INT(sprout_told_to_one(&c.x, &c.frame, runner, exec_str("exec_bench.hall.lamp"), &ids, &count), SPROUT_EVAL_OK);
  CHECK_INT(count, 0);
  CHECK(sprout_is_person(&c.frame, exec_str("exec_bench#1")));
  CHECK(!sprout_is_person(&c.frame, exec_str("exec_bench.hall.dog")));
  exec_case_close(&c);
  exec_bench_close(&b);
}

static void an_engine_line_is_found_on_the_one_it_is_about_then_its_place_then_the_world(void) {
  exec_bench b;
  exec_case c;
  sprout_str by;
  sprout_speech said;
  sprout_str dog = exec_str("exec_bench.hall.dog"), tent = exec_str("exec_bench.hall.tent");
  exec_bench_open(&b);
  exec_case_open(&b, &c, exec_named(&b, "an actor moved between places is told, and the places tell their people"));
  /* The place's notices are written on `sprout.Place`, which the place composes. */
  sprout_engine_said(&c.frame, "arrives", &dog, &tent, &by, &said);
  CHECK_INT(said.kind, SPROUT_SPEECH_PASSAGE);
  CHECK_STR(said.origin, "sprout.Place");
  CHECK_STR(said.name, "arrives");
  CHECK(sprout_str_same(by, tent));
  /* A line about nobody in particular is the world's. */
  sprout_engine_said(&c.frame, "crowded", &dog, &tent, &by, &said);
  CHECK_STR(said.origin, "sprout.World");
  CHECK(sprout_str_same(by, c.draft.base->world));
  exec_case_close(&c);
  exec_bench_close(&b);
}

static void effects_are_recorded_in_order_with_the_names_in_scope(void) {
  exec_bench b;
  exec_case c;
  sprout_effect effect;
  const sprout_effect_binding *names;
  size_t count;
  exec_bench_open(&b);
  exec_case_open(&b, &c, exec_named(&b, "a tell carries every name in scope"));
  c.frame.bindings = sprout_bind(&c.frame, "first", sprout_evaluated_value(sprout_number(1)));
  c.frame.bindings = sprout_bind(&c.frame, "second", sprout_evaluated_value(sprout_number(2)));
  CHECK_INT(sprout_effect_names(&c.frame, &names, &count), SPROUT_EVAL_OK);
  CHECK_INT(count, 2);
  CHECK_STR(names[0].name, "first");
  CHECK_STR(names[1].name, "second");
  memset(&effect, 0, sizeof effect);
  effect.kind = SPROUT_EFFECT_SAID;
  effect.by = exec_str("exec_bench.hall.runner");
  CHECK_INT(sprout_exec_record(&c.x, &effect), SPROUT_EVAL_OK);
  effect.kind = SPROUT_EFFECT_TOLD;
  CHECK_INT(sprout_exec_record(&c.x, &effect), SPROUT_EVAL_OK);
  CHECK_INT(c.x.effect_count, 2);
  CHECK_INT(c.x.effects[0].kind, SPROUT_EFFECT_SAID);
  CHECK_INT(c.x.effects[1].kind, SPROUT_EFFECT_TOLD);
  exec_case_close(&c);
  exec_bench_close(&b);
}

static void the_golden_speech_cases_end_as_the_typescript_runtime_did(void) {
  exec_bench b;
  exec_bench_open(&b);
  CHECK(exec_replay_area(&b, "speech") >= 10);
  exec_bench_close(&b);
  CHECK_INT(b.heap.pages, 0);
}

int main(void) {
  RUN(a_plain_tell_reaches_the_people_in_the_tellers_place);
  RUN(a_tell_leaves_out_the_people_the_reading_addresses);
  RUN(a_place_that_holds_actors_has_two_audiences);
  RUN(a_tell_to_one_reaches_a_person_in_range_and_nobody_else);
  RUN(an_engine_line_is_found_on_the_one_it_is_about_then_its_place_then_the_world);
  RUN(effects_are_recorded_in_order_with_the_names_in_scope);
  RUN(the_golden_speech_cases_end_as_the_typescript_runtime_did);
  return REPORT();
}
