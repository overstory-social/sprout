/*
 * `move` and `act` (the spec's Verbs > Moving something, Acting). A `move` is
 * a proposal that the engine move a thing into a container through consent,
 * with the object whose body runs it as the mover; a refusal is said to
 * whoever the body speaks to, and ends the body. An `act` is a reading with
 * `self` as the actor and each named role filled; it is recorded for the
 * reading pass, which runs both its passes where the statement stands. The
 * reading pass is the readings' own, B28 on, so the body goes on after it.
 */
#include "stmt.h"

sprout_eval_status stmt_move(sprout_run *run, const sprout_frame *frame, const sprout_node *statement) {
  sprout_str item, to;
  sprout_move_end end;
  sprout_move_refusal refusal;
  EXPR_NEED(stmt_acting(run, frame, "`move`"));
  EXPR_NEED(stmt_object_at(frame, sprout_node_get(statement, "thing"), &item));
  EXPR_NEED(stmt_destination_at(frame, sprout_node_get(statement, "destination"), &to));
  EXPR_NEED(sprout_move_instance(run->x, frame, frame->self, item, to, &end, &refusal));
  if (end != SPROUT_MOVE_DONE) {
    sprout_effect effect;
    memset(&effect, 0, sizeof effect);
    effect.kind = SPROUT_EFFECT_REFUSED;
    effect.to = run->x->heard_by;
    effect.to_count = run->x->heard_count;
    effect.by = refusal.by;
    effect.has_speaker = run->x->has_speaker;
    effect.speaker = run->x->speaker;
    effect.said = refusal.said;
    effect.bindings = refusal.bindings;
    effect.binding_count = refusal.binding_count;
    EXPR_NEED(sprout_exec_record(run->x, &effect));
    run->stopped = SPROUT_STOPPED_REFUSED;
  }
  return SPROUT_EVAL_OK;
}

sprout_eval_status stmt_act(sprout_run *run, const sprout_frame *frame, const sprout_node *statement) {
  const sprout_node *roles = sprout_node_get(statement, "roles");
  sprout_pending_reading *reading;
  sprout_pending_role *filled;
  size_t i;
  EXPR_NEED(stmt_acting(run, frame, "`act`"));
  filled = (sprout_pending_role *)sprout_arena_take(frame->turn, ((roles == NULL ? 0 : roles->count) + 1) * sizeof *filled);
  if (filled == NULL) return SPROUT_EVAL_NO_MEMORY;
  for (i = 0; roles != NULL && i < roles->count; i++) {
    filled[i].role = expr_ident(roles->items[i], "role");
    EXPR_NEED(stmt_evaluated_at(frame, sprout_node_get(roles->items[i], "filler"), &filled[i].filler));
  }
  reading = (sprout_pending_reading *)sprout_exec_grow(run->x->turn, (void **)&run->x->readings, &run->x->reading_count,
                                                       &run->x->reading_capacity, sizeof *run->x->readings);
  if (reading == NULL) return SPROUT_EVAL_NO_MEMORY;
  reading->actor = frame->self;
  reading->verb = expr_ident(statement, "verb");
  reading->library = frame->library;
  reading->role_count = roles == NULL ? 0 : roles->count;
  reading->roles = filled;
  reading->after = run->x->effect_count;
  return SPROUT_EVAL_OK;
}
