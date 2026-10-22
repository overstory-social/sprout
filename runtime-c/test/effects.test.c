/*
 * Tests for src/effects.c (the spec's The runtime > Effects; Other people >
 * Who hears it; Prose > Engine lines): who reads what is told. `tell x`
 * reaches `x` only where it is a person in the teller's range; a plain,
 * `inside` or `outside` `tell` reaches the people around the teller that the
 * pass rules let its voice reach, its holder among them, less whom the reading
 * already addresses.
 * The engine's lines are found on the one they are about, then its place,
 * then the world.
 */
#include "exec_fixture.h"
#include "turn_fixture.h"
#include "several_fixture.h"

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
  /* The place around it is the hall, with the lodge in it, which writes no pass rule and so passes. */
  CHECK_INT(sprout_told_to(&c.x, &c.frame, wardrobe, SPROUT_TELL_OUTSIDE, &ids, &count), SPROUT_EVAL_OK);
  CHECK_INT(count, 2);
  CHECK(has(ids, count, "exec_bench#1") && has(ids, count, "exec_bench#4"));
  CHECK_INT(sprout_told_to(&c.x, &c.frame, wardrobe, SPROUT_TELL_PLACE, &ids, &count), SPROUT_EVAL_OK);
  CHECK_INT(count, 3);
  CHECK(has(ids, count, "exec_bench#6") && has(ids, count, "exec_bench#1") && has(ids, count, "exec_bench#4"));
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

/* The chapel of `corpus/good/carried-tells`, Wren and Marta standing in it, and its candle lit; the wake it asked for. */
static uint64_t chapel_lit(turn_world *w) {
  sprout_outcome out;
  const sprout_stored_instance *candle;
  tw_open(w, "carried-tells");
  tw_arrive(w, "v-wren", "Wren", 1000, &out);
  sprout_outcome_free(&out);
  tw_arrive(w, "v-marta", "Marta", 1000, &out);
  sprout_outcome_free(&out);
  tw_do(w, "v-wren", "light", "chapel.candle", 1000, &out);
  sprout_outcome_free(&out);
  candle = tw_instance(w, "carried_tells.chapel.candle");
  CHECK(candle != NULL && candle->wake_count == 1);
  return candle != NULL && candle->wake_count == 1 ? candle->wakes[0].serial : 0;
}

/* Runs `visit`'s `verb` of the standard library on the candle, as its `role`, and with `other` in `other_role`. */
static void chapel_do(turn_world *w, const char *visit, const char *verb, const char *role, const char *other_role,
                      const char *other) {
  sprout_filling fillings[2];
  sprout_reading reading = tw_reading(verb, tw_person(w, visit), &fillings[0], role, "carried_tells.chapel.candle");
  sprout_outcome out;
  if (other_role != NULL) {
    memset(&fillings[1], 0, sizeof fillings[1]);
    fillings[1].role = other_role;
    fillings[1].binds = SPROUT_FILL_OBJECT;
    fillings[1].id = other;
    reading.filling_count = 2;
    reading.fillings = fillings;
  }
  tw_command(w, visit, &reading, 1000, &out);
  CHECK(out.committed);
  sprout_outcome_free(&out);
}

/* The thing `visit` was given to carry on their first arrival: the tin. */
static const char *tin_of(turn_world *w, const char *visit) {
  const char *person = tw_person(w, visit);
  size_t i;
  for (i = 0; i < w->state->instance_count; i++) {
    const sprout_stored_instance *one = &w->state->instances[i];
    if (one->has_container && one->container.length == strlen(person) &&
        memcmp(one->container.bytes, person, one->container.length) == 0)
      return one->id.bytes;
  }
  return "";
}

/* Delivers the candle's wake `serial` at `instant`; the outcome in `out`. */
static void candle_woken(turn_world *w, uint64_t serial, uint64_t instant, sprout_outcome *out) {
  sprout_turn_input wake = tw_input(SPROUT_TURN_WAKE, instant);
  wake.object = "carried_tells.chapel.candle";
  wake.serial = serial;
  CHECK_INT(tw_run(w, wake, 0, out), SPROUT_OK);
  CHECK(out->committed);
}

static uint64_t next_wake(turn_world *w) {
  const sprout_stored_instance *candle = tw_instance(w, "carried_tells.chapel.candle");
  CHECK(candle != NULL && candle->wake_count == 1);
  return candle != NULL && candle->wake_count == 1 ? candle->wakes[0].serial : 0;
}

static void a_thing_in_a_persons_hands_is_heard_by_them_and_nobody_else(void) {
  turn_world w;
  sprout_outcome out;
  uint64_t serial = chapel_lit(&w);
  /* Set down in the chapel, everyone there hears it. */
  candle_woken(&w, serial, 1060, &out);
  CHECK_INT(out.line_count, 2);
  CHECK(tw_told(&out, "v-wren", "The candle grows shorter."));
  CHECK(tw_told(&out, "v-marta", "The candle grows shorter."));
  sprout_outcome_free(&out);
  chapel_do(&w, "v-wren", "sprout.take", "target", NULL, NULL);
  candle_woken(&w, next_wake(&w), 1120, &out);
  CHECK_INT(out.line_count, 1);
  CHECK(tw_told(&out, "v-wren", "The candle grows shorter."));
  sprout_outcome_free(&out);
  tw_close(&w);
}

static void a_thing_in_an_open_container_a_person_carries_is_heard_by_them_and_in_a_shut_one_by_nobody(void) {
  turn_world w;
  sprout_outcome out;
  sprout_filling filling;
  sprout_reading close;
  uint64_t serial = chapel_lit(&w);
  const char *tin = tin_of(&w, "v-wren");
  CHECK(tin[0] != '\0');
  chapel_do(&w, "v-wren", "sprout.take", "target", NULL, NULL);
  chapel_do(&w, "v-wren", "sprout.put", "item", "container", tin);
  candle_woken(&w, serial, 1060, &out);
  CHECK_INT(out.line_count, 1);
  CHECK(tw_told(&out, "v-wren", "The candle grows shorter."));
  sprout_outcome_free(&out);
  close = tw_reading("sprout.close", tw_person(&w, "v-wren"), &filling, "target", tin);
  tw_command(&w, "v-wren", &close, 1060, &out);
  CHECK(out.committed);
  sprout_outcome_free(&out);
  candle_woken(&w, next_wake(&w), 1120, &out);
  CHECK_INT(out.line_count, 0);
  sprout_outcome_free(&out);
  tw_close(&w);
}

static void a_thing_in_someone_elses_hands_is_not_heard(void) {
  turn_world w;
  sprout_outcome out;
  uint64_t serial = chapel_lit(&w);
  chapel_do(&w, "v-marta", "sprout.take", "target", NULL, NULL);
  candle_woken(&w, serial, 1060, &out);
  CHECK_INT(out.line_count, 1);
  CHECK(tw_told(&out, "v-marta", "The candle grows shorter."));
  CHECK(!tw_told(&out, "v-wren", "The candle grows shorter."));
  sprout_outcome_free(&out);
  tw_close(&w);
}

/* Runs `reading` as `visit` and frees what it said. */
static void vessels_command(turn_world *w, const char *visit, const sprout_reading *reading) {
  sprout_outcome out;
  tw_command(w, visit, reading, 1000, &out);
  CHECK(out.committed);
  sprout_outcome_free(&out);
}

/* `visit` goes `direction` along the exit labelled `label` to `to`. */
static void vessels_go(turn_world *w, const char *visit, const char *direction, const char *label, const char *to) {
  sprout_outcome out;
  tw_go(w, visit, direction, label, to, 1000, &out);
  CHECK(out.committed);
  sprout_outcome_free(&out);
}

/* `visit` shuts `id`, a container below the world of `corpus/good/open-vessel-tells`. */
static void vessels_close(turn_world *w, const char *visit, const char *id) {
  sprout_filling filling;
  sprout_reading close = tw_reading("sprout.close", tw_person(w, visit), &filling, "target", id);
  vessels_command(w, visit, &close);
}

/*
 * The hall of `corpus/good/open-vessel-tells`: Ash in the hall, Wren in the open bucket and Marta in the open basket
 * inside it, Pip in the wardrobe and Ivo in the open hamper inside that; the wardrobe shut by Pip.
 */
static void vessels_boarded(turn_world *w) {
  static const char *const visits[][2] = {
      {"v-ash", "Ash"}, {"v-wren", "Wren"}, {"v-marta", "Marta"}, {"v-pip", "Pip"}, {"v-ivo", "Ivo"}};
  sprout_outcome out;
  size_t i;
  tw_open(w, "open-vessel-tells");
  for (i = 0; i < sizeof visits / sizeof visits[0]; i++) {
    tw_arrive(w, visits[i][0], visits[i][1], 1000, &out);
    sprout_outcome_free(&out);
  }
  vessels_go(w, "v-wren", "in", "into the bucket", "hall.bucket");
  vessels_go(w, "v-marta", "in", "into the bucket", "hall.bucket");
  vessels_go(w, "v-marta", "in", "into the basket", "hall.bucket.basket");
  vessels_go(w, "v-pip", "north", "into the wardrobe", "hall.wardrobe");
  vessels_go(w, "v-ivo", "north", "into the wardrobe", "hall.wardrobe");
  vessels_go(w, "v-ivo", "in", "into the hamper", "hall.wardrobe.hamper");
  vessels_close(w, "v-pip", "open_vessel_tells.hall.wardrobe");
}

static void a_tell_in_a_place_is_heard_in_the_places_inside_it_that_pass_and_not_through_a_lid(void) {
  turn_world w;
  sprout_outcome out;
  vessels_boarded(&w);
  tw_do(&w, "v-ash", "ring", "hall.bell", 1000, &out);
  CHECK(out.committed);
  CHECK(tw_told(&out, "v-ash", "You ring a bell."));
  /* The open bucket passes, and the open basket inside it. */
  CHECK(tw_told(&out, "v-wren", "Ash rings a bell."));
  CHECK(tw_told(&out, "v-marta", "Ash rings a bell."));
  /* The shut wardrobe does not, nor the open hamper behind its door. */
  CHECK_INT(out.line_count, 3);
  sprout_outcome_free(&out);
  vessels_close(&w, "v-wren", "open_vessel_tells.hall.bucket");
  tw_do(&w, "v-ash", "ring", "hall.bell", 1000, &out);
  CHECK(out.committed);
  CHECK_INT(out.line_count, 1);
  CHECK(tw_told(&out, "v-ash", "You ring a bell."));
  sprout_outcome_free(&out);
  tw_close(&w);
}

static void a_voice_goes_into_the_places_inside_its_own_and_never_out(void) {
  turn_world w;
  sprout_outcome out;
  vessels_boarded(&w);
  tw_do(&w, "v-wren", "ring", "hall.bucket.chime", 1000, &out);
  CHECK(out.committed);
  CHECK(tw_told(&out, "v-wren", "You ring a chime."));
  CHECK(tw_told(&out, "v-marta", "Wren rings a chime."));
  /* Not Ash in the hall around the bucket. */
  CHECK_INT(out.line_count, 2);
  sprout_outcome_free(&out);
  tw_close(&w);
}

static void a_place_that_does_not_pass_is_not_heard_in_and_its_own_tell_crosses_in(void) {
  turn_world w;
  sprout_outcome out;
  sprout_filling filling;
  sprout_reading open;
  vessels_boarded(&w);
  /* The shut wardrobe is asked, as the place the gong is rung in, and refuses. */
  tw_do(&w, "v-pip", "ring", "hall.wardrobe.gong", 1000, &out);
  CHECK(out.committed);
  CHECK_INT(out.line_count, 1);
  CHECK(tw_told(&out, "v-pip", "You ring a gong."));
  sprout_outcome_free(&out);
  /* The wardrobe's own `tell` reaches Ivo through the open hamper, and the hall around it. */
  open = tw_reading("sprout.open", tw_person(&w, "v-pip"), &filling, "target", "open_vessel_tells.hall.wardrobe");
  tw_command(&w, "v-pip", &open, 1000, &out);
  CHECK(out.committed);
  CHECK(tw_told(&out, "v-ivo", "Pip opens the wardrobe."));
  CHECK(tw_told(&out, "v-ash", "Pip opens the wardrobe."));
  sprout_outcome_free(&out);
  tw_close(&w);
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

static void a_thing_in_several_places_is_heard_in_each_of_them(void) {
  several s;
  const sprout_str *heard;
  size_t count;
  several_open(&s);
  CHECK_INT(sprout_told_to(&s.x, &s.frame, exec_str(SEVERAL_DOOR), SPROUT_TELL_PLACE, &heard, &count), SPROUT_EVAL_OK);
  CHECK_INT(count, 2);
  CHECK(sprout_str_same(heard[0], exec_str(s.wren)));
  CHECK(sprout_str_same(heard[1], exec_str(s.ash)));
  CHECK_INT(sprout_told_to(&s.x, &s.frame, exec_str(SEVERAL_DOOR), SPROUT_TELL_OUTSIDE, &heard, &count), SPROUT_EVAL_OK);
  CHECK_INT(count, 2);
  several_close(&s);
}

int main(void) {
  RUN(a_thing_in_several_places_is_heard_in_each_of_them);
  RUN(a_plain_tell_reaches_the_people_in_the_tellers_place);
  RUN(a_tell_leaves_out_the_people_the_reading_addresses);
  RUN(a_place_that_holds_actors_has_two_audiences);
  RUN(a_tell_to_one_reaches_a_person_in_range_and_nobody_else);
  RUN(a_thing_in_a_persons_hands_is_heard_by_them_and_nobody_else);
  RUN(a_thing_in_an_open_container_a_person_carries_is_heard_by_them_and_in_a_shut_one_by_nobody);
  RUN(a_thing_in_someone_elses_hands_is_not_heard);
  RUN(a_tell_in_a_place_is_heard_in_the_places_inside_it_that_pass_and_not_through_a_lid);
  RUN(a_voice_goes_into_the_places_inside_its_own_and_never_out);
  RUN(a_place_that_does_not_pass_is_not_heard_in_and_its_own_tell_crosses_in);
  RUN(an_engine_line_is_found_on_the_one_it_is_about_then_its_place_then_the_world);
  RUN(effects_are_recorded_in_order_with_the_names_in_scope);
  RUN(the_golden_speech_cases_end_as_the_typescript_runtime_did);
  return REPORT();
}
