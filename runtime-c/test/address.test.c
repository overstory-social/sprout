/*
 * Tests for src/address.c: what an instance is called before its article, an identifier or an option
 * humanised, and the visitor behind a person as the turn leaves them.
 */
#include "prose_fixture.h"

/* What `object` is called in the turn the named case opens. */
static const char *name_of(prose_case *c, const char *object) {
  prose_reading reading = prose_reading_of(c, "");
  sprout_frame frame = prose_frame(&reading, NULL, (sprout_str){"bench.yard.echo", 15}, "bench", NULL);
  const sprout_stored_instance *instance = expr_instance(&frame, (sprout_str){object, strlen(object)});
  sprout_str name;
  if (instance == NULL || sprout_name_of(&frame, instance, &name) != SPROUT_EVAL_OK) return "(refused)";
  return sprout_arena_copy(&c->turn, name.bytes, name.length);
}

static void a_name_is_the_grammar_blocks_the_identifiers_or_the_kinds_with_no_article(void) {
  prose_bench b;
  prose_case c;
  const sprout_json *lines;
  prose_bench_open(&b);
  prose_case_open(&b, &c, prose_named(&b, "articles come from the grammar block, the identifier or the kind, and none writes none"));
  CHECK_STR(name_of(&c, "bench.yard.crate"), "crate");
  CHECK_STR(name_of(&c, "bench.yard.tin_cup"), "dented cup");
  CHECK_STR(name_of(&c, "bench.yard.crate.spare_rib"), "spare rib");
  CHECK_STR(name_of(&c, "bench.yard"), "yard");
  CHECK_STR(name_of(&c, "bench"), "bench");
  prose_case_close(&c);
  prose_case_open(&b, &c, prose_named(&b, "a name the engine gives an object with no identifier is its kind’s, humanised"));
  lines = sprout_json_get(c.golden, "lines");
  CHECK_STR(name_of(&c, prose_text(lines->items[0], "by")), "maze cell");
  prose_case_close(&c);
  prose_bench_close(&b);
}

static void an_option_is_humanised(void) {
  sprout_arena arena;
  test_heap heap;
  sprout_host host = test_host(&heap);
  sprout_str words;
  sprout_arena_init(&arena, &host);
  CHECK(sprout_humanised(&arena, (sprout_str){"bone_dry", 8}, &words));
  CHECK_BYTES(words.bytes, words.length, "bone dry");
  CHECK(sprout_humanised(&arena, (sprout_str){"a__b", 4}, &words));
  CHECK_BYTES(words.bytes, words.length, "a  b");
  CHECK(sprout_humanised(&arena, (sprout_str){"", 0}, &words));
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
  visitor = sprout_visitor_of(&c.draft, (sprout_str){marta, strlen(marta)});
  CHECK(visitor != NULL);
  if (visitor != NULL) CHECK_BYTES(visitor->nickname.bytes, visitor->nickname.length, "Marta B");
  CHECK(sprout_visitor_of(&c.draft, (sprout_str){"bench.yard.press", 16}) == NULL);
  prose_case_close(&c);
  prose_bench_close(&b);
}

int main(void) {
  RUN(a_name_is_the_grammar_blocks_the_identifiers_or_the_kinds_with_no_article);
  RUN(an_option_is_humanised);
  RUN(the_visitor_behind_a_person_is_found_as_the_turn_leaves_them);
  return REPORT();
}
