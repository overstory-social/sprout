/*
 * What the passes of a reading share (the spec's Verbs > The two passes,
 * Playing a role, Roles compose, Set roles, Carried roles, Value roles, A
 * role-player narrows its own options). A reading is a verb, an actor, and
 * its roles filled. Its participants are the actor first and then each
 * role's players in the order the verb declares its roles; each runs every
 * play its kind composes for its role, in composition order, its wildcard
 * plays first. The consent pass only reads; the effect pass writes, and
 * writes only `self`.
 */
#ifndef SPROUT_READING_INTERNAL_H
#define SPROUT_READING_INTERNAL_H

#include "../exec.h"

/* What fills one role of a reading: a thing, the things a set role names in typed order, a value, or an exit. */
typedef struct sprout_filled {
  bool filled; /* a tool left out has no filler, and a set role left out is the empty set */
  sprout_stored_bound bound;
} sprout_filled;

/* A reading as the passes run it: the verb resolved, who acts, and what fills each of the verb's roles. */
typedef struct sprout_resolved {
  const sprout_verb *verb;
  sprout_str actor;
  const sprout_filled *roles; /* one for each role of the verb, in the verb's order */
} sprout_resolved;

/* One participant: who, and the role it plays; no role is the actor's own part. */
typedef struct sprout_participant {
  sprout_str id;
  const sprout_role *role;
} sprout_participant;

/* The consent pass's refusal: the whole of what the actor reads. */
typedef struct sprout_permit_refusal {
  sprout_move_refusal refusal; /* who refused (the engine's lines are the world's), the words, the names they render with */
  const char *role;            /* the role the refusing participant played, or the carried role the engine refused */
} sprout_permit_refusal;

/* The plays a participant's kind runs for its role: wildcard plays first, then the plays for the verb. */
typedef struct sprout_plays {
  size_t count;
  const sprout_play_group *groups[2];
} sprout_plays;

/* ---- reading.c ---- */

/*
 * Runs the consent pass and then, where nobody refused, the effect pass,
 * once each set role is checked against the host's cap on what one binds;
 * `x->acting` is how many `act`s deep it runs. A refusal is returned, not
 * recorded: whoever runs the reading says it.
 */
sprout_eval_status sprout_perform(sprout_exec *x, const sprout_frame *frame, const sprout_resolved *reading,
                                  sprout_reading_end *end, sprout_permit_refusal *refusal);

/* What a role takes: an exit, a value, the things of a set, or a thing. */
sprout_bound_kind sprout_role_takes(const sprout_role *role);

/* The verb written as an `act` or an intent's library writes it: its own library's first, then the standard library's. */
const sprout_verb *sprout_verb_named(const sprout_world *world, const char *library, const char *name);

/* ---- submit.c: a reading handed in by id ---- */

/*
 * The reading a host handed over, resolved against the world and the draft: its verb, its actor and what fills
 * each role. SPROUT_BAD_INPUT, with the words written to `words`, for a reading the world cannot take: an
 * unknown verb or role or thing, or a filling the role does not take.
 */
sprout_status sprout_reading_resolve(const sprout_world *world, const sprout_draft *draft, sprout_arena *turn,
                                     const sprout_reading *reading, sprout_resolved *out, char *words, size_t size);

/*
 * An exit a submitted reading names must be one the actor's place has now: its label and destination among the
 * ways that lead and whose guard admits them. Otherwise it is out of range, as a thing out of range is.
 */
sprout_eval_status sprout_reading_exits(const sprout_frame *frame, const sprout_resolved *reading);

/* ---- consent.c ---- */

/* The actor, then each role's players in the verb's order: a set role's in the order typed. */
sprout_eval_status sprout_participants(sprout_exec *x, const sprout_resolved *reading, const sprout_participant **out,
                                       size_t *count);

/* The actor's place: its container, which holds actors. An actor that is away, or in what holds none, is the engine's defect. */
sprout_eval_status sprout_place_of(const sprout_frame *frame, sprout_str actor, sprout_str *place);

/*
 * The frame one play of `who` runs in: `self` the participant, `actor` and
 * `here`, and each other role as this play sees it. A `permit` is given no
 * draws, which a `do` is.
 */
sprout_eval_status sprout_play_frame(sprout_exec *x, const sprout_resolved *reading, const sprout_participant *who,
                                     const sprout_play *play, bool draws, sprout_frame *out);

/*
 * Every `permit` of every participant, in order, until one refuses. A
 * `permit` that allows, or reaches its end, consents, and so does a
 * participant that wrote none. Before any, the engine refuses a carried role
 * holding what the actor does not carry.
 */
sprout_eval_status sprout_consent_pass(sprout_exec *x, const sprout_frame *frame, const sprout_resolved *reading,
                                       bool *refused, sprout_permit_refusal *out);

/* ---- carried.c ---- */

/* Whether `asker` holds `target`, or holds what holds it, every container strictly between letting it through. */
sprout_eval_status sprout_carries(const sprout_frame *frame, sprout_str asker, sprout_str target, bool *carried);

/* The world's `not_carrying` for the first thing a carried role holds that the actor does not carry. */
sprout_eval_status sprout_uncarried(sprout_exec *x, const sprout_frame *frame, const sprout_resolved *reading,
                                    bool *refused, sprout_permit_refusal *out);

/* ---- wildcards.c ---- */

/* The plays `kind` writes for `role` of `verb` alone, a wildcard's left out; NULL where it writes none. */
const sprout_play_group *sprout_own_plays(const sprout_verb *verb, const char *role, const sprout_kind_def *kind);

/* What `who`, of kind `kind`, runs for its role in the reading's verb. */
void sprout_plays_for(const sprout_resolved *reading, const sprout_participant *who, const sprout_kind_def *kind,
                      sprout_plays *out);

/* ---- sure.c ---- */

/*
 * The engine's `inside_itself` where the reading's first sure move, the first `move` written directly in a
 * `do`, would put a thing inside itself, said as the move would say it; *refused is false where it would
 * not, or where no `move` is written directly in its `do`s. Each play read is a step.
 */
sprout_eval_status sprout_inside_itself(sprout_exec *x, const sprout_frame *frame, const sprout_resolved *reading,
                                        bool *refused, sprout_permit_refusal *out);

/* Whether the first sure move of one of `actor`'s own plays in `verb` moves what fills `role`. */
sprout_eval_status sprout_moves_its_filler(const sprout_frame *frame, const sprout_verb *verb, const sprout_role *role,
                                           sprout_str actor, bool *moves);

/* ---- effect.c ---- */

/*
 * Every `do` of every participant, in the consent pass's order. A
 * participant destroyed by an earlier `do` in the pass does nothing more.
 * When no participant said, told or refused anything to the actor, the
 * world's `nothing_happens` is. `x->acting` is how many `act`s deep.
 */
sprout_eval_status sprout_effect_pass(sprout_exec *x, const sprout_frame *frame, const sprout_resolved *reading);

#endif
