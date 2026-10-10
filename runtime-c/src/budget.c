/*
 * The meter. A budget is spent while a turn runs and is exhausted when a
 * charge takes it past the host's figure; with no figure it never is. The
 * fault text says what ran out, the host's figure and which message was
 * running, in words for whoever reads it.
 */
#include "budget.h"

#include <string.h>

typedef struct text {
  char *at;
  char *end;
} text;

/* The pieces of a fault's words; the longest unit and the widest numbers size sprout_fault.text. */
#define WORDS_BEFORE "This turn used more "
#define WORDS_AFTER_UNIT " than the host allows ("
#define WORDS_AFTER_LIMIT ") while running message "
#define WORDS_END ", so it was stopped and nothing it did was kept."
#define LONGEST_UNIT "levels of passage inside passage"
#define MAX_DIGITS 20 /* digits in UINT64_MAX */

_Static_assert(sizeof(((sprout_fault *)0)->text) >=
                   sizeof(WORDS_BEFORE) + sizeof(LONGEST_UNIT) + sizeof(WORDS_AFTER_UNIT) +
                       sizeof(WORDS_AFTER_LIMIT) + sizeof(WORDS_END) + 2 * MAX_DIGITS,
               "a fault's text must hold the longest message the budgets can produce");

static void put(text *out, const char *words) {
  while (*words != '\0' && out->at + 1 < out->end) *out->at++ = *words++;
  *out->at = '\0';
}

static void put_number(text *out, uint64_t number) {
  char digits[24];
  size_t count = 0;
  do {
    digits[count++] = (char)('0' + (int)(number % 10));
    number /= 10;
  } while (number > 0);
  while (count > 0) {
    char one[2] = {digits[--count], '\0'};
    put(out, one);
  }
}

void sprout_meter_begin(sprout_meter *meter, const sprout_host *host, sprout_turn_kind kind) {
  memset(meter, 0, sizeof *meter);
  meter->host = host;
  meter->budgets = &host->budgets;
  meter->kind = kind;
}

void sprout_meter_message(sprout_meter *meter, uint64_t index) { meter->message = index; }

static bool exhaust(sprout_meter *meter, const char *budget, const char *unit, uint64_t limit) {
  text out = {meter->fault.text, meter->fault.text + sizeof meter->fault.text};
  meter->faulted = true;
  meter->fault.budget = budget;
  meter->fault.limit = limit;
  meter->fault.message = meter->message;
  *out.at = '\0';
  put(&out, WORDS_BEFORE);
  put(&out, unit);
  put(&out, WORDS_AFTER_UNIT);
  put_number(&out, limit);
  put(&out, WORDS_AFTER_LIMIT);
  put_number(&out, meter->message);
  put(&out, WORDS_END);
  return false;
}

/*
 * Spends `count` of a budget held in `*spent`; false when that passes the
 * limit. The charge that passes it is recorded (saturating), as the
 * TypeScript meter records the step that went over, so a faulted turn reads
 * as having spent the figure and one more.
 */
static bool spend(sprout_meter *meter, uint64_t *spent, uint64_t count, sprout_limit limit,
                  const char *budget, const char *unit) {
  if (meter->faulted) return false;
  if (count > UINT64_MAX - *spent) {
    *spent = UINT64_MAX;
    return exhaust(meter, budget, unit, limit.value);
  }
  if (limit.set && *spent + count > limit.value) {
    *spent += count;
    return exhaust(meter, budget, unit, limit.value);
  }
  *spent += count;
  return true;
}

bool sprout_meter_steps(sprout_meter *meter, uint64_t count) {
  if (meter->kind == SPROUT_TURN_POLL)
    return spend(meter, &meter->steps, count, meter->budgets->poll_steps, "steps per poll", "steps");
  return spend(meter, &meter->steps, count, meter->budgets->steps, "steps", "steps");
}

bool sprout_meter_event(sprout_meter *meter) {
  return spend(meter, &meter->events, 1, meter->budgets->events, "events", "events");
}

bool sprout_meter_spawn(sprout_meter *meter) {
  return spend(meter, &meter->spawns, 1, meter->budgets->spawns, "spawns", "spawns");
}

bool sprout_meter_effect(sprout_meter *meter) {
  return spend(meter, &meter->effects, 1, meter->budgets->extension_effects, "effects",
               "effects from extensions");
}

bool sprout_meter_enter_cascade(sprout_meter *meter) {
  return spend(meter, &meter->cascade_depth, 1, meter->budgets->cascade_depth, "cascade depth",
               "levels of cascade");
}

bool sprout_meter_enter_passage(sprout_meter *meter) {
  return spend(meter, &meter->passage_depth, 1, meter->budgets->passage_depth, "passage depth",
               "levels of passage inside passage");
}

void sprout_meter_leave_cascade(sprout_meter *meter) {
  if (meter->cascade_depth > 0) meter->cascade_depth--;
}

void sprout_meter_leave_passage(sprout_meter *meter) {
  if (meter->passage_depth > 0) meter->passage_depth--;
}

bool sprout_meter_set_role(sprout_meter *meter, uint64_t objects) {
  uint64_t held = 0;
  return spend(meter, &held, objects, meter->budgets->set_role_objects, "objects bound by one set role",
               "objects bound by one set role");
}

bool sprout_meter_pending_wakes(sprout_meter *meter, uint64_t pending) {
  uint64_t held = 0;
  return spend(meter, &held, pending, meter->budgets->pending_wakes, "pending wakes",
               "pending wakes on one object");
}

bool sprout_meter_clock(sprout_meter *meter) {
  sprout_limit limit = meter->budgets->wall_clock_ms;
  if (meter->faulted) return false;
  if (!limit.set || meter->host->now == NULL) return true;
  if (meter->host->now(meter->host->ctx) > limit.value)
    return exhaust(meter, "wall clock", "milliseconds", limit.value);
  return true;
}

sprout_output_result sprout_meter_output(sprout_meter *meter, uint64_t *held, uint64_t characters,
                                         bool is_actor) {
  sprout_limit limit = meter->budgets->output;
  if (meter->faulted) return SPROUT_OUTPUT_FAULT;
  if (limit.set && (characters > limit.value || *held > limit.value - characters)) {
    if (!is_actor) return SPROUT_OUTPUT_CUT;
    exhaust(meter, "output", "characters of output", limit.value);
    return SPROUT_OUTPUT_FAULT;
  }
  *held += characters;
  return SPROUT_OUTPUT_FITS;
}

uint64_t sprout_wake_seconds(const sprout_budgets *budgets, uint64_t seconds) {
  if (budgets->shortest_wake_seconds.set && seconds < budgets->shortest_wake_seconds.value)
    return budgets->shortest_wake_seconds.value;
  return seconds;
}

bool sprout_people_allowed(const sprout_budgets *budgets, uint64_t people_after) {
  return !budgets->people_per_place.set || people_after <= budgets->people_per_place.value;
}

bool sprout_nickname_allowed(const sprout_budgets *budgets, uint64_t characters) {
  return !budgets->nickname_characters.set || characters <= budgets->nickname_characters.value;
}
