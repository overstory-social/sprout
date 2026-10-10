/*
 * Submitting a reading (the spec's The host contract, The runtime > Turns,
 * Effects). A host that has already read a typed line, or built a reading
 * from the view's chips, hands the verb, the actor and what fills each role
 * by id. The reading runs through the consent pass and the effect pass
 * against a draft of the stored world, the queue its bodies filled is
 * drained, and a reading that was not abandoned commits the draft. Nothing
 * here reads text, and nothing is rendered: what the turn said comes back as
 * the lines it recorded.
 */
#include <string.h>

#include "draft.h"
#include "draws.h"
#include "outcome.h"
#include "reading/reading.h"
#include "world.h"

/* What an outcome holds: its own arena, and the host that backs it. */
typedef struct held {
  sprout_host host;
  sprout_arena anchor, arena;
} held;

static void problem(sprout_reading_outcome *outcome, const char *before, const char *name, const char *after) {
  size_t room = sizeof outcome->fault.text, used = 0;
  const char *parts[3];
  size_t i;
  parts[0] = before;
  parts[1] = name;
  parts[2] = after;
  for (i = 0; i < 3; i++) {
    size_t n = strlen(parts[i]);
    if (n > room - used - 1) n = room - used - 1;
    memcpy(outcome->fault.text + used, parts[i], n);
    used += n;
  }
  outcome->fault.text[used] = '\0';
}

/* The verb `library.name`, or NULL. */
static const sprout_verb *verb_of(const sprout_world *world, const char *qualified) {
  const char *dot = strchr(qualified, '.');
  size_t i;
  if (dot == NULL) return NULL;
  for (i = 0; i < world->verb_count; i++) {
    const sprout_verb *verb = world->verbs[i];
    if (strlen(verb->library) == (size_t)(dot - qualified) && memcmp(verb->library, qualified, (size_t)(dot - qualified)) == 0 &&
        strcmp(verb->name, dot + 1) == 0)
      return verb;
  }
  return NULL;
}

static sprout_str str_of(const char *text) {
  sprout_str str;
  str.bytes = text;
  str.length = strlen(text);
  return str;
}

/* Whether the draft decodes an instance under `id`. */
static bool is_instance(const sprout_draft *draft, const char *id) {
  return sprout_draft_instance(draft, str_of(id)) != NULL;
}

static sprout_status filled_from(const sprout_draft *draft, sprout_arena *turn, const sprout_role *role,
                                 const sprout_filling *filling, sprout_filled *out, sprout_reading_outcome *outcome) {
  size_t i;
  memset(out, 0, sizeof *out);
  if (filling->binds == SPROUT_FILL_UNBOUND) return SPROUT_OK;
  out->filled = true;
  switch (filling->binds) {
    case SPROUT_FILL_OBJECT:
      out->bound.kind = SPROUT_BOUND_OBJECT;
      if (filling->id == NULL || !is_instance(draft, filling->id)) {
        problem(outcome, "`", filling->id == NULL ? "" : filling->id, "` is not an instance of this world.");
        return SPROUT_BAD_INPUT;
      }
      out->bound.object = str_of(filling->id);
      break;
    case SPROUT_FILL_SET:
      out->bound.kind = SPROUT_BOUND_SET;
      out->bound.set = (sprout_str *)sprout_arena_take(turn, (filling->id_count + 1) * sizeof *out->bound.set);
      if (out->bound.set == NULL) return SPROUT_NO_MEMORY;
      for (i = 0; i < filling->id_count; i++) {
        if (!is_instance(draft, filling->ids[i])) {
          problem(outcome, "`", filling->ids[i], "` is not an instance of this world.");
          return SPROUT_BAD_INPUT;
        }
        out->bound.set[i] = str_of(filling->ids[i]);
      }
      out->bound.set_count = filling->id_count;
      break;
    case SPROUT_FILL_EXIT:
      out->bound.kind = SPROUT_BOUND_EXIT;
      if (filling->id == NULL || filling->label == NULL || !is_instance(draft, filling->id)) {
        problem(outcome, "an exit of `", role->name, "` needs a label and a place that is an instance of this world.");
        return SPROUT_BAD_INPUT;
      }
      out->bound.has_direction = filling->direction != NULL;
      if (filling->direction != NULL) out->bound.direction = str_of(filling->direction);
      out->bound.label = str_of(filling->label);
      out->bound.to = str_of(filling->id);
      break;
    case SPROUT_FILL_TEXT:
      out->bound.kind = SPROUT_BOUND_VALUE;
      out->bound.value_is_string = true;
      out->bound.value_string = str_of(filling->text == NULL ? "" : filling->text);
      break;
    case SPROUT_FILL_NUMBER:
      out->bound.kind = SPROUT_BOUND_VALUE;
      out->bound.value_number = filling->number;
      break;
    case SPROUT_FILL_UNBOUND:
      break;
  }
  if (out->bound.kind != sprout_role_takes(role)) {
    problem(outcome, "`", role->name, "` is not filled with what its verb takes there.");
    return SPROUT_BAD_INPUT;
  }
  return SPROUT_OK;
}

static sprout_status resolve(const sprout_world *world, const sprout_draft *draft, sprout_arena *turn,
                             const sprout_reading *reading, sprout_resolved *out, sprout_reading_outcome *outcome) {
  const sprout_verb *verb = verb_of(world, reading->verb);
  sprout_filled *roles;
  size_t i, j;
  if (verb == NULL) {
    problem(outcome, "no verb is named `", reading->verb, "`.");
    return SPROUT_BAD_INPUT;
  }
  if (!is_instance(draft, reading->actor)) {
    problem(outcome, "`", reading->actor, "` is not an instance of this world.");
    return SPROUT_BAD_INPUT;
  }
  roles = (sprout_filled *)sprout_arena_take(turn, (verb->role_count + 1) * sizeof *roles);
  if (roles == NULL) return SPROUT_NO_MEMORY;
  for (i = 0; i < reading->filling_count; i++) {
    sprout_status status;
    for (j = 0; j < verb->role_count && strcmp(verb->roles[j].name, reading->fillings[i].role) != 0; j++) {}
    if (j == verb->role_count) {
      problem(outcome, "`", verb->name, "` has no such role to fill.");
      return SPROUT_BAD_INPUT;
    }
    status = filled_from(draft, turn, &verb->roles[j], &reading->fillings[i], &roles[j], outcome);
    if (status != SPROUT_OK) return status;
  }
  out->verb = verb;
  out->actor = str_of(reading->actor);
  out->roles = roles;
  return SPROUT_OK;
}

/* A fault, or an engine error, in the sentence a host logs; the world is as it was. */
static void fault_of(const sprout_meter *meter, const sprout_eval_fault *fault, sprout_eval_status status,
                     sprout_reading_outcome *outcome) {
  outcome->faulted = true;
  if (meter->faulted) {
    outcome->fault = meter->fault;
    return;
  }
  outcome->fault.budget = fault->name;
  outcome->fault.limit = 0;
  outcome->fault.message = meter->message;
  strncpy(outcome->fault.text, fault->text, sizeof outcome->fault.text - 1);
  (void)status;
}

/* The outcome's JSON, written into the outcome's own arena. */
static sprout_status write_outcome(sprout_exec *x, const sprout_frame *frame, sprout_reading_end end,
                                   const sprout_permit_refusal *refusal, held *keep, sprout_reading_outcome *outcome) {
  sprout_json *tree;
  sprout_status status;
  if (sprout_outcome_effects(x, frame, &tree) != SPROUT_EVAL_OK) return SPROUT_NO_MEMORY;
  status = sprout_json_write(&keep->arena, tree, &outcome->effects, &outcome->effects_length);
  if (status != SPROUT_OK) return status;
  if (end != SPROUT_READING_REFUSED) return SPROUT_OK;
  if (sprout_outcome_refusal(frame, refusal, &tree) != SPROUT_EVAL_OK) return SPROUT_NO_MEMORY;
  return sprout_json_write(&keep->arena, tree, &outcome->refused, &outcome->refused_length);
}

void sprout_reading_outcome_free(sprout_reading_outcome *outcome) {
  held *keep;
  sprout_arena anchor, data;
  sprout_host host;
  if (outcome == NULL || outcome->held == NULL) return;
  keep = (held *)outcome->held;
  host = keep->host;
  anchor = keep->anchor;
  data = keep->arena;
  anchor.host = &host;
  data.host = &host;
  sprout_arena_reset(&data);
  sprout_arena_reset(&anchor);
  memset(outcome, 0, sizeof *outcome);
}

static held *keep_for(const sprout_host *host) {
  sprout_arena boot;
  held *keep;
  if (sprout_arena_init(&boot, host) != SPROUT_OK) return NULL;
  keep = (held *)sprout_arena_take(&boot, sizeof *keep);
  if (keep == NULL) {
    sprout_arena_reset(&boot);
    return NULL;
  }
  keep->host = *host;
  keep->anchor = boot;
  keep->anchor.host = &keep->host;
  sprout_arena_init(&keep->arena, &keep->host);
  return keep;
}

sprout_status sprout_reading_run(sprout_world *world, sprout_state *state, const sprout_reading *reading,
                                 uint64_t instant, sprout_reading_outcome *outcome) {
  sprout_arena turn;
  sprout_draft draft;
  sprout_meter meter;
  sprout_draws draws;
  sprout_exec x;
  sprout_eval_fault fault;
  sprout_resolved resolved;
  sprout_permit_refusal refusal;
  sprout_reading_end end = SPROUT_READING_ACTED;
  sprout_changes changes;
  sprout_frame frame;
  sprout_eval_status run;
  sprout_status status;
  held *keep;
  if (outcome == NULL) return SPROUT_BAD_HOST;
  memset(outcome, 0, sizeof *outcome);
  if (world == NULL || state == NULL || reading == NULL) return SPROUT_BAD_INPUT;
  status = sprout_arena_init(&turn, &world->host);
  if (status != SPROUT_OK) return status;
  memset(&refusal, 0, sizeof refusal);
  memset(&fault, 0, sizeof fault);
  if (sprout_draft_open(&draft, &turn, world, state) != SPROUT_DRAFT_OK) status = SPROUT_NO_MEMORY;
  if (status == SPROUT_OK) status = world->host.seed == NULL ? SPROUT_BAD_HOST : sprout_draws_begin(&draws, world->host.seed(world->host.ctx));
  if (status == SPROUT_OK) status = resolve(world, &draft, &turn, reading, &resolved, outcome);
  if (status != SPROUT_OK) {
    sprout_arena_reset(&turn);
    return status;
  }
  sprout_meter_begin(&meter, &world->host, SPROUT_TURN_COMMAND);
  sprout_exec_begin(&x, world, &draft, &turn, &meter, &draws, &fault, instant);
  frame = sprout_exec_frame(&x, resolved.actor, NULL, NULL);
  run = sprout_perform(&x, &frame, &resolved, &end, &refusal);
  if (run == SPROUT_EVAL_OK && end != SPROUT_READING_REFUSED) run = sprout_exec_drain(&x);
  if (run == SPROUT_EVAL_NO_MEMORY) {
    sprout_arena_reset(&turn);
    return SPROUT_NO_MEMORY;
  }
  if (run != SPROUT_EVAL_OK) {
    fault_of(&meter, &fault, run, outcome);
    sprout_arena_reset(&turn);
    return SPROUT_FAULT;
  }
  keep = keep_for(&world->host);
  if (keep == NULL) {
    sprout_arena_reset(&turn);
    return SPROUT_NO_MEMORY;
  }
  outcome->held = keep;
  outcome->end = (sprout_read_end)end;
  status = write_outcome(&x, &frame, end, &refusal, keep, outcome);
  if (status == SPROUT_OK && sprout_draft_commit(&draft, &changes) != SPROUT_DRAFT_OK) status = SPROUT_NO_MEMORY;
  sprout_arena_reset(&turn);
  if (status != SPROUT_OK) sprout_reading_outcome_free(outcome);
  return status;
}
