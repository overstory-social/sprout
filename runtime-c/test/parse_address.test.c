/*
 * Tests for src/parse/address.c: what a thing is called and answers to (the spec's Names > Addressing and display,
 * Articles, Nicknames), read in the corpus world `grammar`,
 * and every live instance of every corpus world as a visitor arrives held to the golden
 * (`corpus/goldens/addresses.json`).
 */
#include "parse_golden.h"

static parse_address address(bench *b, const sprout_stored_instance *instance) {
  parse_address out;
  CHECK_INT(parse_address_of(&b->frame, instance, &out), SPROUT_EVAL_OK);
  return out;
}

static parse_address of(bench *b, const char *id) { return address(b, bench_instance(b, id)); }

/* The nouns joined, each by spaces and all by `|`. */
static const char *nouns(bench *b, const parse_address *a) {
  char *out = (char *)sprout_arena_take(b->frame.turn, 512);
  size_t i;
  out[0] = '\0';
  for (i = 0; i < a->noun_count; i++) {
    if (i > 0) strcat(out, "|");
    strcat(out, bench_joined(b, a->nouns[i]));
  }
  return out;
}

static const char *adjectives(bench *b, const parse_address *a) {
  parse_words words;
  words.words = a->adjectives;
  words.count = a->adjective_count;
  return bench_joined(b, words);
}

static void a_thing_is_its_written_name_and_answers_to_it_its_last_word_and_every_noun(void) {
  bench b;
  parse_address key;
  bench_open(&b, "grammar", "Marta Quill");
  key = of(&b, "study.hall.brass_key");
  CHECK_BYTES(key.name.bytes, key.name.length, "brass key");
  CHECK_STR(key.article, "a");
  CHECK_INT(key.pronoun, PARSE_PRONOUN_NONE);
  CHECK_STR(nouns(&b, &key), "brass key|key|metal|shiny thing");
  CHECK_STR(adjectives(&b, &key), "brass");
  bench_close(&b);
}

static void its_names_words_before_the_last_are_adjectives(void) {
  bench b;
  parse_address a;
  bench_open(&b, "grammar", "Marta Quill");
  a = of(&b, "study.hall.lamp_oil");
  CHECK_STR(adjectives(&b, &a), "lamp");
  a = of(&b, "study.hall.gong");
  CHECK_STR(adjectives(&b, &a), "brass");
  a = of(&b, "study.hall.lamp");
  CHECK_INT(a.adjective_count, 0);
  bench_close(&b);
}

static void a_is_an_before_a_vowel_where_none_is_written_and_a_written_one_is_kept(void) {
  bench b;
  parse_address a;
  bench_open(&b, "grammar", "Marta Quill");
  CHECK_STR(of(&b, "study.hall.iron_key").article, "an");
  CHECK_STR(of(&b, "study.hall.lamp_oil").article, "a");
  a = of(&b, "study.cellar.ukulele");
  CHECK_BYTES(a.name.bytes, a.name.length, "ukulele");
  CHECK_STR(a.article, "a");
  bench_close(&b);
}

static void it_is_its_identifier_humanised_where_it_writes_no_name_and_answers_to_that(void) {
  bench b;
  parse_address a;
  bench_open(&b, "grammar", "Marta Quill");
  a = of(&b, "study.hall.iron_key");
  CHECK_BYTES(a.name.bytes, a.name.length, "iron key");
  a = of(&b, "study.hall.lamp_oil");
  CHECK_STR(nouns(&b, &a), "lamp oil|oil|lamp");
  CHECK_STR(of(&b, "study.hall.lamp").article, "the");
  /* Beside a name written otherwise, it answers to its identifier too. */
  a = of(&b, "study.hall.gong");
  CHECK_BYTES(a.name.bytes, a.name.length, "brass disc");
  CHECK_STR(a.article, "the");
  CHECK_STR(nouns(&b, &a), "brass disc|disc|gong");
  bench_close(&b);
}

static void it_takes_a_name_its_kind_writes_and_keeps_its_case(void) {
  bench b;
  parse_address a;
  sprout_str written;
  bench_open(&b, "grammar", "Marta Quill");
  a = of(&b, "study.hall.pebble_b");
  CHECK_BYTES(a.name.bytes, a.name.length, "pebble");
  a = of(&b, "study.hall.guard");
  CHECK_BYTES(a.name.bytes, a.name.length, "Oskar");
  CHECK_STR(a.article, "none");
  CHECK_STR(nouns(&b, &a), "oskar|guard");
  /* The engine writes it as its article and its name in lower case, `none` and all: what tells two apart. */
  CHECK_INT(parse_written_as(&b.frame, &a, &written), SPROUT_EVAL_OK);
  CHECK_BYTES(written.bytes, written.length, "none oskar");
  a = of(&b, "study.hall.gong");
  CHECK_INT(parse_written_as(&b.frame, &a, &written), SPROUT_EVAL_OK);
  CHECK_BYTES(written.bytes, written.length, "the brass disc");
  bench_close(&b);
}

static void a_spawn_is_its_kinds_name_humanised_and_a_content_its_identifier(void) {
  bench b;
  sprout_stored_instance made;
  sprout_str path = bench_str("spare_wick");
  parse_address a;
  bench_open(&b, "grammar", "Marta Quill");
  memset(&made, 0, sizeof made);
  made.id = bench_str("study#90");
  made.made = SPROUT_MADE_SPAWNED;
  made.kind = sprout_world_kind(b.w.world, "study.Gong");
  CHECK(made.kind != NULL);
  a = address(&b, &made);
  CHECK_BYTES(a.name.bytes, a.name.length, "gong");
  CHECK_STR(a.article, "a");
  CHECK_STR(nouns(&b, &a), "gong");
  CHECK_INT(a.adjective_count, 0);
  made.kind = sprout_world_kind(b.w.world, "study.Pebble");
  a = address(&b, &made);
  CHECK_STR(nouns(&b, &a), "pebble");
  made.made = SPROUT_MADE_GIVEN;
  made.kind = sprout_world_kind(b.w.world, "study.Coin");
  made.path = &path;
  made.path_count = 1;
  a = address(&b, &made);
  CHECK_BYTES(a.name.bytes, a.name.length, "spare wick");
  bench_close(&b);
}

static void a_visitor_is_their_nickname_with_no_article_answering_to_the_whole_of_it(void) {
  bench b;
  parse_address a;
  bench_open(&b, "grammar", "Marta Quill");
  a = of(&b, b.actor.bytes);
  CHECK_BYTES(a.name.bytes, a.name.length, "Marta Quill");
  CHECK_STR(a.article, "none");
  CHECK_INT(a.pronoun, PARSE_PRONOUN_NONE);
  CHECK_STR(nouns(&b, &a), "marta quill");
  CHECK_INT(a.adjective_count, 0);
  bench_close(&b);
}

static void the_pronoun_a_thing_declares_is_its_own_and_none_where_it_declares_none(void) {
  bench b;
  bench_open(&b, "pronouns", "Marta");
  CHECK_INT(of(&b, "pronouns.cellar.cat").pronoun, PARSE_PRONOUN_SHE);
  bench_close(&b);
  bench_open(&b, "grammar", "Marta Quill");
  CHECK_INT(of(&b, "study.hall.lamp").pronoun, PARSE_PRONOUN_NONE);
  bench_close(&b);
}

/* Each live instance the golden names is addressed as the golden says. */
static void addressed_alike(bench *b, const sprout_json *world) {
  const sprout_json *instances = sprout_json_get(world, "instances");
  size_t i, j;
  for (i = 0; i < instances->count; i++) {
    const sprout_json *one = instances->items[i], *pronoun = one->items[4];
    const sprout_json *written_nouns = one->items[5], *written_adjectives = one->items[6];
    parse_address a = of(b, one->items[0]->bytes);
    sprout_str written;
    CHECK_INT(parse_written_as(&b->frame, &a, &written), SPROUT_EVAL_OK);
    CHECK_BYTES(written.bytes, written.length, one->items[1]->bytes);
    CHECK_BYTES(a.name.bytes, a.name.length, one->items[2]->bytes);
    CHECK_STR(a.article, one->items[3]->bytes);
    if (pronoun->kind == SPROUT_JSON_NULL) CHECK_INT(a.pronoun, PARSE_PRONOUN_NONE);
    else CHECK_STR(parse_pronoun_text(a.pronoun) == NULL ? "" : parse_pronoun_text(a.pronoun), pronoun->bytes);
    CHECK_INT(a.noun_count, written_nouns->count);
    for (j = 0; j < written_nouns->count && j < a.noun_count; j++)
      CHECK_STR(bench_joined(b, a.nouns[j]), written_nouns->items[j]->bytes);
    CHECK_INT(a.adjective_count, written_adjectives->count);
    for (j = 0; j < written_adjectives->count && j < a.adjective_count; j++)
      CHECK_BYTES(a.adjectives[j].bytes, a.adjectives[j].length, written_adjectives->items[j]->bytes);
  }
}

static void every_corpus_worlds_things_are_addressed_as_the_typescript_runtime_addresses_them(void) {
  golden_worlds(addressed_alike);
}

int main(void) {
  RUN(a_thing_is_its_written_name_and_answers_to_it_its_last_word_and_every_noun);
  RUN(its_names_words_before_the_last_are_adjectives);
  RUN(a_is_an_before_a_vowel_where_none_is_written_and_a_written_one_is_kept);
  RUN(it_is_its_identifier_humanised_where_it_writes_no_name_and_answers_to_that);
  RUN(it_takes_a_name_its_kind_writes_and_keeps_its_case);
  RUN(a_spawn_is_its_kinds_name_humanised_and_a_content_its_identifier);
  RUN(a_visitor_is_their_nickname_with_no_article_answering_to_the_whole_of_it);
  RUN(the_pronoun_a_thing_declares_is_its_own_and_none_where_it_declares_none);
  RUN(every_corpus_worlds_things_are_addressed_as_the_typescript_runtime_addresses_them);
  return REPORT();
}
