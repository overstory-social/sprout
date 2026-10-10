/*
 * Running one consent guard's body (the spec's Movement and consent > The
 * three roles, Guards are read-only; Limits > Runtime budgets). A guard ends
 * in `allow`, in `refuse`, or by reaching its end, which allows. Inside it
 * `self` is the party asked, `mover` whatever proposed the move, and the
 * parameters the objects the move names, positionally. A guard only reads, so
 * it can fault only as an expression can. A refusal carries the passage it
 * names, looked up on the refusing instance's kind at run time so that a
 * composer's own line replaces a library default, or the words it quoted.
 */
#include <string.h>

#include "stmt/stmt.h"

static sprout_eval_status wrong_count(const sprout_frame *frame, const char *guard, size_t wanted, size_t given) {
  expr_text text = expr_text_begin(frame);
  expr_put(&text, "`");
  expr_put(&text, guard);
  expr_put(&text, "` takes ");
  if (wanted == 1) {
    expr_put(&text, "one parameter");
  } else {
    expr_put_number(&text, (double)wanted);
    expr_put(&text, " parameters");
  }
  expr_put(&text, " and was given ");
  expr_put_number(&text, (double)given);
  expr_put(&text, ".");
  frame->fault->name = "Error";
  return SPROUT_EVAL_ENGINE;
}

sprout_eval_status sprout_guard_run(sprout_exec *x, const sprout_node *guard, sprout_str party, sprout_str mover,
                                    const sprout_str *parameters, size_t parameter_count, bool *allowed,
                                    sprout_move_refusal *refusal) {
  const sprout_node *declaration = sprout_node_get(guard, "declaration");
  const sprout_node *written = sprout_node_get(declaration, "parameters");
  const char *origin = sprout_node_text(guard, "origin"), *dot = origin == NULL ? NULL : strchr(origin, '.');
  const char *name = sprout_node_text(declaration, "guard");
  sprout_frame frame = sprout_exec_frame(x, party, NULL, NULL);
  sprout_ended ended;
  const sprout_binding *bound;
  char *library;
  size_t i;
  if (dot == NULL) return expr_unchecked(&frame, "a guard whose origin is not a qualified name");
  if ((written == NULL ? 0 : written->count) != parameter_count)
    return wrong_count(&frame, name, written == NULL ? 0 : written->count, parameter_count);
  library = sprout_arena_copy(x->turn, origin, (size_t)(dot - origin));
  if (library == NULL) return SPROUT_EVAL_NO_MEMORY;
  frame.library = library;
  bound = sprout_bind(&frame, "mover", sprout_evaluated_object(mover));
  if (bound == NULL) return SPROUT_EVAL_NO_MEMORY;
  frame.bindings = bound;
  for (i = 0; i < parameter_count; i++) {
    const char *parameter = written->items[i]->kind == SPROUT_NODE_NULL ? "_" : sprout_node_text(written->items[i], "text");
    if (parameter == NULL || strcmp(parameter, "_") == 0) continue;
    bound = sprout_bind(&frame, parameter, sprout_evaluated_object(parameters[i]));
    if (bound == NULL) return SPROUT_EVAL_NO_MEMORY;
    frame.bindings = bound;
  }
  EXPR_NEED(sprout_exec_body(x, sprout_node_get(declaration, "body"), &frame, SPROUT_BODY_DECIDE, &ended));
  if (ended.how != SPROUT_END_REFUSE) {
    *allowed = true;
    return SPROUT_EVAL_OK;
  }
  *allowed = false;
  memset(refusal, 0, sizeof *refusal);
  refusal->guard = name;
  refusal->origin = origin;
  refusal->by = party;
  refusal->said = ended.refused;
  return sprout_effect_names(&frame, &refusal->bindings, &refusal->binding_count);
}
