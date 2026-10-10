/*
 * `move` and `act` (the spec's Verbs > Moving something, Acting). A `move` is
 * a proposal that the engine move a thing into a container through consent,
 * with the object whose body runs it as the mover; a refusal is said to
 * whoever the body speaks to, and ends the body. An `act` is a reading with
 * `self` as the actor and each named role filled, run on the spot through
 * the reading pass; a refused one ends the body, as a refused `move` does,
 * and so does one that destroyed the actor.
 */
#include "stmt.h"

sprout_eval_status stmt_move(sprout_run *run, const sprout_frame *frame, const sprout_node *statement) {
  sprout_str item, to;
  sprout_move_end end;
  sprout_move_refusal refusal;
  EXPR_NEED(stmt_acting(run, frame, "`move`"));
  EXPR_NEED(stmt_object_at(frame, sprout_node_get(statement, "thing"), &item));
  EXPR_NEED(stmt_destination_at(frame, sprout_node_get(statement, "destination"), &to));
  EXPR_NEED(sprout_move_instance(run->x, frame, frame->self, item, to, SPROUT_REACH_RANGE, NULL, &end, &refusal));
  if (end != SPROUT_MOVE_DONE) {
    EXPR_NEED(sprout_record_refusal(run->x, frame, &refusal));
    run->stopped = SPROUT_STOPPED_REFUSED;
  }
  return SPROUT_EVAL_OK;
}

sprout_eval_status stmt_act(sprout_run *run, const sprout_frame *frame, const sprout_node *statement) {
  const sprout_node *roles = sprout_node_get(statement, "roles");
  sprout_pending_role *filled;
  sprout_reading_end end;
  size_t i, count = roles == NULL ? 0 : roles->count;
  EXPR_NEED(stmt_acting(run, frame, "`act`"));
  filled = (sprout_pending_role *)sprout_arena_take(frame->turn, (count + 1) * sizeof *filled);
  if (filled == NULL) return SPROUT_EVAL_NO_MEMORY;
  for (i = 0; i < count; i++) {
    filled[i].role = expr_ident(roles->items[i], "role");
    EXPR_NEED(stmt_evaluated_at(frame, sprout_node_get(roles->items[i], "filler"), &filled[i].filler));
  }
  EXPR_NEED(run->x->reading(run->x, frame, frame->self, expr_ident(statement, "verb"), count, filled, &end));
  switch (end) {
    case SPROUT_READING_REFUSED:
      run->stopped = SPROUT_STOPPED_REFUSED;
      return SPROUT_EVAL_OK;
    case SPROUT_READING_GONE:
      run->stopped = SPROUT_STOPPED_GONE;
      return SPROUT_EVAL_OK;
    case SPROUT_READING_ACTED:
      break;
  }
  /* The reading may have destroyed the actor, and a body whose `self` is gone has nothing left to run for. */
  if (sprout_draft_instance(run->x->draft, frame->self) == NULL) run->stopped = SPROUT_STOPPED_GONE;
  return SPROUT_EVAL_OK;
}
