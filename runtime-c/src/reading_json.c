/* A reading, an item of a run and a turn a line runs, as JSON and back; see reading_json.h. */
#include "reading_json.h"

#include <string.h>

/* ---- writing ---- */

static sprout_json *text(sprout_arena *arena, const char *bytes) {
  return bytes == NULL ? sprout_json_make(arena, SPROUT_JSON_NULL, 0) : sprout_json_text(arena, bytes, strlen(bytes));
}

static sprout_json *number(sprout_arena *arena, double value) {
  sprout_json *node = sprout_json_make(arena, SPROUT_JSON_NUMBER, 0);
  if (node != NULL) node->number = value;
  return node;
}

/* A node of `count` members, each a name and a node; NULL where any member is missing. */
static sprout_json *object(sprout_arena *arena, size_t count, const char *const *names, sprout_json *const *nodes) {
  sprout_json *made = sprout_json_make(arena, SPROUT_JSON_OBJECT, count);
  size_t i;
  if (made == NULL) return NULL;
  for (i = 0; i < count; i++) {
    if (nodes[i] == NULL) return NULL;
    sprout_json_adopt(made, names[i], nodes[i]);
  }
  return made;
}

static sprout_json *filler_tree(sprout_arena *arena, const sprout_filling *filling) {
  static const char *const names[5] = {"role", "binds", "id", "ids", "value"};
  static const char *const exit_names[5] = {"role", "binds", "direction", "label", "to"};
  sprout_json *nodes[5];
  size_t i;
  nodes[0] = text(arena, filling->role);
  switch (filling->binds) {
    case SPROUT_FILL_UNBOUND:
      nodes[1] = text(arena, "unbound");
      return object(arena, 2, names, nodes);
    case SPROUT_FILL_OBJECT:
      nodes[1] = text(arena, "object");
      nodes[2] = text(arena, filling->id);
      return object(arena, 3, names, nodes);
    case SPROUT_FILL_SET:
      nodes[1] = text(arena, "set");
      nodes[2] = sprout_json_make(arena, SPROUT_JSON_ARRAY, filling->id_count);
      for (i = 0; nodes[2] != NULL && i < filling->id_count; i++) sprout_json_adopt(nodes[2], NULL, text(arena, filling->ids[i]));
      if (nodes[2] == NULL || nodes[2]->count != filling->id_count) return NULL;
      {
        const char *const set_names[3] = {"role", "binds", "ids"};
        return object(arena, 3, set_names, nodes);
      }
    case SPROUT_FILL_EXIT:
      nodes[1] = text(arena, "exit");
      nodes[2] = text(arena, filling->direction);
      nodes[3] = text(arena, filling->label);
      nodes[4] = text(arena, filling->id);
      return object(arena, 5, exit_names, nodes);
    case SPROUT_FILL_TEXT:
    case SPROUT_FILL_NUMBER:
      nodes[1] = text(arena, "value");
      nodes[2] = filling->binds == SPROUT_FILL_TEXT ? text(arena, filling->text) : number(arena, filling->number);
      {
        const char *const value_names[3] = {"role", "binds", "value"};
        return object(arena, 3, value_names, nodes);
      }
  }
  return NULL;
}

sprout_json *sprout_reading_tree(sprout_arena *arena, const char *what, const sprout_reading *reading) {
  sprout_json *bindings = sprout_json_make(arena, SPROUT_JSON_ARRAY, reading->filling_count), *nodes[3];
  const char *names[3];
  size_t i;
  if (bindings == NULL) return NULL;
  for (i = 0; i < reading->filling_count; i++) sprout_json_adopt(bindings, NULL, filler_tree(arena, &reading->fillings[i]));
  if (bindings->count != reading->filling_count) return NULL;
  names[0] = what;
  names[1] = "actor";
  names[2] = "bindings";
  nodes[0] = text(arena, reading->verb);
  nodes[1] = text(arena, reading->actor);
  nodes[2] = bindings;
  return object(arena, 3, names, nodes);
}

sprout_json *sprout_reread_tree(sprout_arena *arena, const sprout_reread *reread) {
  static const char *const names[4] = {"role", "words", "values", "referents"};
  static const char *const pair[2] = {"role", "words"};
  sprout_json *nodes[4];
  size_t i;
  nodes[0] = text(arena, reread->role);
  nodes[1] = text(arena, reread->words);
  nodes[2] = sprout_json_make(arena, SPROUT_JSON_ARRAY, reread->value_count);
  nodes[3] = sprout_json_make(arena, SPROUT_JSON_ARRAY, reread->referent_count);
  if (nodes[2] == NULL || nodes[3] == NULL) return NULL;
  for (i = 0; i < reread->value_count; i++) {
    sprout_json *of[2];
    of[0] = text(arena, reread->values[i].role);
    of[1] = text(arena, reread->values[i].words);
    sprout_json_adopt(nodes[2], NULL, object(arena, 2, pair, of));
  }
  for (i = 0; i < reread->referent_count; i++) sprout_json_adopt(nodes[3], NULL, text(arena, reread->referents[i]));
  if (nodes[2]->count != reread->value_count || nodes[3]->count != reread->referent_count) return NULL;
  return object(arena, 4, names, nodes);
}

sprout_json *sprout_following_tree(sprout_arena *arena, const sprout_following *following) {
  static const char *const names[2] = {"planned", "reread"};
  sprout_json *nodes[2];
  if (following->planned == NULL) {
    static const char *const words[1] = {"text"};
    nodes[0] = text(arena, following->text);
    return object(arena, 1, words, nodes);
  }
  nodes[0] = sprout_reading_tree(arena, "verb", following->planned);
  if (following->reread == NULL) return object(arena, 1, names, nodes);
  nodes[1] = sprout_reread_tree(arena, following->reread);
  return object(arena, 2, names, nodes);
}

/* ---- reading ---- */

/* The string member `key` of `tree`, or NULL where it has none, or one holding a NUL, which no id or word does. */
static const char *string_at(const sprout_json *tree, const char *key) {
  const sprout_json *found = tree == NULL || tree->kind != SPROUT_JSON_OBJECT ? NULL : sprout_json_get(tree, key);
  if (found == NULL || found->kind != SPROUT_JSON_STRING || strlen(found->bytes) != found->length) return NULL;
  return found->bytes;
}

static const sprout_json *array_at(const sprout_json *tree, const char *key) {
  const sprout_json *found = tree == NULL || tree->kind != SPROUT_JSON_OBJECT ? NULL : sprout_json_get(tree, key);
  return found != NULL && found->kind == SPROUT_JSON_ARRAY ? found : NULL;
}

/* The strings of `list`, in `arena`; NULL where one is not a string or a page is refused. */
static const char **strings_of(sprout_arena *arena, const sprout_json *list) {
  const char **made = (const char **)sprout_arena_take(arena, (list->count + 1) * sizeof *made);
  size_t i;
  if (made == NULL) return NULL;
  for (i = 0; i < list->count; i++) {
    const sprout_json *one = list->items[i];
    if (one->kind != SPROUT_JSON_STRING || strlen(one->bytes) != one->length) return NULL;
    made[i] = one->bytes;
  }
  return made;
}

const char *sprout_fillings_of_tree(sprout_arena *arena, const sprout_json *fillers, sprout_filling **out, size_t *count) {
  sprout_filling *found;
  size_t i;
  if (fillers == NULL || fillers->kind != SPROUT_JSON_ARRAY) return "A reading's fillers are not a list.";
  found = (sprout_filling *)sprout_arena_take(arena, (fillers->count + 1) * sizeof *found);
  if (found == NULL) return "There is no memory for the reading.";
  for (i = 0; i < fillers->count; i++) {
    const sprout_json *one = fillers->items[i], *ids = array_at(one, "ids");
    const sprout_json *value = one->kind == SPROUT_JSON_OBJECT ? sprout_json_get(one, "value") : NULL;
    const char *role = string_at(one, "role"), *binds = string_at(one, "binds");
    if (role == NULL || binds == NULL) return "A filler names no role, or does not say what it binds.";
    found[i].role = role;
    if (strcmp(binds, "unbound") == 0) {
      found[i].binds = SPROUT_FILL_UNBOUND;
    } else if (strcmp(binds, "object") == 0 && string_at(one, "id") != NULL) {
      found[i].binds = SPROUT_FILL_OBJECT;
      found[i].id = string_at(one, "id");
    } else if (strcmp(binds, "set") == 0 && ids != NULL) {
      found[i].binds = SPROUT_FILL_SET;
      found[i].ids = strings_of(arena, ids);
      found[i].id_count = ids->count;
      if (found[i].ids == NULL) return "A set filler holds something other than ids.";
    } else if (strcmp(binds, "exit") == 0 && string_at(one, "to") != NULL && string_at(one, "label") != NULL) {
      found[i].binds = SPROUT_FILL_EXIT;
      found[i].id = string_at(one, "to");
      found[i].label = string_at(one, "label");
      found[i].direction = string_at(one, "direction");
    } else if (strcmp(binds, "value") == 0 && value != NULL && value->kind == SPROUT_JSON_STRING) {
      found[i].binds = SPROUT_FILL_TEXT;
      found[i].text = value->bytes;
    } else if (strcmp(binds, "value") == 0 && value != NULL && value->kind == SPROUT_JSON_NUMBER) {
      found[i].binds = SPROUT_FILL_NUMBER;
      found[i].number = value->number;
    } else {
      return "A filler binds what no role takes, or lacks what it binds.";
    }
  }
  *out = found;
  *count = fillers->count;
  return NULL;
}

const char *sprout_reading_of_tree(sprout_arena *arena, const sprout_json *tree, sprout_reading *out) {
  sprout_filling *fillings = NULL;
  const char *wrong;
  memset(out, 0, sizeof *out);
  out->verb = string_at(tree, "verb");
  out->actor = string_at(tree, "actor");
  if (out->verb == NULL || out->actor == NULL) return "A reading names its verb and who performs it.";
  wrong = sprout_fillings_of_tree(arena, array_at(tree, "bindings"), &fillings, &out->filling_count);
  out->fillings = fillings;
  return wrong;
}

const char *sprout_reread_of_tree(sprout_arena *arena, const sprout_json *tree, sprout_reread *out) {
  const sprout_json *values = array_at(tree, "values"), *referents = array_at(tree, "referents");
  sprout_reread_value *pairs;
  size_t i;
  memset(out, 0, sizeof *out);
  out->role = string_at(tree, "role");
  out->words = string_at(tree, "words");
  if (out->role == NULL || out->words == NULL || values == NULL || referents == NULL)
    return "An item of a run names its role, its words, each value role's words and what the pronouns named.";
  pairs = (sprout_reread_value *)sprout_arena_take(arena, (values->count + 1) * sizeof *pairs);
  out->referents = strings_of(arena, referents);
  if (pairs == NULL || out->referents == NULL) return "An item of a run's referents are not ids.";
  for (i = 0; i < values->count; i++) {
    pairs[i].role = string_at(values->items[i], "role");
    pairs[i].words = string_at(values->items[i], "words");
    if (pairs[i].role == NULL || pairs[i].words == NULL) return "An item of a run's value names no role or no words.";
  }
  out->values = pairs;
  out->value_count = values->count;
  out->referent_count = referents->count;
  return NULL;
}
