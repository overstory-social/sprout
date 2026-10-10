/*
 * Tests for src/prose/names.c: an object renders as its article and name, "you" to its reader,
 * a visitor as the nickname the turn leaves them with, and an option humanised.
 */
#include "prose_fixture.h"

static void names_render_as_the_oracle_did(void) {
  prose_bench b;
  prose_bench_open(&b);
  CHECK(prose_replay_area(&b, "names") >= 4);
  prose_bench_close(&b);
  CHECK_INT(b.heap.pages, 0);
}

/* What `object` renders as for `reader` in the turn the named case opens. */
static const char *words_of(prose_case *c, const char *object, const char *reader) {
  prose_reading reading = prose_reading_of(c, reader);
  sprout_frame frame = prose_frame(&reading, NULL, (sprout_str){"bench.yard.echo", 15}, "bench", NULL);
  sprout_str words;
  if (prose_object_words(&frame, (sprout_str){object, strlen(object)}, reading.reader, &words) != SPROUT_EVAL_OK) return "(refused)";
  return sprout_arena_copy(&c->turn, words.bytes, words.length);
}

static void an_article_and_a_name_come_from_the_grammar_block_the_identifier_or_the_kind(void) {
  prose_bench b;
  prose_case c;
  const char *marta;
  prose_bench_open(&b);
  prose_case_open(&b, &c, prose_named(&b, "articles come from the grammar block, the identifier or the kind, and none writes none"));
  marta = prose_text(c.golden, "actor");
  CHECK_STR(words_of(&c, "bench.yard.crate", marta), "the crate");
  CHECK_STR(words_of(&c, "bench.yard.owl", marta), "an owl");
  CHECK_STR(words_of(&c, "bench.yard.press", marta), "a press");
  CHECK_STR(words_of(&c, "bench.yard.tin_cup", marta), "a dented cup");
  CHECK_STR(words_of(&c, "bench.yard.dune", marta), "dune");
  CHECK_STR(words_of(&c, "bench.yard.crate.apple", marta), "an apple");
  CHECK_STR(words_of(&c, "bench.yard.crate.spare_rib", marta), "a spare rib");
  CHECK_STR(words_of(&c, "bench.yard.cat", marta), "a tabby cat");
  CHECK_STR(words_of(&c, "bench.yard", marta), "a yard");
  CHECK_STR(words_of(&c, "bench", marta), "a bench");
  prose_case_close(&c);
  prose_bench_close(&b);
}

static void a_thing_with_no_identifier_is_named_for_its_kind(void) {
  prose_bench b;
  prose_case c;
  const sprout_json *lines;
  prose_bench_open(&b);
  prose_case_open(&b, &c, prose_named(&b, "a name the engine gives an object with no identifier is its kind’s, humanised"));
  lines = sprout_json_get(c.golden, "lines");
  CHECK_STR(words_of(&c, prose_text(lines->items[0], "by"), prose_text(c.golden, "actor")), "a maze cell");
  prose_case_close(&c);
  prose_bench_close(&b);
}

static void an_object_is_you_to_itself_and_a_visitor_is_their_nickname_to_anyone_else(void) {
  prose_bench b;
  prose_case c;
  const char *marta;
  prose_bench_open(&b);
  prose_case_open(&b, &c, prose_named(&b, "a nickname changed in the turn reads as changed, to everyone"));
  marta = prose_text(c.golden, "actor");
  CHECK_STR(words_of(&c, marta, marta), "you");
  CHECK_STR(words_of(&c, marta, "bench.yard.press"), "Marta B");
  prose_case_close(&c);
  prose_bench_close(&b);
}

static void an_option_is_humanised(void) {
  sprout_arena arena;
  test_heap heap;
  sprout_host host = test_host(&heap);
  sprout_str words;
  sprout_arena_init(&arena, &host);
  CHECK(prose_humanised(&arena, (sprout_str){"bone_dry", 8}, &words));
  CHECK_BYTES(words.bytes, words.length, "bone dry");
  CHECK(prose_humanised(&arena, (sprout_str){"a__b", 4}, &words));
  CHECK_BYTES(words.bytes, words.length, "a  b");
  CHECK(prose_humanised(&arena, (sprout_str){"", 0}, &words));
  CHECK_INT(words.length, 0);
  sprout_arena_reset(&arena);
  CHECK_INT(heap.pages, 0);
}

static void the_visitor_behind_a_person_is_found_as_the_turn_leaves_them(void) {
  prose_bench b;
  prose_case c;
  const char *marta;
  const sprout_stored_visitor *visitor;
  prose_bench_open(&b);
  prose_case_open(&b, &c, prose_named(&b, "a nickname changed in the turn reads as changed, to everyone"));
  marta = prose_text(c.golden, "actor");
  visitor = prose_visitor_of(&c.draft, (sprout_str){marta, strlen(marta)});
  CHECK(visitor != NULL);
  if (visitor != NULL) CHECK_BYTES(visitor->nickname.bytes, visitor->nickname.length, "Marta B");
  CHECK(prose_visitor_of(&c.draft, (sprout_str){"bench.yard.press", 16}) == NULL);
  prose_case_close(&c);
  prose_bench_close(&b);
}

int main(void) {
  RUN(names_render_as_the_oracle_did);
  RUN(an_article_and_a_name_come_from_the_grammar_block_the_identifier_or_the_kind);
  RUN(a_thing_with_no_identifier_is_named_for_its_kind);
  RUN(an_object_is_you_to_itself_and_a_visitor_is_their_nickname_to_anyone_else);
  RUN(an_option_is_humanised);
  RUN(the_visitor_behind_a_person_is_found_as_the_turn_leaves_them);
  return REPORT();
}
