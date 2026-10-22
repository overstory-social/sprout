/*
 * The objects a statement names (the spec's Identifiers and scope; Verbs >
 * Moving something, Acting): a path is a binding, or an identifier or dotted
 * path the name table resolved. A spawn's container, a move's thing and an
 * act's roles are read through in range of `self`; a move's destination is
 * read under the move's own rule, which also reaches the destination of an
 * exit or a link of an actor's place; a send's target is read whatever its
 * range, since the send itself asks.
 */
#include <string.h>

#include "stmt.h"

sprout_eval_status stmt_written(const sprout_frame *frame, const sprout_node *path, const char **out) {
  const char *name = sprout_name(frame->graph, path);
  *out = name;
  if (name == NULL) return expr_unchecked(frame, "a path with no name");
  return SPROUT_EVAL_OK;
}

/* The unresolved path is the engine's defect: the checker resolves every name. */
static sprout_eval_status unresolved(const sprout_frame *frame, const char *written) {
  expr_text text = expr_text_begin(frame);
  expr_put(&text, "`");
  expr_put(&text, written);
  expr_put(&text, "` reached the runtime unresolved; the checker resolves it.");
  frame->fault->name = "Error";
  return SPROUT_EVAL_ENGINE;
}

/* Whether a path is one name rather than dotted steps. */
static bool lone(const sprout_graph *graph, const sprout_node *path) {
  const char *name = sprout_name(graph, path);
  return name != NULL && strchr(name, '.') == NULL;
}

sprout_eval_status stmt_evaluated_at(const sprout_frame *frame, const sprout_node *path, sprout_evaluated *out) {
  const char *written = NULL;
  const sprout_node *named;
  sprout_str reached;
  if (lone(frame->graph, path)) return sprout_eval_ident(frame, path, out);
  EXPR_NEED(expr_spend(frame));
  EXPR_NEED(stmt_written(frame, path, &written));
  named = sprout_world_bound(frame->world, path);
  if (named == NULL) return unresolved(frame, written);
  EXPR_NEED(expr_reached_by_name(frame, named, written, &reached));
  *out = sprout_evaluated_object(reached);
  return SPROUT_EVAL_OK;
}

sprout_eval_status stmt_object_at(const sprout_frame *frame, const sprout_node *path, sprout_str *out) {
  sprout_evaluated evaluated;
  EXPR_NEED(stmt_evaluated_at(frame, path, &evaluated));
  return expr_as_object(frame, &evaluated, out);
}

/* A lone name bound in the frame (`self` among them), spent as a step; *bound is false where nothing binds it. */
static sprout_eval_status binding_at(const sprout_frame *frame, const sprout_node *path, sprout_str *out, bool *bound) {
  const char *name = lone(frame->graph, path) ? sprout_name(frame->graph, path) : NULL;
  const sprout_binding *held = name == NULL ? NULL : expr_binding(frame, name);
  *bound = false;
  if (name == NULL || (held == NULL && strcmp(name, "self") != 0)) return SPROUT_EVAL_OK;
  EXPR_NEED(expr_spend(frame));
  *bound = true;
  if (held == NULL) {
    *out = frame->self;
    return SPROUT_EVAL_OK;
  }
  return expr_as_object(frame, &held->bound, out);
}

sprout_eval_status stmt_destination_at(const sprout_frame *frame, const sprout_node *path, sprout_str item,
                                       sprout_str *out) {
  bool bound, found, reached = false;
  const char *written = NULL;
  const sprout_node *named;
  EXPR_NEED(binding_at(frame, path, out, &bound));
  if (bound) return SPROUT_EVAL_OK;
  EXPR_NEED(expr_spend(frame));
  EXPR_NEED(stmt_written(frame, path, &written));
  named = sprout_world_bound(frame->world, path);
  if (named == NULL) return unresolved(frame, written);
  EXPR_NEED(expr_named_object(frame, named, out, &found));
  if (found && expr_live(frame, *out)) EXPR_NEED(sprout_move_reaches(frame, frame->self, (sprout_str){NULL, 0}, *out, &reached));
  if (found && !reached && sprout_move_would_roam(frame, frame->self, item, *out)) {
    expr_text text = expr_text_begin(frame);
    expr_put(&text, "`");
    expr_put_str(&text, *out);
    expr_put(&text, "` is out of range of `");
    expr_put_str(&text, frame->self);
    expr_put(&text, "`; a kind that `roams` may go there.");
    return expr_fail_on(frame, "NameOutOfRange", *out);
  }
  if (!found || !reached) return expr_name_out_of_range(frame, written, found, *out);
  return SPROUT_EVAL_OK;
}

sprout_eval_status stmt_target_at(const sprout_frame *frame, const sprout_node *path, sprout_str *out, bool *found) {
  const char *written = NULL;
  const sprout_node *named;
  EXPR_NEED(binding_at(frame, path, out, found));
  if (*found) return SPROUT_EVAL_OK;
  EXPR_NEED(expr_spend(frame));
  EXPR_NEED(stmt_written(frame, path, &written));
  named = sprout_world_bound(frame->world, path);
  if (named == NULL) return unresolved(frame, written);
  return expr_named_object(frame, named, out, found);
}
