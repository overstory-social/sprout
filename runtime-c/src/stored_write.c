/*
 * Writing the stored world in its canonical form (the spec's The host
 * contract > Storage): keys in the stored schema's order, members in the order
 * held, no white space, whole numbers as digits, and the escapes
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
  if (t->bytes == NULL) {
    t->length += count;
    return;
  }
  if (t->failed) return;
  if (t->length + count + 1 > t->capacity) {
    t->failed = true;
    return;
  }
  memcpy(t->bytes + t->length, bytes, count);
  t->length += count;
}

static void put_char(text *t, char c) {
  if (t->bytes != NULL) {
    if (t->failed) return;
    if (t->length + 2 > t->capacity) {
      t->failed = true;
      return;
    }
    t->bytes[t->length] = c;
  }
  t->length++;
}

/* A string literal, its length known where it is written. */
#define PUT(t, literal) put((t), (literal), sizeof(literal) - 1)

/* The escape a byte takes in a JSON string, or NULL where it is written as it is. */
static const char *escape_of(unsigned char c) {
  switch (c) {
    case '"':
      return "\\\"";
    case '\\':
      return "\\\\";
    case '\b':
      return "\\b";
    case '\f':
      return "\\f";
    case '\n':
      return "\\n";
    case '\r':
      return "\\r";
    case '\t':
      return "\\t";
    default:
      return NULL;
  }
}

/* Runs of bytes that need no escape go in one piece. */
static void put_string(text *t, sprout_str s) {
  static const char digits[] = "0123456789abcdef";
  size_t i = 0, run;
  put_char(t, '"');
  while (i < s.length) {
    unsigned char c;
    for (run = i; run < s.length; run++) {
      c = (unsigned char)s.bytes[run];
      if (c < 0x20 || c == '"' || c == '\\') break;
    }
    if (run > i) put(t, s.bytes + i, run - i);
    if (run == s.length) break;
    c = (unsigned char)s.bytes[run];
    if (escape_of(c) != NULL) {
      put(t, escape_of(c), 2);
    } else {
      char escape[6] = {'\\', 'u', '0', '0', digits[c >> 4], digits[c & 15]};
      put(t, escape, 6);
    }
    i = run + 1;
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
      if (value->boolean) PUT(t, "true");
      else PUT(t, "false");
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

static void put_property(text *t, const sprout_stored_property *p) {
  PUT(t, "{\"type\":");
  put_string(t, p->type);
  PUT(t, ",\"value\":");
  put_value(t, &p->value);
  put_char(t, '}');
}

static void put_properties(text *t, size_t count, const sprout_stored_property *list) {
  size_t i;
  put_char(t, '{');
  for (i = 0; i < count; i++) {
    if (i > 0) put_char(t, ',');
    put_string(t, list[i].name);
    put_char(t, ':');
    put_property(t, &list[i]);
  }
  put_char(t, '}');
}

/* Whether two items of a list default are one value, as reading the default keeps it: an option is its text. */
static bool same_literal(const sprout_literal *a, const sprout_literal *b) {
  bool a_text = a->kind == SPROUT_LITERAL_STRING || a->kind == SPROUT_LITERAL_OPTION;
  bool b_text = b->kind == SPROUT_LITERAL_STRING || b->kind == SPROUT_LITERAL_OPTION;
  size_t i;
  if (a_text || b_text) return a_text && b_text && strcmp(a->text, b->text) == 0;
  if (a->kind != b->kind) return false;
  switch (a->kind) {
    case SPROUT_LITERAL_BOOLEAN:
      return a->boolean == b->boolean;
    case SPROUT_LITERAL_NUMBER:
      return a->number == b->number;
    case SPROUT_LITERAL_LIST:
      if (a->count != b->count) return false;
      for (i = 0; i < a->count; i++)
        if (!same_literal(&a->items[i], &b->items[i])) return false;
      return true;
    default:
      return false;
  }
}

/* A declared default as its stored value is written: a list without its repeats, as reading it drops them. */
static void put_literal(text *t, const sprout_literal *literal) {
  size_t i, j;
  bool first = true;
  switch (literal->kind) {
    case SPROUT_LITERAL_BOOLEAN:
      if (literal->boolean) PUT(t, "true");
      else PUT(t, "false");
      return;
    case SPROUT_LITERAL_NUMBER:
      put_number(t, literal->number);
      return;
    case SPROUT_LITERAL_STRING:
    case SPROUT_LITERAL_OPTION:
      put_cstring(t, literal->text);
      return;
    case SPROUT_LITERAL_LIST:
      put_char(t, '[');
      for (i = 0; i < literal->count; i++) {
        bool repeats = false;
        for (j = 0; j < i && !repeats; j++) repeats = same_literal(&literal->items[j], &literal->items[i]);
        if (repeats) continue;
        if (!first) put_char(t, ',');
        first = false;
        put_literal(t, &literal->items[i]);
      }
      put_char(t, ']');
      return;
  }
}

/* The property the record keeps under `name`, of `length` bytes, or NULL. */
static const sprout_stored_property *held_property(const sprout_stored_instance *in, const char *name, size_t length) {
  size_t i;
  for (i = 0; i < in->property_count; i++) {
    const sprout_stored_property *held = &in->properties[i];
    if (held->name.length == length && memcmp(held->name.bytes, name, length) == 0) return held;
  }
  return NULL;
}

/*
 * An opened record's properties: every plain property its kind declares, in name order (the kind's
 * `by_name`), each as the record keeps it or, where it keeps none, at its default (state.h). A
 * record not opened against a kind is written as held.
 */
static void put_record_properties(text *t, const sprout_stored_instance *in) {
  size_t i;
  if (in->kind == NULL || in->dormant) {
    put_properties(t, in->property_count, in->properties);
    return;
  }
  put_char(t, '{');
  for (i = 0; i < in->kind->plain_count; i++) {
    const sprout_property *declared = in->kind->by_name[i];
    size_t length = strlen(declared->name);
    const sprout_stored_property *held = held_property(in, declared->name, length);
    sprout_str name;
    name.bytes = declared->name;
    name.length = length;
    if (i > 0) put_char(t, ',');
    put_string(t, name);
    put_char(t, ':');
    if (held != NULL) {
      put_property(t, held);
    } else {
      PUT(t, "{\"type\":");
      put_cstring(t, declared->type->key);
      PUT(t, ",\"value\":");
      put_literal(t, &declared->default_value);
      put_char(t, '}');
    }
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

static void put_instance(text *t, const sprout_stored_instance *in) {
  size_t i;
  PUT(t, "{\"id\":");
  put_string(t, in->id);
  PUT(t, ",\"made\":{\"from\":");
  put_cstring(t, made_word(in->made));
  if (in->made == SPROUT_MADE_SPAWNED || in->made == SPROUT_MADE_GIVEN) {
    PUT(t, ",\"kind\":");
    put_string(t, in->made_kind);
  }
  if (in->made == SPROUT_MADE_GIVEN) {
    PUT(t, ",\"path\":");
    put_ids(t, in->path_count, in->path);
  }
  PUT(t, "},\"container\":");
  if (in->has_container) put_string(t, in->container);
  else PUT(t, "null");
  PUT(t, ",\"arrival\":");
  if (in->has_arrival) put_whole(t, in->arrival);
  else PUT(t, "null");
  PUT(t, ",\"properties\":");
  put_record_properties(t, in);
  PUT(t, ",\"links\":{");
  for (i = 0; i < in->link_count; i++) {
    if (i > 0) put_char(t, ',');
    put_string(t, in->links[i].name);
    put_char(t, ':');
    put_string(t, in->links[i].to);
  }
  PUT(t, "},\"wakes\":[");
  for (i = 0; i < in->wake_count; i++) {
    if (i > 0) put_char(t, ',');
    PUT(t, "{\"serial\":");
    put_whole(t, in->wakes[i].serial);
    PUT(t, ",\"askedAt\":");
    put_whole(t, in->wakes[i].asked_at);
    PUT(t, ",\"dueAt\":");
    put_whole(t, in->wakes[i].due_at);
    put_char(t, '}');
  }
  PUT(t, "],\"memory\":{");
  for (i = 0; i < in->memory_count; i++) {
    if (i > 0) put_char(t, ',');
    put_string(t, in->memory[i].actor);
    put_char(t, ':');
    put_properties(t, in->memory[i].count, in->memory[i].properties);
  }
  PUT(t, "},\"lastTick\":");
  if (in->has_last_tick) put_whole(t, in->last_tick);
  else PUT(t, "null");
  put_char(t, '}');
}

static void put_bound(text *t, const sprout_stored_bound *b) {
  switch (b->kind) {
    case SPROUT_BOUND_OBJECT:
      PUT(t, "{\"object\":");
      put_string(t, b->object);
      break;
    case SPROUT_BOUND_SET:
      PUT(t, "{\"set\":");
      put_ids(t, b->set_count, b->set);
      break;
    case SPROUT_BOUND_VALUE:
      PUT(t, "{\"value\":");
      if (b->value_is_string) put_string(t, b->value_string);
      else put_number(t, b->value_number);
      break;
    case SPROUT_BOUND_EXIT:
      PUT(t, "{\"exit\":{\"direction\":");
      if (b->has_direction) put_string(t, b->direction);
      else PUT(t, "null");
      PUT(t, ",\"label\":");
      put_string(t, b->label);
      PUT(t, ",\"to\":");
      put_string(t, b->to);
      put_char(t, '}');
      break;
  }
  put_char(t, '}');
}

static void put_visitor(text *t, const sprout_stored_visitor *v) {
  size_t i;
  PUT(t, "{\"visit\":");
  put_string(t, v->visit);
  PUT(t, ",\"nickname\":");
  put_string(t, v->nickname);
  PUT(t, ",\"instance\":");
  put_string(t, v->instance);
  PUT(t, ",\"lastPlace\":");
  if (v->has_last_place) put_string(t, v->last_place);
  else PUT(t, "null");
  PUT(t, ",\"referents\":");
  put_ids(t, v->referent_count, v->referents);
  PUT(t, ",\"lastReading\":");
  if (!v->has_reading) {
    PUT(t, "null");
  } else {
    PUT(t, "{\"verb\":{\"library\":");
    put_string(t, v->reading.library);
    PUT(t, ",\"name\":");
    put_string(t, v->reading.name);
    PUT(t, "},\"bindings\":[");
    for (i = 0; i < v->reading.binding_count; i++) {
      if (i > 0) put_char(t, ',');
      put_char(t, '[');
      put_string(t, v->reading.bindings[i].role);
      put_char(t, ',');
      put_bound(t, &v->reading.bindings[i].bound);
      put_char(t, ']');
    }
    PUT(t, "]}");
  }
  put_char(t, '}');
}

static void put_state(text *t, const sprout_state *state) {
  size_t i;
  PUT(t, "{\"world\":");
  put_string(t, state->world);
  PUT(t, ",\"serial\":");
  put_whole(t, state->serial);
  PUT(t, ",\"instances\":[");
  for (i = 0; i < state->instance_count; i++) {
    if (i > 0) put_char(t, ',');
    put_instance(t, &state->instances[i]);
  }
  PUT(t, "],\"visitors\":[");
  for (i = 0; i < state->visitor_count; i++) {
    if (i > 0) put_char(t, ',');
    put_visitor(t, &state->visitors[i]);
  }
  PUT(t, "],\"tombstones\":");
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
  PUT(t, "{\"serial\":");
  put_whole(t, changes->serial);
  PUT(t, ",\"upsert\":[");
  for (i = 0; i < changes->upsert_count; i++) {
    const sprout_stored_instance *record = sprout_state_find(state, changes->upsert[i]);
    if (record == NULL) {
      t->unwritable = true;
      return;
    }
    if (i > 0) put_char(t, ',');
    put_instance(t, record);
  }
  PUT(t, "],\"remove\":");
  put_ids(t, changes->remove_count, changes->remove);
  PUT(t, ",\"tombstones\":");
  put_ids(t, changes->tombstone_count, changes->tombstones);
  PUT(t, ",\"visitors\":[");
  for (i = 0; i < changes->visitor_count; i++) {
    const sprout_stored_visitor *record = sprout_state_find_visitor(state, changes->visitors[i]);
    if (record == NULL) {
      t->unwritable = true;
      return;
    }
    if (i > 0) put_char(t, ',');
    put_visitor(t, record);
  }
  PUT(t, "]}");
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
