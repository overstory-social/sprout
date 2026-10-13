/*
 * Tests for src/parse/match.c: match.spec.ts's cases, where a phrase's slots fall in a typed line. The phrase's
 * words must be the line's words where they stand, each slot takes at least one word, and where words do not pin
 * a slot, an earlier slot's longer run is tried first.
 */
#include "check.h"
#include "parse/parse.h"
#include "typed.h"

/* What a walk found: each placement as `role:words` per slot, `,` between slots and `|` between placements. */
typedef struct found {
  const sprout_str *words;
  char text[512];
  size_t used;
  size_t count;
} found;

static sprout_eval_status noted(void *context, const parse_span *spans, size_t count) {
  found *f = (found *)context;
  size_t i, w;
  if (f->count > 0) f->used += (size_t)snprintf(f->text + f->used, sizeof f->text - f->used, "|");
  for (i = 0; i < count; i++) {
    f->used += (size_t)snprintf(f->text + f->used, sizeof f->text - f->used, "%s%zu:", i == 0 ? "" : ",", spans[i].role);
    for (w = spans[i].start; w < spans[i].end; w++)
      f->used += (size_t)snprintf(f->text + f->used, sizeof f->text - f->used, "%s%.*s", w == spans[i].start ? "" : " ",
                                  (int)f->words[w].length, f->words[w].bytes);
  }
  f->count++;
  return SPROUT_EVAL_OK;
}

/* `phrase` as parts, a word run or `[n]`, a slot for role n, each separated by spaces. */
static size_t parts_of(sprout_arena *arena, const char *phrase, sprout_typed_part *parts) {
  size_t count = 0, at = 0, length = strlen(phrase);
  while (at < length) {
    size_t end = at;
    while (end < length && phrase[end] != '[') end++;
    if (end > at) {
      sprout_str *words;
      size_t n, i;
      CHECK_INT(typed_words(arena, (sprout_str){phrase + at, end - at}, &words, &n), SPROUT_OK);
      if (n > 0) {
        const char **texts = (const char **)sprout_arena_take(arena, n * sizeof *texts);
        for (i = 0; i < n; i++) texts[i] = words[i].bytes;
        parts[count].is_slot = false;
        parts[count].word_count = n;
        parts[count++].words = texts;
      }
    }
    if (end < length) {
      parts[count].is_slot = true;
      parts[count].word_count = 0;
      parts[count++].role = (size_t)(phrase[end + 1] - '0');
      end += 3;
    }
    at = end;
  }
  return count;
}

/* Every placement of `phrase` over `line`, as `noted` writes them; "" where there is none, and "-" for one with no slot. */
static void placed(const char *phrase, const char *line, const char *expected) {
  test_heap heap;
  sprout_host host = test_host(&heap);
  sprout_arena arena;
  sprout_typed_part parts[8];
  sprout_str *words;
  size_t part_count, word_count;
  found f;
  sprout_arena_init(&arena, &host);
  part_count = parts_of(&arena, phrase, parts);
  CHECK_INT(typed_words(&arena, (sprout_str){line, strlen(line)}, &words, &word_count), SPROUT_OK);
  memset(&f, 0, sizeof f);
  f.words = words;
  CHECK_INT(parse_slot_spans(&arena, parts, part_count, words, word_count, noted, &f), SPROUT_EVAL_OK);
  if (f.count == 1 && f.used == 0) snprintf(f.text, sizeof f.text, "-");
  if (strcmp(f.text, expected) != 0) fprintf(stderr, "`%s` over `%s`: %s, expected %s\n", phrase, line, f.text, expected);
  CHECK_STR(f.text, expected);
  sprout_arena_reset(&arena);
  CHECK_INT(heap.pages, 0);
}

static void between_the_phrases_words_which_must_stand_where_they_are_written(void) {
  placed("unlock [0] with [1]", "unlock oak door with brass key", "0:oak door,1:brass key");
  placed("use [1] on [0]", "use key on door", "1:key,0:door");
  placed("unlock [0] with [1]", "open door with key", "");
  placed("look", "look", "-");
  placed("look", "look around", "");
}

static void each_taking_at_least_one_word(void) {
  placed("take [0]", "take", "");
  placed("unlock [0] with [1]", "unlock with key", "");
}

static void by_position_where_the_words_do_not_pin_them_the_longer_run_tried_first(void) {
  placed("ask [0] [1]", "ask old guard toll", "0:old guard,1:toll|0:old,1:guard toll");
  placed("put [0] in [1]", "put coin in in box", "0:coin in,1:box|0:coin,1:in box");
}

static void with_no_placement_at_all_for_a_line_the_phrase_cannot_cover(void) {
  placed("[0]", "", "");
  placed("go [0]", "go", "");
}

/* A walk stops at the first status that is not OK, and gives it back. */
static sprout_eval_status stop_at_first(void *context, const parse_span *spans, size_t count) {
  (void)spans, (void)count;
  (*(size_t *)context)++;
  return SPROUT_EVAL_FAULT;
}

static void a_placement_that_faults_ends_the_walk_with_its_fault(void) {
  test_heap heap;
  sprout_host host = test_host(&heap);
  sprout_arena arena;
  sprout_typed_part parts[8];
  sprout_str *words;
  size_t part_count, word_count, calls = 0;
  sprout_arena_init(&arena, &host);
  part_count = parts_of(&arena, "ask [0] [1]", parts);
  CHECK_INT(typed_words(&arena, (sprout_str){"ask old guard toll", 18}, &words, &word_count), SPROUT_OK);
  CHECK_INT(parse_slot_spans(&arena, parts, part_count, words, word_count, stop_at_first, &calls), SPROUT_EVAL_FAULT);
  CHECK_INT(calls, 1);
  sprout_arena_reset(&arena);
}

int main(void) {
  RUN(between_the_phrases_words_which_must_stand_where_they_are_written);
  RUN(each_taking_at_least_one_word);
  RUN(by_position_where_the_words_do_not_pin_them_the_longer_run_tried_first);
  RUN(with_no_placement_at_all_for_a_line_the_phrase_cannot_cover);
  RUN(a_placement_that_faults_ends_the_walk_with_its_fault);
  return REPORT();
}
