/*
 * A wake turn (the spec's Time > Wakes; The runtime > Turns, Faults; The host contract > Time). One due wake
 * is delivered as a turn of its own: it comes off its object's list, the object is sent `:woke (elapsed)`, and
 * the queue drains from there. `elapsed` is the seconds since the wake was asked for, which may be more than
 * was asked. What the queue says is the turn's effects, then the place each person a handler moved arrived
 * in, as they read it; nobody acted, so they carry no actor. The seed is drawn from the host's seed, the
 * woken object's path and how many times it has woken in the step, so adding a clock leaves every other
 * object's draws as they were.
 *
 * A wake that faults is consumed and logged, not retried: the turn is abandoned like every write turn, and
 * then the wake alone is taken off its object's list, so the object is not woken again unless it asks. Which
 * wake to deliver, and when, is the host's; an instant before the wake is due is the host's defect.
 */
#include <string.h>

#include "../expr/expr.h"
#include "../schedule.h"
#include "../turn.h"

#define INTEGER_LIMIT 2147483647u

sprout_eval_status turn_without_wake(turn_run *run, sprout_str object, uint64_t serial) {
  const sprout_stored_instance *instance = sprout_draft_instance(&run->draft, object);
  sprout_stored_instance next;
  sprout_stored_wake *kept;
  size_t i, n = 0;
  if (instance == NULL) return SPROUT_EVAL_NO_MEMORY;
  if (sprout_stored_instance_copy(&run->scratch, instance, &next) != SPROUT_OK) return SPROUT_EVAL_NO_MEMORY;
  kept = (sprout_stored_wake *)sprout_arena_take(&run->scratch, (instance->wake_count + 1) * sizeof *kept);
  if (kept == NULL) return SPROUT_EVAL_NO_MEMORY;
  for (i = 0; i < instance->wake_count; i++)
    if (instance->wakes[i].serial != serial) kept[n++] = instance->wakes[i];
  next.wakes = kept;
  next.wake_count = n;
  return sprout_draft_write(&run->draft, &next) == SPROUT_DRAFT_OK ? SPROUT_EVAL_OK : SPROUT_EVAL_NO_MEMORY;
}

sprout_eval_status turn_deliver_wake(turn_run *run, sprout_str object, uint64_t serial, uint64_t elapsed) {
  sprout_send sent;
  EXPR_NEED(turn_without_wake(run, object, serial));
  memset(&sent, 0, sizeof sent);
  sent.message = SPROUT_MSG_WOKE;
  sent.recipient = object;
  sent.elapsed = (double)elapsed;
  EXPR_NEED(sprout_exec_queue(&run->x, &sent));
  return sprout_exec_drain(&run->x);
}

/* Takes the wake off its object's list in a turn of its own, which cannot fault but by the engine's own defect. */
static sprout_status consume(sprout_world *world, sprout_state *state, const sprout_host *host,
                             const sprout_turn_input *input, sprout_str object, uint64_t seed) {
  turn_run run;
  sprout_status status = turn_open(&run, world, state, host, SPROUT_TURN_WAKE, seed, input->instant, NULL, NULL);
  if (status != SPROUT_OK) return status;
  if (turn_without_wake(&run, object, input->serial) != SPROUT_EVAL_OK) status = SPROUT_FAULT;
  else status = turn_commit(&run);
  turn_drop(&run);
  return status;
}

sprout_status turn_wake(sprout_world *world, sprout_state *state, const sprout_host *host,
                        const sprout_turn_input *input, sprout_outcome *outcome) {
  sprout_due_wake pending;
  sprout_str object;
  turn_run run;
  sprout_frame frame;
  sprout_status status;
  sprout_eval_status eval;
  uint64_t seed, elapsed;
  if (input->object == NULL) return turn_refuse(outcome, "a wake names an object.", "", "");
  object.bytes = input->object;
  object.length = strlen(input->object);
  if (!schedule_pending(state, object, input->serial, &pending)) {
    status = turn_outcome_begin(host, outcome);
    if (status == SPROUT_OK) outcome->result = SPROUT_RESULT_IDLE;
    return status;
  }
  if (pending.due_at > input->instant)
    return turn_refuse(outcome, "the wake of `", input->object, "` is due later than the instant the host gave.");
  elapsed = input->instant - pending.asked_at;
  if (elapsed > INTEGER_LIMIT)
    return turn_refuse(outcome, "more seconds have passed since the wake of `", input->object, "` was asked than `elapsed` can carry.");
  seed = turn_seed_under(world, host->seed(host->ctx), object, input->nth);
  status = turn_outcome_begin(host, outcome);
  if (status != SPROUT_OK) return status;
  outcome->elapsed = elapsed;
  status = turn_open(&run, world, state, host, SPROUT_TURN_WAKE, seed, input->instant, NULL, NULL);
  if (status != SPROUT_OK) return turn_abort(outcome, status);
  frame = sprout_exec_frame(&run.x, object, NULL, NULL);
  {
    const sprout_arrived *arrivals = NULL;
    size_t arrival_count = 0;
    eval = turn_deliver_wake(&run, object, input->serial, elapsed);
    if (eval == SPROUT_EVAL_OK) eval = sprout_arrivals_read(&run.x, &frame, &arrivals, &arrival_count);
    if (eval == SPROUT_EVAL_OK) eval = sprout_lines_assembled(&run.x, NULL, 0, arrivals, arrival_count, NULL, 0);
    if (eval == SPROUT_EVAL_OK) eval = turn_render(&run, NULL, outcome);
  }
  if (eval == SPROUT_EVAL_NO_MEMORY) {
    turn_drop(&run);
    return turn_abort(outcome, SPROUT_NO_MEMORY);
  }
  if (eval == SPROUT_EVAL_OK) {
    status = turn_commit(&run);
    if (status != SPROUT_OK) return turn_abort(outcome, status);
    outcome->committed = outcome->state_changed = true;
    outcome->result = SPROUT_RESULT_DONE;
    turn_drop(&run);
  } else {
    turn_fault_of(&run, eval, outcome);
    outcome->line_count = outcome->effect_count = outcome->cut_count = 0;
    turn_drop(&run);
    /* Consumed and logged, not retried. */
    status = consume(world, state, host, input, object, seed);
    if (status != SPROUT_OK) return turn_abort(outcome, status);
    outcome->state_changed = true;
  }
  status = turn_log(&run, outcome, input->object, strlen(input->object));
  if (status != SPROUT_OK) return turn_abort(outcome, status);
  outcome->log.wake_serial = input->serial;
  return SPROUT_OK;
}
