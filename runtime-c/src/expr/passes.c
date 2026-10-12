/*
 * Whether a container lets a question through to what it holds (the spec's
 * Range > Passing): the rule its kind writes for the message asked, else its
 * `pass any`, else true, except the world's, which refuses, and whose `pass
 * any` never answers for a move's notices, `:arrived` and `:departed`
 * (Places). A rule is an expression evaluated with the container as `self`,
 * and its steps are the turn's.
 */
#include "expr.h"

/*
 * The declaration `rule` of the pass a kind writes for `asking`, or NULL where it writes none that applies;
 * with `or_any` false, only a rule written for the message itself applies.
 */
static const sprout_node *resolved_pass(const sprout_graph *graph, const sprout_kind_def *kind, const char *asking,
                                        bool or_any) {
  const sprout_node *passes = sprout_node_get(graph, kind->node, "passes");
  const sprout_node *found = NULL;
  if (asking != NULL) found = sprout_node_map_find(graph, sprout_node_get(graph, passes, "messages"), asking);
  if (found == NULL && or_any) found = sprout_node_get(graph, passes, "any");
  return found == NULL || found->kind == SPROUT_NODE_NULL ? NULL : found;
}

sprout_eval_status expr_passes(const sprout_frame *frame, sprout_str container, const char *asking, bool *open) {
  const sprout_stored_instance *instance = expr_instance(frame, container);
  /* The world's `pass any` does not answer for a move's notices: they cross it only where it writes their own rule. */
  bool notice = asking != NULL && (strcmp(asking, "arrived") == 0 || strcmp(asking, "departed") == 0);
  bool own = notice && sprout_str_same(container, frame->draft->base->world);
  const sprout_node *written = instance == NULL ? NULL : resolved_pass(frame->graph, instance->kind, asking, !own);
  sprout_frame inside;
  const char *origin, *dot;
  char *library;
  size_t length;
  if (written == NULL) {
    *open = !sprout_str_same(container, frame->draft->base->world);
    return SPROUT_EVAL_OK;
  }
  /* The rule reads as its kind's body does: from the library that wrote it, with the container as `self`. */
  origin = sprout_node_text(frame->graph, written, "origin");
  dot = origin == NULL ? NULL : strchr(origin, '.');
  if (dot == NULL) return expr_unchecked(frame, "a pass rule whose origin is not a qualified name");
  length = (size_t)(dot - origin);
  library = sprout_arena_copy(frame->turn, origin, length);
  if (library == NULL) return SPROUT_EVAL_NO_MEMORY;
  inside = *frame;
  inside.self = container;
  inside.library = library;
  inside.bindings = NULL;
  inside.draws = NULL;
  inside.hands = (sprout_str){NULL, 0};
  return sprout_eval_condition(&inside, sprout_node_get(frame->graph, sprout_node_get(frame->graph, written, "declaration"), "rule"), open);
}
