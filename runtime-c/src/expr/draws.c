/*
 * `chance(n)`, true one time in n, and `random(n)`, from 0 to n - 1, drawn
 * from the turn's stream (the spec's Chance > The forms; The seed). A form
 * with no stream to draw from is the engine's defect: only an acting body
 * has one.
 */
#include "expr.h"

sprout_eval_status expr_drawn(const sprout_frame *frame, const sprout_node *expr, sprout_evaluated *out) {
  const char *name = expr_ident(frame->graph, expr, "name");
  const sprout_node *written = expr_argument_count(frame->graph, expr) == 1 ? expr_argument(frame->graph, expr, 0) : NULL;
  const sprout_node *number = sprout_node_get(frame->graph, written, "value");
  uint32_t drawn;
  if (name == NULL || written == NULL || expr_kind_of(frame->graph, written) != EXPR_INTEGER || number == NULL)
    return expr_unchecked(frame, "a draw given what is not one number written out");
  if (frame->draws == NULL) return expr_unchecked(frame, "a draw where nothing draws");
  if (sprout_node_number(frame->graph, number) < 1 || sprout_node_number(frame->graph, number) > 4294967296.0 ||
      !sprout_draws_below(frame->draws, (uint64_t)sprout_node_number(frame->graph, number), &drawn))
    return expr_unchecked(frame, "a draw below a number outside 1 to 2^32");
  if (strcmp(name, "chance") == 0) *out = sprout_evaluated_value(sprout_bool(drawn == 0));
  else if (strcmp(name, "random") == 0) *out = sprout_evaluated_value(sprout_number((double)drawn));
  else return expr_unchecked(frame, "a draw other than `chance` or `random`");
  return SPROUT_EVAL_OK;
}
