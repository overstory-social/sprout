/*
 * `each` (the spec's Properties > Walking contents; The world model > Range).
 * `each x in c` visits what `c` directly holds, in its order, leaving out
 * whatever is out of range of `self`, so a shut chest seen from outside is
 * walked as holding nothing; a kind filter keeps only the contents composing
 * it. `each x of s` visits the members of a set role in the order the reading
 * bound them. What is walked is fixed before the first visit, so a move in
 * the body does not change it; each iteration is a step.
 */
#include "stmt.h"

sprout_eval_status stmt_each_walked(const sprout_frame *frame, const sprout_node *statement, const sprout_str **ids,
                                    size_t *count) {
  sprout_evaluated over;
  const sprout_node *filter = sprout_node_get(statement, "filter");
  sprout_str container;
  const sprout_str *seen;
  size_t seen_count, i, kept = 0;
  const sprout_kind_def *kind = NULL;
  sprout_str *found;
  EXPR_NEED(sprout_eval(frame, sprout_node_get(statement, "over"), &over));
  if (sprout_node_is(sprout_node_get(statement, "walks"), "of")) {
    if (over.binds != SPROUT_BINDS_SET)
      return expr_unchecked(frame, "`each ... of` walked what is not a set role");
    *ids = over.items;
    *count = over.count;
    return SPROUT_EVAL_OK;
  }
  if (over.binds != SPROUT_BINDS_OBJECT) return expr_unchecked(frame, "`each ... in` walked what is not a thing");
  EXPR_NEED(expr_as_object(frame, &over, &container));
  EXPR_NEED(expr_contents_seen(frame, container, &seen, &seen_count));
  if (filter != NULL && filter->kind != SPROUT_NODE_NULL) {
    kind = expr_kind_named(frame, filter);
    if (kind == NULL) return expr_unchecked(frame, "a kind that is not declared");
  }
  found = (sprout_str *)sprout_arena_take(frame->turn, (seen_count + 1) * sizeof *found);
  if (found == NULL) return SPROUT_EVAL_NO_MEMORY;
  for (i = 0; i < seen_count; i++) {
    const sprout_stored_instance *instance;
    EXPR_NEED(expr_instance_of(frame, seen[i], &instance));
    if (kind == NULL || expr_composes(instance->kind, kind->qualified)) found[kept++] = seen[i];
  }
  *ids = found;
  *count = kept;
  return SPROUT_EVAL_OK;
}

sprout_eval_status stmt_each(sprout_run *run, const sprout_frame *frame, const sprout_node *statement,
                             sprout_ended *ended) {
  const char *variable = expr_ident(statement, "variable");
  const sprout_str *ids;
  size_t count, i;
  EXPR_NEED(stmt_each_walked(frame, statement, &ids, &count));
  for (i = 0; i < count; i++) {
    sprout_frame inner = *frame;
    const sprout_binding *bound;
    EXPR_NEED(expr_spend(frame));
    bound = sprout_bind(frame, variable, sprout_evaluated_object(ids[i]));
    if (bound == NULL) return SPROUT_EVAL_NO_MEMORY;
    inner.bindings = bound;
    EXPR_NEED(stmt_block(run, &inner, sprout_node_get(statement, "body"), ended));
    if (ended->how != SPROUT_END_BODY || run->stopped != SPROUT_RUNNING) return SPROUT_EVAL_OK;
  }
  return SPROUT_EVAL_OK;
}
