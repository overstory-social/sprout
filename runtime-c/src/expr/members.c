/*
 * Member reads and calls (the spec's Properties; Lists; Object identity;
 * Per-actor memory; Range > Sight): `x.count` on a container, a set or a
 * list; and `get`, `recall`, `count(K)`, `holds`, `is`, `includes` and
 * `sees` on a receiver already evaluated. Naming a property or a kind is a
 * node, and costs a step.
 */
#include "expr.h"
#include "../lists.h"

sprout_eval_status expr_member(const sprout_frame *frame, const sprout_node *expr, const sprout_evaluated *receiver,
                               sprout_evaluated *out) {
  const char *member = expr_ident(expr, "member");
  sprout_str container;
  const sprout_list *list;
  if (member == NULL || strcmp(member, "count") != 0) return expr_unchecked(frame, "a reading other than `count`");
  switch (receiver->binds) {
    case SPROUT_BINDS_OBJECT: {
      const sprout_str *seen;
      size_t count;
      EXPR_NEED(expr_as_object(frame, receiver, &container));
      EXPR_NEED(expr_contents_seen(frame, container, &seen, &count));
      *out = sprout_evaluated_value(sprout_number((double)count));
      return SPROUT_EVAL_OK;
    }
    case SPROUT_BINDS_SET:
      *out = sprout_evaluated_value(sprout_number((double)receiver->count));
      return SPROUT_EVAL_OK;
    case SPROUT_BINDS_VALUE:
      EXPR_NEED(expr_as_list(frame, receiver, &list));
      *out = sprout_evaluated_value(sprout_number((double)sprout_list_count(list)));
      return SPROUT_EVAL_OK;
    case SPROUT_BINDS_READINGS:
      break;
  }
  return expr_unchecked(frame, "`.count` on `readings`, which only `{for ... of}` may walk");
}

/* The property `:p` names. Reading the name is a node, and costs a step. */
static sprout_eval_status property_named(const sprout_frame *frame, const sprout_node *written, const char **name) {
  EXPR_NEED(expr_spend(frame));
  if (expr_kind_of(written) != EXPR_SYMBOL) return expr_unchecked(frame, "a property named without a colon");
  *name = expr_ident(written, "name");
  return SPROUT_EVAL_OK;
}

/* The kind `K` names, from the library that wrote the body. Reading the name is a node, and costs a step. */
static sprout_eval_status kind_named(const sprout_frame *frame, const sprout_node *written,
                                     const sprout_kind_def **kind) {
  EXPR_NEED(expr_spend(frame));
  if (expr_kind_of(written) != EXPR_KIND) return expr_unchecked(frame, "a kind named without a capital");
  *kind = expr_kind_named(frame, written);
  if (*kind == NULL) {
    expr_text text = expr_text_begin(frame);
    expr_put(&text, "the kind `");
    expr_put(&text, expr_ident(written, "name"));
    expr_put(&text, "`, which is not declared, reached the evaluator, which the checker refuses.");
    frame->fault->name = "Error";
    return SPROUT_EVAL_ENGINE;
  }
  return SPROUT_EVAL_OK;
}

/* `x.sees(K, :p)`, in a place's `lit`: whether something `x` sees composes `K` and holds `:p` true. */
static sprout_eval_status sees(const sprout_frame *frame, const sprout_node *expr, const sprout_evaluated *receiver,
                               sprout_evaluated *out) {
  const sprout_kind_def *kind;
  const char *name = NULL;
  sprout_str from;
  const sprout_str *seen;
  size_t count, i;
  bool found = false;
  if (expr_argument_count(expr) != 2) return expr_unchecked(frame, "`sees` given the wrong number of things");
  EXPR_NEED(kind_named(frame, expr_argument(expr, 0), &kind));
  EXPR_NEED(property_named(frame, expr_argument(expr, 1), &name));
  EXPR_NEED(expr_as_object(frame, receiver, &from));
  EXPR_NEED(expr_seen_from(frame, from, &seen, &count));
  for (i = 0; i < count && !found; i++) {
    const sprout_stored_instance *instance;
    sprout_value held;
    EXPR_NEED(expr_instance_of(frame, seen[i], &instance));
    if (!expr_composes(instance->kind, kind->qualified)) continue;
    EXPR_NEED(expr_get(frame, instance, name, &held));
    found = held.kind == SPROUT_BOOL && held.as.boolean;
  }
  *out = sprout_evaluated_value(sprout_bool(found));
  return SPROUT_EVAL_OK;
}

sprout_eval_status expr_reading(const sprout_frame *frame, const sprout_node *expr, const sprout_evaluated *receiver,
                                sprout_evaluated *out) {
  const char *method = expr_ident(expr, "method");
  const sprout_node *argument;
  const sprout_stored_instance *instance;
  const sprout_kind_def *kind;
  const char *name = NULL;
  sprout_str object;
  sprout_value value;
  if (method == NULL) return expr_unchecked(frame, "a call with no method");
  if (strcmp(method, "sees") == 0) return sees(frame, expr, receiver, out);
  if (expr_argument_count(expr) != 1) return expr_unchecked(frame, "a reading given the wrong number of things");
  argument = expr_argument(expr, 0);
  if (strcmp(method, "get") == 0) {
    EXPR_NEED(property_named(frame, argument, &name));
    EXPR_NEED(expr_as_object(frame, receiver, &object));
    EXPR_NEED(expr_instance_of(frame, object, &instance));
    EXPR_NEED(expr_get(frame, instance, name, &value));
    *out = sprout_evaluated_value(value);
    return SPROUT_EVAL_OK;
  }
  if (strcmp(method, "recall") == 0) {
    EXPR_NEED(expr_as_object(frame, receiver, &object));
    EXPR_NEED(property_named(frame, argument, &name));
    EXPR_NEED(expr_recalled(frame, object, name, &value));
    *out = sprout_evaluated_value(value);
    return SPROUT_EVAL_OK;
  }
  if (strcmp(method, "count") == 0) {
    const sprout_str *ids;
    size_t count, i, matching = 0;
    EXPR_NEED(kind_named(frame, argument, &kind));
    if (receiver->binds == SPROUT_BINDS_SET) {
      ids = receiver->items;
      count = receiver->count;
    } else {
      EXPR_NEED(expr_as_object(frame, receiver, &object));
      EXPR_NEED(expr_contents_seen(frame, object, &ids, &count));
    }
    for (i = 0; i < count; i++) {
      EXPR_NEED(expr_instance_of(frame, ids[i], &instance));
      if (expr_composes(instance->kind, kind->qualified)) matching++;
    }
    *out = sprout_evaluated_value(sprout_number((double)matching));
    return SPROUT_EVAL_OK;
  }
  if (strcmp(method, "holds") == 0) {
    sprout_evaluated item;
    sprout_str thing;
    bool seen = false;
    EXPR_NEED(expr_as_object(frame, receiver, &object));
    EXPR_NEED(sprout_eval(frame, argument, &item));
    EXPR_NEED(expr_as_object(frame, &item, &thing));
    EXPR_NEED(expr_instance_of(frame, thing, &instance));
    if (instance->has_container && sprout_str_same(instance->container, object))
      EXPR_NEED(expr_seen_by(frame, thing, &seen));
    *out = sprout_evaluated_value(sprout_bool(seen));
    return SPROUT_EVAL_OK;
  }
  if (strcmp(method, "is") == 0) {
    EXPR_NEED(kind_named(frame, argument, &kind));
    EXPR_NEED(expr_as_object(frame, receiver, &object));
    EXPR_NEED(expr_instance_of(frame, object, &instance));
    *out = sprout_evaluated_value(sprout_bool(expr_composes(instance->kind, kind->qualified)));
    return SPROUT_EVAL_OK;
  }
  if (strcmp(method, "includes") == 0) {
    sprout_evaluated sought;
    EXPR_NEED(sprout_eval(frame, argument, &sought));
    if (receiver->binds == SPROUT_BINDS_SET) {
      size_t i;
      bool held = false;
      EXPR_NEED(expr_as_object(frame, &sought, &object));
      for (i = 0; i < receiver->count && !held; i++) held = sprout_str_same(receiver->items[i], object);
      *out = sprout_evaluated_value(sprout_bool(held));
    } else {
      const sprout_list *list;
      EXPR_NEED(expr_as_list(frame, receiver, &list));
      EXPR_NEED(expr_as_value(frame, &sought, &value));
      *out = sprout_evaluated_value(sprout_bool(sprout_list_includes(list, &value)));
    }
    return SPROUT_EVAL_OK;
  }
  {
    expr_text text = expr_text_begin(frame);
    expr_put(&text, "`");
    expr_put(&text, method);
    expr_put(&text, "`, which is not a reading, reached the evaluator, which the checker refuses.");
    frame->fault->name = "Error";
    return SPROUT_EVAL_ENGINE;
  }
}
