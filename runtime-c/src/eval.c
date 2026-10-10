/*
 * What an expression evaluates to while the world runs (the spec's The type
 * system > What the compiler checks, Precedence; Limits > Runtime budgets).
 * Evaluating mirrors the checker: what it accepts is what is handled, and
 * nothing else. A spine of operators or readings is walked with a loop, as
 * the checker walks it, since `a + a + a + ...` has no bracket to count
 * against the parser's depth bound; one step is charged for every node.
 */
#include <string.h>

#include "expr/expr.h"

sprout_evaluated sprout_evaluated_value(sprout_value value) {
  sprout_evaluated evaluated;
  memset(&evaluated, 0, sizeof evaluated);
  evaluated.binds = SPROUT_BINDS_VALUE;
  evaluated.value = value;
  return evaluated;
}

sprout_evaluated sprout_evaluated_object(sprout_str id) {
  sprout_evaluated evaluated;
  memset(&evaluated, 0, sizeof evaluated);
  evaluated.binds = SPROUT_BINDS_OBJECT;
  evaluated.id = id;
  return evaluated;
}

/* What an expression evaluates to, and the frame the right of its topmost `&&` was read in. */
typedef struct walked {
  sprout_evaluated value;
  sprout_frame held;
} walked;

static sprout_eval_status walk(const sprout_frame *frame, const sprout_node *expr, walked *out);

/* A name the frame binds, or the object the name table says it reaches in range of `self`. */
static sprout_eval_status ident_leaf(const sprout_frame *frame, const sprout_node *ident, sprout_evaluated *out) {
  const char *name = ident == NULL || ident->kind != SPROUT_NODE_OBJECT ? NULL : sprout_node_text(ident, "text");
  const sprout_binding *bound;
  const sprout_node *named;
  sprout_str reached;
  if (name == NULL) return expr_unchecked(frame, "a name with no text");
  if (strcmp(name, "self") == 0) {
    *out = sprout_evaluated_object(frame->self);
    return SPROUT_EVAL_OK;
  }
  bound = expr_binding(frame, name);
  if (bound != NULL) {
    *out = bound->bound;
    return SPROUT_EVAL_OK;
  }
  named = sprout_world_bound(frame->world, ident);
  if (named == NULL) {
    expr_text text = expr_text_begin(frame);
    expr_put(&text, "`");
    expr_put(&text, name);
    expr_put(&text, "`, which nothing binds, reached the evaluator, which the checker refuses.");
    frame->fault->name = "Error";
    return SPROUT_EVAL_ENGINE;
  }
  EXPR_NEED(expr_reached_by_name(frame, named, name, &reached));
  *out = sprout_evaluated_object(reached);
  return SPROUT_EVAL_OK;
}

static sprout_eval_status name_leaf(const sprout_frame *frame, const sprout_node *expr, sprout_evaluated *out) {
  return ident_leaf(frame, sprout_node_get(expr, "name"), out);
}

sprout_eval_status sprout_eval_ident(const sprout_frame *frame, const sprout_node *ident, sprout_evaluated *out) {
  EXPR_NEED(expr_spend(frame));
  return ident_leaf(frame, ident, out);
}

/* A dotted path, `w2.forest_1.box`: what a narrowing bound it to, else what the checker resolved it to. */
static sprout_eval_status path_leaf(const sprout_frame *frame, const sprout_node *expr, sprout_evaluated *out) {
  const char *written;
  const sprout_node *named = sprout_world_bound(frame->world, expr);
  const sprout_binding *bound;
  sprout_str reached;
  EXPR_NEED(expr_written_members(frame, expr, &written));
  if (written == NULL || named == NULL) return expr_unchecked(frame, "a reading at the bottom of a spine");
  bound = expr_binding(frame, written);
  if (bound != NULL) {
    *out = bound->bound;
    return SPROUT_EVAL_OK;
  }
  EXPR_NEED(expr_reached_by_name(frame, named, written, &reached));
  *out = sprout_evaluated_object(reached);
  return SPROUT_EVAL_OK;
}

static sprout_eval_status text_leaf(const sprout_frame *frame, const char *bytes, size_t length,
                                    sprout_evaluated *out) {
  sprout_value value;
  if (!sprout_string(frame->turn, bytes, length, &value)) return SPROUT_EVAL_NO_MEMORY;
  *out = sprout_evaluated_value(value);
  return SPROUT_EVAL_OK;
}

static sprout_eval_status leaf(const sprout_frame *frame, const sprout_node *expr, sprout_evaluated *out) {
  const sprout_node *value = sprout_node_get(expr, "value");
  const char *name;
  EXPR_NEED(expr_spend(frame));
  switch (expr_kind_of(expr)) {
    case EXPR_BOOLEAN:
      if (value == NULL || value->kind != SPROUT_NODE_BOOL) break;
      *out = sprout_evaluated_value(sprout_bool(value->boolean));
      return SPROUT_EVAL_OK;
    case EXPR_INTEGER:
      if (value == NULL || value->kind != SPROUT_NODE_NUMBER) break;
      *out = sprout_evaluated_value(sprout_number(value->number));
      return SPROUT_EVAL_OK;
    case EXPR_STRING:
      if (value == NULL || value->kind != SPROUT_NODE_STRING) break;
      return text_leaf(frame, value->text, value->length, out);
    case EXPR_SYMBOL:
      /* An option, compared or looked for: its bare name, as a value holds it. */
      name = expr_ident(expr, "name");
      if (name == NULL) break;
      return text_leaf(frame, name, strlen(name), out);
    case EXPR_BINDING:
      return name_leaf(frame, expr, out);
    case EXPR_BOUND:
      /* A tool the reading left out, or a value outside what this role-player hears, is not in the frame. */
      name = expr_ident(expr, "name");
      if (name == NULL) break;
      *out = sprout_evaluated_value(sprout_bool(expr_binding(frame, name) != NULL));
      return SPROUT_EVAL_OK;
    case EXPR_KIND:
      return expr_unchecked(frame, "a kind standing as a value");
    case EXPR_FREE_CALL:
      return expr_drawn(frame, expr, out);
    case EXPR_MEMBER:
      return path_leaf(frame, expr, out);
    default:
      return expr_unchecked(frame, "an expression at the bottom of a spine");
  }
  return expr_unchecked(frame, "an expression written without its value");
}

/* One step up a spine, from what the node is written on. */
static sprout_eval_status above(const sprout_frame *frame, const sprout_node *expr, const sprout_evaluated *below,
                                sprout_evaluated *out) {
  EXPR_NEED(expr_spend(frame));
  switch (expr_kind_of(expr)) {
    case EXPR_UNARY:
      return expr_unary(frame, expr, below, out);
    case EXPR_BINARY:
      return expr_binary(frame, expr, below, out);
    case EXPR_MEMBER:
      return expr_member(frame, expr, below, out);
    case EXPR_CALL:
      return expr_reading(frame, expr, below, out);
    default:
      return expr_unchecked(frame, "an expression above another expression");
  }
}

/* The nodes from the expression down its left to the one a spine stands on, outermost first. */
static sprout_eval_status spine_of(const sprout_frame *frame, const sprout_node *expr, const sprout_node ***spine,
                                   size_t *count) {
  const sprout_node **nodes = NULL;
  size_t used = 0, capacity = 0;
  const sprout_node *node = expr;
  for (;;) {
    const sprout_node *next;
    if (used == capacity) {
      size_t wanted = capacity == 0 ? 16 : capacity * 2;
      const sprout_node **bigger = (const sprout_node **)sprout_arena_take(frame->turn, wanted * sizeof *bigger);
      if (bigger == NULL) return SPROUT_EVAL_NO_MEMORY;
      if (used > 0) memcpy(bigger, nodes, used * sizeof *bigger);
      nodes = bigger;
      capacity = wanted;
    }
    nodes[used++] = node;
    switch (expr_kind_of(node)) {
      case EXPR_BINARY:
        next = sprout_node_get(node, "left");
        break;
      case EXPR_UNARY:
        next = sprout_node_get(node, "operand");
        break;
      case EXPR_MEMBER:
        next = sprout_world_bound(frame->world, node) == NULL ? sprout_node_get(node, "receiver") : NULL;
        break;
      case EXPR_CALL:
        next = sprout_node_get(node, "receiver");
        break;
      default:
        next = NULL;
    }
    if (next == NULL) break;
    node = next;
  }
  *spine = nodes;
  *count = used;
  return SPROUT_EVAL_OK;
}

static sprout_eval_status walk(const sprout_frame *frame, const sprout_node *expr, walked *out) {
  const sprout_node **spine;
  size_t count, at;
  sprout_evaluated below, next;
  sprout_frame held = *frame;
  EXPR_NEED(spine_of(frame, expr, &spine, &count));
  EXPR_NEED(leaf(frame, spine[count - 1], &below));
  for (at = count - 1; at-- > 0;) {
    const sprout_node *node = spine[at];
    bool holds;
    if (!expr_is_and(node)) {
      EXPR_NEED(above(frame, node, &below, &next));
      below = next;
      continue;
    }
    EXPR_NEED(expr_spend(frame));
    EXPR_NEED(expr_as_boolean(frame, &below, &holds));
    if (!holds) continue;
    {
      const sprout_node *left = sprout_node_get(node, "left");
      sprout_frame read_in;
      /* An `&&` on the left is the node just walked, and `held` is where its right was read. */
      if (expr_is_and(left)) EXPR_NEED(expr_narrowed(&held, sprout_node_get(left, "right"), &read_in));
      else EXPR_NEED(expr_narrowed(frame, left, &read_in));
      held = read_in;
    }
    EXPR_NEED(sprout_eval_condition(&held, sprout_node_get(node, "right"), &holds));
    below = sprout_evaluated_value(sprout_bool(holds));
  }
  out->value = below;
  out->held = held;
  return SPROUT_EVAL_OK;
}

sprout_eval_status sprout_eval(const sprout_frame *frame, const sprout_node *expr, sprout_evaluated *out) {
  walked result;
  EXPR_NEED(walk(frame, expr, &result));
  *out = result.value;
  return SPROUT_EVAL_OK;
}

sprout_eval_status sprout_eval_condition(const sprout_frame *frame, const sprout_node *expr, bool *out) {
  sprout_evaluated evaluated;
  EXPR_NEED(sprout_eval(frame, expr, &evaluated));
  return expr_as_boolean(frame, &evaluated, out);
}

sprout_eval_status sprout_eval_branch(const sprout_frame *frame, const sprout_node *condition, bool *taken,
                                      sprout_frame *inner) {
  sprout_frame narrowed;
  walked result;
  EXPR_NEED(expr_narrowed(frame, condition, &narrowed));
  EXPR_NEED(walk(&narrowed, condition, &result));
  EXPR_NEED(expr_as_boolean(frame, &result.value, taken));
  if (!*taken) return SPROUT_EVAL_OK;
  if (expr_is_and(condition)) EXPR_NEED(expr_narrowed(&result.held, sprout_node_get(condition, "right"), inner));
  else *inner = narrowed;
  return SPROUT_EVAL_OK;
}
