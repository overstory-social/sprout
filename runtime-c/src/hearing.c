/*
 * Who reads what a body says (the spec's Verbs > Acting; Other people > Who
 * hears it). A person's reading is answered to the person; an NPC's is
 * heard from it by whoever would hear its `tell`, found where the NPC stands
 * when the line is said, since a `move` earlier in the same `do` may have
 * carried it somewhere else.
 */
#include <string.h>

#include "exec.h"

sprout_eval_status sprout_exec_hearers(const sprout_exec *x, const sprout_frame *frame, const sprout_str **to,
                                       size_t *count) {
  if (!x->hears_live) {
    *to = x->heard_by;
    *count = x->heard_count;
    return SPROUT_EVAL_OK;
  }
  return sprout_told_to(x, frame, x->speaker, SPROUT_TELL_PLACE, to, count);
}

sprout_eval_status sprout_record_refusal(sprout_exec *x, const sprout_frame *frame, const sprout_move_refusal *refusal) {
  sprout_effect effect;
  sprout_eval_status status;
  memset(&effect, 0, sizeof effect);
  effect.kind = SPROUT_EFFECT_REFUSED;
  status = sprout_exec_hearers(x, frame, &effect.to, &effect.to_count);
  if (status != SPROUT_EVAL_OK) return status;
  effect.by = refusal->by;
  effect.has_speaker = x->has_speaker;
  effect.speaker = x->speaker;
  effect.said = refusal->said;
  effect.bindings = refusal->bindings;
  effect.binding_count = refusal->binding_count;
  return sprout_exec_record(x, &effect);
}

sprout_eval_status sprout_hear_reading(sprout_exec *x, const sprout_frame *frame, sprout_str actor,
                                       const sprout_str *participants, size_t count, sprout_hearing *saved) {
  saved->heard_by = x->heard_by;
  saved->heard_count = x->heard_count;
  saved->left_out = x->left_out;
  saved->left_out_count = x->left_out_count;
  saved->has_speaker = x->has_speaker;
  saved->speaker = x->speaker;
  saved->records_as_said = x->records_as_said;
  saved->hears_live = x->hears_live;
  x->left_out = participants;
  x->left_out_count = count;
  x->records_as_said = true;
  if (sprout_is_person(frame, actor)) {
    sprout_str *to = (sprout_str *)sprout_arena_take(x->turn, sizeof *to);
    if (to == NULL) return SPROUT_EVAL_NO_MEMORY;
    *to = actor;
    x->heard_by = to;
    x->heard_count = 1;
    x->has_speaker = false;
    x->hears_live = false;
  } else {
    x->has_speaker = true;
    x->speaker = actor;
    x->hears_live = true;
  }
  return SPROUT_EVAL_OK;
}

void sprout_hearing_restore(sprout_exec *x, const sprout_hearing *saved) {
  x->heard_by = saved->heard_by;
  x->heard_count = saved->heard_count;
  x->left_out = saved->left_out;
  x->left_out_count = saved->left_out_count;
  x->has_speaker = saved->has_speaker;
  x->speaker = saved->speaker;
  x->records_as_said = saved->records_as_said;
  x->hears_live = saved->hears_live;
}
