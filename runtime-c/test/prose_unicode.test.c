/*
 * Tests for src/prose/unicode.c, the two rules reflow takes from the JavaScript runtime as
 * tables: which code points are letters or numbers, and what a code point of the Basic
 * Multilingual Plane becomes in upper case. Every line the golden holds is capitalised as
 * JavaScript capitalised it: the edge of every run of letters and numbers, and every letter
 * whose upper case is something else.
 */
#include "prose/unicode.h"

#include "prose_fixture.h"

static void letters_and_numbers_are_told_from_the_rest(void) {
  CHECK(prose_unicode_letter_or_number('a'));
  CHECK(prose_unicode_letter_or_number('Z'));
  CHECK(prose_unicode_letter_or_number('0'));
  CHECK(prose_unicode_letter_or_number(0xB2));    /* superscript two: a number */
  CHECK(prose_unicode_letter_or_number(0x4E2D));  /* a Han character */
  CHECK(prose_unicode_letter_or_number(0x10428)); /* Deseret small letter */
  CHECK(!prose_unicode_letter_or_number(' '));
  CHECK(!prose_unicode_letter_or_number('('));
  CHECK(!prose_unicode_letter_or_number(0x201C)); /* a quotation mark */
  CHECK(!prose_unicode_letter_or_number(0x1F600)); /* an emoji */
  CHECK(!prose_unicode_letter_or_number(0x0301)); /* a combining mark */
  CHECK(!prose_unicode_letter_or_number(0x10FFFF));
}

static void a_letter_becomes_its_upper_case_and_some_become_several(void) {
  unsigned long out[3];
  CHECK_INT(prose_unicode_upper('a', out), 1);
  CHECK_INT(out[0], 'A');
  CHECK_INT(prose_unicode_upper('A', out), 1);
  CHECK_INT(out[0], 'A');
  CHECK_INT(prose_unicode_upper('3', out), 1);
  CHECK_INT(out[0], '3');
  CHECK_INT(prose_unicode_upper(0xDF, out), 2); /* sharp s is SS */
  CHECK_INT(out[0], 'S');
  CHECK_INT(out[1], 'S');
  CHECK_INT(prose_unicode_upper(0x390, out), 3); /* Greek iota with dialytika and tonos */
  CHECK_INT(out[0], 0x399);
  CHECK_INT(out[1], 0x308);
  CHECK_INT(out[2], 0x301);
  CHECK_INT(prose_unicode_upper(0x1C6, out), 1); /* a digraph's small form is the capital digraph */
  CHECK_INT(out[0], 0x1C4);
  CHECK_INT(prose_unicode_upper(0x131, out), 1); /* dotless i */
  CHECK_INT(out[0], 'I');
}

static void a_letter_past_the_basic_multilingual_plane_is_its_own_upper_case(void) {
  unsigned long out[3];
  CHECK_INT(prose_unicode_upper(0x10428, out), 1);
  CHECK_INT(out[0], 0x10428);
}

static void every_line_the_golden_holds_is_capitalised_as_javascript_capitalised_it(void) {
  prose_bench b;
  sprout_arena arena;
  const sprout_json *held;
  size_t i;
  prose_bench_open(&b);
  held = sprout_json_get(b.golden, "capitalise");
  CHECK(held->count > 1000);
  sprout_arena_init(&arena, &b.host);
  for (i = 0; i < held->count; i++) {
    const sprout_json *pair = held->items[i];
    sprout_str out;
    CHECK(prose_capitalise(&arena, (sprout_str){pair->items[0]->bytes, pair->items[0]->length}, &out));
    CHECK_BYTES(out.bytes, out.length, pair->items[1]->bytes);
    if (out.length != pair->items[1]->length || memcmp(out.bytes, pair->items[1]->bytes, out.length) != 0)
      fprintf(stderr, "  capitalising entry %zu\n", i);
    sprout_arena_reset(&arena);
  }
  prose_bench_close(&b);
  CHECK_INT(b.heap.pages, 0);
}

int main(void) {
  RUN(letters_and_numbers_are_told_from_the_rest);
  RUN(a_letter_becomes_its_upper_case_and_some_become_several);
  RUN(a_letter_past_the_basic_multilingual_plane_is_its_own_upper_case);
  RUN(every_line_the_golden_holds_is_capitalised_as_javascript_capitalised_it);
  return REPORT();
}
