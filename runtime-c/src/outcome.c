/*
 * What a reading came to, as canonical JSON (see outcome.h). Nothing is
 * rendered: a passage is named by the kind that wrote it and its name, and
 * the names in scope are carried beside it for the prose layer.
 */
#include <string.h>

#include "expr/expr.h"
#include "outcome.h"

#define NEED_NODE(node)                                   \
  do {                                                    \
    if ((node) == NULL) return SPROUT_EVAL_NO_MEMORY;     \
  } while (0)

static sprout_json *text_of(const sprout_frame *frame, const char *text) {
  return sprout_json_text(frame->turn, text, strlen(text));
}

static sprout_json *id_of(const sprout_frame *frame, sprout_str id) {
  return sprout_json_text(frame->turn, id.bytes, id.length);
}

/* `{key: text}` as the object a speech is under one key. */
static sprout_json *one_of(const sprout_frame *frame, const char *key, sprout_json *value) {
  sprout_json *object = sprout_json_make(frame->turn, SPROUT_JSON_OBJECT, 1);
  if (object == NULL || value == NULL) return NULL;
  sprout_json_adopt(object, key, value);
  return object;
}

/* The words a line says, as the form the goldens hold. */
static sprout_json *speech_json(const sprout_frame *frame, const sprout_speech *speech) {
  sprout_json *inner;
  switch (speech->kind) {
    case SPROUT_SPEECH_PASSAGE:
      inner = sprout_json_make(frame->turn, SPROUT_JSON_OBJECT, 2);
      if (inner == NULL) return NULL;
      sprout_json_adopt(inner, "origin", text_of(frame, speech->origin));
      sprout_json_adopt(inner, "name", text_of(frame, speech->name));
      return one_of(frame, "passage", inner);
    case SPROUT_SPEECH_TEXT: {
      const sprout_node *value = sprout_node_get(speech->node, "value");
      inner = sprout_json_make(frame->turn, SPROUT_JSON_OBJECT, 2);
      if (inner == NULL) return NULL;
      sprout_json_adopt(inner, "text", sprout_json_text(frame->turn, value->text, value->length));
      sprout_json_adopt(inner, "library", text_of(frame, speech->library));
      return inner;
    }
    case SPROUT_SPEECH_ABSENT:
      return one_of(frame, "absent", text_of(frame, speech->name));
    case SPROUT_SPEECH_ENGINE:
      return one_of(frame, "engine", text_of(frame, speech->name));
    case SPROUT_SPEECH_RECORDED:
      inner = sprout_json_make(frame->turn, SPROUT_JSON_OBJECT, 2);
      if (inner == NULL) return NULL;
      sprout_json_adopt(inner, "extension", text_of(frame, speech->extension));
      sprout_json_adopt(inner, "statement", text_of(frame, speech->statement));
      return one_of(frame, "recorded", inner);
  }
  return NULL;
}

static sprout_eval_status bindings_json(const sprout_frame *frame, const sprout_effect_binding *bindings, size_t count,
                                        sprout_json **out) {
  sprout_json *object = sprout_json_make(frame->turn, SPROUT_JSON_OBJECT, count);
  size_t i;
  NEED_NODE(object);
  for (i = 0; i < count; i++) {
    sprout_json *shown;
    EXPR_NEED(sprout_eval_node(frame, &bindings[i].bound, &shown));
    sprout_json_adopt(object, bindings[i].name, shown);
  }
  *out = object;
  return SPROUT_EVAL_OK;
}

static const char *kind_name(sprout_effect_kind kind) {
  switch (kind) {
    case SPROUT_EFFECT_SAID:
      return "said";
    case SPROUT_EFFECT_TOLD:
      return "told";
    case SPROUT_EFFECT_REFUSED:
      return "refused";
    case SPROUT_EFFECT_NOTICE:
      return "notice";
    case SPROUT_EFFECT_EXTENSION:
      return "extension";
    case SPROUT_EFFECT_DESCRIBED:
      return "described";
  }
  return "";
}

static sprout_eval_status effect_json(const sprout_frame *frame, const sprout_effect *effect, sprout_json **out) {
  sprout_json *object = sprout_json_make(frame->turn, SPROUT_JSON_OBJECT, 6), *to, *shown, *speaker;
  size_t i;
  NEED_NODE(object);
  sprout_json_adopt(object, "effect", text_of(frame, kind_name(effect->kind)));
  to = sprout_json_make(frame->turn, SPROUT_JSON_ARRAY, effect->to_count);
  NEED_NODE(to);
  for (i = 0; i < effect->to_count; i++) sprout_json_adopt(to, NULL, id_of(frame, effect->to[i]));
  sprout_json_adopt(object, "to", to);
  sprout_json_adopt(object, "by", id_of(frame, effect->by));
  speaker = effect->has_speaker ? id_of(frame, effect->speaker) : sprout_json_make(frame->turn, SPROUT_JSON_NULL, 0);
  NEED_NODE(speaker);
  sprout_json_adopt(object, "speaker", speaker);
  shown = speech_json(frame, &effect->said);
  NEED_NODE(shown);
  sprout_json_adopt(object, "said", shown);
  EXPR_NEED(bindings_json(frame, effect->bindings, effect->binding_count, &shown));
  sprout_json_adopt(object, "bindings", shown);
  if (object->count != 6 || to->count != effect->to_count) return SPROUT_EVAL_NO_MEMORY;
  *out = object;
  return SPROUT_EVAL_OK;
}

sprout_eval_status sprout_outcome_effects(const sprout_exec *x, const sprout_frame *frame, sprout_json **out) {
  sprout_json *list = sprout_json_make(frame->turn, SPROUT_JSON_ARRAY, x->effect_count);
  size_t i;
  NEED_NODE(list);
  for (i = 0; i < x->effect_count; i++) {
    sprout_json *one;
    EXPR_NEED(effect_json(frame, &x->effects[i], &one));
    sprout_json_adopt(list, NULL, one);
  }
  *out = list;
  return SPROUT_EVAL_OK;
}

sprout_eval_status sprout_outcome_refusal(const sprout_frame *frame, const sprout_permit_refusal *refusal,
                                          sprout_json **out) {
  sprout_json *object = sprout_json_make(frame->turn, SPROUT_JSON_OBJECT, 5), *shown;
  NEED_NODE(object);
  sprout_json_adopt(object, "by", id_of(frame, refusal->refusal.by));
  sprout_json_adopt(object, "role", text_of(frame, refusal->role));
  shown = refusal->refusal.origin == NULL ? sprout_json_make(frame->turn, SPROUT_JSON_NULL, 0)
                                          : text_of(frame, refusal->refusal.origin);
  NEED_NODE(shown);
  sprout_json_adopt(object, "origin", shown);
  shown = speech_json(frame, &refusal->refusal.said);
  NEED_NODE(shown);
  sprout_json_adopt(object, "said", shown);
  EXPR_NEED(bindings_json(frame, refusal->refusal.bindings, refusal->refusal.binding_count, &shown));
  sprout_json_adopt(object, "bindings", shown);
  if (object->count != 5) return SPROUT_EVAL_NO_MEMORY;
  *out = object;
  return SPROUT_EVAL_OK;
}
