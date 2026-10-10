/*
 * The exits and links that apply where an actor stands (the spec's Verbs >
 * Exits, An exit may be conditional, Links; The compiler > What absent
 * means). Several exits may share a direction and the first whose guard
 * holds is the one that applies, so a direction gives at most one, and a
 * link is one of its name; an exit that does not apply is not offered, not
 * traversable and not mentioned. An exit that refuses applies as any exit
 * does, deciding its direction, and is never offered: going that way is
 * answered with its words, and nothing moves. Asking is a function over a
 * frame, charged one step for each exit asked.
 */
#ifndef SPROUT_EXITS_H
#define SPROUT_EXITS_H

#include "exec.h"

/* One way out of a place that applies now. */
typedef struct sprout_way {
  const char *direction; /* NULL for a link */
  const char *label;
  bool refuses;          /* the way does not go: it answers with `said`, from `by` */
  sprout_str to;         /* where it leads, unless it refuses */
  sprout_str by;
  sprout_speech said;
  const sprout_node *exit; /* the exit or link as the place's kind declares it */
} sprout_way;

/* Every exit and link that applies on `place`, a refusing one among them, in the order its kind answers them. */
sprout_eval_status sprout_ways_from(const sprout_frame *frame, sprout_str place, const sprout_way **ways, size_t *count);

/* Those that lead somewhere, which are what a visitor is offered. */
sprout_eval_status sprout_exits_from(const sprout_frame *frame, sprout_str place, const sprout_way **ways, size_t *count);

/* What a way says to whoever takes it, and the place that says it. */
typedef struct sprout_saying {
  bool says;
  sprout_str by;
  sprout_speech said;
} sprout_saying;

/*
 * What `taken`, an exit of `place` that leads, says as it is taken; nothing
 * where it says nothing. The exits of its direction are asked again, a step
 * for each, only where one of them says something.
 */
sprout_eval_status sprout_exit_saying(const sprout_frame *frame, sprout_str place, const sprout_way *taken,
                                      sprout_saying *out);

#endif
