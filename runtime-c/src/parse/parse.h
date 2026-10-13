/*
 * The command parser's areas (the spec's Parsing; Verbs > Slots), each a module of functions over what it
 * reads: where a phrase's slots fall in a line (match.c), and a line read as the command turn reads it
 * (command.c, `sprout_parse`). Scratch is the turn's arena, rewound with it; what a host reads is copied
 * into the arena it hands in.
 */
#ifndef SPROUT_PARSE_H
#define SPROUT_PARSE_H

#include "../eval.h"
#include "../world.h"

/* ---- match.c: where a phrase's slots fall ---- */

/* The words one slot takes: its role, by index, and where in the line they run, `end` one past the last. */
typedef struct parse_span {
  size_t role, start, end;
} parse_span;

/* Called with each placement in the order tried; anything but SPROUT_EVAL_OK stops the walk with it. */
typedef sprout_eval_status (*parse_placed)(void *context, const parse_span *spans, size_t count);

/*
 * Every way `parts` cover `words` exactly, each slot at least one word, the phrase's words standing where they are
 * written, an earlier slot's longer run tried first (the spec's Verbs > Slots; Names > Nicknames: longest first).
 */
sprout_eval_status parse_slot_spans(sprout_arena *scratch, const sprout_typed_part *parts, size_t part_count,
                                    const sprout_str *words, size_t word_count, parse_placed each, void *context);

/* ---- command.c: a line as the command turn reads it ---- */

/* `line` without a trailing `?`, which is read as nothing; a `?` alone is kept, since it is a phrase of `help`. */
sprout_str parse_without_question(sprout_str line);

#endif
