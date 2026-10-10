/*
 * An intent read from a line, and the steps it plans (the spec's Parsing >
 * Intents). Every step is planned before the line runs, against the world as
 * the visitor typed into it: a step whose roles what was bound cannot fill,
 * or whose `when` is false, is left out, and the rest are the line's
 * readings, each run as a turn of its own.
 */
#ifndef SPROUT_INTENTS_H
#define SPROUT_INTENTS_H

#include "reading/reading.h"

/* A line understood as an intent: which, who typed it, and what fills each slot, in the intent's order. */
typedef struct sprout_intended {
  const sprout_intent *intent;
  sprout_str actor;
  const sprout_filled *slots; /* one for each slot of the intent; only a thing fills one that a step reads */
} sprout_intended;

/*
 * The readings `intended` stands for, in order: each step that can be filled
 * and whose `when` holds. A `when` is read as a guard is, with the one typing
 * as `actor`, their place as `here` and each slot by its name; a name it
 * reads that is out of range, or destroyed, makes it false.
 */
sprout_eval_status sprout_plan_intent(const sprout_frame *frame, const sprout_intended *intended,
                                      const sprout_resolved **planned, size_t *count);

#endif
