/*
 * What a reading came to, as a host reads it (the spec's The runtime >
 * Effects): the lines a turn said, unrendered, and the refusal the consent
 * pass gave. Each is a tree in the canonical JSON the readings goldens hold:
 * a line is `effect`, `to`, `by`, `speaker`, `said` (a passage by where it
 * is written, the quoted words, an engine line by name, or what an extension
 * recorded) and the names in scope where it was said.
 */
#ifndef SPROUT_OUTCOME_H
#define SPROUT_OUTCOME_H

#include "json.h"
#include "reading/reading.h"

/* Every effect the exec recorded, in order, as an array in the turn arena. */
sprout_eval_status sprout_outcome_effects(const sprout_exec *x, const sprout_frame *frame, sprout_json **out);

/* The consent pass's refusal as an object in the turn arena: `by`, `role`, `origin`, `said` and `bindings`. */
sprout_eval_status sprout_outcome_refusal(const sprout_frame *frame, const sprout_permit_refusal *refusal,
                                          sprout_json **out);

#endif
