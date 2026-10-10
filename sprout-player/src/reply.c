/* The JSON the registered functions hand back; see reply.h. */
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

const char *line_kind_name(sprout_line_kind kind) {
  switch (kind) {
    case SPROUT_LINE_SAID:
      return "said";
    case SPROUT_LINE_TOLD:
      return "told";
    case SPROUT_LINE_REFUSED:
      return "refused";
    case SPROUT_LINE_DESCRIBED:
      return "described";
    case SPROUT_LINE_NOTICE:
      return "notice";
    case SPROUT_LINE_EXTENSION:
      return "extension";
  }
  return "";
}

const char *turn_kind_name(sprout_turn_kind kind) {
  switch (kind) {
    case SPROUT_TURN_COMMAND:
      return "command";
    case SPROUT_TURN_TICK:
      return "tick";
    case SPROUT_TURN_WAKE:
      return "wake";
    case SPROUT_TURN_MAINTENANCE:
      return "maintenance";
    case SPROUT_TURN_POLL:
      return "poll";
    case SPROUT_TURN_ARRIVAL:
      return "arrival";
    case SPROUT_TURN_DEPARTURE:
      return "departure";
  }
  return "";
}

const char *result_name(sprout_turn_result result) {
  switch (result) {
    case SPROUT_RESULT_DONE:
      return "done";
    case SPROUT_RESULT_FAULTED:
      return "faulted";
    case SPROUT_RESULT_REFUSED:
      return "refused";
    case SPROUT_RESULT_CLOSED:
      return "closed";
    case SPROUT_RESULT_IDLE:
      return "idle";
  }
  return "";
}

static told *told_next(sprout_arena *arena, told_list *list) {
  if (list->count == list->capacity) {
    size_t wanted = list->capacity == 0 ? 8 : list->capacity * 2;
    told *bigger = (told *)sprout_arena_take(arena, wanted * sizeof *bigger);
    if (bigger == NULL) return NULL;
    if (list->count > 0) memcpy(bigger, list->items, list->count * sizeof *bigger);
    list->items = bigger;
    list->capacity = wanted;
  }
  return &list->items[list->count++];
}

static bool told_put(sprout_arena *arena, told_list *list, const char *reader, size_t reader_length, const char *kind,
                     const char *text, size_t text_length) {
  told *line = told_next(arena, list);
  if (line == NULL) return false;
  line->reader = sprout_arena_copy(arena, reader, reader_length);
  line->reader_length = reader_length;
  line->kind = kind;
  line->text = sprout_arena_copy(arena, text, text_length);
  line->text_length = text_length;
  return line->reader != NULL && line->text != NULL;
}

bool told_add(sprout_arena *arena, told_list *list, const char *reader, const char *kind, const char *text) {
  return told_put(arena, list, reader, strlen(reader), kind, text, strlen(text));
}

/* Copies what recorded an extension's effect onto the line that tells it. */
static bool told_extension(sprout_arena *arena, told *line, const sprout_told_effect *effect) {
  if (effect == NULL || effect->extension == NULL) return true;
  line->extension = sprout_arena_copy(arena, effect->extension, strlen(effect->extension));
  line->statement = sprout_arena_copy(arena, effect->statement, strlen(effect->statement));
  if (effect->payload.length > 0) {
    line->payload = sprout_arena_copy(arena, effect->payload.bytes, effect->payload.length);
    line->payload_length = effect->payload.length;
    if (line->payload == NULL) return false;
  }
  return line->extension != NULL && line->statement != NULL;
}

bool told_collect(sprout_arena *arena, told_list *list, const sprout_outcome *outcome, const char *visit) {
  size_t i;
  for (i = 0; i < outcome->line_count; i++) {
    const sprout_line *line = &outcome->lines[i];
    if (!told_put(arena, list, line->recipient, line->recipient_length, line_kind_name(line->kind), line->text,
                  line->text_length))
      return false;
    if (!told_extension(arena, &list->items[list->count - 1],
                        line->effect < outcome->effect_count ? &outcome->effects[line->effect] : NULL))
      return false;
  }
  /* An error shown in play names the fault beside the world's `fault` passage, and never its detail. */
  if (outcome->faulted && outcome->fault_name != NULL) return told_add(arena, list, visit, "record", outcome->fault_name);
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
