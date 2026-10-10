/*
 * What an actor can do where they stand (the spec's Verbs > Engine verbs: `help`; The runtime > The
 * view). Every verb a visitor may type is offered once for each way its roles fill from what is in
 * range: a role a thing fills, by each thing in range it fits but the actor, and a carried role only
 * by what the actor carries; a set role by each such thing alone; a role only the actor plays, and
 * their own part moves, never by the actor's own place; and `go`'s way by each exit and link that
 * applies, a link typed by its label. In the dark a thing role is offered only what the actor carries,
 * and the ways out still. A tool is left out and a value role left unbound, which a body reads only
 * inside `if (bound ...)` and a `from` may leave so anyway. Each offer is typed by its verb's first
 * phrase that fits, with the consent pass's answer beside it, or the `inside_itself` its move would
 * meet, and costs a step, so a world too large to list faults as any work does.
 */
#ifndef SPROUT_OFFERS_H
#define SPROUT_OFFERS_H

#include "exits.h"
#include "reading/reading.h"

/* One reading the actor could type now. */
typedef struct sprout_offer {
  sprout_resolved reading;
  const char *typed; /* the line that types it, each filled slot as a visitor types it and a value role's as `…` */
  bool refused;      /* its consent pass refused, or its first sure move would put a thing inside itself */
  sprout_permit_refusal refusal;
} sprout_offer;

/*
 * Every reading `actor` could type where they stand, in the order the parser tries the verbs; `go` by each
 * of `ways`, the exits and links that apply on their place, and the rest from what `reached` holds, the
 * actor's range, nearest first. Everything is held in the turn arena.
 */
sprout_eval_status sprout_offers_to(sprout_exec *x, const sprout_frame *frame, sprout_str actor, const sprout_way *ways,
                                    size_t way_count, const sprout_reached *reached, size_t reached_count,
                                    const sprout_offer **out, size_t *count);

#endif
