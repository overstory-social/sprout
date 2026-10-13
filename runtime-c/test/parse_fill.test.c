/*
 * Tests for src/parse/fill.c: what the words a slot took fill its role with (the spec's Verbs > Slots, Set roles,
 * Carried roles, Exits; Parsing > Sequences, again and all), read in corpus worlds: the ways out of `no-way`'s
 * clearing and `out-of-reach-exit`'s, the tools of `carried`, and the kitchen of `runs`.
 */
#include "parse_fixture.h"

typedef struct slot {
  bench b;
  parse_fill_context fill;
} slot;

/* The world `name` with Marta arrived, what she can reach and the ways out where she stands. */
static void open_slot(slot *s, const char *name) {
  const sprout_stored_instance *marta;
  parse_candidate *candidates;
  bench_open(&s->b, name, "Marta");
  marta = bench_instance(&s->b, s->b.actor.bytes);
  memset(&s->fill, 0, sizeof s->fill);
  s->fill.nouns = bench_nouns(&s->b, NULL, 0);
  CHECK_INT(sprout_ways_from(&s->b.frame, marta->container, &s->fill.ways, &s->fill.way_count), SPROUT_EVAL_OK);
  CHECK_INT(parse_reach_of(&s->b.frame, s->b.actor, &candidates, &s->fill.candidate_count), SPROUT_EVAL_OK);
  s->fill.candidates = candidates;
}

/* Reaches again, after the draft has changed. */
static void reach_again(slot *s) {
  parse_candidate *candidates;
  CHECK_INT(parse_reach_of(&s->b.frame, s->b.actor, &candidates, &s->fill.candidate_count), SPROUT_EVAL_OK);
  s->fill.candidates = candidates;
}

static parse_filled fill(slot *s, const sprout_role *role, const char *line) {
  parse_filled out;
  CHECK_INT(parse_fill_slot(&s->fill, role, bench_words(&s->b, line), &out), SPROUT_EVAL_OK);
  return out;
}

static const char *id_of(const parse_named *thing) { return thing->candidate->instance->id.bytes; }

static void an_exit_that_refuses_is_answered_and_a_direction_none_answers_is_no_way(void) {
  slot s;
  const sprout_role *way;
  parse_filled filled;
  uint64_t before;
  open_slot(&s, "no-way");
  way = bench_role(&s.b, "sprout", "go", "way");
  before = s.b.run.meter->steps;
  filled = fill(&s, way, "north");
  /* Asking which way the words name is a step. */
  CHECK_INT(s.b.run.meter->steps - before, 1);
  CHECK_INT(filled.fills, PARSE_FILLS_REFUSED);
  CHECK(filled.way != NULL && filled.way->refuses);
  CHECK_INT(fill(&s, way, "w").fills, PARSE_FILLS_REFUSED);
  filled = fill(&s, way, "south");
  CHECK_INT(filled.fills, PARSE_FILLS_NO_WAY);
  CHECK_STR(filled.direction, "south");
  CHECK_INT(fill(&s, way, "xyzzy").fills, PARSE_FILLS_UNFIT);
  bench_close(&s.b);
}

static void an_exit_that_applies_is_its_option_and_a_label_written_elsewhere_names_nothing_here(void) {
  slot s;
  const sprout_role *way;
  parse_filled filled;
  open_slot(&s, "out-of-reach-exit");
  way = bench_role(&s.b, "sprout", "go", "way");
  filled = fill(&s, way, "n");
  CHECK_INT(filled.fills, PARSE_FILLS_OPTIONS);
  CHECK(filled.way != NULL && strcmp(filled.way->direction, "north") == 0);
  CHECK_INT(filled.literal, 1);
  filled = fill(&s, way, "the window");
  CHECK_INT(filled.fills, PARSE_FILLS_NOTHING);
  CHECK(filled.start == 0 && filled.end == 2);
  bench_close(&s.b);
}

static void a_carried_role_takes_what_is_carried_and_is_outward_where_only_something_further_out_answers(void) {
  slot s;
  const sprout_role *tool;
  parse_filled filled;
  open_slot(&s, "carried");
  tool = bench_role(&s.b, "sprout", "unlock", "tool");
  filled = fill(&s, tool, "iron key");
  CHECK_INT(filled.fills, PARSE_FILLS_OUTWARD);
  CHECK(filled.thing_count == 1 && strcmp(id_of(&filled.things[0]), "carried.cellar.iron_key") == 0);
  CHECK_INT(sprout_draft_place(&s.b.run.draft, bench_str("carried.cellar.iron_key"), &s.b.actor), SPROUT_DRAFT_OK);
  reach_again(&s);
  /* A carried thing the noun names wins over one further out, with no draw. */
  filled = fill(&s, tool, "key");
  CHECK_INT(filled.fills, PARSE_FILLS_OPTIONS);
  CHECK(filled.thing_count == 1 && strcmp(id_of(&filled.things[0]), "carried.cellar.iron_key") == 0);
  CHECK_INT(fill(&s, tool, "unicorn").fills, PARSE_FILLS_NOTHING);
  bench_close(&s.b);
}

static void a_thing_role_takes_a_run_its_first_item_now_and_each_after_it_in_order(void) {
  slot s;
  const sprout_role *take;
  parse_filled filled;
  open_slot(&s, "runs");
  take = bench_role(&s.b, "sprout", "take", "target");
  filled = fill(&s, take, "salt and lamp");
  CHECK_INT(filled.fills, PARSE_FILLS_RUN);
  CHECK(filled.thing_count == 1 && strcmp(id_of(&filled.things[0]), "runs.kitchen.salt") == 0);
  CHECK_INT(filled.later_count, 1);
  CHECK(filled.later[0].start == 2 && filled.later[0].end == 3 && filled.later[0].filled.fills == PARSE_FILLS_OPTIONS);
  /* An item after the first that names nothing is left for its own turn to read. */
  filled = fill(&s, take, "lamp and unicorn");
  CHECK_INT(filled.fills, PARSE_FILLS_RUN);
  CHECK_INT(filled.later[0].filled.fills, PARSE_FILLS_NOTHING);
  /* The first naming nothing, the slot names nothing, where its noun runs. */
  filled = fill(&s, take, "unicorn and lamp");
  CHECK(filled.fills == PARSE_FILLS_NOTHING && filled.start == 0 && filled.end == 1);
  CHECK_INT(fill(&s, take, "lamp and all").fills, PARSE_FILLS_UNFIT);
  filled = fill(&s, take, "the salt and pepper shaker");
  CHECK(filled.fills == PARSE_FILLS_OPTIONS && strcmp(id_of(&filled.things[0]), "runs.kitchen.shaker") == 0);
  bench_close(&s.b);
}

static void a_set_role_binds_the_run_at_once_and_a_value_role_takes_any_words(void) {
  slot s;
  parse_filled filled;
  open_slot(&s, "runs");
  filled = fill(&s, bench_role(&s.b, "runs", "juggle", "things"), "salt and lamp");
  CHECK(filled.fills == PARSE_FILLS_OPTIONS && filled.set_count == 1 && filled.sets[0].count == 2);
  filled = fill(&s, bench_role(&s.b, "runs", "juggle", "things"), "salt and unicorn");
  CHECK(filled.fills == PARSE_FILLS_NOTHING && filled.start == 2 && filled.end == 3);
  CHECK_INT(fill(&s, bench_role(&s.b, "sprout", "ask", "topic"), "the old press").fills, PARSE_FILLS_WORDS);
  bench_close(&s.b);
}

static void an_intents_slot_takes_what_fits_any_role_it_is_given_carried_where_any_is(void) {
  slot s;
  const sprout_role *roles[2];
  parse_filled filled;
  open_slot(&s, "carried");
  roles[0] = bench_role(&s.b, "sprout", "take", "target");
  CHECK_INT(parse_fill_intent_slot(&s.fill, roles, 1, bench_words(&s.b, "iron key"), &filled), SPROUT_EVAL_OK);
  CHECK_INT(filled.fills, PARSE_FILLS_OPTIONS);
  roles[1] = bench_role(&s.b, "sprout", "unlock", "tool");
  CHECK_INT(parse_fill_intent_slot(&s.fill, roles, 2, bench_words(&s.b, "iron key"), &filled), SPROUT_EVAL_OK);
  CHECK_INT(filled.fills, PARSE_FILLS_OUTWARD);
  bench_close(&s.b);
}

int main(void) {
  RUN(an_exit_that_refuses_is_answered_and_a_direction_none_answers_is_no_way);
  RUN(an_exit_that_applies_is_its_option_and_a_label_written_elsewhere_names_nothing_here);
  RUN(a_carried_role_takes_what_is_carried_and_is_outward_where_only_something_further_out_answers);
  RUN(a_thing_role_takes_a_run_its_first_item_now_and_each_after_it_in_order);
  RUN(a_set_role_binds_the_run_at_once_and_a_value_role_takes_any_words);
  RUN(an_intents_slot_takes_what_fits_any_role_it_is_given_carried_where_any_is);
  return REPORT();
}
