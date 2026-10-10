/*
 * What is to be done with time, read from the committed state (the spec's Time > Ticks, Wakes, Absence;
 * The host contract > Time): which places hold a visitor and so are ticked, and which wakes have fallen
 * due on something in the tree. Which to run, and when, is the host's; these only read.
 */
#ifndef SPROUT_SCHEDULE_H
#define SPROUT_SCHEDULE_H

#include "state.h"

/* Whether `id` is in the tree: decoded, with every container out to the world decoded. */
bool schedule_live(const sprout_state *state, sprout_str id);

/* Whether `id` is a place a visitor can stand in now: live, not the world, and holding actors. */
bool schedule_is_place(const sprout_state *state, sprout_str id);

/* Whether a visitor stands in `place`, which must be a place. */
bool schedule_occupied(const sprout_state *state, sprout_str place);

/* The wake `object` holds under `serial`, where it is pending on something in the tree. */
bool schedule_pending(const sprout_state *state, sprout_str object, uint64_t serial, sprout_due_wake *out);

/* Every wake due at `until` or before, oldest first, in the arena. */
sprout_status schedule_due(sprout_arena *arena, const sprout_state *state, uint64_t until, sprout_due_wake **out,
                           size_t *count);

#endif
