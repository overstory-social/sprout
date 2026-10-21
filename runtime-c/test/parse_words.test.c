/*
 * Tests for src/parse/words.c: the parser's word lists are the golden's, list by list and in order
 * (`corpus/goldens/parser-words.json`, a hand-kept golden), and a typed word is read
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

/* `words` as typed words, NUL-terminated each, for the list readers that take an array. */
static size_t typed(const char *line, sprout_str *out) {
  static char text[256];
  size_t count = 0;
  char *word;
  snprintf(text, sizeof text, "%s", line);
  for (word = strtok(text, " "); word != NULL; word = strtok(NULL, " ")) out[count++] = bench_str(word);
  return count;
}

static void a_holder_word_is_one_word_or_out_of_and_is_counted_where_it_stands(void) {
  sprout_str words[12];
  size_t count = typed("all out of the sack from off in on", words);
  CHECK_INT(parse_holder_word_at(words, count, 0), 0);
  CHECK_INT(parse_holder_word_at(words, count, 1), 2);
  /* `of` alone, and `out` with no `of` after it, are none. */
  CHECK_INT(parse_holder_word_at(words, count, 2), 0);
  CHECK_INT(parse_holder_word_at(words, 2, 1), 0);
  CHECK_INT(parse_holder_word_at(words, count, 5), 1);
  CHECK_INT(parse_holder_word_at(words, count, 6), 1);
  CHECK_INT(parse_holder_word_at(words, count, 7), 1);
  CHECK_INT(parse_holder_word_at(words, count, 8), 1);
  CHECK_INT(parse_holder_word_at(words, count, 3), 0);
}

static void a_plural_is_read_less_s_less_es_and_with_ies_as_y(void) {
  test_heap heap;
  sprout_host host = test_host(&heap);
  sprout_arena arena;
  sprout_str forms[3];
  size_t count;
  sprout_arena_init(&arena, &host);
  CHECK(parse_singulars(&arena, bench_str("berries"), forms, &count));
  CHECK_INT(count, 3);
  CHECK_STR(forms[0].bytes, "berrie");
  CHECK_STR(forms[1].bytes, "berri");
  CHECK_STR(forms[2].bytes, "berry");
  CHECK_INT(forms[2].length, 5);
  CHECK(parse_singulars(&arena, bench_str("boxes"), forms, &count));
  CHECK_INT(count, 2);
  CHECK_STR(forms[1].bytes, "box");
  CHECK(parse_singulars(&arena, bench_str("cakes"), forms, &count));
  CHECK_STR(forms[0].bytes, "cake");
  /* A word that does not end in `s` is no plural, and `s` alone is none. */
  CHECK(parse_singulars(&arena, bench_str("cake"), forms, &count));
  CHECK_INT(count, 0);
  CHECK(parse_singulars(&arena, bench_str("s"), forms, &count));
  CHECK_INT(count, 0);
  sprout_arena_reset(&arena);
  CHECK_INT(heap.pages, 0);
}

static void articles_connectors_and_all_are_the_lists_words(void) {
  CHECK(parse_is_determiner(bench_str("my")));
  CHECK(!parse_is_determiner(bench_str("your")));
  CHECK(parse_is_connector(bench_str(",")));
  CHECK(!parse_is_connector(bench_str("then")));
  CHECK(parse_is_all(bench_str("everything")));
  CHECK(!parse_is_all(bench_str("each")));
}

static void a_noun_may_hold_the_parsers_own_words_but_not_again_or_then(void) {
  static const char *const own[] = {"a",  "an",  "the", "my", "this", "that", "and", ",",          "in",    "on",
                                    "is", "one", "it",  "them", "him", "her",  "all", "everything", "except"};
  size_t i;
  for (i = 0; i < sizeof own / sizeof *own; i++) CHECK(parse_is_noun_word(bench_str(own[i])));
  CHECK(!parse_is_noun_word(bench_str("again")));
  CHECK(!parse_is_noun_word(bench_str("then")));
  CHECK(!parse_is_noun_word(bench_str("they")));
  CHECK(!parse_is_noun_word(bench_str("north")));
}

int main(void) {
  RUN(the_lists_are_the_typescript_parsers_in_order);
  RUN(a_direction_is_written_out_or_abbreviated_and_in_and_out_have_no_shorter_form);
  RUN(a_pronoun_is_one_a_visitor_types_as_the_pronoun_a_thing_declares);
  RUN(articles_connectors_and_all_are_the_lists_words);
  RUN(a_holder_word_is_one_word_or_out_of_and_is_counted_where_it_stands);
  RUN(a_plural_is_read_less_s_less_es_and_with_ies_as_y);
  RUN(a_noun_may_hold_the_parsers_own_words_but_not_again_or_then);
  return REPORT();
}
