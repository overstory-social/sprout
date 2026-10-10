/*
 * The operators (the spec's The type system > What the compiler checks;
 * Precedence): `!` and `-`, the comparisons, `==` and `!=`, `+` and `-`, and
 * `||`, which decides from its left where it can and leaves its right
 * unevaluated. There is no truthiness and no coercion; the checker has typed
 * every operand, so reading one as what it is not is an engine error. A `+`
 * or `-` that leaves the integer range faults (the spec's The types).
 */
#include "expr.h"

#define INTEGER_MIN (-2147483648.0)
#define INTEGER_MAX 2147483647.0

sprout_eval_status expr_as_value(const sprout_frame *frame, const sprout_evaluated *evaluated, sprout_value *out) {
  if (evaluated->binds != SPROUT_BINDS_VALUE) {
    const char *what = evaluated->binds == SPROUT_BINDS_OBJECT ? "an object"
                       : evaluated->binds == SPROUT_BINDS_SET  ? "a set"
                                                               : "readings";
    expr_text text = expr_text_begin(frame);
    expr_put(&text, what);
    expr_put(&text, " read as a value reached the evaluator, which the checker refuses.");
    frame->fault->name = "Error";
    return SPROUT_EVAL_ENGINE;
  }
  *out = evaluated->value;
  return SPROUT_EVAL_OK;
}

sprout_eval_status expr_as_boolean(const sprout_frame *frame, const sprout_evaluated *evaluated, bool *out) {
  sprout_value value;
  EXPR_NEED(expr_as_value(frame, evaluated, &value));
  if (value.kind != SPROUT_BOOL) return expr_unchecked(frame, "a value read as true or false");
  *out = value.as.boolean;
  return SPROUT_EVAL_OK;
}

sprout_eval_status expr_as_integer(const sprout_frame *frame, const sprout_evaluated *evaluated, double *out) {
  sprout_value value;
  EXPR_NEED(expr_as_value(frame, evaluated, &value));
  if (value.kind != SPROUT_NUMBER) return expr_unchecked(frame, "a value read as a number");
  *out = value.as.number;
  return SPROUT_EVAL_OK;
}

sprout_eval_status expr_as_object(const sprout_frame *frame, const sprout_evaluated *evaluated, sprout_str *out) {
  if (evaluated->binds != SPROUT_BINDS_OBJECT) return expr_unchecked(frame, "something that is not an object read as an object");
  *out = evaluated->id;
  return SPROUT_EVAL_OK;
}

sprout_eval_status expr_as_list(const sprout_frame *frame, const sprout_evaluated *evaluated, const sprout_list **out) {
  sprout_value value;
  EXPR_NEED(expr_as_value(frame, evaluated, &value));
  if (value.kind != SPROUT_LIST) return expr_unchecked(frame, "a value read as a list");
  *out = value.as.list;
  return SPROUT_EVAL_OK;
}

/* A result of `+` or `-`: in the integer range, or a fault. */
static sprout_eval_status in_range(const sprout_frame *frame, double result, sprout_evaluated *out) {
  expr_text text;
  if (result < INTEGER_MIN || result > INTEGER_MAX) {
    text = expr_text_begin(frame);
    expr_put_number(&text, result);
    expr_put(&text, " is outside the integer range, -2147483648 to 2147483647.");
    return expr_fail(frame, "IntegerOverflow");
  }
  *out = sprout_evaluated_value(sprout_number(result));
  return SPROUT_EVAL_OK;
}

sprout_eval_status expr_unary(const sprout_frame *frame, const sprout_node *expr, const sprout_evaluated *operand,
                              sprout_evaluated *out) {
  if (sprout_node_is(sprout_node_get(expr, "operator"), "!")) {
    bool value;
    EXPR_NEED(expr_as_boolean(frame, operand, &value));
    *out = sprout_evaluated_value(sprout_bool(!value));
    return SPROUT_EVAL_OK;
  } else {
    double value;
    EXPR_NEED(expr_as_integer(frame, operand, &value));
    return in_range(frame, -value, out);
  }
}

/* `==` on two objects is identity; on two values of one type, equality. Lists are never compared. */
static sprout_eval_status same(const sprout_frame *frame, const sprout_evaluated *a, const sprout_evaluated *b,
                               bool *out) {
  if (a->binds == SPROUT_BINDS_OBJECT && b->binds == SPROUT_BINDS_OBJECT) {
    *out = sprout_str_same(a->id, b->id);
    return SPROUT_EVAL_OK;
  }
  if (a->binds == SPROUT_BINDS_VALUE && b->binds == SPROUT_BINDS_VALUE) {
    if (a->value.kind == SPROUT_LIST || b->value.kind == SPROUT_LIST)
      return expr_unchecked(frame, "two lists compared with `==`");
    *out = a->value.kind == b->value.kind && sprout_value_same(&a->value, &b->value);
    return SPROUT_EVAL_OK;
  }
  return expr_unchecked(frame, "values of different kinds compared with `==`");
}

sprout_eval_status expr_binary(const sprout_frame *frame, const sprout_node *expr, const sprout_evaluated *left,
                               sprout_evaluated *out) {
  const sprout_node *operator_node = sprout_node_get(expr, "operator"), *right = sprout_node_get(expr, "right");
  const char *op = operator_node != NULL && operator_node->kind == SPROUT_NODE_STRING ? operator_node->text : "";
  sprout_evaluated other;
  double a, b;
  bool equal, decided;
  if (strcmp(op, "&&") == 0) return expr_unchecked(frame, "`&&` above another expression");
  if (strcmp(op, "||") == 0) {
    EXPR_NEED(expr_as_boolean(frame, left, &decided));
    if (!decided) EXPR_NEED(sprout_eval_condition(frame, right, &decided));
    *out = sprout_evaluated_value(sprout_bool(decided));
    return SPROUT_EVAL_OK;
  }
  if (strcmp(op, "==") == 0 || strcmp(op, "!=") == 0) {
    EXPR_NEED(sprout_eval(frame, right, &other));
    EXPR_NEED(same(frame, left, &other, &equal));
    *out = sprout_evaluated_value(sprout_bool(strcmp(op, "==") == 0 ? equal : !equal));
    return SPROUT_EVAL_OK;
  }
  EXPR_NEED(expr_as_integer(frame, left, &a));
  EXPR_NEED(sprout_eval(frame, right, &other));
  EXPR_NEED(expr_as_integer(frame, &other, &b));
  if (strcmp(op, "<") == 0) *out = sprout_evaluated_value(sprout_bool(a < b));
  else if (strcmp(op, "<=") == 0) *out = sprout_evaluated_value(sprout_bool(a <= b));
  else if (strcmp(op, ">") == 0) *out = sprout_evaluated_value(sprout_bool(a > b));
  else if (strcmp(op, ">=") == 0) *out = sprout_evaluated_value(sprout_bool(a >= b));
  else if (strcmp(op, "+") == 0) return in_range(frame, a + b, out);
  else if (strcmp(op, "-") == 0) return in_range(frame, a - b, out);
  else return expr_unchecked(frame, "an operator this runtime does not know");
  return SPROUT_EVAL_OK;
}
