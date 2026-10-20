/*
 * Tests for src/parse/vocabulary.c: the words a noun may be made of anywhere in the world (the spec's Parsing > When
 * nothing matches), in the study (the corpus world `grammar`) with
 * Marta arrived in its hall: the cellar's barrel and ukulele out of reach, the coin shut in the chest.
 */
#include "parse_fixture.h"

static bool has(const parse_vocabulary *vocabulary, const char *word) {
  parse_words words;
  sprout_str one = bench_str(word);
  words.words = &one;
  words.count = 1;
  return parse_in_vocabulary(words, vocabulary);
}

static void they_are_every_name_noun_and_adjective_of_every_thing_in_reach_or_not_and_its_kinds_names(void) {
  static const char *const known[] = {"brass", "key", "shiny", "thing", "disc", "oskar", "coin",
                                      "barrel", "ukulele", "metal", "pebble", "guard", "marta", "person"};
  bench b;
  parse_vocabulary vocabulary;
  size_t i;
  bench_open(&b, "grammar", "Marta");
  CHECK_INT(parse_world_words(&b.frame, b.frame.turn, &vocabulary), SPROUT_EVAL_OK);
  for (i = 0; i < sizeof known / sizeof *known; i++) {
    CHECK(has(&vocabulary, known[i]));
    if (!has(&vocabulary, known[i])) fprintf(stderr, "  missing: %s\n", known[i]);
  }
  CHECK(!has(&vocabulary, "unicorn"));
  bench_close(&b);
}

static void they_are_the_parsers_own_a_noun_may_hold_but_not_again_or_then(void) {
  static const char *const own[] = {"the", "my", "and", ",", "in", "on", "that", "it", "them", "all", "everything",
                                    "except"};
  bench b;
  parse_vocabulary vocabulary;
  size_t i;
  bench_open(&b, "grammar", "Marta");
  CHECK_INT(parse_world_words(&b.frame, b.frame.turn, &vocabulary), SPROUT_EVAL_OK);
  for (i = 0; i < sizeof own / sizeof *own; i++) CHECK(has(&vocabulary, own[i]));
  CHECK(!has(&vocabulary, "again"));
  CHECK(!has(&vocabulary, "then"));
  bench_close(&b);
}

static void they_are_what_the_bundle_writes_though_nothing_is_in_the_world_now(void) {
  bench b;
  parse_vocabulary vocabulary;
  const sprout_str *removed;
  size_t count;
  bench_open(&b, "grammar", "Marta");
  /* The cellar and all it holds leave the tree; the bundle still writes the barrel and the ukulele. */
  CHECK_INT(sprout_draft_remove(&b.run.draft, bench_str("study.cellar"), &removed, &count), SPROUT_DRAFT_OK);
  CHECK_INT(parse_world_words(&b.frame, b.frame.turn, &vocabulary), SPROUT_EVAL_OK);
  CHECK(has(&vocabulary, "barrel"));
  CHECK(has(&vocabulary, "ukulele"));
  bench_close(&b);
}

static void they_are_every_kinds_name_a_librarys_too_though_nothing_is_made_of_it(void) {
  bench b;
  parse_vocabulary vocabulary;
  bench_open(&b, "grammar", "Marta");
  /* Nothing in the study is lockable. */
  CHECK_INT(parse_world_words(&b.frame, b.frame.turn, &vocabulary), SPROUT_EVAL_OK);
  CHECK(has(&vocabulary, "lockable"));
  bench_close(&b);
}

static void every_instance_the_worlds_tree_holds_is_a_step_and_what_the_bundle_writes_none(void) {
  bench b;
  uint64_t before;
  parse_vocabulary vocabulary;
  const sprout_str *removed;
  size_t count;
  bench_open(&b, "grammar", "Marta");
  before = b.run.meter->steps;
  CHECK_INT(parse_world_words(&b.frame, b.frame.turn, &vocabulary), SPROUT_EVAL_OK);
  /* The world; the hall, its eleven things, the coin shut in the chest and Marta; the cellar and its two. */
  CHECK_INT(b.run.meter->steps - before, 1 + 1 + 11 + 1 + 1 + 1 + 2);
  /* A thing gone from the tree is no step. */
  CHECK_INT(sprout_draft_remove(&b.run.draft, bench_str("study.cellar.barrel"), &removed, &count), SPROUT_DRAFT_OK);
  before = b.run.meter->steps;
  CHECK_INT(parse_world_words(&b.frame, b.frame.turn, &vocabulary), SPROUT_EVAL_OK);
  CHECK_INT(b.run.meter->steps - before, 17);
  bench_close(&b);
}

static void a_walk_past_the_budget_faults_the_turn(void) {
  bench b;
  parse_vocabulary vocabulary;
  bench_open(&b, "grammar", "Marta");
  b.w.host.budgets.steps = (sprout_limit){true, b.run.meter->steps + 5};
  CHECK_INT(parse_world_words(&b.frame, b.frame.turn, &vocabulary), SPROUT_EVAL_FAULT);
  CHECK(b.run.meter->faulted);
  bench_close(&b);
}

static void they_hold_a_noun_only_where_every_one_of_its_words_is_one(void) {
  bench b;
  parse_vocabulary vocabulary;
  bench_open(&b, "grammar", "Marta");
  CHECK_INT(parse_world_words(&b.frame, b.frame.turn, &vocabulary), SPROUT_EVAL_OK);
  CHECK(parse_in_vocabulary(bench_words(&b, "the barrel in the chest"), &vocabulary));
  CHECK(!parse_in_vocabulary(bench_words(&b, "the lamp again"), &vocabulary));
  bench_close(&b);
}

static void a_noun_after_all_holds_its_last_word_as_typed_or_as_a_plural(void) {
  bench b;
  parse_vocabulary vocabulary;
  bool known;
  bench_open(&b, "grammar", "Marta");
  CHECK_INT(parse_world_words(&b.frame, b.frame.turn, &vocabulary), SPROUT_EVAL_OK);
  CHECK(parse_in_vocabulary_as_plural(b.frame.turn, bench_words(&b, "the brass keys"), &vocabulary, &known) && known);
  CHECK(parse_in_vocabulary_as_plural(b.frame.turn, bench_words(&b, "the barrels"), &vocabulary, &known) && known);
  CHECK(parse_in_vocabulary_as_plural(b.frame.turn, bench_words(&b, "the key"), &vocabulary, &known) && known);
  /* Only the last word is read as a plural, and a plural of no word the world names is none. */
  CHECK(parse_in_vocabulary_as_plural(b.frame.turn, bench_words(&b, "brasses key"), &vocabulary, &known) && !known);
  CHECK(parse_in_vocabulary_as_plural(b.frame.turn, bench_words(&b, "zebras"), &vocabulary, &known) && !known);
  /* Where it is not after `all`, a plural is no word of the world's. */
  CHECK(!parse_in_vocabulary(bench_words(&b, "the barrels"), &vocabulary));
  bench_close(&b);
}

int main(void) {
  RUN(they_are_every_name_noun_and_adjective_of_every_thing_in_reach_or_not_and_its_kinds_names);
  RUN(they_are_the_parsers_own_a_noun_may_hold_but_not_again_or_then);
  RUN(they_are_what_the_bundle_writes_though_nothing_is_in_the_world_now);
  RUN(they_are_every_kinds_name_a_librarys_too_though_nothing_is_made_of_it);
  RUN(every_instance_the_worlds_tree_holds_is_a_step_and_what_the_bundle_writes_none);
  RUN(a_walk_past_the_budget_faults_the_turn);
  RUN(they_hold_a_noun_only_where_every_one_of_its_words_is_one);
  RUN(a_noun_after_all_holds_its_last_word_as_typed_or_as_a_plural);
  return REPORT();
}
