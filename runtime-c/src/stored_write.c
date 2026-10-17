/*
 * Writing the stored world in its canonical form (the spec's The host
 * contract > Storage): the diff of the live state from the world a fresh load
 * makes. An instance is written only where something about it differs from
 * its declaration (a minted one always), and a written record carries only
 * the fields that differ: keys in the stored schema's order, members in the
 * order held, no white space, whole numbers as digits, and the escapes
 * JSON.stringify makes. The text is measured first and then taken once, at
 * its size, from the arena the caller gives, so a save of any size costs
 * that arena its own length and the state's arena nothing.
 */
#include <string.h>

#include "sprout.h"
#include "state.h"

typedef struct text {
  char *bytes; /* NULL while measuring */
  size_t length, capacity;
  bool failed;
  bool unwritable; /* a number the stored form does not write, or a changed record the state does not hold */
} text;

/* Appends `count` bytes; the measuring pass only counts them into `length`, so the text is taken once, at its size. */
static void put(text *t, const char *bytes, size_t count) {
  if (t->failed) return;
  if (t->bytes == NULL) {
    t->length += count;
    return;
  }
  if (t->length + count + 1 > t->capacity) {
    t->failed = true;
    return;
  }
  memcpy(t->bytes + t->length, bytes, count);
  t->length += count;
}

static void put_text(text *t, const char *s) { put(t, s, strlen(s)); }
static void put_char(text *t, char c) { put(t, &c, 1); }

static void put_string(text *t, sprout_str s) {
  static const char digits[] = "0123456789abcdef";
  size_t i;
  put_char(t, '"');
  for (i = 0; i < s.length; i++) {
    unsigned char c = (unsigned char)s.bytes[i];
    switch (c) {
      case '"':
        put_text(t, "\\\"");
        break;
      case '\\':
        put_text(t, "\\\\");
        break;
      case '\b':
        put_text(t, "\\b");
        break;
      case '\f':
        put_text(t, "\\f");
        break;
      case '\n':
        put_text(t, "\\n");
        break;
      case '\r':
        put_text(t, "\\r");
        break;
      case '\t':
        put_text(t, "\\t");
        break;
      default:
        if (c < 0x20) {
          char escape[6] = {'\\', 'u', '0', '0', digits[c >> 4], digits[c & 15]};
          put(t, escape, 6);
        } else {
          put_char(t, (char)c);
        }
    }
  }
  put_char(t, '"');
}

static void put_cstring(text *t, const char *s) {
  sprout_str str;
  str.bytes = s;
  str.length = strlen(s);
  put_string(t, str);
}

static void put_number(text *t, double number) {
  char digits[40];
  size_t length;
  if (!sprout_number_text(number, digits, sizeof digits, &length)) {
    t->unwritable = true;
    return;
  }
  put(t, digits, length);
}

static void put_value(text *t, const sprout_stored_value *value) {
  size_t i;
  switch (value->kind) {
    case SPROUT_BOOL:
      put_text(t, value->boolean ? "true" : "false");
      break;
    case SPROUT_NUMBER:
      put_number(t, value->number);
      break;
    case SPROUT_STRING:
      put_string(t, value->string);
      break;
    case SPROUT_LIST:
      put_char(t, '[');
      for (i = 0; i < value->count; i++) {
        if (i > 0) put_char(t, ',');
        put_value(t, &value->items[i]);
      }
      put_char(t, ']');
      break;
  }
}

/* Whether a held value is one the record need not write: its property's declared default, under `kind`. */
static bool at_default(const sprout_kind_def *kind, const sprout_stored_property *p) {
  const sprout_property *declared;
  char name[128];
  if (kind == NULL || p->name.length >= sizeof name) return false;
  memcpy(name, p->name.bytes, p->name.length);
  name[p->name.length] = '\0';
  declared = sprout_kind_property(kind, name);
  return declared != NULL && sprout_value_is_default(declared, &p->value);
}

/* Whether any of a record's held properties is other than its default. */
static bool any_differs(const sprout_kind_def *kind, size_t count, const sprout_stored_property *list) {
  size_t i;
  for (i = 0; i < count; i++)
    if (!at_default(kind, &list[i])) return true;
  return false;
}

/* `{"name":value,...}` of the held properties not at their default. */
static void put_property_map(text *t, const sprout_kind_def *kind, size_t count, const sprout_stored_property *list) {
  size_t i;
  bool first = true;
  put_char(t, '{');
  for (i = 0; i < count; i++) {
    if (at_default(kind, &list[i])) continue;
    if (!first) put_char(t, ',');
    first = false;
    put_string(t, list[i].name);
    put_char(t, ':');
    put_value(t, &list[i].value);
  }
  put_char(t, '}');
}

static void put_ids(text *t, size_t count, const sprout_str *ids) {
  size_t i;
  put_char(t, '[');
  for (i = 0; i < count; i++) {
    if (i > 0) put_char(t, ',');
    put_string(t, ids[i]);
  }
  put_char(t, ']');
}

static void put_whole(text *t, uint64_t n) { put_number(t, (double)n); }

/* `,"key":`: every member after the id follows a comma. */
static void put_key(text *t, const char *key) {
  put_text(t, ",\"");
  put_text(t, key);
  put_text(t, "\":");
}

static const char *made_word(sprout_made_from made) {
  switch (made) {
    case SPROUT_MADE_WORLD:
      return "world";
    case SPROUT_MADE_DECLARED:
      return "declared";
    case SPROUT_MADE_VISITOR:
      return "visitor";
    case SPROUT_MADE_SPAWNED:
      return "spawned";
    case SPROUT_MADE_GIVEN:
      return "given";
  }
  return "";
}

/* Whether a declared record's container is other than where it was declared. */
static bool moved(const sprout_stored_instance *in) {
  return in->has_container && !sprout_str_same(in->container, sprout_declared_container(in->id));
}

/* The record in the diff form: its id, and then only what differs from the fresh load. */
static void put_instance(text *t, const sprout_stored_instance *in) {
  size_t i;
  bool first = true; /* of the memory's actors */
  put_text(t, "{\"id\":");
  put_string(t, in->id);
  if (in->made != SPROUT_MADE_WORLD && in->made != SPROUT_MADE_DECLARED) {
    put_text(t, ",\"made\":{\"from\":");
    put_cstring(t, made_word(in->made));
    if (in->made == SPROUT_MADE_SPAWNED || in->made == SPROUT_MADE_GIVEN) {
      put_text(t, ",\"kind\":");
      put_string(t, in->made_kind);
    }
    if (in->made == SPROUT_MADE_GIVEN) {
      put_text(t, ",\"path\":");
      put_ids(t, in->path_count, in->path);
    }
    put_char(t, '}');
  }
  if (in->made == SPROUT_MADE_DECLARED ? moved(in) : (in->made != SPROUT_MADE_WORLD && in->has_container)) {
    put_key(t, "container");
    put_string(t, in->container);
  }
  if (in->has_arrival) {
    put_key(t, "arrival");
    put_whole(t, in->arrival);
  }
  if (any_differs(in->kind, in->property_count, in->properties)) {
    put_key(t, "properties");
    put_property_map(t, in->kind, in->property_count, in->properties);
  }
  if (in->link_count > 0) {
    put_key(t, "links");
    put_char(t, '{');
    for (i = 0; i < in->link_count; i++) {
      if (i > 0) put_char(t, ',');
      put_string(t, in->links[i].name);
      put_char(t, ':');
      put_string(t, in->links[i].to);
    }
    put_char(t, '}');
  }
  if (in->wake_count > 0) {
    put_key(t, "wakes");
    put_char(t, '[');
    for (i = 0; i < in->wake_count; i++) {
      if (i > 0) put_char(t, ',');
      put_text(t, "{\"serial\":");
      put_whole(t, in->wakes[i].serial);
      put_text(t, ",\"askedAt\":");
      put_whole(t, in->wakes[i].asked_at);
      put_text(t, ",\"dueAt\":");
      put_whole(t, in->wakes[i].due_at);
      put_char(t, '}');
    }
    put_char(t, ']');
  }
  for (i = 0; i < in->memory_count; i++) {
    if (!any_differs(in->kind, in->memory[i].count, in->memory[i].properties)) continue;
    if (first) put_key(t, "memory");
    put_char(t, first ? '{' : ',');
    first = false;
    put_string(t, in->memory[i].actor);
    put_char(t, ':');
    put_property_map(t, in->kind, in->memory[i].count, in->memory[i].properties);
  }
  if (!first) put_char(t, '}');
  if (in->has_last_tick) {
    put_key(t, "lastTick");
    put_whole(t, in->last_tick);
  }
  put_char(t, '}');
}

/* Whether a record of the world or a declared object has anything to write: the fresh load makes the rest. */
static bool differs(const sprout_stored_instance *in) {
  size_t i;
  if (in->made != SPROUT_MADE_WORLD && in->made != SPROUT_MADE_DECLARED) return true;
  if (in->made == SPROUT_MADE_DECLARED && moved(in)) return true;
  if (in->has_arrival || in->link_count > 0 || in->wake_count > 0 || in->has_last_tick) return true;
  if (any_differs(in->kind, in->property_count, in->properties)) return true;
  for (i = 0; i < in->memory_count; i++)
    if (any_differs(in->kind, in->memory[i].count, in->memory[i].properties)) return true;
  return false;
}

static void put_bound(text *t, const sprout_stored_bound *b) {
  switch (b->kind) {
    case SPROUT_BOUND_OBJECT:
      put_text(t, "{\"object\":");
      put_string(t, b->object);
      break;
    case SPROUT_BOUND_SET:
      put_text(t, "{\"set\":");
      put_ids(t, b->set_count, b->set);
      break;
    case SPROUT_BOUND_VALUE:
      put_text(t, "{\"value\":");
      if (b->value_is_string) put_string(t, b->value_string);
      else put_number(t, b->value_number);
      break;
    case SPROUT_BOUND_EXIT:
      put_text(t, "{\"exit\":{\"direction\":");
      if (b->has_direction) put_string(t, b->direction);
      else put_text(t, "null");
      put_text(t, ",\"label\":");
      put_string(t, b->label);
      put_text(t, ",\"to\":");
      put_string(t, b->to);
      put_char(t, '}');
      break;
  }
  put_char(t, '}');
}

static void put_visitor(text *t, const sprout_stored_visitor *v) {
  size_t i;
  put_text(t, "{\"visit\":");
  put_string(t, v->visit);
  put_text(t, ",\"nickname\":");
  put_string(t, v->nickname);
  put_text(t, ",\"instance\":");
  put_string(t, v->instance);
  put_text(t, ",\"lastPlace\":");
  if (v->has_last_place) put_string(t, v->last_place);
  else put_text(t, "null");
  put_text(t, ",\"referents\":");
  put_ids(t, v->referent_count, v->referents);
  put_text(t, ",\"lastReading\":");
  if (!v->has_reading) {
    put_text(t, "null");
  } else {
    put_text(t, "{\"verb\":{\"library\":");
    put_string(t, v->reading.library);
    put_text(t, ",\"name\":");
    put_string(t, v->reading.name);
    put_text(t, "},\"bindings\":[");
    for (i = 0; i < v->reading.binding_count; i++) {
      if (i > 0) put_char(t, ',');
      put_char(t, '[');
      put_string(t, v->reading.bindings[i].role);
      put_char(t, ',');
      put_bound(t, &v->reading.bindings[i].bound);
      put_char(t, ']');
    }
    put_text(t, "]}");
  }
  put_char(t, '}');
}

static void put_state(text *t, const sprout_state *state) {
  size_t i;
  bool first = true;
  put_text(t, "{\"world\":");
  put_string(t, state->world);
  put_text(t, ",\"serial\":");
  put_whole(t, state->serial);
  put_text(t, ",\"instances\":[");
  for (i = 0; i < state->instance_count; i++) {
    if (!differs(&state->instances[i])) continue;
    if (!first) put_char(t, ',');
    first = false;
    put_instance(t, &state->instances[i]);
  }
  put_text(t, "],\"visitors\":[");
  for (i = 0; i < state->visitor_count; i++) {
    if (i > 0) put_char(t, ',');
    put_visitor(t, &state->visitors[i]);
  }
  put_text(t, "],\"tombstones\":");
  put_ids(t, state->tombstone_count, state->tombstones);
  put_char(t, '}');
}

sprout_status sprout_state_write(const sprout_state *state, sprout_arena *scratch, const char **bytes,
                                 size_t *length) {
  text t;
  memset(&t, 0, sizeof t);
  put_state(&t, state);
  if (t.unwritable) return SPROUT_BAD_INPUT;
  t.capacity = t.length + 1;
  t.bytes = (char *)sprout_arena_take(scratch, t.capacity);
  if (t.bytes == NULL) return SPROUT_NO_MEMORY;
  t.length = 0;
  put_state(&t, state);
  if (t.failed) return SPROUT_NO_MEMORY;
  t.bytes[t.length] = '\0';
  *bytes = t.bytes;
  *length = t.length;
  return SPROUT_OK;
}

/* A turn's changes, `{serial, upsert, remove, tombstones, visitors}`, the records read from `state`. */
static void put_changes(text *t, const sprout_state *state, const sprout_stored_changes *changes) {
  size_t i;
  put_text(t, "{\"serial\":");
  put_whole(t, changes->serial);
  put_text(t, ",\"upsert\":[");
  for (i = 0; i < changes->upsert_count; i++) {
    const sprout_stored_instance *record = sprout_state_find(state, changes->upsert[i]);
    if (record == NULL) {
      t->unwritable = true;
      return;
    }
    if (i > 0) put_char(t, ',');
    put_instance(t, record);
  }
  put_text(t, "],\"remove\":");
  put_ids(t, changes->remove_count, changes->remove);
  put_text(t, ",\"tombstones\":");
  put_ids(t, changes->tombstone_count, changes->tombstones);
  put_text(t, ",\"visitors\":[");
  for (i = 0; i < changes->visitor_count; i++) {
    const sprout_stored_visitor *record = sprout_state_find_visitor(state, changes->visitors[i]);
    if (record == NULL) {
      t->unwritable = true;
      return;
    }
    if (i > 0) put_char(t, ',');
    put_visitor(t, record);
  }
  put_text(t, "]}");
}

sprout_status sprout_changes_write(const sprout_state *state, const sprout_stored_changes *changes,
                                   sprout_arena *scratch, const char **bytes, size_t *length) {
  text t;
  memset(&t, 0, sizeof t);
  put_changes(&t, state, changes);
  /* A record the changes name that the state does not hold: the state is not the one the turn left. */
  if (t.unwritable) return SPROUT_BAD_INPUT;
  t.capacity = t.length + 1;
  t.bytes = (char *)sprout_arena_take(scratch, t.capacity);
  if (t.bytes == NULL) return SPROUT_NO_MEMORY;
  t.length = 0;
  put_changes(&t, state, changes);
  if (t.failed) return SPROUT_NO_MEMORY;
  t.bytes[t.length] = '\0';
  *bytes = t.bytes;
  *length = t.length;
  return SPROUT_OK;
}
