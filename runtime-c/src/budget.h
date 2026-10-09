/*
 * The budget meter (the spec's Limits > Runtime budgets). Every row of the
 * table is a field the host fills in sprout_budgets; a limit left unset is
 * unbounded, and the meter holds no figure of its own. Exhausting a budget
 * is a fault that names the budget, the host's figure and the index of the
 * message being run, and it is sticky: once faulted, every charge refuses.
 */
#ifndef SPROUT_BUDGET_H
#define SPROUT_BUDGET_H

#include "sprout.h"

typedef struct sprout_meter {
  const sprout_budgets *budgets;
  const sprout_host *host;
  sprout_turn_kind kind;
  uint64_t message; /* the index of the message being run */
  uint64_t steps, events, spawns, effects;
  uint64_t cascade_depth, passage_depth;
  bool faulted;
  sprout_fault fault;
} sprout_meter;

typedef enum sprout_output_result {
  SPROUT_OUTPUT_FITS,
  SPROUT_OUTPUT_CUT,  /* a recipient other than the actor is told nothing more this turn */
  SPROUT_OUTPUT_FAULT /* the actor's own output passed the budget: the turn faults */
} sprout_output_result;

/* Begins a turn's meter; a poll is charged to poll_steps, any other turn to steps. */
void sprout_meter_begin(sprout_meter *meter, const sprout_host *host, sprout_turn_kind kind);

/* Names the message now being run, so a fault can say which. */
void sprout_meter_message(sprout_meter *meter, uint64_t index);

/* Each charge returns false when it faults the turn. */
bool sprout_meter_steps(sprout_meter *meter, uint64_t count);
bool sprout_meter_event(sprout_meter *meter);
bool sprout_meter_spawn(sprout_meter *meter);
bool sprout_meter_effect(sprout_meter *meter);
bool sprout_meter_enter_cascade(sprout_meter *meter);
bool sprout_meter_enter_passage(sprout_meter *meter);
void sprout_meter_leave_cascade(sprout_meter *meter);
void sprout_meter_leave_passage(sprout_meter *meter);
/* A set role that binds this many objects. */
bool sprout_meter_set_role(sprout_meter *meter, uint64_t objects);
/* An object that would hold this many wakes pending. */
bool sprout_meter_pending_wakes(sprout_meter *meter, uint64_t pending);
/* The wall-clock backstop, read from the host's now. */
bool sprout_meter_clock(sprout_meter *meter);

/* Output to one recipient: `held` is what they have been given this turn. */
sprout_output_result sprout_meter_output(sprout_meter *meter, uint64_t *held, uint64_t characters,
                                         bool is_actor);

/* A wake asked for in `seconds` waits at least the host's shortest. */
uint64_t sprout_wake_seconds(const sprout_budgets *budgets, uint64_t seconds);

/* Held across turns or checked once, so refused rather than faulted. */
bool sprout_people_allowed(const sprout_budgets *budgets, uint64_t people_after);
bool sprout_nickname_allowed(const sprout_budgets *budgets, uint64_t characters);

#endif
