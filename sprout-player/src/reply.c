/* The JSON the bridge hands Lua; see reply.h. */
#include "reply.h"

#include <string.h>

void jb_begin(jb *builder, sprout_arena *arena) {
  builder->arena = arena;
  builder->ok = true;
}

static sprout_json *made(jb *builder, sprout_json_kind kind, size_t members) {
  sprout_json *node = sprout_json_make(builder->arena, kind, members);
  if (node == NULL) builder->ok = false;
  return node;
}

sprout_json *jb_object(jb *builder, size_t members) { return made(builder, SPROUT_JSON_OBJECT, members); }
sprout_json *jb_array(jb *builder, size_t members) { return made(builder, SPROUT_JSON_ARRAY, members); }

sprout_json *jb_text(jb *builder, const char *bytes, size_t length) {
  sprout_json *node = sprout_json_text(builder->arena, bytes, length);
  if (node == NULL) builder->ok = false;
  return node;
}

sprout_json *jb_string(jb *builder, const char *text) { return jb_text(builder, text, strlen(text)); }
sprout_json *jb_str(jb *builder, sprout_str text) { return jb_text(builder, text.bytes, text.length); }

sprout_json *jb_number(jb *builder, double number) {
  sprout_json *node = made(builder, SPROUT_JSON_NUMBER, 0);
  if (node != NULL) node->number = number;
  return node;
}

sprout_json *jb_bool(jb *builder, bool value) {
  sprout_json *node = made(builder, SPROUT_JSON_BOOL, 0);
  if (node != NULL) node->boolean = value;
  return node;
}

sprout_json *jb_null(jb *builder) { return made(builder, SPROUT_JSON_NULL, 0); }

void jb_set(jb *builder, sprout_json *parent, const char *key, sprout_json *child) {
  if (parent == NULL || child == NULL) {
    builder->ok = false;
    return;
  }
  sprout_json_adopt(parent, key, child);
}

bool jb_finish(jb *builder, PlaydateAPI *pd, const sprout_json *root, char **reply) {
  const char *bytes;
  size_t length;
  char *copy;
  if (!builder->ok || root == NULL) return false;
  if (sprout_json_write(builder->arena, root, &bytes, &length) != SPROUT_OK) return false;
  copy = (char *)pd->system->realloc(*reply, length + 1);
  if (copy == NULL) return false;
  memcpy(copy, bytes, length);
  copy[length] = '\0';
  *reply = copy;
  return true;
}

sprout_json *jb_told(jb *builder, const told_list *list) {
  sprout_json *array = jb_array(builder, list->count);
  size_t i;
  for (i = 0; i < list->count; i++) {
    const told *line = &list->items[i];
    sprout_json *one = jb_object(builder, 6);
    jb_set(builder, one, "reader", jb_text(builder, line->reader, line->reader_length));
    jb_set(builder, one, "kind", jb_string(builder, line->kind));
    jb_set(builder, one, "text", jb_text(builder, line->text, line->text_length));
    if (line->extension != NULL) {
      sprout_json *payload = NULL;
      sprout_json_error error;
      jb_set(builder, one, "extension", jb_string(builder, line->extension));
      jb_set(builder, one, "statement", jb_string(builder, line->statement));
      if (line->payload != NULL && sprout_json_read(builder->arena, line->payload, line->payload_length, &payload, &error) == SPROUT_OK)
        jb_set(builder, one, "payload", payload);
    }
    jb_set(builder, array, NULL, one);
  }
  return array;
}
