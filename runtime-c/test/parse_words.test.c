/*
 * Tests for src/parse/words.c: the parser's word lists are the TypeScript parser's, list by list and in order
 * (`corpus/goldens/parser-words.json`, written by runtime/parser/goldens.spec.ts), and a typed word is read
 * against them as that parser reads it.
 */
#include "parse_fixture.h"

static const sprout_json *golden(sprout_arena *arena) {
  size_t length;
  char *text = test_golden("parser-words.json", &length);
  sprout_json *root = NULL;
  sprout_json_error error;
  if (sprout_json_read(arena, text, length, &root, &error) != SPROUT_OK) {
    fprintf(stderr, "parser-words.json: %s\n", error.text);
    exit(2);
  }
  free(text);
  return root;
}

static void the_lists_are_the_typescript_parsers_in_order(void) {
  test_heap heap;
  sprout_host host = test_host(&heap);
  sprout_arena arena;
  const sprout_json *root;
  size_t i, j;
  sprout_arena_init(&arena, &host);
  root = golden(&arena);
  /* Every list the golden holds is one C holds, and none more. */
  CHECK_INT(root->count, parse_list_count + parse_pair_list_count);
  for (i = 0; i < parse_list_count; i++) {
    const sprout_json *list = sprout_json_get(root, parse_lists[i].name);
    CHECK(list != NULL && list->kind == SPROUT_JSON_ARRAY);
    if (list == NULL) continue;
    CHECK_INT(list->count, parse_lists[i].count);
    for (j = 0; j < list->count && j < parse_lists[i].count; j++)
      CHECK_BYTES(list->items[j]->bytes, list->items[j]->length, parse_lists[i].words[j]);
  }
  for (i = 0; i < parse_pair_list_count; i++) {
    const sprout_json *list = sprout_json_get(root, parse_pair_lists[i].name);
    CHECK(list != NULL && list->kind == SPROUT_JSON_ARRAY);
    if (list == NULL) continue;
    CHECK_INT(list->count, parse_pair_lists[i].count);
    for (j = 0; j < list->count && j < parse_pair_lists[i].count; j++) {
      const sprout_json *pair = list->items[j];
      CHECK_INT(pair->count, 2);
      CHECK_BYTES(pair->items[0]->bytes, pair->items[0]->length, parse_pair_lists[i].typed[j]);
      CHECK_BYTES(pair->items[1]->bytes, pair->items[1]->length, parse_pair_lists[i].meant[j]);
    }
  }
  sprout_arena_reset(&arena);
  CHECK_INT(heap.pages, 0);
}

static void a_direction_is_written_out_or_abbreviated_and_in_and_out_have_no_shorter_form(void) {
  CHECK_STR(parse_direction_of(bench_str("north")), "north");
  CHECK_STR(parse_direction_of(bench_str("ne")), "northeast");
  CHECK_STR(parse_direction_of(bench_str("d")), "down");
  CHECK_STR(parse_direction_of(bench_str("in")), "in");
  CHECK(parse_direction_of(bench_str("i")) == NULL);
  CHECK(parse_direction_of(bench_str("North")) == NULL);
  CHECK(parse_direction_of(bench_str("lamp")) == NULL);
}

static void a_pronoun_is_one_a_visitor_types_as_the_pronoun_a_thing_declares(void) {
  CHECK_INT(parse_pronoun_in(bench_str("it")), PARSE_PRONOUN_IT);
  CHECK_INT(parse_pronoun_in(bench_str("them")), PARSE_PRONOUN_THEY);
  CHECK_INT(parse_pronoun_in(bench_str("him")), PARSE_PRONOUN_HE);
  CHECK_INT(parse_pronoun_in(bench_str("her")), PARSE_PRONOUN_SHE);
  CHECK_INT(parse_pronoun_in(bench_str("lamp")), PARSE_PRONOUN_NONE);
  /* `they` is what a thing declares, not a word a visitor types for it. */
  CHECK_INT(parse_pronoun_in(bench_str("they")), PARSE_PRONOUN_NONE);
  CHECK_INT(parse_pronoun_named("she"), PARSE_PRONOUN_SHE);
  CHECK_STR(parse_pronoun_text(PARSE_PRONOUN_THEY), "they");
  CHECK(parse_pronoun_text(PARSE_PRONOUN_NONE) == NULL);
}

static void articles_connectors_and_all_are_the_lists_words(void) {
  CHECK(parse_is_determiner(bench_str("my")));
  CHECK(!parse_is_determiner(bench_str("your")));
  CHECK(parse_is_connector(bench_str(",")));
  CHECK(!parse_is_connector(bench_str("then")));
  CHECK(parse_is_all(bench_str("everything")));
  CHECK(!parse_is_all(bench_str("each")));
}

int main(void) {
  RUN(the_lists_are_the_typescript_parsers_in_order);
  RUN(a_direction_is_written_out_or_abbreviated_and_in_and_out_have_no_shorter_form);
  RUN(a_pronoun_is_one_a_visitor_types_as_the_pronoun_a_thing_declares);
  RUN(articles_connectors_and_all_are_the_lists_words);
  return REPORT();
}
