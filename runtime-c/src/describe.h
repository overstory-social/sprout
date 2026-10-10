/*
 * A description, derived, and whether a place is lit (the spec's Prose; Verbs > Engine verbs; The
 * runtime > The view; Range > Sight). A thing's `describe` runs with `self` the thing, `actor`
 * whoever is looking, `here` their place and `seen` what it is read for; it only reads, draws
 * nothing, and gives its words with `text`, each one line, carried unrendered with the names in
 * scope for the prose layer. A place that is not lit is described by the world's `dark` in place
 * of its own, and a thing that gives no words by the engine's `unremarkable`, so looking at
 * anything reads something. A place's `lit` is asked as an exit's `when` is: a place that writes
 * none is lit, and a condition that reads through a name out of range, or a destroyed one, does
 * not hold, so the place is dark rather than the poll faulting.
 */
#ifndef SPROUT_DESCRIBE_H
#define SPROUT_DESCRIBE_H

#include "exec.h"

/* Whether `place` is lit now. */
sprout_eval_status sprout_is_lit(const sprout_frame *frame, sprout_str place, bool *lit);

/* Whether `actor` stands in the dark: their place is not lit. One who is away stands nowhere, and is not. */
sprout_eval_status sprout_in_the_dark(const sprout_frame *frame, sprout_str actor, bool *dark);

/* One line a description gives: whose body said it, what it says, and every name in scope where it was said. */
typedef struct sprout_spoken {
  sprout_str by;
  sprout_speech said;
  const sprout_binding *bindings;
} sprout_spoken;

/* What one reader reads of a thing when they look at it. */
typedef struct sprout_description {
  sprout_str of, to;
  size_t line_count;
  const sprout_spoken *lines;
  size_t recorded_count;
  const sprout_spoken *recorded; /* what its extension statements recorded, for the one looking, in order */
  sprout_spoken unremarkable; /* read where the lines render nothing, with `thing` the thing */
} sprout_description;

/*
 * What `actor` reads looking at `thing`, for `seen` (`look`, `arrival` or `poll`): each statement
 * of its describe a step and each expression as a body's is charged. An actor who is away looks at
 * nothing, which is the engine's defect.
 */
sprout_eval_status sprout_describe(const sprout_frame *frame, sprout_str thing, sprout_str actor, const char *seen,
                                   sprout_description *out);

#endif
