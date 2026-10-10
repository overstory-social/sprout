/*
 * Running a body (the spec's The world model, Events, messages and the bus,
 * Movement and consent, Time, The runtime > Effects; Limits > Runtime
 * budgets). A body is a block of statements; it runs against a turn's draft,
 * writes only `self`, and records what it says, sends and asks for rather
 * than rendering or delivering it: the words are recorded as passage
 * references with the names in scope, the sends wait in a queue the bus
 * drains breadth-first, and a reading an `act` proposes is run on the spot by
 * the reading pass. Every charge is against the host's budgets.
 *
 * Each module is functions over an exec context, as the evaluator's are over
 * a frame: exec.c runs blocks, stmt/ holds one module per statement area,
 * bus.c the queue, move.c the one place the tree changes, range.c the walk
 * a broadcast and a move's notices make, wakes.c the wakes an object holds,
 * guards.c a consent guard, effects.c what a turn says and who hears it,
 * hearing.c who reads what a reading says, reading.c and reading/ the two
 * passes of a reading, exits.c the ways out of a place.
 */
#ifndef SPROUT_EXEC_H
#define SPROUT_EXEC_H

#include "eval.h"

/* Whether a body decides, as a guard does, or acts, as a handler or a `do` does. */
typedef enum sprout_body_mode { SPROUT_BODY_DECIDE, SPROUT_BODY_ACT } sprout_body_mode;

/* ---- effects.c: what a turn says ---- */

/* What a `say`, `tell`, `refuse` or engine line gives: a passage, words in quotes, or what an extension recorded. */
typedef enum sprout_speech_kind {
  SPROUT_SPEECH_PASSAGE, /* a passage as the speaker's kind has it */
  SPROUT_SPEECH_TEXT,    /* words in quotes, a one-line passage */
  SPROUT_SPEECH_ABSENT,  /* a passage whose prose file the world was loaded without: renders nothing */
  SPROUT_SPEECH_ENGINE,  /* one of the engine's lines, to be found where the spec's Engine lines says */
  SPROUT_SPEECH_RECORDED /* what an extension's statement recorded */
} sprout_speech_kind;

typedef struct sprout_speech {
  sprout_speech_kind kind;
  const char *name;         /* passage, absent, engine: the passage's name */
  const char *origin;       /* passage: the qualified kind that wrote it */
  const sprout_node *node;  /* passage: its body; text: the prose literal */
  const char *library;      /* text: the library whose body said it, where a kind its slots name is read from */
  const char *extension, *statement; /* recorded */
  size_t argument_count;
  const sprout_value *arguments;     /* recorded: what the statement was given, for the extension to turn into a payload */
} sprout_speech;

typedef enum sprout_effect_kind {
  SPROUT_EFFECT_SAID,
  SPROUT_EFFECT_TOLD,
  SPROUT_EFFECT_REFUSED,
  SPROUT_EFFECT_NOTICE,
  SPROUT_EFFECT_EXTENSION
} sprout_effect_kind;

typedef struct sprout_effect_binding {
  const char *name;
  sprout_evaluated bound;
} sprout_effect_binding;

/* One line a turn said, unrendered: who reads it, whose body said it, and every name in scope where it was said. */
typedef struct sprout_effect {
  sprout_effect_kind kind;
  size_t to_count;
  const sprout_str *to;
  sprout_str by;
  bool has_speaker;
  sprout_str speaker;
  sprout_speech said;
  size_t binding_count;
  const sprout_effect_binding *bindings;
} sprout_effect;

/* A description a move owes the one it carried between places, read once `after` effects are said. */
typedef struct sprout_owed {
  sprout_str mover, place;
  size_t after;
} sprout_owed;

/* A handler or hook that ran, for an author's tools: the kind that wrote it, what it answers, and where. */
typedef struct sprout_ran {
  const char *origin;
  const char *on; /* a message's key, or `changed :p` for a hook */
  const sprout_node *at;
} sprout_ran;

/* ---- bus.c: the queue ---- */

typedef enum sprout_message_kind {
  SPROUT_MSG_AUTHORED,
  SPROUT_MSG_CHANGED,
  SPROUT_MSG_ENTERED,
  SPROUT_MSG_LEFT,
  SPROUT_MSG_MOVED,
  SPROUT_MSG_ARRIVED,
  SPROUT_MSG_DEPARTED,
  SPROUT_MSG_SPAWNED,
  SPROUT_MSG_TICK,
  SPROUT_MSG_WOKE
} sprout_message_kind;

/* One message waiting, with the objects it names positionally, as the spec's Receiving lists them. */
typedef struct sprout_send {
  sprout_message_kind message;
  sprout_str recipient;
  bool has_from; /* what a destroyed sender takes the message with it */
  sprout_str from;
  sprout_str item; /* entered, left: the item; arrived, departed: the actor */
  sprout_str to;   /* left, moved, departed */
  const sprout_message *declared; /* authored */
  bool has_value;
  sprout_value value;             /* authored: what it carries */
  const char *property;           /* changed */
  sprout_value was;               /* changed: the value before the write */
  double elapsed;                 /* tick, woke */
  size_t depth;                   /* how deep a cascade it runs */
} sprout_send;

/* ---- reading.c: the reading pass an `act` runs on the spot ---- */

/* A role of an `act`, and what fills it. */
typedef struct sprout_pending_role {
  const char *role;
  sprout_evaluated filler;
} sprout_pending_role;

/* How a reading ended: both passes ran, the consent pass refused, or the actor is gone. */
typedef enum sprout_reading_end { SPROUT_READING_ACTED, SPROUT_READING_REFUSED, SPROUT_READING_GONE } sprout_reading_end;

struct sprout_exec;

/*
 * Runs the reading `verb` of `actor`, filled by `roles`, through both passes
 * against the exec's draft (the spec's Verbs > Acting): what it says, sends
 * and writes is recorded in the exec as a body's is, and the words of a
 * refusal are said to whoever would hear the actor. `verb` is written as
 * the `act` writes it, from `frame->library`.
 */
typedef sprout_eval_status (*sprout_reading_fn)(struct sprout_exec *x, const sprout_frame *frame, sprout_str actor,
                                                const char *verb, size_t role_count,
                                                const sprout_pending_role *roles, sprout_reading_end *end);

/* The reading pass of reading.c, which an exec begins with. */
sprout_eval_status sprout_run_reading(struct sprout_exec *x, const sprout_frame *frame, sprout_str actor,
                                      const char *verb, size_t role_count, const sprout_pending_role *roles,
                                      sprout_reading_end *end);

/* ---- the context ---- */

typedef struct sprout_exec {
  const sprout_world *world;
  sprout_draft *draft;
  sprout_arena *turn;
  sprout_meter *meter;
  sprout_draws *draws;
  sprout_eval_fault *fault;
  uint64_t instant; /* the instant the turn runs, in host seconds, which a `wake` is asked at */

  /* Who reads what an acting body says, and from whom it is heard (set by whoever runs the body). */
  const sprout_str *heard_by;
  size_t heard_count;
  bool has_speaker;
  sprout_str speaker;
  const sprout_str *left_out; /* whom a plain `tell` leaves out */
  size_t left_out_count;
  bool records_as_said; /* an extension's effect reaches those who read what is said, rather than the teller's place */
  bool hears_live;      /* what is said is heard by whoever would hear the speaker's `tell` now, rather than by `heard_by` */
  size_t acting;        /* the `act`s the readings now running stand inside, one deeper against the cascade depth each */

  /* What the turn has done, in order. */
  sprout_effect *effects;
  size_t effect_count, effect_capacity;
  sprout_owed *owed;
  size_t owed_count, owed_capacity;
  sprout_ran *ran;
  size_t ran_count, ran_capacity;
  sprout_reading_fn reading; /* the reading pass an `act` runs on the spot */
  size_t events; /* deliveries that ran a handler or a hook */

  /* What bodies have queued since the queue last drained. */
  sprout_send *queued;
  size_t queued_count, queued_capacity;
  sprout_str *destroyed; /* removed by a body that has ended, not yet dropped from the queue */
  size_t destroyed_count, destroyed_capacity;
  sprout_str *gone; /* everything destroyed this turn, in the order destroyed */
  size_t gone_count, gone_capacity;
  sprout_send *queue; /* the deliveries waiting, read from `head` */
  size_t queue_count, queue_capacity, queue_head;
  sprout_str *marked;
  size_t marked_count, marked_capacity;
  size_t depth; /* the cascade depth of the sends a body now running queues */
} sprout_exec;

/* Begins a turn's execution over its draft, meter and arena; nothing is heard until the caller says who hears. */
void sprout_exec_begin(sprout_exec *x, const sprout_world *world, sprout_draft *draft, sprout_arena *turn,
                       sprout_meter *meter, sprout_draws *draws, sprout_eval_fault *fault, uint64_t instant);

/* The frame a body of `self` runs in, written by `library`, with the names `bindings` holds. */
sprout_frame sprout_exec_frame(const sprout_exec *x, sprout_str self, const char *library,
                               const sprout_binding *bindings);

/* The next slot of a growing list in the turn arena, zeroed; NULL when the host refuses a page. */
void *sprout_exec_grow(sprout_arena *arena, void **items, size_t *count, size_t *capacity, size_t size);

/* How a body ended: it ran to its end, or, deciding, it allowed or refused. */
typedef enum sprout_end { SPROUT_END_BODY, SPROUT_END_ALLOW, SPROUT_END_REFUSE } sprout_end;

typedef struct sprout_ended {
  sprout_end how;
  sprout_speech refused;
} sprout_ended;

/*
 * Runs `block` as the body of `frame->self`. Deciding, it may end in `allow`
 * or a refusal; acting, it runs to its end or its first refused `move`, and a
 * `destroy self` in it takes effect then. What it sends is queued for the bus.
 */
sprout_eval_status sprout_exec_body(sprout_exec *x, const sprout_node *block, const sprout_frame *frame,
                                    sprout_body_mode mode, sprout_ended *ended);

/* ---- bus.c ---- */

/* Delivers everything queued and everything that sends, breadth-first in insertion order, then destroys what was marked. */
sprout_eval_status sprout_exec_drain(sprout_exec *x);

/* A message the engine or a body sends, queued behind everything waiting; the send's depth is the running body's. */
sprout_eval_status sprout_exec_queue(sprout_exec *x, const sprout_send *send);

/* ---- range.c ---- */

typedef enum sprout_via {
  SPROUT_VIA_SELF,    /* the asker */
  SPROUT_VIA_HELD,    /* one of its own contents */
  SPROUT_VIA_SURFACE, /* a container outward that refuses, seen from inside only as a surface */
  SPROUT_VIA_PASSED   /* reached through a rule that passed */
} sprout_via;

typedef struct sprout_reached {
  sprout_str node;
  sprout_via via;
} sprout_reached;

/*
 * Everything in range of `asker` for `asking` (a message's qualified name, or
 * NULL for any), nearest first, each once; every node reached is a step.
 */
sprout_eval_status sprout_range_of(const sprout_frame *frame, sprout_str asker, const char *asking,
                                   const sprout_reached **reached, size_t *count);

/* ---- move.c ---- */

/* How a move reaches its destination: through the mover's range, as a `move` does, or through an exit or a link. */
typedef enum sprout_reach { SPROUT_REACH_RANGE, SPROUT_REACH_EXIT } sprout_reach;

typedef enum sprout_move_end {
  SPROUT_MOVE_DONE,
  SPROUT_MOVE_REFUSED_BY_GUARD,
  SPROUT_MOVE_REFUSED_BY_ENGINE
} sprout_move_end;

/* A move refused: who refused it, the words the actor reads, and the names they render with. */
typedef struct sprout_move_refusal {
  const char *guard;  /* depart, release, accept; NULL where the engine refused */
  const char *origin; /* the kind that wrote the guard, or NULL */
  sprout_str by;
  sprout_speech said;
  size_t binding_count;
  const sprout_effect_binding *bindings;
} sprout_move_refusal;

/*
 * Moves `item` into `to`, as `mover` proposes: the faults, the engine's
 * refusals (a thing inside itself, an actor into what holds no actors, a
 * person into a place the host says is full), then the three parties' guards
 * in the spec's order, then the one write. What the engine then tells the
 * world is queued, and what a place speaks of an actor moved between two is
 * recorded. `to` is in range of a move `mover` proposes as every place the
 * mover reaches is and, for an actor, as the destination of an exit or link of
 * its place that applies; a move made through an exit (`reach`) asks neither,
 * and names the exit's label as `way` (the spec's Verbs > Acting, Exits).
 */
sprout_eval_status sprout_move_instance(sprout_exec *x, const sprout_frame *frame, sprout_str mover, sprout_str item,
                                        sprout_str to, sprout_reach reach, const char *way, sprout_move_end *end,
                                        sprout_move_refusal *refusal);

/* Whether `to` is in range of a move `mover` proposes: in its range, or an exit or link of its place leads there. */
sprout_eval_status sprout_move_reaches(const sprout_frame *frame, sprout_str mover, sprout_str to, bool *reached);

/* ---- guards.c ---- */

/*
 * Runs one guard `guard` (a declaration with its origin) for `party`: `mover`
 * is whatever proposed the move and `parameters` the objects the move names,
 * positionally. A guard ends in `allow`, in `refuse`, or by reaching its end,
 * which allows; a refusal carries the words and the names they render with.
 */
sprout_eval_status sprout_guard_run(sprout_exec *x, const sprout_node *guard, sprout_str party, sprout_str mover,
                                    const sprout_str *parameters, size_t parameter_count, bool *allowed,
                                    sprout_move_refusal *refusal);

/* ---- hearing.c: who reads what a body says ---- */

/*
 * Who reads what a `say`, a refused `move` or an extension's line records
 * now: `heard_by`, or, where an NPC performs a reading, whoever would hear
 * its `tell` where it stands now (the spec's Verbs > Acting).
 */
sprout_eval_status sprout_exec_hearers(const sprout_exec *x, const sprout_frame *frame, const sprout_str **to,
                                       size_t *count);

/* Who reads what the bodies of a reading say, and whom their plain `tell`s leave out: what an exec holds of it. */
typedef struct sprout_hearing {
  const sprout_str *heard_by, *left_out;
  size_t heard_count, left_out_count;
  bool has_speaker, records_as_said, hears_live;
  sprout_str speaker;
} sprout_hearing;

/*
 * Sets who reads what a reading of `actor` says, `participants` (the actor
 * among them) being addressed by it already: the actor, where a person acts;
 * where an NPC acts, whoever would hear its `tell`, from it. What was set
 * before goes to `saved`, for sprout_hearing_restore.
 */
sprout_eval_status sprout_hear_reading(sprout_exec *x, const sprout_frame *frame, sprout_str actor,
                                       const sprout_str *participants, size_t count, sprout_hearing *saved);
void sprout_hearing_restore(sprout_exec *x, const sprout_hearing *saved);

/* A refused move recorded as the refusal it is, said to whoever the body speaks to. */
sprout_eval_status sprout_record_refusal(sprout_exec *x, const sprout_frame *frame, const sprout_move_refusal *refusal);

/* ---- wakes.c ---- */

/* `wake in <count> <unit>` run by `frame->self`: one wake asked at the turn's instant, no sooner than the host's floor. */
sprout_eval_status sprout_wake_ask(sprout_exec *x, const sprout_frame *frame, uint64_t seconds);

/* `cancel wakes` run by `frame->self`: every wake it has pending is taken back. */
sprout_eval_status sprout_wake_cancel(sprout_exec *x, const sprout_frame *frame);

/* ---- effects.c ---- */

/* Appends an effect to the turn's, in order. */
sprout_eval_status sprout_exec_record(sprout_exec *x, const sprout_effect *effect);

/* Whether `id` is a person: a visitor, rather than an NPC or a thing. */
bool sprout_is_person(const sprout_frame *frame, sprout_str id);

/* The place around `id`: its nearest container, strictly outward, that holds actors; false where there is none. */
bool sprout_surround_of(const sprout_frame *frame, sprout_str id, sprout_str *surround);

/* Every name in scope in `frame`, oldest first, for an effect to carry. */
sprout_eval_status sprout_effect_names(const sprout_frame *frame, const sprout_effect_binding **out, size_t *count);

/* Whom a `tell` reaches: the teller's place and its own occupants, only the occupants, or only the place around it. */
typedef enum sprout_tell_scope { SPROUT_TELL_PLACE, SPROUT_TELL_INSIDE, SPROUT_TELL_OUTSIDE } sprout_tell_scope;

sprout_eval_status sprout_told_to(const sprout_exec *x, const sprout_frame *frame, sprout_str teller,
                                  sprout_tell_scope scope, const sprout_str **out, size_t *count);
/* `tell x`: `x` where it is a person live and in the teller's range, else nobody. */
sprout_eval_status sprout_told_to_one(const sprout_exec *x, const sprout_frame *frame, sprout_str teller,
                                      sprout_str one, const sprout_str **out, size_t *count);

/* A passage of a kind as a speech. */
void sprout_passage_speech(const sprout_passage *passage, sprout_speech *out);
/* The passage a kind has by this name, as a speech; false where it has none. */
bool sprout_passage_on(const sprout_kind_def *kind, const char *name, sprout_speech *out);

/*
 * The engine's line `name` as it is said of `about` standing in `place`
 * (either may be NULL): the first found on `about`, `place` and the world, a
 * passage written `default` yielding to any other; the engine's own words,
 * recorded by name, where none writes it (the spec's Prose > Engine lines).
 */
void sprout_engine_said(const sprout_frame *frame, const char *name, const sprout_str *about, const sprout_str *place,
                        sprout_str *by, sprout_speech *said);

#endif
