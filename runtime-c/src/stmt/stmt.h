/*
 * What the statement modules share (the spec's Verbs, Properties, The world
 * model, Events, messages and the bus, Time): the state of one run of a
 * body, and the functions each statement area provides to exec.c. Each is a
 * function over a run and a frame, as the evaluator's are over a frame.
 */
#ifndef SPROUT_STMT_H
#define SPROUT_STMT_H

#include "../expr/expr.h"
#include "../exec.h"

/* Why a run stopped before its end: `self` is gone, or a `move` in it was refused. */
typedef enum sprout_stopped { SPROUT_RUNNING, SPROUT_STOPPED_GONE, SPROUT_STOPPED_REFUSED } sprout_stopped;

/* One run of a body: its mode, where its effects go, whether it asked to be destroyed, and why it stopped. */
typedef struct sprout_run {
  sprout_exec *x;
  sprout_body_mode mode;
  bool destroying;
  bool finally; /* it ran `finally destroy self`, which waits for the queue to empty */
  sprout_stopped stopped;
} sprout_run;

/* ---- exec.c ---- */

/* A block in a scope of its own: a `let` lives to its `}`. */
sprout_eval_status stmt_block(sprout_run *run, const sprout_frame *outer, const sprout_node *block, sprout_ended *ended);

/* ---- paths.c: the objects a statement names ---- */

/* The object a path in a statement names, read through in range: a binding, or what the name table says it reaches. */
sprout_eval_status stmt_object_at(const sprout_frame *frame, const sprout_node *path, sprout_str *out);
/* What a path evaluates to, an object or a set. One step. */
sprout_eval_status stmt_evaluated_at(const sprout_frame *frame, const sprout_node *path, sprout_evaluated *out);
/* A `move`'s destination: a binding, or what the name table says it reaches in range of the mover. */
sprout_eval_status stmt_destination_at(const sprout_frame *frame, const sprout_node *path, sprout_str *out);
/* A `send`'s target: a binding, or what the name reaches whatever its range; *found is false where it reaches nothing. */
sprout_eval_status stmt_target_at(const sprout_frame *frame, const sprout_node *path, sprout_str *out, bool *found);
/* The path as written, `kiln.shelf`, in the turn arena. */
sprout_eval_status stmt_written(const sprout_frame *frame, const sprout_node *path, const char **out);

/* ---- guards of a run ---- */

/* An acting statement in a body that decides, or a deciding one in a `do`, is the engine's defect. */
sprout_eval_status stmt_acting(const sprout_run *run, const sprout_frame *frame, const char *what);
sprout_eval_status stmt_deciding(const sprout_run *run, const sprout_frame *frame, const char *what);

/* ---- sends.c ---- */

/* A declared message's qualified name, the key its handlers and pass rules answer to. */
const char *stmt_message_key(const sprout_exec *x, const sprout_message *declared);

/* ---- speech.c: say, tell, refuse, text ---- */

/* The words a `say`, `tell` or `refuse` gives: a passage as `self`'s kind has it, or the words quoted. */
void stmt_speech_of(const sprout_frame *frame, const sprout_node *statement, sprout_speech *out);
sprout_eval_status stmt_say(sprout_run *run, const sprout_frame *frame, const sprout_node *statement);
sprout_eval_status stmt_tell(sprout_run *run, const sprout_frame *frame, const sprout_node *statement);

/* ---- write.c: a write to `self` ---- */

/* `self.set`, `adjust`, `add`, `remove` and `x.remember`, `adjust` on memory, written as a statement. */
sprout_eval_status stmt_write(sprout_run *run, const sprout_frame *frame, const sprout_node *statement);

/* ---- lifecycle.c: spawn, destroy ---- */

/* `spawn K in c`: the new instance, with what its kinds give it, and what a spawn tells the world queued. */
sprout_eval_status stmt_spawn(sprout_run *run, const sprout_frame *frame, const sprout_node *statement, sprout_str *id);
/* `destroy self`, `finally destroy self`: takes effect where the body ends. */
sprout_eval_status stmt_destroy(sprout_run *run, const sprout_frame *frame, const sprout_node *statement);
/* Removes `id` and what it holds now: what is queued to it is dropped by the bus. */
sprout_eval_status stmt_remove(sprout_exec *x, const sprout_frame *frame, sprout_str id);

/* ---- links.c ---- */

sprout_eval_status stmt_connect(sprout_run *run, const sprout_frame *frame, const sprout_node *statement);

/* ---- sends.c ---- */

sprout_eval_status stmt_send(sprout_run *run, const sprout_frame *frame, const sprout_node *statement);
sprout_eval_status stmt_broadcast(sprout_run *run, const sprout_frame *frame, const sprout_node *statement);

/* ---- propose.c: a move and an act ---- */

sprout_eval_status stmt_move(sprout_run *run, const sprout_frame *frame, const sprout_node *statement);
sprout_eval_status stmt_act(sprout_run *run, const sprout_frame *frame, const sprout_node *statement);

/* ---- each.c ---- */

/* What an `each` visits, in order, fixed before the first visit. */
sprout_eval_status stmt_each_walked(const sprout_frame *frame, const sprout_node *statement, const sprout_str **ids,
                                    size_t *count);
/* `each`: the body once for each thing walked, until one ends the body. */
sprout_eval_status stmt_each(sprout_run *run, const sprout_frame *frame, const sprout_node *statement,
                             sprout_ended *ended);

/* ---- extension.c ---- */

sprout_eval_status stmt_extension(sprout_run *run, const sprout_frame *frame, const sprout_node *statement);

#endif
