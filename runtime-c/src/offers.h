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
 * meet, and costs a step, so a world too large to list faults as any work does. What `all` takes in a role is
 * here too, one rule for the parser's `all` and the view's word on each filler.
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

/*
 * The verbs `actor` could be offered where they stand, in the order the parser tries them: those whose every role
 * can be filled from what is in range (a `go` by a way out), before any consent pass. Held in the turn arena.
 */
sprout_eval_status sprout_offers_verbs(sprout_exec *x, const sprout_frame *frame, sprout_str actor, const sprout_way *ways,
                                       size_t way_count, const sprout_reached *reached, size_t reached_count,
                                       const sprout_verb ***out, size_t *count);

/* The readings of `verb` alone that `actor` could type where they stand, as sprout_offers_to lists them for it. */
sprout_eval_status sprout_offers_for(sprout_exec *x, const sprout_frame *frame, sprout_str actor, const sprout_way *ways,
                                     size_t way_count, const sprout_reached *reached, size_t reached_count,
                                     const sprout_verb *verb, const sprout_offer **out, size_t *count);

/*
 * Whether only the actor plays a part in `role` of `verb`: no kind a spawn may name plays it, each kind a step.
 * `all` never fills such a role with the actor's own place, nor does an offer where the actor's part moves it.
 */
sprout_eval_status sprout_only_the_actor_plays(const sprout_frame *frame, const sprout_verb *verb, const sprout_role *role,
                                              bool *only);

/* What `all` takes in one role of a verb (the spec's Parsing > Sequences, again and all), its part that is the same for every thing. */
typedef struct sprout_all_rule {
  const sprout_verb *verb;
  const sprout_role *role;
  bool every_thing; /* an open role takes every thing not a person: an engine verb's, or one only the actor plays */
} sprout_all_rule;

/* The rule of `all` for `role` of `verb`, worked out once for every thing weighed by it; for a world verb, each kind asked is a step. */
sprout_eval_status sprout_all_rule_of(const sprout_frame *frame, const sprout_verb *verb, const sprout_role *role,
                                      sprout_all_rule *out);

/*
 * Whether `all` takes `thing` by `rule`, `carried` saying whether `actor` carries it: never the actor nor `here`,
 * their place; for a carried role only what is carried; for a role that takes a value or a way out, nothing. The
 * parser's `all` weighs each thing in reach by it, and the view each thing it offers.
 */
bool sprout_all_takes(const sprout_all_rule *rule, const sprout_stored_instance *thing, sprout_str actor, sprout_str here,
                      bool carried);

#endif
