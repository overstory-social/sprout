/*
 * Planning an intent's steps (the spec's Parsing > Intents). Each step names
 * a verb and which slot fills each of its roles, and may carry a `when`;
 * planning reads the world as the visitor typed into it and writes nothing.
 */
#include <string.h>

#include "expr/expr.h"
#include "intents.h"

/* Whether `instance` may fill `role`: any thing an open role, one composing its kind a kind's. */
static bool fits(const sprout_role *role, const sprout_stored_instance *instance) {
  if (role->filler == SPROUT_FILLER_OPEN) return true;
  if (role->filler == SPROUT_FILLER_KIND) return expr_composes(instance->kind, role->filler_kind->qualified);
  return false;
}

/* The reading one step makes of what the slots hold; *made is false where a role it gives cannot be filled so. */
static sprout_eval_status reading_of(const sprout_frame *frame, const sprout_intended *intended,
                                     const sprout_intent_step *step, sprout_resolved *out, bool *made) {
  sprout_filled *roles = (sprout_filled *)sprout_arena_take(frame->turn, (step->verb->role_count + 1) * sizeof *roles);
  size_t i, j;
  if (roles == NULL) return SPROUT_EVAL_NO_MEMORY;
  *made = false;
  for (i = 0; i < step->filler_count; i++) {
    const sprout_filled *held = &intended->slots[step->filler_slots[i]];
    const sprout_stored_instance *thing = held->filled && held->bound.kind == SPROUT_BOUND_OBJECT
                                              ? expr_instance(frame, held->bound.object)
                                              : NULL;
    for (j = 0; j < step->verb->role_count && strcmp(step->verb->roles[j].name, step->filler_roles[i]) != 0; j++) {}
    if (j == step->verb->role_count) return expr_engine(frame, "an intent's step fills a role its verb does not declare.");
    if (thing == NULL || !fits(&step->verb->roles[j], thing)) return SPROUT_EVAL_OK;
    roles[j] = *held;
  }
  out->verb = step->verb;
  out->actor = intended->actor;
  out->roles = roles;
  *made = true;
  return SPROUT_EVAL_OK;
}

/* Whether `step`'s `when` holds now; one it cannot read, a name out of range or destroyed, does not. */
static sprout_eval_status holds(const sprout_frame *frame, const sprout_intended *intended, const sprout_intent_step *step,
                                bool *out) {
  const sprout_intent *intent = intended->intent;
  const sprout_stored_instance *actor = expr_instance(frame, intended->actor);
  sprout_frame at = *frame;
  const sprout_binding *bound;
  sprout_eval_status status;
  size_t i;
  *out = true;
  if (step->when == NULL || step->when->kind == SPROUT_NODE_NULL) return SPROUT_EVAL_OK;
  at.self = intended->actor;
  at.library = intent->library;
  at.bindings = NULL;
  bound = sprout_bind(&at, "actor", sprout_evaluated_object(intended->actor));
  if (bound == NULL) return SPROUT_EVAL_NO_MEMORY;
  at.bindings = bound;
  if (actor != NULL && actor->has_container) {
    bound = sprout_bind(&at, "here", sprout_evaluated_object(actor->container));
    if (bound == NULL) return SPROUT_EVAL_NO_MEMORY;
    at.bindings = bound;
  }
  for (i = 0; i < intent->slot_count; i++) {
    if (!intended->slots[i].filled || intended->slots[i].bound.kind != SPROUT_BOUND_OBJECT) continue;
    bound = sprout_bind(&at, intent->slots[i], sprout_evaluated_object(intended->slots[i].bound.object));
    if (bound == NULL) return SPROUT_EVAL_NO_MEMORY;
    at.bindings = bound;
  }
  status = sprout_eval_condition(&at, step->when, out);
  if (status == SPROUT_EVAL_FAULT &&
      (strcmp(frame->fault->name, "NameOutOfRange") == 0 || strcmp(frame->fault->name, "DestroyedReference") == 0)) {
    *out = false;
    return SPROUT_EVAL_OK;
  }
  return status;
}

sprout_eval_status sprout_plan_intent(const sprout_frame *frame, const sprout_intended *intended,
                                      const sprout_resolved **planned, size_t *count) {
  const sprout_intent *intent = intended->intent;
  sprout_resolved *found = (sprout_resolved *)sprout_arena_take(frame->turn, (intent->step_count + 1) * sizeof *found);
  size_t i, n = 0;
  if (found == NULL) return SPROUT_EVAL_NO_MEMORY;
  for (i = 0; i < intent->step_count; i++) {
    sprout_resolved reading;
    bool made, allowed;
    EXPR_NEED(reading_of(frame, intended, &intent->steps[i], &reading, &made));
    if (!made) continue;
    EXPR_NEED(holds(frame, intended, &intent->steps[i], &allowed));
    if (allowed) found[n++] = reading;
  }
  *planned = found;
  *count = n;
  return SPROUT_EVAL_OK;
}
