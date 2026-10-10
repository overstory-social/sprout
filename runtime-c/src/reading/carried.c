/*
 * Carried roles (the spec's Verbs > Carried roles). A role marked `carried`
 * must be filled by something the actor holds, or holds what holds it, every
 * container strictly between letting it through. Before any `permit` the
 * engine refuses a carried role holding what the actor does not carry, in
 * the world's `not_carrying` given the thing, for a person and an NPC alike;
 * what a thing's own guard then says, `sprout.RequiresHeld` among them, is
 * the thing's.
 */
#include <string.h>

#include "../expr/expr.h"
#include "reading.h"

/* What holds `node` in the live tree; nothing for anything not live. */
static bool container_of(const sprout_frame *frame, sprout_str node, sprout_str *container) {
  const sprout_stored_instance *instance;
  if (!expr_live(frame, node)) return false;
  instance = expr_instance(frame, node);
  if (instance == NULL || !instance->has_container) return false;
  *container = instance->container;
  return true;
}

sprout_eval_status sprout_carries(const sprout_frame *frame, sprout_str asker, sprout_str target, bool *carried) {
  sprout_str node;
  bool have = container_of(frame, target, &node);
  *carried = false;
  while (have) {
    bool open;
    EXPR_NEED(expr_spend(frame));
    if (sprout_str_same(node, asker)) {
      *carried = true;
      return SPROUT_EVAL_OK;
    }
    EXPR_NEED(expr_passes(frame, node, NULL, &open));
    if (!open) return SPROUT_EVAL_OK;
    have = container_of(frame, node, &node);
  }
  return SPROUT_EVAL_OK;
}

/* The three names the engine's `not_carrying` renders with. */
static sprout_eval_status names_of(const sprout_frame *frame, sprout_str actor, sprout_str here, sprout_str thing,
                                   sprout_permit_refusal *out) {
  sprout_effect_binding *bound = (sprout_effect_binding *)sprout_arena_take(frame->turn, 3 * sizeof *bound);
  if (bound == NULL) return SPROUT_EVAL_NO_MEMORY;
  bound[0].name = "actor";
  bound[0].bound = sprout_evaluated_object(actor);
  bound[1].name = "here";
  bound[1].bound = sprout_evaluated_object(here);
  bound[2].name = "thing";
  bound[2].bound = sprout_evaluated_object(thing);
  out->refusal.bindings = bound;
  out->refusal.binding_count = 3;
  return SPROUT_EVAL_OK;
}

sprout_eval_status sprout_uncarried(sprout_exec *x, const sprout_frame *frame, const sprout_resolved *reading,
                                    bool *refused, sprout_permit_refusal *out) {
  const sprout_verb *verb = reading->verb;
  size_t i, j;
  (void)x;
  *refused = false;
  for (i = 0; i < verb->role_count; i++) {
    const sprout_filled *held = &reading->roles[i];
    const sprout_str *things = NULL;
    size_t count = 0;
    if (!verb->roles[i].carried || !held->filled) continue;
    if (held->bound.kind == SPROUT_BOUND_OBJECT) {
      things = &held->bound.object;
      count = 1;
    } else if (held->bound.kind == SPROUT_BOUND_SET) {
      things = held->bound.set;
      count = held->bound.set_count;
    }
    for (j = 0; j < count; j++) {
      bool carried;
      sprout_str here;
      EXPR_NEED(sprout_carries(frame, reading->actor, things[j], &carried));
      if (carried) continue;
      EXPR_NEED(sprout_place_of(frame, reading->actor, &here));
      memset(out, 0, sizeof *out);
      sprout_engine_said(frame, "not_carrying", &reading->actor, &here, &out->refusal.by, &out->refusal.said);
      out->role = verb->roles[i].name;
      *refused = true;
      return names_of(frame, reading->actor, here, things[j], out);
    }
  }
  return SPROUT_EVAL_OK;
}
