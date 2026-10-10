/*
 * A write to `self` (the spec's Properties > What the compiler checks, Lists,
 * Per-actor memory; Events, messages and the bus > Receiving): `self.set`,
 * `adjust`, `add` and `remove`, and `x.remember` and `x.adjust` on what
 * `self` remembers about an actor. Only `self` writes `self`. A value its
 * property cannot hold faults, an `adjust` clamps to the property's range,
 * and adding a new element to a full list faults. A write that changes a
 * property its kind watches queues the hook, which the bus delivers once the
 * body has ended, with the value the property held before.
 */
#include <string.h>

#include "../lists.h"
#include "stmt.h"

static sprout_eval_status refused_write(const sprout_frame *frame, const char *words) {
  return expr_engine(frame, words);
}

/* A value as a message names it: numbers, `true`, a string as it is, a list as `[a, b]`. */
static void put_value(expr_text *text, const sprout_value *value) {
  size_t i;
  switch (value->kind) {
    case SPROUT_BOOL:
      expr_put(text, value->as.boolean ? "true" : "false");
      break;
    case SPROUT_NUMBER:
      expr_put_number(text, value->as.number);
      break;
    case SPROUT_STRING:
      expr_put(text, value->as.string.bytes);
      break;
    case SPROUT_LIST:
      expr_put(text, "[");
      for (i = 0; i < value->as.list->count; i++) {
        if (i > 0) expr_put(text, ", ");
        put_value(text, &value->as.list->items[i]);
      }
      expr_put(text, "]");
      break;
  }
}

/* A type as a message names it. */
static void put_type(expr_text *text, const sprout_decl_type *type) {
  const char *dot;
  switch (type->kind) {
    case SPROUT_DECL_BOOLEAN:
      expr_put(text, "boolean");
      break;
    case SPROUT_DECL_INTEGER:
      if (type->min == INTEGER_MIN && type->max == INTEGER_MAX) {
        expr_put(text, "integer");
      } else {
        expr_put(text, "integer ");
        expr_put_number(text, type->min);
        expr_put(text, " to ");
        expr_put_number(text, type->max);
      }
      break;
    case SPROUT_DECL_STRING:
      expr_put(text, "string");
      break;
    case SPROUT_DECL_SYMBOL:
      dot = strrchr(type->enum_name, '.');
      expr_put(text, dot == NULL ? type->enum_name : dot + 1);
      break;
    case SPROUT_DECL_LIST:
      expr_put(text, "[");
      put_type(text, type->element);
      expr_put(text, "]");
      break;
    case SPROUT_DECL_EXTENSION:
      expr_put(text, type->key);
      break;
  }
}

/* Whether the value is one the declared type holds: a symbol among its options, an integer within its range. */
static bool fits(const sprout_frame *frame, const sprout_decl_type *type, const sprout_value *value) {
  size_t i;
  switch (type->kind) {
    case SPROUT_DECL_BOOLEAN:
      return value->kind == SPROUT_BOOL;
    case SPROUT_DECL_STRING:
      return value->kind == SPROUT_STRING;
    case SPROUT_DECL_INTEGER:
      return value->kind == SPROUT_NUMBER && value->as.number == (double)(long long)value->as.number &&
             value->as.number >= type->min && value->as.number <= type->max;
    case SPROUT_DECL_SYMBOL:
      if (value->kind != SPROUT_STRING) return false;
      for (i = 0; i < type->option_count; i++)
        if (strcmp(type->options[i], value->as.string.bytes) == 0) return true;
      return false;
    case SPROUT_DECL_LIST: {
      sprout_limit cap = frame->world->host.budgets.list_elements;
      if (value->kind != SPROUT_LIST) return false;
      if (cap.set && value->as.list->count > cap.value) return false;
      for (i = 0; i < value->as.list->count; i++)
        if (!fits(frame, type->element, &value->as.list->items[i])) return false;
      return true;
    }
    case SPROUT_DECL_EXTENSION:
      return false;
  }
  return false;
}

/* The stored form of a value. */
static bool stored_of(const sprout_frame *frame, const sprout_value *value, sprout_stored_value *out) {
  size_t i;
  memset(out, 0, sizeof *out);
  out->kind = value->kind;
  switch (value->kind) {
    case SPROUT_BOOL:
      out->boolean = value->as.boolean;
      return true;
    case SPROUT_NUMBER:
      out->number = value->as.number;
      return true;
    case SPROUT_STRING:
      out->string.bytes = value->as.string.bytes;
      out->string.length = value->as.string.length;
      return true;
    case SPROUT_LIST:
      out->count = value->as.list->count;
      out->items = (sprout_stored_value *)sprout_arena_take(frame->turn, (out->count + 1) * sizeof *out->items);
      if (out->items == NULL) return false;
      for (i = 0; i < out->count; i++)
        if (!stored_of(frame, &value->as.list->items[i], &out->items[i])) return false;
      return true;
  }
  return false;
}

/* The value, where the property can hold it; a fault where it cannot. */
static sprout_eval_status fitting(const sprout_frame *frame, sprout_str object, const sprout_property *property,
                                  const sprout_value *value) {
  expr_text text;
  if (fits(frame, property->type, value)) return SPROUT_EVAL_OK;
  text = expr_text_begin(frame);
  expr_put(&text, "`");
  expr_put_str(&text, object);
  expr_put(&text, "` cannot hold ");
  put_value(&text, value);
  expr_put(&text, " in `:");
  expr_put(&text, property->name);
  expr_put(&text, "`.");
  return expr_fail(frame, "ValueOutOfRange");
}

/* `adjust`: the held number stepped and clamped to the property's range, since reaching the edge is the meaning. */
static sprout_eval_status clamped(const sprout_frame *frame, const sprout_property *property, const sprout_value *held,
                                  const sprout_value *by, sprout_value *out) {
  double next;
  if (property->type->kind != SPROUT_DECL_INTEGER || held->kind != SPROUT_NUMBER || by->kind != SPROUT_NUMBER)
    return expr_unchecked(frame, "`adjust` on what is not an integer");
  next = held->as.number + by->as.number;
  if (next < property->type->min) next = property->type->min;
  if (next > property->type->max) next = property->type->max;
  *out = sprout_number(next);
  return SPROUT_EVAL_OK;
}

static sprout_eval_status drafted(sprout_draft_result result) {
  return result == SPROUT_DRAFT_OK ? SPROUT_EVAL_OK : SPROUT_EVAL_NO_MEMORY;
}

/* The stored property `name` of a list, or NULL. */
static sprout_stored_property *find_property(sprout_stored_property *list, size_t count, const char *name) {
  size_t i, length = strlen(name);
  for (i = 0; i < count; i++)
    if (list[i].name.length == length && memcmp(list[i].name.bytes, name, length) == 0) return &list[i];
  return NULL;
}

/* Writes `value` as the property `name` of a copy of `self`, in the object's own or its memory about `actor`. */
static sprout_eval_status put_property(const sprout_frame *frame, const sprout_stored_instance *self, const char *name,
                                       const sprout_property *declared, const sprout_str *actor,
                                       const sprout_value *value) {
  sprout_stored_instance next;
  sprout_stored_property *property;
  sprout_stored_value stored;
  if (sprout_stored_instance_copy(frame->turn, self, &next) != SPROUT_OK) return SPROUT_EVAL_NO_MEMORY;
  if (!stored_of(frame, value, &stored)) return SPROUT_EVAL_NO_MEMORY;
  if (actor == NULL) {
    property = find_property(next.properties, next.property_count, name);
    if (property == NULL) return refused_write(frame, "a held property is not stored; the checker refuses that write.");
    property->value = stored;
  } else {
    sprout_stored_memory *about = NULL;
    size_t i;
    for (i = 0; i < next.memory_count && about == NULL; i++)
      if (sprout_str_same(next.memory[i].actor, *actor)) about = &next.memory[i];
    if (about == NULL) {
      sprout_stored_memory *bigger = (sprout_stored_memory *)sprout_arena_take(
          frame->turn, (next.memory_count + 1) * sizeof *bigger);
      if (bigger == NULL) return SPROUT_EVAL_NO_MEMORY;
      if (next.memory_count > 0) memcpy(bigger, next.memory, next.memory_count * sizeof *bigger);
      about = &bigger[next.memory_count++];
      memset(about, 0, sizeof *about);
      about->actor = *actor;
      next.memory = bigger;
    }
    property = find_property(about->properties, about->count, name);
    if (property == NULL) {
      sprout_stored_property *bigger = (sprout_stored_property *)sprout_arena_take(
          frame->turn, (about->count + 1) * sizeof *bigger);
      if (bigger == NULL) return SPROUT_EVAL_NO_MEMORY;
      if (about->count > 0) memcpy(bigger, about->properties, about->count * sizeof *bigger);
      property = &bigger[about->count++];
      memset(property, 0, sizeof *property);
      property->name = (sprout_str){name, strlen(name)};
      property->type = (sprout_str){declared->type->key, strlen(declared->type->key)};
      about->properties = bigger;
    }
    property->value = stored;
  }
  if (sprout_stored_instance_order(frame->turn, &next) != SPROUT_OK) return SPROUT_EVAL_NO_MEMORY;
  return drafted(sprout_draft_write(frame->draft, &next));
}

/* The property `self` declares by this name, held or remembered as the write needs. */
static sprout_eval_status declared_as(const sprout_frame *frame, const sprout_stored_instance *self, const char *name,
                                      bool remembered, const sprout_property **out) {
  const sprout_property *property = sprout_kind_property(self->kind, name);
  expr_text text;
  if (property != NULL && property->remembered == remembered) {
    *out = property;
    return SPROUT_EVAL_OK;
  }
  text = expr_text_begin(frame);
  expr_put(&text, "`:");
  expr_put(&text, name);
  expr_put(&text, "` is not ");
  expr_put(&text, remembered ? "remembered" : "held");
  expr_put(&text, " by `");
  expr_put_str(&text, self->id);
  expr_put(&text, "`; the checker refuses that write.");
  frame->fault->name = "Error";
  return SPROUT_EVAL_ENGINE;
}

/* `adjust` through a name other than `self` is memory's, as the checker reads it. */
static bool remembers_through(const sprout_node *call) {
  const sprout_node *receiver = sprout_node_get(call, "receiver");
  const char *name = expr_ident(receiver, "name");
  return expr_kind_of(receiver) == EXPR_BINDING && name != NULL && strcmp(name, "self") != 0;
}

/* Queues the hook `self`'s kind watches `name` with, once per change. */
static sprout_eval_status queue_hook(sprout_run *run, const sprout_frame *frame, const sprout_stored_instance *self,
                                     const char *name, const sprout_value *was) {
  sprout_send send;
  if (sprout_node_map_find(sprout_node_get(self->kind->node, "hooks"), name) == NULL) return SPROUT_EVAL_OK;
  memset(&send, 0, sizeof send);
  send.message = SPROUT_MSG_CHANGED;
  send.recipient = self->id;
  send.property = name;
  send.was = *was;
  (void)frame;
  return sprout_exec_queue(run->x, &send);
}

sprout_eval_status stmt_write(sprout_run *run, const sprout_frame *frame, const sprout_node *statement) {
  const sprout_node *call = sprout_node_get(statement, "expression");
  const sprout_node *name_node, *value_node;
  const sprout_stored_instance *self;
  const sprout_property *property;
  sprout_evaluated receiver_evaluated, value_evaluated;
  sprout_str receiver;
  sprout_value value, held, next;
  const char *name, *method;
  EXPR_NEED(stmt_acting(run, frame, "a write"));
  if (expr_kind_of(call) != EXPR_CALL || expr_argument_count(call) != 2)
    return expr_unchecked(frame, "a statement that does not write");
  EXPR_NEED(sprout_eval(frame, sprout_node_get(call, "receiver"), &receiver_evaluated));
  EXPR_NEED(expr_as_object(frame, &receiver_evaluated, &receiver));
  EXPR_NEED(expr_spend(frame));
  name_node = expr_argument(call, 0);
  if (expr_kind_of(name_node) != EXPR_SYMBOL)
    return expr_unchecked(frame, "a property named without a colon");
  name = expr_ident(name_node, "name");
  value_node = expr_argument(call, 1);
  EXPR_NEED(sprout_eval(frame, value_node, &value_evaluated));
  EXPR_NEED(expr_as_value(frame, &value_evaluated, &value));
  method = expr_ident(call, "method");
  self = expr_instance(frame, frame->self);
  if (self == NULL) {
    expr_text text = expr_text_begin(frame);
    expr_put(&text, "`");
    expr_put_str(&text, frame->self);
    expr_put(&text, "` writes, and is not an instance.");
    frame->fault->name = "Error";
    return SPROUT_EVAL_ENGINE;
  }
  if (strcmp(method, "remember") == 0 || (strcmp(method, "adjust") == 0 && remembers_through(call))) {
    EXPR_NEED(declared_as(frame, self, name, true, &property));
    EXPR_NEED(expr_recalled(frame, receiver, name, &held));
    if (strcmp(method, "remember") == 0) {
      EXPR_NEED(fitting(frame, self->id, property, &value));
      next = value;
    } else {
      EXPR_NEED(clamped(frame, property, &held, &value, &next));
    }
    return put_property(frame, self, name, property, &receiver, &next);
  }
  if (!sprout_str_same(receiver, frame->self)) {
    expr_text text = expr_text_begin(frame);
    expr_put(&text, "`");
    expr_put(&text, method);
    expr_put(&text, "` on another object reached the runtime; only `self` writes `self`.");
    frame->fault->name = "Error";
    return SPROUT_EVAL_ENGINE;
  }
  EXPR_NEED(declared_as(frame, self, name, false, &property));
  if (find_property(self->properties, self->property_count, name) == NULL) {
    expr_text text = expr_text_begin(frame);
    expr_put(&text, "`");
    expr_put_str(&text, self->id);
    expr_put(&text, "` holds no `:");
    expr_put(&text, name);
    expr_put(&text, "`.");
    frame->fault->name = "Error";
    return SPROUT_EVAL_ENGINE;
  }
  EXPR_NEED(expr_get(frame, self, name, &held));
  if (strcmp(method, "set") == 0) {
    EXPR_NEED(fitting(frame, self->id, property, &value));
    next = value;
  } else if (strcmp(method, "adjust") == 0) {
    EXPR_NEED(clamped(frame, property, &held, &value, &next));
  } else if (strcmp(method, "add") == 0 || strcmp(method, "remove") == 0) {
    const sprout_list *changed;
    sprout_list_result result;
    if (held.kind != SPROUT_LIST) return expr_unchecked(frame, "a list change of what is not a list");
    result = strcmp(method, "add") == 0
                 ? sprout_list_add(frame->turn, held.as.list, &value, frame->world->host.budgets.list_elements, &changed)
                 : sprout_list_remove(frame->turn, held.as.list, &value, &changed);
    if (result == SPROUT_LIST_NO_MEMORY) return SPROUT_EVAL_NO_MEMORY;
    if (result == SPROUT_LIST_FULL) {
      expr_text text = expr_text_begin(frame);
      expr_put(&text, "a list of ");
      put_type(&text, property->type->element);
      expr_put(&text, " already holds ");
      expr_put_number(&text, (double)frame->world->host.budgets.list_elements.value);
      return expr_fail(frame, "ListFull");
    }
    if (result != SPROUT_LIST_OK) return expr_unchecked(frame, "an element of the wrong type added to a list");
    next.kind = SPROUT_LIST;
    next.as.list = changed;
  } else {
    expr_text text = expr_text_begin(frame);
    expr_put(&text, "`");
    expr_put(&text, method);
    expr_put(&text, "`, which does not write, reached the runtime as a statement.");
    frame->fault->name = "Error";
    return SPROUT_EVAL_ENGINE;
  }
  EXPR_NEED(put_property(frame, self, name, property, NULL, &next));
  if (!sprout_value_same(&held, &next)) return queue_hook(run, frame, self, name, &held);
  return SPROUT_EVAL_OK;
}
