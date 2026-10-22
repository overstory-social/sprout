/*
 * Tests for src/parse/phrases.c: every phrase tried against a line, and a line no reading reads tried by its first
 * words (the spec's Parsing > Matching a line, When nothing matches), in the corpus world `trailing-words`, where
 * Marta stands in the clearing with the menhir, the sword, the place mat and the case, and the gong is in the cellar.
 * What the line comes to through `sprout_parse`, the words read restated, is parse_command's.
 */
#include "parse_fixture.h"

typedef struct reading_line {
  bench b;
  parse_line line;
} reading_line;

static void open_clearing(reading_line *r) {
  const sprout_stored_instance *marta;
  parse_candidate *candidates;
  memset(r, 0, sizeof *r);
  bench_open(&r->b, "trailing-words", "Marta");
  marta = bench_instance(&r->b, r->b.actor.bytes);
  r->line.run = &r->b.run;
  r->line.frame = r->b.frame;
  r->line.actor = r->b.actor;
  r->line.here = marta->container;
  CHECK_INT(sprout_ways_from(&r->b.frame, marta->container, &r->line.ways, &r->line.way_count), SPROUT_EVAL_OK);
  CHECK_INT(parse_reach_of(&r->b.frame, r->b.actor, &candidates, &r->line.candidate_count), SPROUT_EVAL_OK);
  r->line.candidates = candidates;
}

static parse_tried tried(reading_line *r, const char *text) {
  parse_tried out;
  CHECK_INT(parse_phrases_read(&r->line, bench_words(&r->b, text), &out), SPROUT_EVAL_OK);
  return out;
}

/* The first words `text` is read by, joined, or NULL where none make a reading. */
static const char *first_words(reading_line *r, const char *text) {
  parse_tried whole = tried(r, text), first;
  bool read;
  CHECK_INT(whole.readings.count, 0);
  CHECK_INT(parse_first_words_read(&r->line, &whole, &first, &read), SPROUT_EVAL_OK);
  return read ? bench_joined(&r->b, first.words) : NULL;
}

static void a_line_read_whole_makes_its_reading(void) {
  reading_line r;
  parse_tried t;
  open_clearing(&r);
  t = tried(&r, "push the menhir");
  CHECK_INT(t.readings.count, 1);
  CHECK(!t.not_here);
  CHECK(!t.missing);
  CHECK_INT(t.words.count, 3);
  bench_close(&r.b);
}

static void a_noun_naming_nothing_in_reach_is_kept_as_the_last_place_one_begins(void) {
  reading_line r;
  parse_tried t;
  open_clearing(&r);
  /* `push [target]` takes all of `the menhir with the sword`, which names nothing. */
  t = tried(&r, "push the menhir with the sword");
  CHECK_INT(t.readings.count, 0);
  CHECK(t.not_here);
  CHECK(t.missing);
  CHECK_INT(t.missing_from, 1);
  /* `drop [item] on [surface]` puts the gong in a slot of its own, after `drop [target]`'s noun. */
  t = tried(&r, "drop sword on gong");
  CHECK(t.missing);
  CHECK_INT(t.missing_from, 3);
  /* A line no phrase reads names nothing missing. */
  t = tried(&r, "frobnicate the menhir");
  CHECK(!t.not_here);
  CHECK(!t.missing);
  bench_close(&r.b);
}

static void the_longest_first_words_that_make_a_reading_are_read(void) {
  reading_line r;
  open_clearing(&r);
  CHECK_STR(first_words(&r, "push the menhir with the sword"), "push the menhir");
  CHECK_STR(first_words(&r, "take the sword too"), "take the sword");
  CHECK_STR(first_words(&r, "pull the place mat back"), "pull the place mat");
  CHECK_STR(first_words(&r, "wait for the floating to stop"), "wait");
  CHECK_STR(first_words(&r, "take the passage that climbs"), "take the passage");
  /* Words dropped are dropped whatever they name: the case is in reach. */
  CHECK_STR(first_words(&r, "put sword in case quickly"), "put sword in case");
  CHECK_STR(first_words(&r, "drop sword in case"), "drop sword");
  bench_close(&r.b);
}

static void a_noun_naming_nothing_in_a_slot_of_its_own_is_never_dropped(void) {
  reading_line r;
  open_clearing(&r);
  /* `look` and `drop sword` would read, but the gong was named and is not here. */
  CHECK(first_words(&r, "look at gong") == NULL);
  CHECK(first_words(&r, "drop sword on gong") == NULL);
  /* Longer first words tried count too: `examine gong` names the gong alone, so `examine` is not tried. */
  CHECK(first_words(&r, "examine gong closely") == NULL);
  /* First words whose nouns name nothing make no reading. */
  CHECK(first_words(&r, "push the gong with the sword") == NULL);
  CHECK(first_words(&r, "frobnicate the menhir") == NULL);
  bench_close(&r.b);
}

static void and_a_comma_or_except_is_never_dropped(void) {
  reading_line r;
  open_clearing(&r);
  /* `all` is no item of a run, so nothing reads the line; `take the sword` would. */
  CHECK(first_words(&r, "take the sword and all") == NULL);
  CHECK(first_words(&r, "take the sword, all") == NULL);
  /* `pull` takes the sword and the mat, so `all` leaves nothing once both are left out; `pull all` would read. */
  CHECK(first_words(&r, "pull all except the sword and the mat") == NULL);
  bench_close(&r.b);
}

static void first_words_tried_are_charged_to_the_turn(void) {
  reading_line r;
  parse_tried whole, first;
  uint64_t before;
  bool read;
  open_clearing(&r);
  whole = tried(&r, "push the menhir with the sword");
  before = r.b.run.meter->steps;
  CHECK_INT(parse_first_words_read(&r.line, &whole, &first, &read), SPROUT_EVAL_OK);
  CHECK(read);
  CHECK(r.b.run.meter->steps > before);
  bench_close(&r.b);
}

int main(void) {
  RUN(a_line_read_whole_makes_its_reading);
  RUN(a_noun_naming_nothing_in_reach_is_kept_as_the_last_place_one_begins);
  RUN(the_longest_first_words_that_make_a_reading_are_read);
  RUN(a_noun_naming_nothing_in_a_slot_of_its_own_is_never_dropped);
  RUN(and_a_comma_or_except_is_never_dropped);
  RUN(first_words_tried_are_charged_to_the_turn);
  return REPORT();
}
