/*
 * Whether a place is lit (the spec's Range > Sight; Places). A place's `lit` is asked as an exit's
 * `when` is, in the library of the kind that wrote it with `self` the place: a place that writes
 * none is lit, and a condition that reads through a name out of range, or to a declared object
 * destroyed, does not hold.
 */
#include "describe.h"
#include "exits.h"
#include "expr/expr.h"

sprout_eval_status sprout_is_lit(const sprout_frame *frame, sprout_str place, bool *lit) {
  const sprout_stored_instance *instance = expr_instance(frame, place);
  const sprout_node *line =
      instance == NULL ? NULL : sprout_node_get(sprout_node_get(instance->kind->node, "grammar"), "lit");
  sprout_frame at = *frame;
  sprout_eval_status status;
  *lit = true;
  if (line == NULL || line->kind == SPROUT_NODE_NULL) return SPROUT_EVAL_OK;
  EXPR_NEED(sprout_origin_library(frame, sprout_node_text(line, "origin"), &at.library));
  at.self = place;
  at.bindings = NULL;
  status = sprout_eval_condition(&at, sprout_node_get(sprout_node_get(line, "value"), "condition"), lit);
  if (sprout_reads_nothing(frame, status)) {
    *lit = false;
    return SPROUT_EVAL_OK;
  }
  return status;
}

sprout_eval_status sprout_in_the_dark(const sprout_frame *frame, sprout_str actor, bool *dark) {
  const sprout_stored_instance *instance = expr_instance(frame, actor);
  bool lit;
  *dark = false;
  if (instance == NULL || !instance->has_container) return SPROUT_EVAL_OK;
  EXPR_NEED(sprout_is_lit(frame, instance->container, &lit));
  *dark = !lit;
  return SPROUT_EVAL_OK;
}
