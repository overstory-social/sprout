/*
 * What the turn kinds share (the spec's The runtime > Turns, Effects, Faults; Limits > Runtime
 * budgets). A write turn runs in a draft over the last committed state, under a meter and a stream
 * of draws begun from its seed, and either commits or is dropped, leaving the state byte for byte as
 * it was. What it said is rendered inside the turn, against the draft, so a line too long for the
 * turn's actor faults the turn as any budget spent does and anyone else is cut short. Each kind is
 * one module under turn/, a function over a run and an outcome.
 */
#ifndef SPROUT_TURN_H
#define SPROUT_TURN_H

#include "address.h"
#include "answers.h"
#include "prose.h"

/* One attempt at a turn: its scratch, its draft, its meter and its draws. */
typedef struct turn_run {
  sprout_world *world;
  sprout_state *state;
  const sprout_host *host;
  sprout_turn_kind kind;
  uint64_t seed, instant;
  sprout_arena scratch;
  sprout_draft draft;
  sprout_meter own_meter;
  sprout_draws own_draws;
  sprout_meter *meter; /* the run's own, or the one a maintenance turn shares among its parts */
  sprout_draws *draws;
  sprout_eval_fault fault;
  sprout_exec x;
} turn_run;

/* What an outcome owns: the host that backs it, and the arena that holds everything it points to. */
typedef struct turn_held {
  sprout_host host;
  sprout_arena anchor, arena;
} turn_held;

/* ---- turn.c ---- */

/*
 * Begins an attempt: a scratch arena, a draft over `state`, a meter of `kind` and draws begun from `seed`.
 * A `shared` meter and stream, which a maintenance turn keeps across its parts, replace the run's own.
 */
sprout_status turn_open(turn_run *run, sprout_world *world, sprout_state *state, const sprout_host *host,
                        sprout_turn_kind kind, uint64_t seed, uint64_t instant, sprout_meter *shared_meter,
                        sprout_draws *shared_draws);

/* Drops an attempt: its scratch is released and the state it was opened on is as it was. */
void turn_drop(turn_run *run);

/* The outcome's arena, for what the host reads after the call. */
sprout_arena *turn_keep(sprout_outcome *outcome);

/* An outcome that owns an arena over `host`; SPROUT_NO_MEMORY when the host refuses one. */
sprout_status turn_outcome_begin(const sprout_host *host, sprout_outcome *outcome);

/*
 * What an attempt that ended in `status` (not SPROUT_EVAL_OK) says of its fault, written into the outcome:
 * the rule broken by name, in words, and the object it is about; for a budget, the figure.
 */
void turn_fault_of(const turn_run *run, sprout_eval_status status, sprout_outcome *outcome);

/*
 * Renders what the exec recorded for `actor` (NULL where nobody acted) against the draft and copies the
 * lines, the effects and the cuts into the outcome. A budget spent while rendering is the attempt's fault.
 */
sprout_eval_status turn_render(turn_run *run, const sprout_str *actor, sprout_outcome *outcome);

/* Commits the attempt's draft; the state is now what the turn made. */
sprout_status turn_commit(turn_run *run);

/*
 * Records the log entry of a turn that ran: its kind, the world's last serial, the seed it drew from, the
 * instant, and whom it was for. Strings are copied into the outcome.
 */
sprout_status turn_log(turn_run *run, sprout_outcome *outcome, const char *who, size_t who_length);

/* Frees what the outcome holds and returns `status`, keeping the words a refusal wrote in the fault text. */
sprout_status turn_abort(sprout_outcome *outcome, sprout_status status);

/* The seed of the `nth` tick or wake turn a step runs for `id`, drawn from the step's `seed` and the path of `id`. */
uint64_t turn_seed_under(const sprout_world *world, uint64_t seed, sprout_str id, uint64_t nth);

/* The visit's record in the committed state, or NULL. */
const sprout_stored_visitor *turn_visitor(const sprout_state *state, const char *visit);

/* Words for a host defect, written to the outcome's fault text, which a call returns SPROUT_BAD_INPUT with. */
sprout_status turn_refuse(sprout_outcome *outcome, const char *before, const char *name, const char *after);

/* ---- turn/arrival.c: entering a place, shared by an arrival and a displaced visitor's next turn ---- */

/* Words a host tells a person outside the world (the spec's The host contract > Admission and identity). */
#define TURN_NOT_ADMITTING "This world is not letting anyone in just now."
#define TURN_ENTRY_FAILED "Something went wrong as you arrived, and you have not come in."

/* Whether `id` is a place a visitor can stand in now: live, not the world, and holding actors. */
bool turn_is_place(const sprout_frame *frame, sprout_str id);

/* Whether `actor` stands in a place now; one whose place is gone, or who is away, does not. */
bool turn_stands_in_place(const sprout_frame *frame, sprout_str actor);

/* Why the world admits no one as the draft stands, in words for the log, or NULL where it admits. */
const char *turn_closed_reason(const sprout_frame *frame);

/* An entry: made, or refused by the host's bound on a crowd or by the place's `accept`, whose words the visitor reads. */
typedef struct turn_entry {
  bool refused;
  sprout_effect refusal; /* when refused: what the visitor is told */
  sprout_str place;      /* when entered: where */
} turn_entry;

/*
 * Brings `visitor`, who stands nowhere live, into `place`: the host's bound on a crowd, then its `accept` asked with
 * the world as `from`, the first refusal deciding, then the one write and what the engine sends and says of it.
 */
sprout_eval_status turn_enter(turn_run *run, sprout_str visitor, sprout_str place, turn_entry *out);

/* The engine's `name` line told to `visitor`, rendered with nothing bound: `missing` and `displaced`. */
sprout_eval_status turn_told(const sprout_frame *frame, const char *name, sprout_str visitor, sprout_effect *out);

/* ---- turn/wake.c: a wake taken off its object's list, shared with catch-up ---- */

/* Takes the wake asked under `serial` off `object`'s list. */
sprout_eval_status turn_without_wake(turn_run *run, sprout_str object, uint64_t serial);

/* Delivers a wake: it comes off the list, the object is sent `:woke (elapsed)`, and the queue drains. */
sprout_eval_status turn_deliver_wake(turn_run *run, sprout_str object, uint64_t serial, uint64_t elapsed);

/* ---- the kinds, each a module under turn/ ---- */

sprout_status turn_command(sprout_world *world, sprout_state *state, const sprout_host *host,
                           const sprout_turn_input *input, sprout_outcome *outcome);
sprout_status turn_arrival(sprout_world *world, sprout_state *state, const sprout_host *host,
                           const sprout_turn_input *input, sprout_outcome *outcome);
sprout_status turn_departure(sprout_world *world, sprout_state *state, const sprout_host *host,
                             const sprout_turn_input *input, sprout_outcome *outcome);
sprout_status turn_tick(sprout_world *world, sprout_state *state, const sprout_host *host,
                        const sprout_turn_input *input, sprout_outcome *outcome);
sprout_status turn_wake(sprout_world *world, sprout_state *state, const sprout_host *host,
                        const sprout_turn_input *input, sprout_outcome *outcome);
sprout_status turn_maintenance(sprout_world *world, sprout_state *state, const sprout_host *host,
                               const sprout_turn_input *input, sprout_outcome *outcome);

#endif
