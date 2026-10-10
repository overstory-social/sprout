/*
 * Tests for src/prose/reflow.c: rendered words laid out as reflow.ts lays them out. White space
 * is JavaScript's, a blank line is a paragraph and a paragraph with nothing in it is none, `\n`
 * is kept, the first letter of every line is capitalised past quotation marks and not past a
 * bracket, and a passage put into a slot loses the padding in its braces.
 */
#include "prose_fixture.h"

static void layout_cases_render_as_the_oracle_did(void) {
  prose_bench b;
  prose_bench_open(&b);
  CHECK(prose_replay_area(&b, "layout") >= 7);
  prose_bench_close(&b);
  CHECK_INT(b.heap.pages, 0);
}

typedef struct laid {
  test_heap heap;
  sprout_host host;
  sprout_arena arena;
  prose_pieces pieces;
} laid;

static void laid_open(laid *l) {
  memset(l, 0, sizeof *l);
  l->host = test_host(&l->heap);
  sprout_arena_init(&l->arena, &l->host);
}

static void words(laid *l, const char *text) { CHECK(prose_put(&l->arena, &l->pieces, PROSE_WORDS, text, strlen(text))); }
static void paragraph(laid *l) { CHECK(prose_put(&l->arena, &l->pieces, PROSE_PARAGRAPH, NULL, 0)); }
static void line(laid *l) { CHECK(prose_put(&l->arena, &l->pieces, PROSE_LINE, NULL, 0)); }

/* The paragraphs of `pieces` joined by a bar, for a short expectation. */
static const char *flowed(laid *l, const prose_pieces *pieces) {
  prose_paragraphs paragraphs;
  size_t i, at = 0;
  char *joined;
  CHECK(prose_reflow(&l->arena, pieces, &paragraphs));
  joined = (char *)sprout_arena_take(&l->arena, 512);
  for (i = 0; i < paragraphs.count; i++) {
    if (i > 0) joined[at++] = '|';
    memcpy(joined + at, paragraphs.items[i].bytes, paragraphs.items[i].length);
    at += paragraphs.items[i].length;
  }
  joined[at] = '\0';
  return joined;
}

static void every_run_of_space_is_one_space_and_a_paragraph_has_none_at_its_ends(void) {
  laid l;
  laid_open(&l);
  words(&l, "  hello \n\t  there  ");
  words(&l, "  you ");
  CHECK_STR(flowed(&l, &l.pieces), "Hello there you");
  sprout_arena_reset(&l.arena);
  CHECK_INT(l.heap.pages, 0);
}

static void a_blank_line_is_a_paragraph_and_a_paragraph_with_nothing_in_it_is_none(void) {
  laid l;
  laid_open(&l);
  paragraph(&l);
  words(&l, "one");
  paragraph(&l);
  words(&l, "   ");
  paragraph(&l);
  paragraph(&l);
  words(&l, "two");
  paragraph(&l);
  CHECK_STR(flowed(&l, &l.pieces), "One|Two");
  sprout_arena_reset(&l.arena);
}

static void a_line_break_is_kept_and_every_line_is_capitalised(void) {
  laid l;
  laid_open(&l);
  words(&l, "first");
  line(&l);
  words(&l, "second");
  line(&l);
  line(&l);
  words(&l, "fourth");
  CHECK_STR(flowed(&l, &l.pieces), "First\nSecond\n\nFourth");
  sprout_arena_reset(&l.arena);
}

static void a_paragraph_ending_in_a_line_break_is_still_nul_terminated(void) {
  laid l;
  prose_paragraphs out;
  laid_open(&l);
  words(&l, "hello");
  line(&l);
  CHECK(prose_reflow(&l.arena, &l.pieces, &out));
  CHECK_INT(out.count, 1);
  CHECK_BYTES(out.items[0].bytes, out.items[0].length, "Hello");
  CHECK_INT(out.items[0].bytes[out.items[0].length], 0);
  sprout_arena_reset(&l.arena);
}

static void a_line_break_at_a_paragraphs_ends_is_trimmed(void) {
  laid l;
  laid_open(&l);
  line(&l);
  words(&l, "inside");
  line(&l);
  CHECK_STR(flowed(&l, &l.pieces), "Inside");
  sprout_arena_reset(&l.arena);
}

static void white_space_is_what_javascript_calls_it(void) {
  laid l;
  laid_open(&l);
  words(&l, "a\xC2\xA0\xC2\xA0" "b\xE3\x80\x80" "c\xEF\xBB\xBF" "d\xE2\x80\xA8" "e\xE2\x80\x8B" "f");
  /* U+200B is not white space to JavaScript. */
  CHECK_STR(flowed(&l, &l.pieces), "A b c d e\xE2\x80\x8B" "f");
  sprout_arena_reset(&l.arena);
}

static void a_passage_in_a_slot_loses_its_padding_and_keeps_breaks_only_where_it_has_words(void) {
  laid l;
  prose_pieces slotted;
  laid_open(&l);
  words(&l, "  ");
  paragraph(&l);
  words(&l, "  hello ");
  words(&l, " world  ");
  line(&l);
  line(&l);
  CHECK(prose_slotted(&l.arena, &l.pieces, &slotted));
  /* A paragraph before, the words with their ends trimmed, and a paragraph after (two line breaks). */
  CHECK_INT(slotted.count, 4);
  CHECK(slotted.items[0].kind == PROSE_PARAGRAPH);
  CHECK_BYTES(slotted.items[1].bytes, slotted.items[1].length, "hello ");
  CHECK_BYTES(slotted.items[2].bytes, slotted.items[2].length, " world");
  CHECK(slotted.items[3].kind == PROSE_PARAGRAPH);
  sprout_arena_reset(&l.arena);
}

static void a_passage_that_renders_no_words_leaves_nothing_in_the_slot(void) {
  laid l;
  prose_pieces slotted;
  laid_open(&l);
  words(&l, "   ");
  paragraph(&l);
  line(&l);
  CHECK(prose_slotted(&l.arena, &l.pieces, &slotted));
  CHECK_INT(slotted.count, 0);
  sprout_arena_reset(&l.arena);
}

static void one_line_break_at_an_end_is_a_line_break_and_none_is_none(void) {
  laid l;
  prose_pieces slotted;
  laid_open(&l);
  words(&l, "on");
  line(&l);
  CHECK(prose_slotted(&l.arena, &l.pieces, &slotted));
  CHECK_INT(slotted.count, 2);
  CHECK(slotted.items[1].kind == PROSE_LINE);
  sprout_arena_reset(&l.arena);
}

/* `line` capitalised. */
static const char *capital(laid *l, const char *line_text) {
  sprout_str out;
  CHECK(prose_capitalise(&l->arena, (sprout_str){line_text, strlen(line_text)}, &out));
  return sprout_arena_copy(&l->arena, out.bytes, out.length);
}

static void the_first_letter_is_capitalised_past_a_quotation_mark_and_not_past_a_bracket(void) {
  laid l;
  laid_open(&l);
  CHECK_STR(capital(&l, "hello"), "Hello");
  CHECK_STR(capital(&l, "\"hello\""), "\"Hello\"");
  CHECK_STR(capital(&l, "\xE2\x80\x9Chello"), "\xE2\x80\x9CHello");
  CHECK_STR(capital(&l, "(the wooden rib)"), "(the wooden rib)");
  CHECK_STR(capital(&l, "\xE2\x80\x94(x"), "\xE2\x80\x94(x");
  CHECK_STR(capital(&l, "[x"), "[x");
  CHECK_STR(capital(&l, "{x"), "{x");
  CHECK_STR(capital(&l, "3 pots"), "3 pots");
  CHECK_STR(capital(&l, "..."), "...");
  CHECK_STR(capital(&l, ""), "");
  sprout_arena_reset(&l.arena);
  CHECK_INT(l.heap.pages, 0);
}

int main(void) {
  RUN(layout_cases_render_as_the_oracle_did);
  RUN(every_run_of_space_is_one_space_and_a_paragraph_has_none_at_its_ends);
  RUN(a_blank_line_is_a_paragraph_and_a_paragraph_with_nothing_in_it_is_none);
  RUN(a_line_break_is_kept_and_every_line_is_capitalised);
  RUN(a_paragraph_ending_in_a_line_break_is_still_nul_terminated);
  RUN(a_line_break_at_a_paragraphs_ends_is_trimmed);
  RUN(white_space_is_what_javascript_calls_it);
  RUN(a_passage_in_a_slot_loses_its_padding_and_keeps_breaks_only_where_it_has_words);
  RUN(a_passage_that_renders_no_words_leaves_nothing_in_the_slot);
  RUN(one_line_break_at_an_end_is_a_line_break_and_none_is_none);
  RUN(the_first_letter_is_capitalised_past_a_quotation_mark_and_not_past_a_bracket);
  return REPORT();
}
