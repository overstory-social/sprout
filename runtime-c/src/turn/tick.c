/*
 * A tick turn (the spec's Time > Ticks; The runtime > Turns, Faults; The host contract > Time). Each place
 * holding a visitor is ticked as a turn of its own: the place is sent `:tick (elapsed)`, and the queue drains
 * from there, so the tick reaches the place and no further unless the place sends onward. `elapsed` is the
 * seconds since the last tick the place received, and the turn records the instant it ran as that place's
 * last tick; a place that was skipped folds the missed interval in. What the queue says is the turn's effects,
 * then the place each person a handler moved arrived in, as they read it; nobody acted, so they carry no
 * actor. The seed is drawn from the host's seed and the place's path, so two places never draw alike.
 *
 * A tick that faults is dropped: abandoned like every write turn, so its place's last tick stays where it
 * was and the next tick's `elapsed` covers it, and nobody in the world is told, since nobody acted. How
 * often a place is ticked, and not ticking one whose last tick has not run, is the host's.
 */
#include <string.h>

#include "../expr/expr.h"
#include "../schedule.h"
#include "../turn.h"

#define INTEGER_LIMIT 2147483647u

sprout_status turn_tick(sprout_world *world, sprout_state *state, const sprout_host *host,
                        const sprout_turn_input *input, sprout_outcome *outcome) {
  const sprout_stored_instance *instance;
  sprout_str place;
  turn_run run;
  sprout_frame frame;
  sprout_status status;
  sprout_eval_status eval;
  uint64_t seed, elapsed = 0;
  if (input->place == NULL) return turn_refuse(outcome, "a tick names a place.", "", "");
  place.bytes = input->place;
  place.length = strlen(input->place);
  instance = sprout_state_find(state, place);
  if (instance == NULL) return turn_refuse(outcome, "`", input->place, "` is not in this world to be ticked.");
  if (instance->kind == NULL || !instance->kind->contains_actors)
    return turn_refuse(outcome, "`", input->place, "` holds no actors, so it is not a place and is not ticked.");
  if (instance->has_last_tick) {
    if (input->instant < instance->last_tick)
      return turn_refuse(outcome, "now is before the place's last tick, and time does not run backwards: `", input->place, "`.");
    elapsed = input->instant - instance->last_tick;
    if (elapsed > INTEGER_LIMIT)
      return turn_refuse(outcome, "more seconds have passed since the last tick of `", input->place, "` than `elapsed` can carry.");
  }
  seed = turn_seed_under(world, host->seed(host->ctx), place, 0);
  status = turn_outcome_begin(host, outcome);
  if (status != SPROUT_OK) return status;
  status = turn_open(&run, world, state, host, SPROUT_TURN_TICK, seed, input->instant, NULL, NULL);
  if (status != SPROUT_OK) return turn_abort(outcome, status);
  frame = sprout_exec_frame(&run.x, place, NULL, NULL);
  if (!schedule_occupied(state, place)) {
    turn_drop(&run);
    outcome->result = SPROUT_RESULT_IDLE;
    return SPROUT_OK;
  }
  outcome->elapsed = elapsed;
  {
    sprout_stored_instance next;
    sprout_send sent;
    const sprout_arrived *arrivals = NULL;
    size_t arrival_count = 0;
    eval = SPROUT_EVAL_OK;
    if (sprout_stored_instance_copy(&run.scratch, sprout_draft_instance(&run.draft, place), &next) != SPROUT_OK)
      eval = SPROUT_EVAL_NO_MEMORY;
    if (eval == SPROUT_EVAL_OK) {
      next.has_last_tick = true;
      next.last_tick = input->instant;
      if (sprout_draft_write(&run.draft, &next) != SPROUT_DRAFT_OK) eval = SPROUT_EVAL_NO_MEMORY;
    }
    memset(&sent, 0, sizeof sent);
    sent.message = SPROUT_MSG_TICK;
    sent.recipient = place;
    sent.elapsed = (double)elapsed;
    if (eval == SPROUT_EVAL_OK) eval = sprout_exec_queue(&run.x, &sent);
    if (eval == SPROUT_EVAL_OK) eval = sprout_exec_drain(&run.x);
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
  } else {
    turn_fault_of(&run, eval, outcome);
    outcome->line_count = outcome->effect_count = outcome->cut_count = 0;
  }
  turn_drop(&run);
  status = turn_log(&run, outcome, input->place, strlen(input->place));
  if (status != SPROUT_OK) return turn_abort(outcome, status);
  return SPROUT_OK;
}
