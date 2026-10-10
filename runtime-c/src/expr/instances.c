/*
 * Reading instances through the draft (the spec's The runtime > State;
 * Properties; Per-actor memory): a stored property decoded under the type its
 * kind declares, an object's memory about an actor, and the declared default
 * a remembered property reads as until it is written.
 */
#include "expr.h"
#include "../lists.h"

const sprout_stored_instance *expr_instance(const sprout_frame *frame, sprout_str id) {
  const sprout_stored_instance *found = sprout_draft_instance(frame->draft, id);
  return found != NULL ? found : sprout_draft_destroyed(frame->draft, id);
}

sprout_eval_status expr_instance_of(const sprout_frame *frame, sprout_str id, const sprout_stored_instance **out) {
  expr_text text;
  *out = expr_instance(frame, id);
  if (*out != NULL) return SPROUT_EVAL_OK;
  text = expr_text_begin(frame);
  expr_put(&text, "`");
  expr_put_str(&text, id);
  expr_put(&text, "` is bound, and is not an instance.");
  frame->fault->name = "Error";
  return SPROUT_EVAL_ENGINE;
}

bool expr_composes(const sprout_kind_def *kind, const char *qualified) {
  size_t i;
  for (i = 0; i < kind->order_count; i++)
    if (strcmp(kind->order[i], qualified) == 0) return true;
  return false;
}

static const sprout_type BOOLEAN_TYPE = {SPROUT_BOOL, NULL};
static const sprout_type NUMBER_TYPE = {SPROUT_NUMBER, NULL};
static const sprout_type STRING_TYPE = {SPROUT_STRING, NULL};

/* The type a value of the declared type has. */
static sprout_eval_status type_of(const sprout_frame *frame, const sprout_decl_type *declared,
                                  const sprout_type **out) {
  switch (declared->kind) {
    case SPROUT_DECL_BOOLEAN:
      *out = &BOOLEAN_TYPE;
      return SPROUT_EVAL_OK;
    case SPROUT_DECL_INTEGER:
      *out = &NUMBER_TYPE;
      return SPROUT_EVAL_OK;
    case SPROUT_DECL_STRING:
    case SPROUT_DECL_SYMBOL:
      *out = &STRING_TYPE;
      return SPROUT_EVAL_OK;
    case SPROUT_DECL_LIST: {
      sprout_type *list = (sprout_type *)sprout_arena_take(frame->turn, sizeof *list);
      if (list == NULL) return SPROUT_EVAL_NO_MEMORY;
      list->kind = SPROUT_LIST;
      EXPR_NEED(type_of(frame, declared->element, &list->element));
      *out = list;
      return SPROUT_EVAL_OK;
    }
    case SPROUT_DECL_EXTENSION:
      return expr_engine(frame, "a value of an extension's type reached the evaluator, which the C runtime does not hold.");
  }
  return expr_engine(frame, "a property's declared type reached the evaluator unknown.");
}

static sprout_eval_status list_of(const sprout_frame *frame, const sprout_type *holds, const sprout_value *items,
                                  size_t count, sprout_value *out) {
  const sprout_list *list;
  sprout_list_result made = sprout_list_make(frame->turn, holds, items, count,
                                             frame->world->host.budgets.list_elements, &list);
  if (made == SPROUT_LIST_NO_MEMORY) return SPROUT_EVAL_NO_MEMORY;
  if (made != SPROUT_LIST_OK) return expr_engine(frame, "a stored list passed the host's bound on a list's length.");
  out->kind = SPROUT_LIST;
  out->as.list = list;
  return SPROUT_EVAL_OK;
}

static sprout_eval_status text_value(const sprout_frame *frame, const char *bytes, size_t length, sprout_value *out) {
  if (!sprout_string(frame->turn, bytes, length, out)) return SPROUT_EVAL_NO_MEMORY;
  return SPROUT_EVAL_OK;
}

sprout_eval_status expr_decode(const sprout_frame *frame, const sprout_decl_type *type,
                               const sprout_stored_value *stored, sprout_value *out) {
  switch (type->kind) {
    case SPROUT_DECL_BOOLEAN:
      *out = sprout_bool(stored->boolean);
      return SPROUT_EVAL_OK;
    case SPROUT_DECL_INTEGER:
      *out = sprout_number(stored->number);
      return SPROUT_EVAL_OK;
    case SPROUT_DECL_STRING:
    case SPROUT_DECL_SYMBOL:
      return text_value(frame, stored->string.bytes, stored->string.length, out);
    case SPROUT_DECL_LIST: {
      const sprout_type *holds;
      sprout_value *items = (sprout_value *)sprout_arena_take(frame->turn, (stored->count + 1) * sizeof *items);
      size_t i;
      if (items == NULL) return SPROUT_EVAL_NO_MEMORY;
      EXPR_NEED(type_of(frame, type->element, &holds));
      for (i = 0; i < stored->count; i++) EXPR_NEED(expr_decode(frame, type->element, &stored->items[i], &items[i]));
      return list_of(frame, holds, items, stored->count, out);
    }
    case SPROUT_DECL_EXTENSION:
      break;
  }
  return expr_engine(frame, "a value of an extension's type reached the evaluator, which the C runtime does not hold.");
}

/* The declared default of a property: a literal the declare tier has checked against its type. */
static sprout_eval_status literal_value(const sprout_frame *frame, const sprout_decl_type *type,
                                        const sprout_literal *literal, sprout_value *out) {
  switch (literal->kind) {
    case SPROUT_LITERAL_BOOLEAN:
      *out = sprout_bool(literal->boolean);
      return SPROUT_EVAL_OK;
    case SPROUT_LITERAL_NUMBER:
      *out = sprout_number(literal->number);
      return SPROUT_EVAL_OK;
    case SPROUT_LITERAL_STRING:
    case SPROUT_LITERAL_OPTION:
      return text_value(frame, literal->text, strlen(literal->text), out);
    case SPROUT_LITERAL_LIST: {
      const sprout_type *holds;
      sprout_value *items = (sprout_value *)sprout_arena_take(frame->turn, (literal->count + 1) * sizeof *items);
      size_t i;
      if (items == NULL) return SPROUT_EVAL_NO_MEMORY;
      EXPR_NEED(type_of(frame, type->element, &holds));
      for (i = 0; i < literal->count; i++)
        EXPR_NEED(literal_value(frame, type->element, &literal->items[i], &items[i]));
      return list_of(frame, holds, items, literal->count, out);
    }
  }
  return expr_engine(frame, "a declared default reached the evaluator unknown.");
}

static const sprout_stored_property *stored_named(const sprout_stored_property *list, size_t count, const char *name) {
  size_t i, length = strlen(name);
  for (i = 0; i < count; i++)
    if (list[i].name.length == length && memcmp(list[i].name.bytes, name, length) == 0) return &list[i];
  return NULL;
}

static sprout_eval_status not_held(const sprout_frame *frame, const char *name, const char *who) {
  expr_text text = expr_text_begin(frame);
  expr_put(&text, "`:");
  expr_put(&text, name);
  expr_put(&text, "`, which ");
  expr_put(&text, who);
  expr_put(&text, ",");
  expr_put(&text, " reached the evaluator, which the checker refuses.");
  frame->fault->name = "Error";
  return SPROUT_EVAL_ENGINE;
}

sprout_eval_status expr_get(const sprout_frame *frame, const sprout_stored_instance *instance, const char *name,
                            sprout_value *out) {
  const sprout_stored_property *held = stored_named(instance->properties, instance->property_count, name);
  const sprout_property *declared = sprout_kind_property(instance->kind, name);
  if (held == NULL || declared == NULL) return not_held(frame, name, "its object does not hold");
  return expr_decode(frame, declared->type, &held->value, out);
}

sprout_eval_status expr_recalled(const sprout_frame *frame, sprout_str actor, const char *name, sprout_value *out) {
  const sprout_stored_instance *self;
  const sprout_property *declared;
  size_t i;
  EXPR_NEED(expr_instance_of(frame, frame->self, &self));
  declared = sprout_kind_property(self->kind, name);
  if (declared == NULL || !declared->remembered) return not_held(frame, name, "`self` does not remember");
  for (i = 0; i < self->memory_count; i++) {
    const sprout_stored_memory *about = &self->memory[i];
    const sprout_stored_property *written;
    if (!sprout_str_same(about->actor, actor)) continue;
    written = stored_named(about->properties, about->count, name);
    if (written != NULL) return expr_decode(frame, declared->type, &written->value, out);
  }
  return literal_value(frame, declared->type, &declared->default_value, out);
}
