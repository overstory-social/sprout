/*
 * Tests for src/typed.c: a typed line's words are the ones the TypeScript parser's `typedWords` makes, lower case
 * as JavaScript's `toLowerCase` makes it, split on the white space of JavaScript's `\s`, each comma a word of its
 * own. Each case's words were read off `typedWords` itself.
 */
#include "check.h"
#include "typed.h"

/* Checks that `text` reads as the words in `expected`, `|` between them. */
static void reads_as(sprout_arena *arena, const char *text, const char *expected) {
  sprout_str *words;
  size_t count, i;
  char joined[256];
  size_t used = 0;
  CHECK_INT(typed_words(arena, (sprout_str){text, strlen(text)}, &words, &count), SPROUT_OK);
  joined[0] = '\0';
  for (i = 0; i < count; i++) {
    CHECK_INT(words[i].bytes[words[i].length], '\0');
    used += (size_t)snprintf(joined + used, sizeof joined - used, "%s%.*s", i == 0 ? "" : "|", (int)words[i].length,
                             words[i].bytes);
  }
  CHECK_STR(joined, expected);
}

static void a_line_is_lower_case_words_and_each_comma_a_word_of_its_own(void) {
  test_heap heap;
  sprout_host host = test_host(&heap);
  sprout_arena arena;
  sprout_arena_init(&arena, &host);
  reads_as(&arena, "A, b", "a|,|b");
  reads_as(&arena, "a,,b", "a|,|,|b");
  reads_as(&arena, ",", ",");
  reads_as(&arena, "", "");
  reads_as(&arena, "  ", "");
  sprout_arena_reset(&arena);
}

static void white_space_is_what_javascript_reads_as_white_space(void) {
  test_heap heap;
  sprout_host host = test_host(&heap);
  sprout_arena arena;
  sprout_arena_init(&arena, &host);
  /* A tab, two spaces, a no-break space and a byte order mark. */
  reads_as(&arena, " \t Take  the\xC2\xA0Key,\xEF\xBB\xBF", "take|the|key|,");
  sprout_arena_reset(&arena);
}

static void letters_fold_as_javascript_folds_them(void) {
  test_heap heap;
  sprout_host host = test_host(&heap);
  sprout_arena arena;
  sprout_arena_init(&arena, &host);
  /* A capital sigma that ends a word after a letter is a final sigma; anywhere else it is not. */
  reads_as(&arena, "\xCE\x91\xCE\xA3 \xCE\xA3\xCE\x91\xCE\xA3", "\xCE\xB1\xCF\x82|\xCF\x83\xCE\xB1\xCF\x82");
  /* A comma after it is no cased letter, so the sigma before it is final. */
  reads_as(&arena, "\xCE\xA3\xCE\x91\xCE\xA3,x", "\xCF\x83\xCE\xB1\xCF\x82|,|x");
  /* A capital I with a dot above lower-cases to two code points. */
  reads_as(&arena, "\xC4\xB0", "i\xCC\x87");
  sprout_arena_reset(&arena);
}

static void a_whole_text_lowers_as_javascript_lowers_it_spaces_and_commas_kept(void) {
  static const struct {
    const char *text, *lower;
  } cases[] = {{"Oskar", "oskar"},
               {"The  Salt, and Pepper", "the  salt, and pepper"},
               /* A capital sigma at a word's end is final, inside one it is not. */
               {"\xce\x9f\xce\x94\xce\x9f\xce\xa3 \xce\xa3\xce\x91", "\xce\xbf\xce\xb4\xce\xbf\xcf\x82 \xcf\x83\xce\xb1"},
               {"", ""}};
  test_heap heap;
  sprout_host host = test_host(&heap);
  sprout_arena arena;
  size_t i;
  sprout_arena_init(&arena, &host);
  for (i = 0; i < sizeof cases / sizeof cases[0]; i++) {
    sprout_str lower;
    CHECK_INT(typed_lower(&arena, (sprout_str){cases[i].text, strlen(cases[i].text)}, &lower), SPROUT_OK);
    CHECK_BYTES(lower.bytes, lower.length, cases[i].lower);
    CHECK_INT(lower.bytes[lower.length], '\0');
  }
  sprout_arena_reset(&arena);
  CHECK_INT(heap.pages, 0);
}

int main(void) {
  RUN(a_line_is_lower_case_words_and_each_comma_a_word_of_its_own);
  RUN(white_space_is_what_javascript_reads_as_white_space);
  RUN(letters_fold_as_javascript_folds_them);
  RUN(a_whole_text_lowers_as_javascript_lowers_it_spaces_and_commas_kept);
  return REPORT();
}
