/*
 * The canonical form of an evaluation, for goldens and for `sproutc eval`:
 * {"value":V} where a list is an array, {"object":"id"}, {"set":[ids]} or
 * {"readings":[lines]}. It is the stored form's JSON with the escapes
 * JSON.stringify makes, so a golden written by the TypeScript runtime and
 * this one's output compare as bytes.
 */
#include "expr.h"
#include "../json.h"

static sprout_json *make(const sprout_frame *frame, sprout_json_kind kind) {
  sprout_json *node = (sprout_json *)sprout_arena_take(frame->turn, sizeof *node);
  if (node != NULL) node->kind = kind;
  return node;
}

/* Adds `child` as the next member of `parent`, whose `count` members were sized when it was made. */
static void adopt(sprout_json *parent, const char *key, sprout_json *child) {
  child->parent = parent;
  child->index = parent->count;
  child->key = key;
  child->key_length = key == NULL ? 0 : strlen(key);
  parent->items[parent->count++] = child;
}

static sprout_json *container(const sprout_frame *frame, sprout_json_kind kind, size_t members) {
  sprout_json *node = make(frame, kind);
  if (node == NULL) return NULL;
  node->items = (sprout_json **)sprout_arena_take(frame->turn, (members + 1) * sizeof *node->items);
  return node->items == NULL ? NULL : node;
}

static sprout_json *text_json(const sprout_frame *frame, const char *bytes, size_t length) {
  sprout_json *node = make(frame, SPROUT_JSON_STRING);
  if (node == NULL) return NULL;
  node->bytes = bytes;
  node->length = length;
  return node;
}

static sprout_json *value_json(const sprout_frame *frame, const sprout_value *value) {
  sprout_json *node;
  size_t i;
  switch (value->kind) {
    case SPROUT_BOOL:
      node = make(frame, SPROUT_JSON_BOOL);
      if (node != NULL) node->boolean = value->as.boolean;
      return node;
    case SPROUT_NUMBER:
      node = make(frame, SPROUT_JSON_NUMBER);
      if (node != NULL) node->number = value->as.number;
      return node;
    case SPROUT_STRING:
      return text_json(frame, value->as.string.bytes, value->as.string.length);
    case SPROUT_LIST:
      node = container(frame, SPROUT_JSON_ARRAY, value->as.list->count);
      for (i = 0; node != NULL && i < value->as.list->count; i++) {
        sprout_json *one = value_json(frame, &value->as.list->items[i]);
        if (one == NULL) return NULL;
        adopt(node, NULL, one);
      }
      return node;
  }
  return NULL;
}

static sprout_json *strs_json(const sprout_frame *frame, const sprout_str *items, size_t count) {
  sprout_json *node = container(frame, SPROUT_JSON_ARRAY, count);
  size_t i;
  for (i = 0; node != NULL && i < count; i++) {
    sprout_json *one = text_json(frame, items[i].bytes, items[i].length);
    if (one == NULL) return NULL;
    adopt(node, NULL, one);
  }
  return node;
}

sprout_eval_status sprout_eval_node(const sprout_frame *frame, const sprout_evaluated *evaluated, sprout_json **out) {
  sprout_json *root = container(frame, SPROUT_JSON_OBJECT, 1), *inner = NULL;
  const char *key = "value";
  if (root == NULL) return SPROUT_EVAL_NO_MEMORY;
  switch (evaluated->binds) {
    case SPROUT_BINDS_VALUE:
      inner = value_json(frame, &evaluated->value);
      break;
    case SPROUT_BINDS_OBJECT:
      key = "object";
      inner = text_json(frame, evaluated->id.bytes, evaluated->id.length);
      break;
    case SPROUT_BINDS_SET:
      key = "set";
      inner = strs_json(frame, evaluated->items, evaluated->count);
      break;
    case SPROUT_BINDS_READINGS:
      key = "readings";
      inner = strs_json(frame, evaluated->items, evaluated->count);
      break;
  }
  if (inner == NULL) return SPROUT_EVAL_NO_MEMORY;
  adopt(root, key, inner);
  *out = root;
  return SPROUT_EVAL_OK;
}

sprout_eval_status sprout_eval_show(const sprout_frame *frame, const sprout_evaluated *evaluated, const char **bytes,
                                    size_t *length) {
  sprout_json *root;
  sprout_status written;
  EXPR_NEED(sprout_eval_node(frame, evaluated, &root));
  written = sprout_json_write(frame->turn, root, bytes, length);
  if (written == SPROUT_NO_MEMORY) return SPROUT_EVAL_NO_MEMORY;
  if (written != SPROUT_OK) return expr_engine(frame, "a result that is not a whole number reached the printer.");
  return SPROUT_EVAL_OK;
}
