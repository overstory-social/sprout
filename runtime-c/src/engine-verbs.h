/*
 * The verbs whose behaviour is the engine's (the spec's Verbs > Engine
 * verbs): `go`, `look`, `examine`, `inventory`, `wait` and `help`, which the
 * standard library declares and the engine answers. `take`, `drop`, `put`,
 * `give`, `open`, `close` and `unlock` are the library's own plays, run like
 * any other. Only `go` has a role an exit fills.
 */
#ifndef SPROUT_ENGINE_VERBS_H
#define SPROUT_ENGINE_VERBS_H

#include "reading/reading.h"

/* Whether `verb` is the standard library's verb of one of the engine's names. */
bool sprout_is_engine_verb(const sprout_verb *verb);

/*
 * Whether the engine answers a person's reading of `verb` with what the actor
 * reads, once the queue is empty: `look`, `examine`, `inventory`, `wait` and
 * `help`.
 */
bool sprout_answered_by_engine(const sprout_verb *verb);

/* The exit a reading of the engine's `go` takes; NULL for any other reading. */
const sprout_stored_bound *sprout_exit_of(const sprout_resolved *reading);

/*
 * `go`, the reading's first effect: the actor moved through the exit named,
 * a refusal of the move said as a refused `move` is, and what the exit says
 * as it is taken said to a person who went. Neither is the effect pass's to
 * guess, so it is told which came of it.
 */
typedef enum sprout_went { SPROUT_WENT_DONE, SPROUT_WENT_REFUSED } sprout_went;

sprout_eval_status sprout_go(sprout_exec *x, const sprout_frame *frame, const sprout_resolved *reading,
                             const sprout_stored_bound *way, bool person, sprout_went *went);

#endif
