/*
 * Reading the stored world (the spec's The runtime > State, and The host
 * contract > Storage). The stored form is the diff from the world a fresh
 * load makes: a record is its id and then only the fields that differ from
 * its declaration, each value bare, since the kind fixes its type. The reader
 * holds exactly what a store keeps and refuses what the stored form's schema
 * refuses, with a sentence that names where; a record's place in the world
 * is read when the state is opened against it (state.c).
 */
#include <string.h>

#include "state.h"

#define MAX_DEPTH 64

/* ---- strings ---- */

bool sprout_str_same(sprout_str a, sprout_str b) {
  return a.length == b.length && (a.length == 0 || memcmp(a.bytes, b.bytes, a.length) == 0);
}

bool sprout_str_is(sprout_str a, const char *text) {
  size_t n = strlen(text);
  return a.length == n && (n == 0 || memcmp(a.bytes, text, n) == 0);
}

/* UTF-8 sorts in code-point order, which is code-unit order except past the astral planes. */
int sprout_str_compare(sprout_str a, sprout_str b) {
  size_t n = a.length < b.length ? a.length : b.length;
  int c = n == 0 ? 0 : memcmp(a.bytes, b.bytes, n);
  if (c != 0) return c < 0 ? -1 : 1;
  return a.length < b.length ? -1 : a.length > b.length ? 1 : 0;
}

bool sprout_state_copy_str(sprout_arena *arena, sprout_str from, sprout_str *to) {
  char *copy = sprout_arena_copy(arena, from.bytes == NULL ? "" : from.bytes, from.length);
  if (copy == NULL) return false;
  to->bytes = copy;
  to->length = from.length;
  return true;
}

static bool is_name_start(char c) { return c >= 'a' && c <= 'z'; }
static bool is_name_char(char c) { return is_name_start(c) || (c >= '0' && c <= '9') || c == '_'; }

/* [a-z][a-z0-9_]* */
static bool is_name(const char *bytes, size_t length) {
  size_t i;
  if (length == 0 || !is_name_start(bytes[0])) return false;
  for (i = 1; i < length; i++)
    if (!is_name_char(bytes[i])) return false;
  return true;
}

/* A minted id's serial: [1-9][0-9]*, or 0 when the text is not one. Saturates past 2^53. */
static uint64_t minted_serial(const char *bytes, size_t length) {
  uint64_t n = 0;
  size_t i;
  if (length == 0 || bytes[0] < '1' || bytes[0] > '9') return 0;
  for (i = 0; i < length; i++) {
    if (bytes[i] < '0' || bytes[i] > '9') return 0;
    n = n * 10 + (uint64_t)(bytes[i] - '0');
    if (n > ((uint64_t)1 << 53)) n = ((uint64_t)1 << 53) + 1;
  }
  return n;
}

sprout_id_form sprout_id_form_of(sprout_str world, sprout_str id) {
  const char *rest;
  size_t length, start, i;
  if (sprout_str_same(world, id)) return SPROUT_ID_WORLD;
  if (id.length <= world.length || memcmp(id.bytes, world.bytes, world.length) != 0)
    return SPROUT_ID_NONE;
  rest = id.bytes + world.length + 1;
  length = id.length - world.length - 1;
  if (id.bytes[world.length] == '#') return minted_serial(rest, length) > 0 ? SPROUT_ID_MINTED : SPROUT_ID_NONE;
  if (id.bytes[world.length] != '.') return SPROUT_ID_NONE;
  start = 0;
  for (i = 0; i <= length; i++) {
    if (i == length || rest[i] == '.') {
      if (!is_name(rest + start, i - start)) return SPROUT_ID_NONE;
      start = i + 1;
    }
  }
  return SPROUT_ID_DECLARED;
}

sprout_str sprout_declared_container(sprout_str id) {
  sprout_str container = id;
  while (container.length > 0 && container.bytes[container.length - 1] != '.') container.length--;
  if (container.length > 0) container.length--;
  return container;
}

/* ---- reading ---- */

typedef struct reader {
  sprout_state *state;
  sprout_refusal *refusal;
  char path[192];
  size_t path_length;
} reader;

static size_t mark(const reader *r) { return r->path_length; }
static void back_to(reader *r, size_t at) {
  r->path_length = at;
  r->path[at] = '\0';
}

static void push(reader *r, const char *piece) {
  size_t n = strlen(piece);
  if (r->path_length + n >= sizeof r->path) n = sizeof r->path - 1 - r->path_length;
  memcpy(r->path + r->path_length, piece, n);
  r->path_length += n;
  r->path[r->path_length] = '\0';
}

static void push_index(reader *r, size_t i) {
  char digits[24];
  size_t n = 0, k;
  char reversed[24];
  do {
    reversed[n++] = (char)('0' + i % 10);
    i /= 10;
  } while (i > 0);
  digits[0] = '[';
  for (k = 0; k < n; k++) digits[1 + k] = reversed[n - 1 - k];
  digits[1 + n] = ']';
  digits[2 + n] = '\0';
  push(r, digits);
}

/* Writes "The stored state is not readable at <path>: <what><a><b>" to the refusal, if there is one. */
sprout_status sprout_stored_refuse(sprout_refusal *refusal, const char *path, const char *what,
                                   const char *a, const char *b) {
  if (refusal != NULL) {
    char *out = refusal->text;
    size_t cap = sizeof refusal->text, used = 0, i;
    const char *parts[7];
    parts[0] = "The stored state is not readable";
    parts[1] = path[0] != '\0' ? " at " : "";
    parts[2] = path;
    parts[3] = ": ";
    parts[4] = what;
    parts[5] = a;
    parts[6] = b;
    for (i = 0; i < 7; i++) {
      size_t n = parts[i] == NULL ? 0 : strlen(parts[i]);
      if (used + n + 1 > cap) n = cap - 1 - used;
      if (n > 0) memcpy(out + used, parts[i], n);
      used += n;
    }
    out[used] = '\0';
  }
  return SPROUT_BAD_INPUT;
}

static sprout_status refuse(reader *r, const char *what, const char *detail_a, const char *detail_b) {
  return sprout_stored_refuse(r->refusal, r->path, what, detail_a, detail_b);
}

#define NEED(expr)                        \
  do {                                    \
    sprout_status need_ = (expr);         \
    if (need_ != SPROUT_OK) return need_; \
  } while (0)

#define MEMORY(pointer)                             \
  do {                                              \
    if ((pointer) == NULL) return SPROUT_NO_MEMORY; \
  } while (0)

static void *take(reader *r, size_t count, size_t size) {
  if (size != 0 && count > (size_t)-1 / size) return NULL;
  return sprout_arena_take(&r->state->arena, count * size);
}

static sprout_status own(reader *r, const sprout_json *string, sprout_str *out) {
  sprout_str from;
  from.bytes = string->bytes;
  from.length = string->length;
  return sprout_state_copy_str(&r->state->arena, from, out) ? SPROUT_OK : SPROUT_NO_MEMORY;
}

/* Whether member `i` of an object is the first of its name: a repeated name keeps its first place and its last value. */
static bool first_of_its_name(const sprout_json *object, size_t i) {
  size_t j;
  for (j = 0; j < i; j++)
    if (object->items[j]->key_length == object->items[i]->key_length &&
        memcmp(object->items[j]->key, object->items[i]->key, object->items[i]->key_length) == 0)
      return false;
  return true;
}

static size_t distinct_members(const sprout_json *object) {
  size_t i, n = 0;
  for (i = 0; i < object->count; i++)
    if (first_of_its_name(object, i)) n++;
  return n;
}

static const sprout_json *member(const sprout_json *object, const char *key) {
  return sprout_json_get(object, key);
}

static sprout_status want_string(reader *r, const sprout_json *object, const char *key, bool allow_empty,
                                 sprout_str *out) {
  const sprout_json *field = member(object, key);
  size_t at = mark(r);
  sprout_status status;
  push(r, ".");
  push(r, key);
  if (field == NULL || field->kind != SPROUT_JSON_STRING) {
    status = refuse(r, "it should be a string.", NULL, NULL);
    back_to(r, at);
    return status;
  }
  if (!allow_empty && field->length == 0) {
    status = refuse(r, "it should not be empty.", NULL, NULL);
    back_to(r, at);
    return status;
  }
  back_to(r, at);
  return own(r, field, out);
}

/* A whole number of at least `least`, where the member is written; `present` is false where it is not. */
static sprout_status want_count(reader *r, const sprout_json *object, const char *key, double least,
                                bool *present, uint64_t *out) {
  const sprout_json *field = member(object, key);
  size_t at = mark(r);
  sprout_status status;
  *present = field != NULL;
  *out = 0;
  if (field == NULL) return SPROUT_OK;
  push(r, ".");
  push(r, key);
  if (field->kind != SPROUT_JSON_NUMBER || field->number < least || field->number > 9007199254740991.0) {
    status = refuse(r, least >= 1 ? "it should be a whole number of at least 1." : "it should be a whole number of at least 0.",
                    NULL, NULL);
    back_to(r, at);
    return status;
  }
  *out = (uint64_t)field->number;
  back_to(r, at);
  return SPROUT_OK;
}

/* A wake's field, which is never left out. */
static sprout_status want_wake_count(reader *r, const sprout_json *wake, const char *key, double least, uint64_t *out) {
  bool present;
  NEED(want_count(r, wake, key, least, &present, out));
  if (present) return SPROUT_OK;
  push(r, ".");
  push(r, key);
  return refuse(r, least >= 1 ? "it should be a whole number of at least 1." : "it should be a whole number of at least 0.",
                NULL, NULL);
}

static sprout_status read_value(reader *r, const sprout_json *json, sprout_stored_value *value,
                                int depth) {
  size_t i;
  if (depth > MAX_DEPTH) return refuse(r, "a list is nested more deeply than a stored value can be.", NULL, NULL);
  switch (json->kind) {
    case SPROUT_JSON_BOOL:
      value->kind = SPROUT_BOOL;
      value->boolean = json->boolean;
      return SPROUT_OK;
    case SPROUT_JSON_NUMBER:
      value->kind = SPROUT_NUMBER;
      value->number = json->number;
      return SPROUT_OK;
    case SPROUT_JSON_STRING:
      value->kind = SPROUT_STRING;
      return own(r, json, &value->string);
    case SPROUT_JSON_ARRAY:
      value->kind = SPROUT_LIST;
      value->count = json->count;
      value->items = (sprout_stored_value *)take(r, json->count, sizeof(sprout_stored_value));
      MEMORY(value->items);
      for (i = 0; i < json->count; i++) {
        size_t at = mark(r);
        push_index(r, i);
        NEED(read_value(r, json->items[i], &value->items[i], depth + 1));
        back_to(r, at);
      }
      return SPROUT_OK;
    default:
      return refuse(r, "a value is a boolean, a number, a string or a list of them.", NULL, NULL);
  }
}

/* An object of properties by name, each a bare value; a map not written is empty. */
static sprout_status read_property_map(reader *r, const sprout_json *json, size_t *count,
                                       sprout_stored_property **out) {
  size_t i, n = 0;
  *count = 0;
  *out = NULL;
  if (json == NULL) return SPROUT_OK;
  if (json->kind != SPROUT_JSON_OBJECT) return refuse(r, "it should be an object of properties.", NULL, NULL);
  *count = distinct_members(json);
  *out = (sprout_stored_property *)take(r, *count, sizeof(sprout_stored_property));
  MEMORY(*out);
  for (i = 0; i < json->count; i++) {
    size_t at = mark(r);
    const sprout_json *last;
    if (!first_of_its_name(json, i)) continue;
    last = sprout_json_get(json, json->items[i]->key);
    push(r, ".");
    push(r, json->items[i]->key);
    {
      sprout_json name;
      name.bytes = json->items[i]->key;
      name.length = json->items[i]->key_length;
      NEED(own(r, &name, &(*out)[n].name));
    }
    NEED(read_value(r, last, &(*out)[n].value, 0));
    back_to(r, at);
    n++;
  }
  return SPROUT_OK;
}

/*
 * How the instance was made. The world's id and a declared path say it themselves, so `made` is written for a
 * minted id alone: a visitor, a spawn of a kind, or what a kind's body gave a spawn, by the kind and its path there.
 */
static sprout_status read_made(reader *r, const sprout_json *json, sprout_stored_instance *out) {
  const sprout_json *made = member(json, "made");
  const sprout_json *from = made == NULL ? NULL : member(made, "from");
  sprout_id_form form = sprout_id_form_of(r->state->world, out->id);
  size_t at = mark(r), i;
  push(r, ".made");
  if (made == NULL) {
    if (form == SPROUT_ID_MINTED)
      return refuse(r, "it should say how the instance was made: visitor, spawned or given.", NULL, NULL);
    out->made = form == SPROUT_ID_WORLD ? SPROUT_MADE_WORLD : SPROUT_MADE_DECLARED;
    back_to(r, at);
    return SPROUT_OK;
  }
  if (form == SPROUT_ID_WORLD || form == SPROUT_ID_DECLARED)
    return refuse(r, "a declared id says how it was made; `made` is for a minted one.", NULL, NULL);
  if (made->kind != SPROUT_JSON_OBJECT || from == NULL || from->kind != SPROUT_JSON_STRING)
    return refuse(r, "it should say where the instance came from.", NULL, NULL);
  if (strcmp(from->bytes, "visitor") == 0) out->made = SPROUT_MADE_VISITOR;
  else if (strcmp(from->bytes, "spawned") == 0) out->made = SPROUT_MADE_SPAWNED;
  else if (strcmp(from->bytes, "given") == 0) out->made = SPROUT_MADE_GIVEN;
  else return refuse(r, "`from` is not one of visitor, spawned or given: ", from->bytes, NULL);
  if (out->made == SPROUT_MADE_SPAWNED || out->made == SPROUT_MADE_GIVEN) {
    NEED(want_string(r, made, "kind", false, &out->made_kind));
  }
  if (out->made == SPROUT_MADE_GIVEN) {
    const sprout_json *path = member(made, "path");
    push(r, ".path");
    if (path == NULL || path->kind != SPROUT_JSON_ARRAY || path->count == 0)
      return refuse(r, "it should be a path of at least one name.", NULL, NULL);
    out->path_count = path->count;
    out->path = (sprout_str *)take(r, path->count, sizeof(sprout_str));
    MEMORY(out->path);
    for (i = 0; i < path->count; i++) {
      size_t inner = mark(r);
      push_index(r, i);
      if (path->items[i]->kind != SPROUT_JSON_STRING || !is_name(path->items[i]->bytes, path->items[i]->length))
        return refuse(r, "it should be a name: lower case letters, digits and underscores.", NULL, NULL);
      NEED(own(r, path->items[i], &out->path[i]));
      back_to(r, inner);
    }
  }
  back_to(r, at);
  return SPROUT_OK;
}

/* A record: its id, and then each field that differs from its declaration, in the schema's order. */
static sprout_status read_instance(reader *r, const sprout_json *json, sprout_stored_instance *out) {
  const sprout_json *field;
  size_t i, n, at;
  if (json->kind != SPROUT_JSON_OBJECT) return refuse(r, "it should be an object.", NULL, NULL);
  NEED(want_string(r, json, "id", true, &out->id));
  NEED(read_made(r, json, out));
  field = member(json, "container");
  at = mark(r);
  if (field != NULL) {
    push(r, ".container");
    if (field->kind != SPROUT_JSON_STRING) return refuse(r, "it should be an id.", NULL, NULL);
    out->has_container = true;
    NEED(own(r, field, &out->container));
    back_to(r, at);
  } else if (out->made == SPROUT_MADE_DECLARED) {
    /* A declared object that says nothing of its container is where it was declared. */
    out->has_container = true;
    if (!sprout_state_copy_str(&r->state->arena, sprout_declared_container(out->id), &out->container))
      return SPROUT_NO_MEMORY;
  }
  NEED(want_count(r, json, "arrival", 1, &out->has_arrival, &out->arrival));

  push(r, ".properties");
  NEED(read_property_map(r, member(json, "properties"), &out->property_count, &out->properties));
  back_to(r, at);

  field = member(json, "links");
  if (field != NULL) {
    push(r, ".links");
    if (field->kind != SPROUT_JSON_OBJECT) return refuse(r, "it should be an object of ids.", NULL, NULL);
    out->link_count = distinct_members(field);
    out->links = (sprout_stored_link *)take(r, out->link_count, sizeof(sprout_stored_link));
    MEMORY(out->links);
    for (i = 0, n = 0; i < field->count; i++) {
      size_t inner = mark(r);
      sprout_json name;
      const sprout_json *last;
      if (!first_of_its_name(field, i)) continue;
      last = sprout_json_get(field, field->items[i]->key);
      push(r, ".");
      push(r, field->items[i]->key);
      name.bytes = field->items[i]->key;
      name.length = field->items[i]->key_length;
      NEED(own(r, &name, &out->links[n].name));
      if (last->kind != SPROUT_JSON_STRING) return refuse(r, "it should be an id.", NULL, NULL);
      NEED(own(r, last, &out->links[n].to));
      back_to(r, inner);
      n++;
    }
    back_to(r, at);
  }

  field = member(json, "wakes");
  if (field != NULL) {
    push(r, ".wakes");
    if (field->kind != SPROUT_JSON_ARRAY) return refuse(r, "it should be a list of wakes.", NULL, NULL);
    out->wake_count = field->count;
    out->wakes = (sprout_stored_wake *)take(r, field->count, sizeof(sprout_stored_wake));
    MEMORY(out->wakes);
    for (i = 0; i < field->count; i++) {
      size_t inner = mark(r);
      push_index(r, i);
      if (field->items[i]->kind != SPROUT_JSON_OBJECT) return refuse(r, "it should be an object.", NULL, NULL);
      NEED(want_wake_count(r, field->items[i], "serial", 1, &out->wakes[i].serial));
      NEED(want_wake_count(r, field->items[i], "askedAt", 0, &out->wakes[i].asked_at));
      NEED(want_wake_count(r, field->items[i], "dueAt", 0, &out->wakes[i].due_at));
      back_to(r, inner);
    }
    back_to(r, at);
  }

  field = member(json, "memory");
  if (field != NULL) {
    push(r, ".memory");
    if (field->kind != SPROUT_JSON_OBJECT)
      return refuse(r, "it should be an object of what each actor is remembered to have.", NULL, NULL);
    out->memory_count = distinct_members(field);
    out->memory = (sprout_stored_memory *)take(r, out->memory_count, sizeof(sprout_stored_memory));
    MEMORY(out->memory);
    for (i = 0, n = 0; i < field->count; i++) {
      size_t inner = mark(r);
      sprout_json name;
      const sprout_json *last;
      if (!first_of_its_name(field, i)) continue;
      last = sprout_json_get(field, field->items[i]->key);
      push(r, ".");
      push(r, field->items[i]->key);
      name.bytes = field->items[i]->key;
      name.length = field->items[i]->key_length;
      NEED(own(r, &name, &out->memory[n].actor));
      NEED(read_property_map(r, last, &out->memory[n].count, &out->memory[n].properties));
      back_to(r, inner);
      n++;
    }
    back_to(r, at);
  }

  NEED(want_count(r, json, "lastTick", 0, &out->has_last_tick, &out->last_tick));
  return SPROUT_OK;
}

static const char *const DIRECTIONS[] = {"north", "south",     "east",      "west", "northeast", "northwest",
                                         "southeast", "southwest", "up", "down", "in", "out"};

static bool is_direction(const char *text) {
  size_t i;
  for (i = 0; i < sizeof DIRECTIONS / sizeof DIRECTIONS[0]; i++)
    if (strcmp(DIRECTIONS[i], text) == 0) return true;
  return false;
}

static sprout_status read_ids(reader *r, const sprout_json *list, size_t *count, sprout_str **out) {
  size_t i;
  if (list == NULL || list->kind != SPROUT_JSON_ARRAY) return refuse(r, "it should be a list of ids.", NULL, NULL);
  *count = list->count;
  *out = (sprout_str *)take(r, list->count, sizeof(sprout_str));
  MEMORY(*out);
  for (i = 0; i < list->count; i++) {
    size_t at = mark(r);
    push_index(r, i);
    if (list->items[i]->kind != SPROUT_JSON_STRING) return refuse(r, "it should be an id.", NULL, NULL);
    NEED(own(r, list->items[i], &(*out)[i]));
    back_to(r, at);
  }
  return SPROUT_OK;
}

static sprout_status read_bound(reader *r, const sprout_json *json, sprout_stored_bound *out) {
  const sprout_json *field;
  size_t at = mark(r);
  if (json->kind != SPROUT_JSON_OBJECT) return refuse(r, "it should say what fills the role.", NULL, NULL);
  if ((field = member(json, "object")) != NULL) {
    out->kind = SPROUT_BOUND_OBJECT;
    push(r, ".object");
    if (field->kind != SPROUT_JSON_STRING) return refuse(r, "it should be an id.", NULL, NULL);
    NEED(own(r, field, &out->object));
  } else if ((field = member(json, "set")) != NULL) {
    out->kind = SPROUT_BOUND_SET;
    push(r, ".set");
    NEED(read_ids(r, field, &out->set_count, &out->set));
  } else if ((field = member(json, "value")) != NULL) {
    out->kind = SPROUT_BOUND_VALUE;
    push(r, ".value");
    if (field->kind == SPROUT_JSON_STRING) {
      out->value_is_string = true;
      NEED(own(r, field, &out->value_string));
    } else if (field->kind == SPROUT_JSON_NUMBER) {
      out->value_number = field->number;
    } else {
      return refuse(r, "it should be a string or a whole number.", NULL, NULL);
    }
  } else if ((field = member(json, "exit")) != NULL) {
    const sprout_json *direction = field->kind == SPROUT_JSON_OBJECT ? member(field, "direction") : NULL;
    out->kind = SPROUT_BOUND_EXIT;
    push(r, ".exit");
    if (field->kind != SPROUT_JSON_OBJECT || direction == NULL)
      return refuse(r, "it should say a direction, a label and where it leads.", NULL, NULL);
    if (direction->kind == SPROUT_JSON_STRING) {
      if (!is_direction(direction->bytes)) return refuse(r, "`direction` is not a direction: ", direction->bytes, NULL);
      out->has_direction = true;
      NEED(own(r, direction, &out->direction));
    } else if (direction->kind != SPROUT_JSON_NULL) {
      return refuse(r, "`direction` should be a direction or null.", NULL, NULL);
    }
    NEED(want_string(r, field, "label", true, &out->label));
    NEED(want_string(r, field, "to", true, &out->to));
  } else {
    return refuse(r, "it should hold an object, a set, a value or an exit.", NULL, NULL);
  }
  back_to(r, at);
  return SPROUT_OK;
}

static sprout_status read_visitor(reader *r, const sprout_json *json, sprout_stored_visitor *out) {
  const sprout_json *field;
  size_t at = mark(r), i;
  if (json->kind != SPROUT_JSON_OBJECT) return refuse(r, "it should be an object.", NULL, NULL);
  NEED(want_string(r, json, "visit", false, &out->visit));
  NEED(want_string(r, json, "nickname", false, &out->nickname));
  NEED(want_string(r, json, "instance", true, &out->instance));
  field = member(json, "lastPlace");
  push(r, ".lastPlace");
  if (field == NULL || (field->kind != SPROUT_JSON_STRING && field->kind != SPROUT_JSON_NULL))
    return refuse(r, "it should be an id or null.", NULL, NULL);
  if (field->kind == SPROUT_JSON_STRING) {
    out->has_last_place = true;
    NEED(own(r, field, &out->last_place));
  }
  back_to(r, at);
  push(r, ".referents");
  NEED(read_ids(r, member(json, "referents"), &out->referent_count, &out->referents));
  back_to(r, at);
  field = member(json, "lastReading");
  push(r, ".lastReading");
  if (field == NULL) return refuse(r, "it is missing.", NULL, NULL);
  if (field->kind != SPROUT_JSON_NULL) {
    const sprout_json *verb = member(field, "verb");
    const sprout_json *bindings = member(field, "bindings");
    size_t inner = mark(r);
    out->has_reading = true;
    if (field->kind != SPROUT_JSON_OBJECT || verb == NULL || verb->kind != SPROUT_JSON_OBJECT)
      return refuse(r, "it should name a verb and what filled its roles.", NULL, NULL);
    push(r, ".verb");
    NEED(want_string(r, verb, "library", false, &out->reading.library));
    NEED(want_string(r, verb, "name", false, &out->reading.name));
    back_to(r, inner);
    push(r, ".bindings");
    if (bindings == NULL || bindings->kind != SPROUT_JSON_ARRAY)
      return refuse(r, "it should be a list of roles and what filled them.", NULL, NULL);
    out->reading.binding_count = bindings->count;
    out->reading.bindings =
        (sprout_stored_binding *)take(r, bindings->count, sizeof(sprout_stored_binding));
    MEMORY(out->reading.bindings);
    for (i = 0; i < bindings->count; i++) {
      size_t each = mark(r);
      const sprout_json *pair = bindings->items[i];
      push_index(r, i);
      if (pair->kind != SPROUT_JSON_ARRAY || pair->count != 2 || pair->items[0]->kind != SPROUT_JSON_STRING ||
          pair->items[0]->length == 0)
        return refuse(r, "it should be a role and what filled it.", NULL, NULL);
      NEED(own(r, pair->items[0], &out->reading.bindings[i].role));
      NEED(read_bound(r, pair->items[1], &out->reading.bindings[i].bound));
      back_to(r, each);
    }
  }
  back_to(r, at);
  return SPROUT_OK;
}

static sprout_status read_list(reader *r, const sprout_json *root, const char *key, size_t *count,
                               void **items, size_t size) {
  const sprout_json *list = member(root, key);
  size_t at = mark(r);
  push(r, key);
  if (list == NULL || list->kind != SPROUT_JSON_ARRAY) return refuse(r, "it should be a list.", NULL, NULL);
  *count = list->count;
  *items = take(r, list->count, size);
  MEMORY(*items);
  back_to(r, at);
  return SPROUT_OK;
}

static sprout_status read_world(reader *r, const sprout_json *root) {
  sprout_state *state = r->state;
  const sprout_json *name = member(root, "world");
  const sprout_json *list;
  size_t i;
  uint64_t serial;
  if (root->kind != SPROUT_JSON_OBJECT) return refuse(r, "the store should hold an object.", NULL, NULL);
  push(r, "world");
  if (name == NULL || name->kind != SPROUT_JSON_STRING || !is_name(name->bytes, name->length))
    return refuse(r, "it should be a name: lower case letters, digits and underscores.", NULL, NULL);
  NEED(own(r, name, &state->world));
  back_to(r, 0);
  push(r, "serial");
  {
    const sprout_json *field = member(root, "serial");
    if (field == NULL || field->kind != SPROUT_JSON_NUMBER || field->number < 0 || field->number > 9007199254740991.0)
      return refuse(r, "it should be a whole number of at least 0.", NULL, NULL);
    serial = (uint64_t)field->number;
  }
  back_to(r, 0);
  state->serial = serial;

  NEED(read_list(r, root, "instances", &state->instance_count, (void **)&state->instances, sizeof(sprout_stored_instance)));
  NEED(read_list(r, root, "visitors", &state->visitor_count, (void **)&state->visitors, sizeof(sprout_stored_visitor)));
  list = member(root, "instances");
  for (i = 0; i < list->count; i++) {
    push(r, "instances");
    push_index(r, i);
    NEED(read_instance(r, list->items[i], &state->instances[i]));
    back_to(r, 0);
  }
  list = member(root, "visitors");
  for (i = 0; i < list->count; i++) {
    push(r, "visitors");
    push_index(r, i);
    NEED(read_visitor(r, list->items[i], &state->visitors[i]));
    back_to(r, 0);
  }
  push(r, "tombstones");
  NEED(read_ids(r, member(root, "tombstones"), &state->tombstone_count, &state->tombstones));
  back_to(r, 0);
  return SPROUT_OK;
}

sprout_status sprout_state_read_shape(const sprout_host *host, const char *bytes, size_t length,
                                      sprout_state **out, sprout_refusal *refusal) {
  sprout_arena boot, scratch;
  sprout_state *state;
  sprout_json *root = NULL;
  sprout_json_error error;
  reader r;
  sprout_status status;
  if (out != NULL) *out = NULL;
  if (refusal != NULL) refusal->text[0] = '\0';
  if (host == NULL || out == NULL) return SPROUT_BAD_HOST;
  status = sprout_arena_init(&boot, host);
  if (status != SPROUT_OK) return status;
  state = (sprout_state *)sprout_arena_take(&boot, sizeof *state);
  if (state == NULL) {
    sprout_arena_reset(&boot);
    return SPROUT_NO_MEMORY;
  }
  state->host = *host;
  state->anchor = boot;
  state->anchor.host = &state->host;
  sprout_arena_init(&state->arena, &state->host);
  sprout_arena_init(&state->contents.arena, &state->host);
  sprout_arena_init(&scratch, &state->host);
  status = sprout_json_read(&scratch, bytes == NULL ? "" : bytes, bytes == NULL ? 0 : length, &root, &error);
  if (status == SPROUT_BAD_INPUT) {
    sprout_stored_refuse(refusal, "", "the store is not JSON: ", error.text, ".");
  } else if (status == SPROUT_OK) {
    memset(&r, 0, sizeof r);
    r.state = state;
    r.refusal = refusal;
    status = read_world(&r, root);
  }
  sprout_arena_reset(&scratch);
  if (status != SPROUT_OK) {
    sprout_state_free(state);
    return status;
  }
  *out = state;
  return SPROUT_OK;
}

sprout_status sprout_state_read(const sprout_host *host, const char *bytes, size_t length,
                                sprout_state **out, sprout_refusal *refusal) {
  sprout_status status = sprout_state_read_shape(host, bytes, length, out, refusal);
  if (status != SPROUT_OK) return status;
  status = sprout_state_check(*out, refusal);
  if (status != SPROUT_OK) {
    sprout_state_free(*out);
    *out = NULL;
  }
  return status;
}

void sprout_state_free(sprout_state *state) {
  sprout_arena anchor, data, contents;
  sprout_host host;
  if (state == NULL) return;
  /* The struct lives in the anchor's page, so the arenas are released through copies. */
  host = state->host;
  anchor = state->anchor;
  data = state->arena;
  contents = state->contents.arena;
  anchor.host = &host;
  data.host = &host;
  contents.host = &host;
  sprout_arena_reset(&contents);
  sprout_arena_reset(&data);
  sprout_arena_reset(&anchor);
}
