/*
 * Evaluating an expression (the spec's The type system > What the compiler
 * checks, Precedence; Limits > Runtime budgets; Chance > The forms). The
 * checker has already guaranteed every operand's type, so a mismatch here is
 * an engine error, never a fault an author can cause. Two things fault: a
 * budget, which charges one step for every expression node evaluated, and
 * `+` or `-` whose result leaves the integer range. Reading a name that is
 * out of range, or a declared object destroyed, faults too. Evaluating only
 * reads; the one write the expressions' neighbour makes, a spawn, is
 * sprout_spawn.
 */
#ifndef SPROUT_EVAL_H
#define SPROUT_EVAL_H

#include "budget.h"
#include "draft.h"
#include "draws.h"
#include "world.h"

/* What an expression evaluates to: a value, a thing in the world, a set of things, or the readings `help` offers. */
typedef enum sprout_binds {
  SPROUT_BINDS_VALUE,
  SPROUT_BINDS_OBJECT,
  SPROUT_BINDS_SET,
  SPROUT_BINDS_READINGS
} sprout_binds;

typedef struct sprout_evaluated {
  sprout_binds binds;
  sprout_value value; /* SPROUT_BINDS_VALUE */
  sprout_str id;      /* SPROUT_BINDS_OBJECT: an object is its id, which is what identity compares */
  size_t count;
  const sprout_str *items; /* SPROUT_BINDS_SET: the ids; SPROUT_BINDS_READINGS: the typed lines */
} sprout_evaluated;

/* A name bound in a frame: a play's role, a `let`, or a narrowing. The newest is first. */
typedef struct sprout_binding {
  const char *name;
  sprout_evaluated bound;
  const struct sprout_binding *next;
} sprout_binding;

/* What ended an evaluation. */
typedef enum sprout_eval_status {
  SPROUT_EVAL_OK,
  SPROUT_EVAL_FAULT,     /* the turn is abandoned: see the frame's fault, and the meter for a budget */
  SPROUT_EVAL_ENGINE,    /* something the checker refuses reached the evaluator: the engine's defect */
  SPROUT_EVAL_NO_MEMORY
} sprout_eval_status;

/* A fault or an engine error in words: the rule broken, by name, and what happened. */
typedef struct sprout_eval_fault {
  const char *name; /* BudgetExhausted, IntegerOverflow, NameOutOfRange, DestroyedReference, LifecycleFault, Error */
  char text[480];
} sprout_eval_fault;

/* What a body is evaluated inside. */
typedef struct sprout_frame {
  const sprout_world *world;
  sprout_draft *draft;  /* the turn's state: a draft in a write turn, the committed state read through one in a poll */
  sprout_arena *turn;   /* scratch for the turn */
  sprout_meter *meter;
  sprout_draws *draws;  /* the turn's draws, or NULL where nothing draws */
  sprout_str self;      /* the object whose body this is: what `self` names, and whose memory `recall` reads */
  const char *library;  /* the library or world whose kind wrote the body, for a kind written without one */
  const sprout_binding *bindings;
  sprout_eval_fault *fault; /* filled when an evaluation returns SPROUT_EVAL_FAULT or SPROUT_EVAL_ENGINE */
  sprout_str hands;     /* a refusal's words: the acting visitor whose hands a range question sees into (the spec's Range), or none */
} sprout_frame;

sprout_evaluated sprout_evaluated_value(sprout_value value);
sprout_evaluated sprout_evaluated_object(sprout_str id);

/* The frame with `name` bound to `bound`, in the turn arena; NULL when the host refuses a page. */
const sprout_binding *sprout_bind(const sprout_frame *frame, const char *name, sprout_evaluated bound);

/* What `expr` evaluates to in `frame`. */
sprout_eval_status sprout_eval(const sprout_frame *frame, const sprout_node *expr, sprout_evaluated *out);

/*
 * What a name written as a statement's object, a lone identifier, stands for:
 * `self`, a binding, or what the name table says it reaches in range of
 * `self`. One step, as a binding written in an expression is.
 */
sprout_eval_status sprout_eval_ident(const sprout_frame *frame, const sprout_node *ident, sprout_evaluated *out);

/* A condition: an expression the checker typed as a boolean. */
sprout_eval_status sprout_eval_condition(const sprout_frame *frame, const sprout_node *expr, bool *out);

/*
 * Whether the branch a condition guards runs and, where it does, the frame it
 * runs in: each `name.is(K)` the condition holds by, alone or as an operand
 * of `&&`, over a name in a kind's body, binds the name to what it reaches
 * now, so a move inside the branch cannot change what it reaches.
 */
sprout_eval_status sprout_eval_branch(const sprout_frame *frame, const sprout_node *condition,
                                      bool *taken, sprout_frame *inner);

/*
 * The canonical form of a result, for goldens and for `sproutc eval`:
 * {"value":V} for a value (a list is an array), {"object":"id"}, {"set":[ids]}
 * or {"readings":[lines]}. In the turn arena, NUL-terminated.
 */
sprout_eval_status sprout_eval_show(const sprout_frame *frame, const sprout_evaluated *evaluated,
                                    const char **bytes, size_t *length);

struct sprout_json;

/* The same as a tree in the turn arena, for a caller that embeds it in a larger document. */
sprout_eval_status sprout_eval_node(const sprout_frame *frame, const sprout_evaluated *evaluated,
                                    struct sprout_json **out);

/* What a spawn made: the new instance and what its kinds gave it, each after what holds it. */
typedef struct sprout_spawned {
  sprout_str id;
  size_t count;
  const sprout_str *contents;
} sprout_spawned;

/*
 * Spawns an instance of the kind named `kind` (qualified) into `container` at
 * its defaults, with its contents (the spec's Spawning); `frame->self` is the
 * object whose body ran the `spawn`. Charged to spawns per turn, one for the
 * instance and one for each content. A fault writes nothing.
 */
sprout_eval_status sprout_spawn(const sprout_frame *frame, const char *kind, sprout_str container,
                                sprout_spawned *out);

/*
 * Gives `holder`, an instance made this turn that holds nothing yet, its own copy of everything its kinds' bodies
 * hold, as a spawn of its kind is given them (the spec's Actors and visitors); nothing is sent for any of them.
 * Faults, writing nothing, as a spawn does.
 */
sprout_eval_status sprout_give_contents(const sprout_frame *frame, sprout_str holder, sprout_spawned *out);

#endif
