/*
 * A maintenance turn: catch-up after an absence (the spec's Time > Absence; The runtime > Faults; The host
 * contract > Time). Run before an arriving visitor is admitted, it delivers every object's oldest due wake,
 * one per object, oldest first, under the one budget the turn has; a wake one of them asks for, and an
 * object's later due wakes, wait for live time. Catch-up does not narrate: what the wakes did is kept and
 * nothing they said is told.
 *
 * Each wake is a part of the turn, kept once it has run. A part that faults is abandoned and its wake
 * consumed, as any faulted wake is, and the catch-up goes on to the other objects' wakes, under the same
 * budget and on along the same stream of draws: what the faulted part drew stays drawn, so a replay from the
 * seed draws the same again. Once steps, events or the wall clock are spent, nothing more can run under the
 * budget, and the rest of the catch-up is abandoned, left pending for live time. The visitor is admitted either way.
 */
#include <string.h>

#include "../expr/expr.h"
#include "../schedule.h"
#include "../turn.h"

#define INTEGER_LIMIT 2147483647u

/* Whether the budget that faulted a part is one that the rest of the turn is charged to as well. */
static bool spent_for_the_turn(const sprout_meter *meter) {
  const char *budget = meter->fault.budget;
  return meter->faulted && budget != NULL &&
         (strcmp(budget, "steps") == 0 || strcmp(budget, "events") == 0 || strcmp(budget, "wall clock") == 0);
}

/* The wakes of one list kept as the entry names them, in the outcome's arena. */
typedef struct wake_list {
  sprout_logged_wake *items;
  size_t count, capacity;
} wake_list;

static bool wake_listed(sprout_arena *keep, wake_list *list, const sprout_due_wake *wake, const char *fault_name,
                        const char *fault_detail) {
  sprout_logged_wake *slot =
      (sprout_logged_wake *)sprout_exec_grow(keep, (void **)&list->items, &list->count, &list->capacity, sizeof *slot);
  sprout_str object;
  if (slot == NULL) return false;
  object.bytes = wake->object.bytes;
  object.length = wake->object.length;
  slot->object.bytes = sprout_arena_copy(keep, object.bytes, object.length);
  slot->object.length = object.length;
  slot->serial = wake->serial;
  slot->asked_at = wake->asked_at;
  slot->fault_name = fault_name;
  slot->fault_detail.bytes = "";
  if (fault_detail != NULL) {
    slot->fault_detail.length = strlen(fault_detail);
    slot->fault_detail.bytes = sprout_arena_copy(keep, fault_detail, slot->fault_detail.length);
    if (slot->fault_detail.bytes == NULL) return false;
  }
  return slot->object.bytes != NULL;
}

sprout_status turn_maintenance(sprout_world *world, sprout_state *state, const sprout_host *host,
                               const sprout_turn_input *input, sprout_outcome *outcome) {
  sprout_arena scratch;
  sprout_meter meter;
  sprout_draws draws;
  sprout_due_wake *due;
  size_t due_count, i, j, kept = 0;
  wake_list delivered, faulted, abandoned;
  uint64_t seed;
  sprout_status status;
  bool changed = false;
  sprout_arena *keep;
  memset(&delivered, 0, sizeof delivered);
  memset(&faulted, 0, sizeof faulted);
  memset(&abandoned, 0, sizeof abandoned);
  status = turn_outcome_begin(host, outcome);
  if (status != SPROUT_OK) return status;
  keep = turn_keep(outcome);
  status = sprout_arena_init(&scratch, host);
  if (status != SPROUT_OK) return turn_abort(outcome, status);
  seed = host->seed(host->ctx);
  /* Every part is charged to the one budget and draws from the one seed. */
  sprout_meter_begin(&meter, host, SPROUT_TURN_MAINTENANCE);
  status = sprout_draws_begin(&draws, seed);
  if (status == SPROUT_OK) status = schedule_due(&scratch, state, input->instant, &due, &due_count);
  if (status != SPROUT_OK) {
    sprout_arena_reset(&scratch);
    return turn_abort(outcome, status);
  }
  /* Each object's oldest. */
  for (i = 0; i < due_count; i++) {
    bool seen = false;
    for (j = 0; j < kept && !seen; j++) seen = sprout_str_same(due[j].object, due[i].object);
    if (!seen) due[kept++] = due[i];
  }
  due_count = kept;
  for (i = 0; i < due_count; i++) {
    sprout_due_wake wake;
    turn_run run;
    sprout_eval_status eval;
    uint64_t elapsed;
    bool lost = false;
    /* An earlier wake may have destroyed this one's object, or moved it out of the tree. */
    if (!schedule_pending(state, due[i].object, due[i].serial, &wake)) continue;
    elapsed = input->instant - wake.asked_at;
    if (elapsed > INTEGER_LIMIT) {
      sprout_arena_reset(&scratch);
      turn_refuse(outcome, "more seconds have passed since a wake was asked than `elapsed` can carry.", "", "");
      return turn_abort(outcome, SPROUT_BAD_INPUT);
    }
    status = turn_open(&run, world, state, host, SPROUT_TURN_MAINTENANCE, seed, input->instant, &meter, &draws);
    if (status != SPROUT_OK) {
      sprout_arena_reset(&scratch);
      return turn_abort(outcome, status);
    }
    eval = turn_deliver_wake(&run, wake.object, wake.serial, elapsed);
    if (eval == SPROUT_EVAL_OK) {
      status = turn_commit(&run);
      turn_drop(&run);
      if (status != SPROUT_OK) {
        sprout_arena_reset(&scratch);
        return turn_abort(outcome, status);
      }
      changed = true;
      if (!wake_listed(keep, &delivered, &wake, NULL, NULL)) lost = true;
    } else if (eval == SPROUT_EVAL_NO_MEMORY) {
      turn_drop(&run);
      sprout_arena_reset(&scratch);
      return turn_abort(outcome, SPROUT_NO_MEMORY);
    } else {
      sprout_outcome fault;
      const char *name, *detail;
      memset(&fault, 0, sizeof fault);
      turn_fault_of(&run, eval, &fault);
      name = fault.fault_name;
      detail = fault.fault.text;
      lost = !wake_listed(keep, &faulted, &wake, name, detail);
      turn_drop(&run);
      /* Consumed, and the catch-up goes on: a faulted part drew what it drew, and the stream stays where it is. */
      {
        turn_run again;
        bool exhausted = spent_for_the_turn(&meter);
        meter.faulted = exhausted;
        meter.cascade_depth = meter.passage_depth = 0;
        status = turn_open(&again, world, state, host, SPROUT_TURN_MAINTENANCE, seed, input->instant, &meter, &draws);
        if (status == SPROUT_OK) {
          if (turn_without_wake(&again, wake.object, wake.serial) != SPROUT_EVAL_OK) status = SPROUT_FAULT;
          else status = turn_commit(&again);
          turn_drop(&again);
        }
        if (status != SPROUT_OK) {
          sprout_arena_reset(&scratch);
          return turn_abort(outcome, status);
        }
        changed = true;
        if (exhausted) {
          for (j = i + 1; j < due_count && !lost; j++) {
            sprout_due_wake rest;
            if (schedule_pending(state, due[j].object, due[j].serial, &rest))
              lost = !wake_listed(keep, &abandoned, &rest, NULL, NULL);
          }
          i = due_count;
        }
      }
    }
    if (lost) {
      sprout_arena_reset(&scratch);
      return turn_abort(outcome, SPROUT_NO_MEMORY);
    }
  }
  sprout_arena_reset(&scratch);
  outcome->result = SPROUT_RESULT_DONE;
  outcome->committed = true;
  outcome->state_changed = changed;
  outcome->has_log = true;
  outcome->log.kind = SPROUT_TURN_MAINTENANCE;
  outcome->log.serial = state->serial;
  outcome->log.seed = seed;
  outcome->log.seconds = input->instant;
  outcome->log.delivered_count = delivered.count;
  outcome->log.delivered = delivered.items;
  outcome->log.faulted_count = faulted.count;
  outcome->log.faulted_wakes = faulted.items;
  outcome->log.abandoned_count = abandoned.count;
  outcome->log.abandoned = abandoned.items;
  return SPROUT_OK;
}
