/*
 * Tests for src/parse/offered.c: an object's synonym typed where the object is out of reach (the spec's Parsing >
 * Synonyms, When nothing matches), in the corpus world
 * `out-of-reach-synonym`, where the yard's window makes `enter` a word for `go_through` and Marta stands in the
 * clearing, or in the yard beside it. What the answer comes to through `sprout_parse` is parse_command's.
 */
#include "parse_fixture.h"

#define WINDOW "out_of_reach_synonym.yard.window"

typedef struct asking {
  bench b;
  parse_fill_context fill;
  const sprout_typed_phrase *phrase;
  parse_words words;
  bool named, placed;
  uint64_t steps;
} asking;

/* Marta arrived, in the clearing, or gone north into the yard. */
static void open_house(asking *a, bool in_yard) {
  sprout_outcome done;
  const sprout_stored_instance *marta;
  parse_candidate *candidates;
  size_t i;
  memset(a, 0, sizeof *a);
  tw_open(&a->b.w, "out-of-reach-synonym");
  tw_arrive(&a->b.w, "v-marta", "Marta", 1000, &done);
  sprout_outcome_free(&done);
  if (in_yard) {
    tw_go(&a->b.w, "v-marta", "north", "north", "yard", 1001, &done);
    sprout_outcome_free(&done);
  }
  a->b.actor = bench_str(tw_person(&a->b.w, "v-marta"));
  bench_turn(&a->b);
  marta = bench_instance(&a->b, a->b.actor.bytes);
  a->fill.nouns = bench_nouns(&a->b, NULL, 0);
  CHECK_INT(sprout_ways_from(&a->b.frame, marta->container, &a->fill.ways, &a->fill.way_count), SPROUT_EVAL_OK);
  CHECK_INT(parse_reach_of(&a->b.frame, a->b.actor, &candidates, &a->fill.candidate_count), SPROUT_EVAL_OK);
  a->fill.candidates = candidates;
  for (i = 0; i < a->b.w.world->phrase_count; i++)
    if (a->b.w.world->phrases[i].only != NULL && strcmp(a->b.w.world->phrases[i].only, WINDOW) == 0)
      a->phrase = &a->b.w.world->phrases[i];
  CHECK(a->phrase != NULL);
}

/* The first placement of the window's phrase: its slots filled, then asked after, and the steps the asking spent. */
static sprout_eval_status first_placement(void *context, const parse_span *spans, size_t count) {
  asking *a = (asking *)context;
  const parse_filled **fills = (const parse_filled **)sprout_arena_take(a->b.frame.turn, (count + 1) * sizeof *fills);
  parse_placement placement;
  uint64_t before;
  size_t i;
  if (a->placed) return SPROUT_EVAL_OK;
  a->placed = true;
  for (i = 0; i < count; i++) {
    parse_filled *filled = (parse_filled *)sprout_arena_take(a->b.frame.turn, sizeof *filled);
    parse_words words;
    words.words = a->words.words + spans[i].start;
    words.count = spans[i].end - spans[i].start;
    CHECK_INT(parse_fill_slot(&a->fill, &a->phrase->verb->roles[spans[i].role], words, filled), SPROUT_EVAL_OK);
    fills[i] = filled;
  }
  memset(&placement, 0, sizeof placement);
  placement.phrase = a->phrase;
  placement.words = a->words;
  placement.spans = spans;
  placement.count = count;
  placement.fills = fills;
  before = a->b.run.meter->steps;
  CHECK_INT(parse_offered_out_of_reach(&a->fill, &placement, &a->named), SPROUT_EVAL_OK);
  a->steps = a->b.run.meter->steps - before;
  return SPROUT_EVAL_OK;
}

/* Whether `line` is one the window's phrase would read with the window in reach. */
static bool asked(asking *a, const char *line) {
  a->words = bench_words(&a->b, line);
  a->placed = a->named = false;
  a->steps = 0;
  CHECK_INT(parse_slot_spans(a->b.frame.turn, a->phrase->parts, a->phrase->part_count, a->words.words,
                             a->words.count, first_placement, a),
            SPROUT_EVAL_OK);
  return a->named;
}

static void it_would_read_the_line_where_its_noun_names_the_object(void) {
  asking a;
  open_house(&a, false);
  CHECK(asked(&a, "enter window"));
  CHECK(asked(&a, "enter the window"));
  bench_close(&a.b);
}

static void it_would_not_where_the_noun_names_something_else_or_nothing_at_all(void) {
  asking a;
  open_house(&a, false);
  CHECK(!asked(&a, "enter door"));
  CHECK(!asked(&a, "enter zebra"));
  bench_close(&a.b);
}

static void it_would_not_where_the_object_is_no_longer_in_the_world(void) {
  asking a;
  const sprout_str *removed;
  size_t count;
  open_house(&a, false);
  CHECK_INT(sprout_draft_remove(&a.b.run.draft, bench_str(WINDOW), &removed, &count), SPROUT_DRAFT_OK);
  CHECK(!asked(&a, "enter window"));
  bench_close(&a.b);
}

static void it_spends_a_step_on_the_noun_it_tries_and_none_where_it_names_something_in_reach(void) {
  asking a;
  open_house(&a, false);
  CHECK(asked(&a, "enter window"));
  CHECK(a.steps > 0);
  bench_close(&a.b);
  open_house(&a, true);
  CHECK(!asked(&a, "enter window"));
  CHECK_INT(a.steps, 0);
  bench_close(&a.b);
}

static void it_is_no_other_phrases_to_ask(void) {
  asking a;
  parse_placement placement;
  bool named = true;
  open_house(&a, false);
  memset(&placement, 0, sizeof placement);
  CHECK_INT(parse_offered_out_of_reach(&a.fill, &placement, &named), SPROUT_EVAL_OK);
  CHECK(!named);
  bench_close(&a.b);
}

int main(void) {
  RUN(it_would_read_the_line_where_its_noun_names_the_object);
  RUN(it_would_not_where_the_noun_names_something_else_or_nothing_at_all);
  RUN(it_would_not_where_the_object_is_no_longer_in_the_world);
  RUN(it_spends_a_step_on_the_noun_it_tries_and_none_where_it_names_something_in_reach);
  RUN(it_is_no_other_phrases_to_ask);
  return REPORT();
}
