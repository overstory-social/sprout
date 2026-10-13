/*
 * Where a phrase's slots fall in a typed line (see parse.h): the phrase's words must be the line's words where
 * they stand, and each slot takes the run of words between them; where words do not pin a slot, position does,
 * and a slot takes its longest run first. The walk recurses once a part, and a phrase's parts are bounded by the
 * bundle's phrase caps.
 */
#include <string.h>

#include "parse.h"

typedef struct walk {
  const sprout_typed_part *parts;
  size_t part_count;
  const sprout_str *words;
  size_t word_count;
  parse_span *spans;
  parse_placed each;
  void *context;
} walk;

/* Whether `run` stands in `words` from `at`. */
static bool stands_at(const walk *w, size_t at, const sprout_typed_part *run) {
  size_t i;
  if (at + run->word_count > w->word_count) return false;
  for (i = 0; i < run->word_count; i++) {
    size_t n = strlen(run->words[i]);
    if (w->words[at + i].length != n || memcmp(w->words[at + i].bytes, run->words[i], n) != 0) return false;
  }
  return true;
}

static sprout_eval_status from(const walk *w, size_t part, size_t at, size_t placed) {
  const sprout_typed_part *here;
  size_t after = 0, end, i;
  if (part == w->part_count) return at == w->word_count ? w->each(w->context, w->spans, placed) : SPROUT_EVAL_OK;
  here = &w->parts[part];
  if (!here->is_slot) return stands_at(w, at, here) ? from(w, part + 1, at + here->word_count, placed) : SPROUT_EVAL_OK;
  /* What the parts after this one need at least: a word each for a slot, and their own words for a run of them. */
  for (i = part + 1; i < w->part_count; i++) after += w->parts[i].is_slot ? 1 : w->parts[i].word_count;
  if (after > w->word_count) return SPROUT_EVAL_OK;
  for (end = w->word_count - after; end > at; end--) {
    sprout_eval_status status;
    w->spans[placed].role = here->role;
    w->spans[placed].start = at;
    w->spans[placed].end = end;
    status = from(w, part + 1, end, placed + 1);
    if (status != SPROUT_EVAL_OK) return status;
  }
  return SPROUT_EVAL_OK;
}

sprout_eval_status parse_slot_spans(sprout_arena *scratch, const sprout_typed_part *parts, size_t part_count,
                                    const sprout_str *words, size_t word_count, parse_placed each, void *context) {
  walk w;
  w.parts = parts;
  w.part_count = part_count;
  w.words = words;
  w.word_count = word_count;
  w.each = each;
  w.context = context;
  w.spans = (parse_span *)sprout_arena_take(scratch, (part_count + 1) * sizeof *w.spans);
  if (w.spans == NULL) return SPROUT_EVAL_NO_MEMORY;
  return from(&w, 0, 0, 0);
}
