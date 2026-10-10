/* A reading from the sentence builder; see reading_json.h. */
#include "reading_json.h"

#include <string.h>

#include "json.h"

#define NO_MEMORY "The player ran out of memory reading that."

static bool is_text(const sprout_json *node) { return node != NULL && node->kind == SPROUT_JSON_STRING; }

/* One filling from its JSON; NULL on success, else words. */
static const char *filling_of(sprout_arena *arena, const sprout_json *one, sprout_filling *out) {
  const sprout_json *role = sprout_json_get(one, "role"), *binds = sprout_json_get(one, "binds");
  const sprout_json *id = sprout_json_get(one, "id"), *ids = sprout_json_get(one, "ids");
  const sprout_json *direction = sprout_json_get(one, "direction"), *label = sprout_json_get(one, "label");
  const sprout_json *to = sprout_json_get(one, "to"), *value = sprout_json_get(one, "value");
  size_t j;
  if (!is_text(role) || !is_text(binds)) return "A part of the reading names no role or says nothing of how it is filled.";
  out->role = role->bytes;
  if (strcmp(binds->bytes, "unbound") == 0) {
    out->binds = SPROUT_FILL_UNBOUND;
  } else if (strcmp(binds->bytes, "object") == 0 && is_text(id)) {
    out->binds = SPROUT_FILL_OBJECT;
    out->id = id->bytes;
  } else if (strcmp(binds->bytes, "set") == 0 && ids != NULL && ids->kind == SPROUT_JSON_ARRAY) {
    const char **list = (const char **)sprout_arena_take(arena, (ids->count + 1) * sizeof *list);
    if (list == NULL) return NO_MEMORY;
    for (j = 0; j < ids->count; j++) {
      if (!is_text(ids->items[j])) return "A set in the reading holds something that is not a thing.";
      list[j] = ids->items[j]->bytes;
    }
    out->binds = SPROUT_FILL_SET;
    out->ids = list;
    out->id_count = ids->count;
  } else if (strcmp(binds->bytes, "exit") == 0 && is_text(to) && is_text(label)) {
    out->binds = SPROUT_FILL_EXIT;
    out->id = to->bytes;
    out->label = label->bytes;
    out->direction = is_text(direction) ? direction->bytes : NULL;
  } else if (strcmp(binds->bytes, "value") == 0 && is_text(value)) {
    out->binds = SPROUT_FILL_TEXT;
    out->text = value->bytes;
  } else if (strcmp(binds->bytes, "value") == 0 && value != NULL && value->kind == SPROUT_JSON_NUMBER) {
    out->binds = SPROUT_FILL_NUMBER;
    out->number = value->number;
  } else {
    return "A part of the reading fills a role with something no role takes.";
  }
  return NULL;
}

const char *reading_parse(sprout_arena *arena, const char *json, size_t length, const char *actor,
                          sprout_reading *read, const char **text) {
  sprout_json *root = NULL;
  sprout_json_error error;
  const sprout_json *verb, *fillers, *typed;
  sprout_filling *fillings;
  size_t i;
  memset(read, 0, sizeof *read);
  *text = NULL;
  if (sprout_json_read(arena, json, length, &root, &error) != SPROUT_OK || root == NULL ||
      root->kind != SPROUT_JSON_OBJECT)
    return "The reading was not written as the player writes one.";
  verb = sprout_json_get(root, "verb");
  fillers = sprout_json_get(root, "fillers");
  typed = sprout_json_get(root, "text");
  if (!is_text(verb) || fillers == NULL || fillers->kind != SPROUT_JSON_ARRAY)
    return "The reading names no verb, or no list of what fills its roles.";
  fillings = (sprout_filling *)sprout_arena_take(arena, (fillers->count + 1) * sizeof *fillings);
  if (fillings == NULL) return NO_MEMORY;
  for (i = 0; i < fillers->count; i++) {
    const char *why = filling_of(arena, fillers->items[i], &fillings[i]);
    if (why != NULL) return why;
  }
  read->verb = verb->bytes;
  read->actor = actor;
  read->filling_count = fillers->count;
  read->fillings = fillings;
  if (is_text(typed)) *text = typed->bytes;
  return NULL;
}
