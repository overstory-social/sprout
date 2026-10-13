/*
 * A line some phrase read in part (the spec's Parsing > When nothing matches; Verbs > Carried roles): its verb or
 * intent understood, and a slot's words naming something in range the role cannot take, or, in a carried role, only
 * something the actor does not carry. Each way the slots fill so is a partial reading, a step, written as a visitor
 * would type it: a thing by its name after `the`, a set's things joined by `and`, an exit by its direction or label,
 * a value as typed. The one answered matched most of the line's words, then filled most roles, a tie drawn from the
 * turn's stream. Only the partials tied for best so far are kept, in the order made, which is what a stable sort of
 * every one of them leaves at its head.
 */
#include <string.h>

#include "../expr/expr.h"
#include "../typed.h"
#include "parse.h"

int parse_compare_partial(const parse_partial *a, const parse_partial *b) {
  if (a->literal != b->literal) return a->literal > b->literal ? -1 : 1;
  if (a->bound != b->bound) return a->bound > b->bound ? -1 : 1;
  return 0;
}

/* How many options a slot gives a partial reading: one for a value's words, each thing, set or way otherwise. */
static size_t options_of(const parse_filled *one) {
  if (one->fills == PARSE_FILLS_WORDS) return 1;
  if (one->fills == PARSE_FILLS_OPTIONS && one->way != NULL) return 1;
  if (one->fills == PARSE_FILLS_OPTIONS && one->set_count > 0) return one->set_count;
  return one->thing_count;
}

/* How many of the line's words the option `at` of a slot matched literally; a value's words all do. */
static size_t literal_of(const parse_filled *one, const parse_span *span, size_t at) {
  if (one->fills == PARSE_FILLS_WORDS) return span->end - span->start;
  if (one->fills == PARSE_FILLS_OPTIONS && one->way != NULL) return one->literal;
  if (one->fills == PARSE_FILLS_OPTIONS && one->set_count > 0) return one->sets[at].literal;
  return one->things[at].literal;
}

/* A growing run of bytes in an arena. */
typedef struct written {
  sprout_arena *arena;
  char *bytes;
  size_t length, capacity;
} written;

static bool put(written *w, const char *bytes, size_t length) {
  if (w->length + length + 1 > w->capacity) {
    size_t capacity = (w->length + length + 1) * 2;
    char *grown = (char *)sprout_arena_take_aligned(w->arena, capacity, 1);
    if (grown == NULL) return false;
    if (w->length > 0) memcpy(grown, w->bytes, w->length);
    w->bytes = grown;
    w->capacity = capacity;
  }
  memcpy(w->bytes + w->length, bytes, length);
  w->length += length;
  w->bytes[w->length] = '\0';
  return true;
}

/* A thing as a visitor names it in a line: `the` and its name in lower case, or its name alone where it takes no article. */
static bool definite(written *w, const parse_address *address) {
  sprout_str lower;
  if (strcmp(address->article, "none") == 0) return put(w, address->name.bytes, address->name.length);
  if (typed_lower(w->arena, address->name, &lower) != SPROUT_OK) return false;
  return put(w, "the ", 4) && put(w, lower.bytes, lower.length);
}

/* The words `words` joined by single spaces. */
static bool joined(written *w, const char *const *words, size_t count) {
  size_t i;
  for (i = 0; i < count; i++)
    if ((i > 0 && !put(w, " ", 1)) || !put(w, words[i], strlen(words[i]))) return false;
  return true;
}

/* What fills a slot as the option `at` of it, as a visitor types it. */
static bool slot_words(written *w, parse_words line, const parse_span *span, const parse_filled *one, size_t at) {
  size_t i;
  if (one->fills == PARSE_FILLS_WORDS) {
    for (i = span->start; i < span->end; i++)
      if ((i > span->start && !put(w, " ", 1)) || !put(w, line.words[i].bytes, line.words[i].length)) return false;
    return true;
  }
  if (one->fills == PARSE_FILLS_OPTIONS && one->way != NULL) {
    const char *way = one->way->direction != NULL ? one->way->direction : one->way->label;
    return put(w, way, strlen(way));
  }
  if (one->fills == PARSE_FILLS_OPTIONS && one->set_count > 0) {
    const parse_named_set *set = &one->sets[at];
    for (i = 0; i < set->count; i++)
      if ((i > 0 && !put(w, " and ", 5)) || !definite(w, &set->things[i]->address)) return false;
    return true;
  }
  return definite(w, &one->things[at].candidate->address);
}

/* The partial reading the options `at` make, written in the phrase's order, its uncarried thing the first slot's. */
static sprout_eval_status write_partial(const sprout_frame *frame, const parse_placement *placement,
                                        const sprout_typed_part *parts, size_t part_count, const size_t *at, bool unfit,
                                        sprout_arena *keep, parse_partial *out) {
  written w;
  size_t p, i;
  memset(&w, 0, sizeof w);
  w.arena = keep;
  for (p = 0; p < part_count; p++) {
    if (p > 0 && !put(&w, " ", 1)) return SPROUT_EVAL_NO_MEMORY;
    if (!parts[p].is_slot) {
      if (!joined(&w, parts[p].words, parts[p].word_count)) return SPROUT_EVAL_NO_MEMORY;
      continue;
    }
    for (i = 0; i < placement->count && placement->spans[i].role != parts[p].role; i++) continue;
    if (i == placement->count) return expr_engine(frame, "a phrase's slot has no words in a placement of it.");
    if (!slot_words(&w, placement->words, &placement->spans[i], placement->fills[i], at[i])) return SPROUT_EVAL_NO_MEMORY;
  }
  out->words.bytes = w.bytes == NULL ? "" : w.bytes;
  out->words.length = w.length;
  out->uncarried.bytes = NULL;
  out->uncarried.length = 0;
  for (i = 0; i < placement->count && !unfit; i++) {
    sprout_str id;
    if (placement->fills[i]->fills != PARSE_FILLS_OUTWARD) continue;
    id = placement->fills[i]->things[at[i]].candidate->instance->id;
    out->uncarried.bytes = sprout_arena_copy(keep, id.bytes, id.length);
    out->uncarried.length = id.length;
    return out->uncarried.bytes == NULL ? SPROUT_EVAL_NO_MEMORY : SPROUT_EVAL_OK;
  }
  return SPROUT_EVAL_OK;
}

sprout_eval_status parse_partials_of(const sprout_frame *frame, const parse_placement *placement, sprout_arena *keep,
                                     parse_partials *partials) {
  const sprout_typed_part *parts = placement->phrase != NULL ? placement->phrase->parts : placement->intent->parts;
  size_t part_count = placement->phrase != NULL ? placement->phrase->part_count : placement->intent->part_count;
  size_t i, phrase_literal = 0, *at;
  bool unfit = false, outward = false;
  for (i = 0; i < placement->count; i++) {
    unfit = unfit || placement->fills[i]->fills == PARSE_FILLS_UNFIT;
    outward = outward || placement->fills[i]->fills == PARSE_FILLS_OUTWARD;
  }
  if (!unfit && !outward) return SPROUT_EVAL_OK;
  for (i = 0; i < placement->count; i++) {
    parse_fills fills = placement->fills[i]->fills;
    if (fills == PARSE_FILLS_NOTHING || fills == PARSE_FILLS_REFUSED || fills == PARSE_FILLS_NO_WAY) return SPROUT_EVAL_OK;
    if (options_of(placement->fills[i]) == 0) return SPROUT_EVAL_OK;
  }
  for (i = 0; i < part_count; i++)
    if (!parts[i].is_slot) phrase_literal += parts[i].word_count;
  at = (size_t *)sprout_arena_take(frame->turn, (placement->count + 1) * sizeof *at);
  if (at == NULL) return SPROUT_EVAL_NO_MEMORY;
  memset(at, 0, (placement->count + 1) * sizeof *at);
  /* Each way to take one option from each slot, the last slot turning fastest, as TS's flatMap orders them. */
  for (;;) {
    parse_partial made;
    EXPR_NEED(expr_spend(frame));
    made.literal = phrase_literal;
    made.bound = placement->count;
    for (i = 0; i < placement->count; i++) made.literal += literal_of(placement->fills[i], &placement->spans[i], at[i]);
    if (partials->count == 0 || parse_compare_partial(&made, &partials->best[0]) <= 0) {
      parse_partial *slot;
      if (partials->count > 0 && parse_compare_partial(&made, &partials->best[0]) < 0) partials->count = 0;
      EXPR_NEED(write_partial(frame, placement, parts, part_count, at, unfit, keep, &made));
      slot = (parse_partial *)sprout_exec_grow(keep, (void **)&partials->best, &partials->count, &partials->capacity,
                                               sizeof *partials->best);
      if (slot == NULL) return SPROUT_EVAL_NO_MEMORY;
      *slot = made;
    }
    for (i = placement->count; i > 0; i--) {
      if (++at[i - 1] < options_of(placement->fills[i - 1])) break;
      at[i - 1] = 0;
    }
    if (i == 0) return SPROUT_EVAL_OK;
  }
}

sprout_eval_status parse_choose_partial(const sprout_frame *frame, const parse_partial *partials, size_t count,
                                        const parse_partial **chosen, size_t *among) {
  const parse_partial *best = &partials[0];
  size_t i;
  uint32_t drawn;
  *among = 0;
  for (i = 1; i < count; i++)
    if (parse_compare_partial(&partials[i], best) < 0) best = &partials[i];
  for (i = 0; i < count; i++)
    if (parse_compare_partial(&partials[i], best) == 0) (*among)++;
  *chosen = best;
  if (*among == 1) return SPROUT_EVAL_OK;
  EXPR_NEED(expr_spend(frame));
  if (frame->draws == NULL || !sprout_draws_below(frame->draws, *among, &drawn))
    return expr_engine(frame, "a tie among partial readings is drawn without the turn's draws.");
  for (i = 0; i < count; i++)
    if (parse_compare_partial(&partials[i], best) == 0 && drawn-- == 0) break;
  *chosen = &partials[i];
  return SPROUT_EVAL_OK;
}
