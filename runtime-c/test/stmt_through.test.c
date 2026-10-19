/*
 * Tests for src/stmt/through.c (the spec's Verbs > Moving something): an
 * actor goes through a way out of its place, the exit of a direction that
 * applies or one drawn from the turn's seed among those that lead; a way
 * that refuses, a direction no exit answers and a draw with nothing to
 * draw each refuse, to whoever the body speaks to, which in a handler is
 * nobody, and end the body. Played over corpus/good/wandering.
 */
#include "draws.h"
#include "turn_fixture.h"

static sprout_turn_input wake_of(const char *object, uint64_t serial, uint64_t instant) {
  sprout_turn_input input = tw_input(SPROUT_TURN_WAKE, instant);
  input.object = object;
  input.serial = serial;
  return input;
}

/* Shoos `animal` (below the world) at `instant` and runs its wake a minute later with `seed`. */
static void shoo_and_wake(turn_world *w, const char *animal, uint64_t instant, uint64_t seed, sprout_outcome *out) {
  char id[64];
  const sprout_stored_instance *it;
  tw_do(w, "v-marta", "shoo", animal, instant, out);
  sprout_outcome_free(out);
  snprintf(id, sizeof id, "wandering.%s", animal);
  it = tw_instance(w, id);
  CHECK(it != NULL && it->wake_count == 1);
  CHECK_INT(tw_run(w, wake_of(id, it->wakes[0].serial, instant + 60), seed, out), SPROUT_OK);
  CHECK_INT(out->result, SPROUT_RESULT_DONE);
}

/* Whether the instance under `id` stands in `place`, written out from the world down. */
static bool stands_in(turn_world *w, const char *id, const char *place) {
  const sprout_stored_instance *it = tw_instance(w, id);
  if (it == NULL || !it->has_container) return false;
  return it->container.length == strlen(place) && memcmp(it->container.bytes, place, it->container.length) == 0;
}

static void a_direction_no_exit_answers_refuses_to_nobody_and_ends_the_handler(void) {
  turn_world w;
  sprout_outcome out;
  tw_open(&w, "wandering");
  tw_arrive(&w, "v-marta", "Marta", 1000, &out);
  sprout_outcome_free(&out);
  shoo_and_wake(&w, "yard.cat", 1000, 0, &out);
  /* `here` is the cat's own place; the gate is shut, so no exit north applies and nothing moves. */
  CHECK(tw_told(&out, "v-marta", "The cat sniffs the air of the yard."));
  CHECK_INT(out.line_count, 1);
  CHECK(stands_in(&w, "wandering.yard.cat", "wandering.yard"));
  sprout_outcome_free(&out);
  tw_close(&w);
}

static void an_exit_whose_when_holds_takes_the_actor_through(void) {
  turn_world w;
  sprout_outcome out;
  tw_open(&w, "wandering");
  tw_arrive(&w, "v-marta", "Marta", 1000, &out);
  sprout_outcome_free(&out);
  tw_do(&w, "v-marta", "open", "yard.gate", 1000, &out);
  sprout_outcome_free(&out);
  shoo_and_wake(&w, "yard.cat", 1000, 0, &out);
  CHECK(stands_in(&w, "wandering.yard.cat", "wandering.barn"));
  CHECK(tw_told(&out, "v-marta", "The cat leaves for the barn."));
  /* What the handler says after the move is said in the barn, where nobody is. */
  CHECK(!tw_told(&out, "v-marta", "The cat pads in from the yard."));
  sprout_outcome_free(&out);
  tw_close(&w);
}

static void an_exit_that_refuses_is_the_refusal_and_nothing_after_it_runs(void) {
  turn_world w;
  sprout_outcome out;
  tw_open(&w, "wandering");
  tw_arrive(&w, "v-marta", "Marta", 1000, &out);
  sprout_outcome_free(&out);
  tw_do(&w, "v-marta", "poke", "yard.cat", 1000, &out);
  CHECK(out.committed);
  CHECK(tw_told(&out, "v-marta", "The cat bristles."));
  CHECK_INT(out.line_count, 1);
  CHECK(stands_in(&w, "wandering.yard.cat", "wandering.yard"));
  sprout_outcome_free(&out);
  tw_close(&w);
}

static void a_way_drawn_is_among_those_that_lead_and_the_seed_chooses(void) {
  uint64_t seed;
  for (seed = 0; seed < 8; seed++) {
    turn_world w;
    sprout_outcome out;
    sprout_draws draws;
    uint32_t drawn = 9;
    tw_open(&w, "wandering");
    tw_arrive(&w, "v-marta", "Marta", 1000, &out);
    sprout_outcome_free(&out);
    /* In the barn one way leads, the ladder refusing, so every seed takes the dog to the yard. */
    shoo_and_wake(&w, "barn.dog", 1000, seed, &out);
    CHECK(stands_in(&w, "wandering.barn.dog", "wandering.yard"));
    sprout_outcome_free(&out);
    /* In the yard with the gate open two lead, north and in, the fence refusing: the turn's first draw below two. */
    tw_do(&w, "v-marta", "open", "yard.gate", 1100, &out);
    sprout_outcome_free(&out);
    shoo_and_wake(&w, "barn.dog", 1100, seed, &out);
    CHECK_INT(sprout_draws_begin(&draws, seed), SPROUT_OK);
    CHECK(sprout_draws_below(&draws, 2, &drawn));
    CHECK(stands_in(&w, "wandering.barn.dog", drawn == 0 ? "wandering.barn" : "wandering.coop"));
    sprout_outcome_free(&out);
    tw_close(&w);
  }
}

static void a_draw_with_no_way_to_draw_refuses_and_ends_the_handler(void) {
  turn_world w;
  sprout_outcome out;
  tw_open(&w, "wandering");
  tw_arrive(&w, "v-marta", "Marta", 1000, &out);
  sprout_outcome_free(&out);
  tw_go(&w, "v-marta", "in", "into the coop", "coop", 1000, &out);
  sprout_outcome_free(&out);
  shoo_and_wake(&w, "coop.owl", 1000, 0, &out);
  CHECK(out.committed);
  CHECK_INT(out.line_count, 0);
  CHECK(stands_in(&w, "wandering.coop.owl", "wandering.coop"));
  sprout_outcome_free(&out);
  tw_close(&w);
}

int main(void) {
  RUN(a_direction_no_exit_answers_refuses_to_nobody_and_ends_the_handler);
  RUN(an_exit_whose_when_holds_takes_the_actor_through);
  RUN(an_exit_that_refuses_is_the_refusal_and_nothing_after_it_runs);
  RUN(a_way_drawn_is_among_those_that_lead_and_the_seed_chooses);
  RUN(a_draw_with_no_way_to_draw_refuses_and_ends_the_handler);
  return REPORT();
}
