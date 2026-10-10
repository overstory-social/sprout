/*
 * A visitor going away (the spec's The world model > Actors and visitors: a visitor who leaves keeps their
 * state for a later visit and has no container while away; Places: leaving is the mirror of arriving). The
 * visitor's instance leaves the tree with everything it carries, and where they stood is kept for their next
 * arrival. No guard is asked, since a person is never held in a world; the place they left is sent `:left`,
 * its range reads `leaves` and is sent `:departed`, with the world as `to`, and the one leaving is told the
 * engine's `gone_away`. What it says is one sequence of effects: the words to the one leaving, the place's
 * `leaves`, then what the queue said.
 *
 * A departure that faults is abandoned like every write turn, and the visitor then goes away in a turn of
 * its own with nothing sent, as a faulted wake is consumed, so nobody is kept in by a world's fault; the one
 * leaving is still told so.
 */
#include <string.h>

#include "../expr/expr.h"
#include "../turn.h"

static sprout_eval_status drafted(sprout_draft_result result) {
  return result == SPROUT_DRAFT_OK ? SPROUT_EVAL_OK : SPROUT_EVAL_NO_MEMORY;
}

/* Takes the visitor out of the tree, keeping `from` as where they last stood, and records what they are told. */
static sprout_eval_status go_away(turn_run *run, const sprout_stored_visitor *record, sprout_str from) {
  sprout_frame frame = sprout_exec_frame(&run->x, record->instance, NULL, NULL);
  sprout_effect told;
  sprout_effect_binding *bound;
  sprout_str *to;
  sprout_stored_visitor put = *record;
  bool there = sprout_draft_instance(&run->draft, from) != NULL;
  memset(&told, 0, sizeof told);
  /* The line is about the one leaving, and then the place they left, where it is still there. */
  sprout_engine_said(&frame, "gone_away", &record->instance, there ? &from : NULL, &told.by, &told.said);
  to = (sprout_str *)sprout_arena_take(run->x.turn, sizeof *to);
  bound = (sprout_effect_binding *)sprout_arena_take(run->x.turn, sizeof *bound);
  if (to == NULL || bound == NULL) return SPROUT_EVAL_NO_MEMORY;
  *to = record->instance;
  bound->name = "actor";
  bound->bound = sprout_evaluated_object(record->instance);
  told.kind = SPROUT_EFFECT_NOTICE;
  told.to = to;
  told.to_count = 1;
  told.bindings = bound;
  told.binding_count = 1;
  EXPR_NEED(drafted(sprout_draft_place(&run->draft, record->instance, NULL)));
  put.has_last_place = true;
  put.last_place = from;
  EXPR_NEED(drafted(sprout_draft_put_visitor(&run->draft, &put)));
  return sprout_exec_record(&run->x, &told);
}

/* What the place they left sends and says of it, and the queue from there. */
static sprout_eval_status leave(turn_run *run, sprout_str visitor, sprout_str from) {
  sprout_frame frame = sprout_exec_frame(&run->x, visitor, NULL, NULL);
  sprout_str world = run->draft.base->world;
  sprout_send left;
  memset(&left, 0, sizeof left);
  left.message = SPROUT_MSG_LEFT;
  left.recipient = from;
  left.item = visitor;
  left.to = world;
  EXPR_NEED(sprout_exec_queue(&run->x, &left));
  EXPR_NEED(sprout_move_spoken(&run->x, &frame, true, from, visitor, world, NULL));
  return sprout_exec_drain(&run->x);
}

/* One attempt: the departure itself, or, where `quietly`, the visitor gone away with nothing sent. */
static sprout_eval_status attempt(turn_run *run, const sprout_stored_visitor *record, sprout_str from, bool place_stands,
                                  bool quietly, sprout_outcome *outcome) {
  sprout_str actor = record->instance;
  EXPR_NEED(go_away(run, record, from));
  if (place_stands && !quietly) EXPR_NEED(leave(run, record->instance, from));
  return turn_render(run, &actor, outcome);
}

sprout_status turn_departure(sprout_world *world, sprout_state *state, const sprout_host *host,
                             const sprout_turn_input *input, sprout_outcome *outcome) {
  const sprout_stored_visitor *record;
  const sprout_stored_instance *instance;
  sprout_stored_visitor held;
  sprout_str from;
  turn_run run;
  sprout_frame frame;
  sprout_status status;
  sprout_eval_status eval;
  bool place_stands;
  uint64_t seed;
  if (input->visit == NULL) return turn_refuse(outcome, "a departure names a visit.", "", "");
  record = turn_visitor(state, input->visit);
  if (record == NULL) return turn_refuse(outcome, "`", input->visit, "` has never visited this world.");
  instance = sprout_state_find(state, record->instance);
  if (instance == NULL || !instance->has_container)
    return turn_refuse(outcome, "`", input->visit, "` is not in this world to leave it.");
  status = turn_outcome_begin(host, outcome);
  if (status != SPROUT_OK) return status;
  /* The visitor's record and the place are copied out of the state's own memory before the draft opens. */
  if (sprout_stored_visitor_copy(turn_keep(outcome), record, &held) != SPROUT_OK ||
      !sprout_state_copy_str(turn_keep(outcome), instance->container, &from))
    return turn_abort(outcome, SPROUT_NO_MEMORY);
  seed = host->seed(host->ctx);
  status = turn_open(&run, world, state, host, SPROUT_TURN_DEPARTURE, seed, input->instant, NULL, NULL);
  if (status != SPROUT_OK) return turn_abort(outcome, status);
  frame = sprout_exec_frame(&run.x, held.instance, NULL, NULL);
  /* A place that is gone has nobody in range to tell. */
  place_stands = turn_is_place(&frame, from);
  eval = attempt(&run, &held, from, place_stands, false, outcome);
  if (eval == SPROUT_EVAL_NO_MEMORY) {
    turn_drop(&run);
    return turn_abort(outcome, SPROUT_NO_MEMORY);
  }
  if (eval == SPROUT_EVAL_OK) {
    status = turn_commit(&run);
    if (status != SPROUT_OK) return turn_abort(outcome, status);
    outcome->committed = outcome->state_changed = true;
    outcome->result = SPROUT_RESULT_DONE;
  } else {
    /* Abandoned; the visitor goes away in a turn of their own, so nobody is kept in by a world's fault. */
    turn_fault_of(&run, eval, outcome);
    outcome->line_count = outcome->effect_count = outcome->cut_count = 0;
    turn_drop(&run);
    status = turn_open(&run, world, state, host, SPROUT_TURN_DEPARTURE, seed, input->instant, NULL, NULL);
    if (status != SPROUT_OK) return turn_abort(outcome, status);
    eval = attempt(&run, &held, from, place_stands, true, outcome);
    if (eval == SPROUT_EVAL_OK) status = turn_commit(&run);
    if (eval != SPROUT_EVAL_OK || status != SPROUT_OK) {
      turn_drop(&run);
      return turn_abort(outcome, eval == SPROUT_EVAL_NO_MEMORY || status != SPROUT_OK ? SPROUT_NO_MEMORY : SPROUT_FAULT);
    }
    outcome->state_changed = true;
    outcome->result = SPROUT_RESULT_FAULTED;
  }
  turn_drop(&run);
  status = turn_log(&run, outcome, input->visit, strlen(input->visit));
  if (status != SPROUT_OK) return turn_abort(outcome, status);
  return SPROUT_OK;
}
