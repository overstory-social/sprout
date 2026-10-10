/*
 * The wakes an object holds (the spec's Time > Wakes; Limits > Runtime
 * budgets). A `wake` asks for one under the world's next serial, due no
 * sooner than the host's floor; one asked past the host's cap on pending
 * wakes faults, and nothing is charged while it waits. `cancel wakes` empties
 * the list, so what it held never arrives and no longer counts toward the
 * cap. An object's list is kept oldest first: by when each falls due, then by
 * the serial it was asked under. Nothing here reads a clock: every instant is
 * the one the host handed the turn.
 */
#include <string.h>

#include "stmt/stmt.h"

sprout_eval_status sprout_wake_ask(sprout_exec *x, const sprout_frame *frame, uint64_t seconds) {
  const sprout_stored_instance *self = expr_instance(frame, frame->self);
  sprout_limit cap = x->world->host.budgets.pending_wakes;
  sprout_stored_instance next;
  sprout_stored_wake wake, *wakes;
  uint64_t wait, serial;
  size_t i;
  expr_text text;
  if (self == NULL) {
    text = expr_text_begin(frame);
    expr_put(&text, "`");
    expr_put_str(&text, frame->self);
    expr_put(&text, "` is not here to be woken.");
    frame->fault->name = "Error";
    return SPROUT_EVAL_ENGINE;
  }
  if (cap.set && self->wake_count >= cap.value) {
    text = expr_text_begin(frame);
    expr_put(&text, "`");
    expr_put_str(&text, frame->self);
    expr_put(&text, "` asked for a wake with ");
    expr_put_number(&text, (double)self->wake_count);
    expr_put(&text, " pending, and this host allows ");
    expr_put_number(&text, (double)cap.value);
    expr_put(&text, ".");
    return expr_fail(frame, "WakeFault");
  }
  wait = sprout_wake_seconds(&x->world->host.budgets, seconds);
  if (sprout_draft_next_serial(x->draft, &serial) != SPROUT_DRAFT_OK) return SPROUT_EVAL_NO_MEMORY;
  wake.serial = serial;
  wake.asked_at = x->instant;
  wake.due_at = x->instant + wait;
  if (sprout_stored_instance_copy(x->turn, self, &next) != SPROUT_OK) return SPROUT_EVAL_NO_MEMORY;
  wakes = (sprout_stored_wake *)sprout_arena_take(x->turn, (self->wake_count + 1) * sizeof *wakes);
  if (wakes == NULL) return SPROUT_EVAL_NO_MEMORY;
  /* Insertion keeps the list oldest first. */
  for (i = self->wake_count; i > 0; i--) {
    const sprout_stored_wake *held = &self->wakes[i - 1];
    if (held->due_at < wake.due_at || (held->due_at == wake.due_at && held->serial < wake.serial)) break;
  }
  if (i > 0) memcpy(wakes, self->wakes, i * sizeof *wakes);
  wakes[i] = wake;
  if (self->wake_count > i) memcpy(wakes + i + 1, self->wakes + i, (self->wake_count - i) * sizeof *wakes);
  next.wakes = wakes;
  next.wake_count = self->wake_count + 1;
  return sprout_draft_write(x->draft, &next) == SPROUT_DRAFT_OK ? SPROUT_EVAL_OK : SPROUT_EVAL_NO_MEMORY;
}

sprout_eval_status sprout_wake_cancel(sprout_exec *x, const sprout_frame *frame) {
  const sprout_stored_instance *self = expr_instance(frame, frame->self);
  sprout_stored_instance next;
  expr_text text;
  if (self == NULL) {
    text = expr_text_begin(frame);
    expr_put(&text, "`");
    expr_put_str(&text, frame->self);
    expr_put(&text, "` is not here to cancel its wakes.");
    frame->fault->name = "Error";
    return SPROUT_EVAL_ENGINE;
  }
  if (self->wake_count == 0) return SPROUT_EVAL_OK;
  if (sprout_stored_instance_copy(x->turn, self, &next) != SPROUT_OK) return SPROUT_EVAL_NO_MEMORY;
  next.wake_count = 0;
  return sprout_draft_write(x->draft, &next) == SPROUT_DRAFT_OK ? SPROUT_EVAL_OK : SPROUT_EVAL_NO_MEMORY;
}
