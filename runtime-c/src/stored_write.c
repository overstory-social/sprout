/*
 * Writing the stored world in its canonical form (the spec's The host
 * contract > Storage): keys in the stored schema's order, members in the order
 * held, no white space, whole numbers as digits, and the escapes
 * JSON.stringify makes. The text is built in the state's arena.
 */
#include <string.h>

#include "state.h"

typedef struct text {
  sprout_arena *arena;
  char *bytes;
  size_t length, capacity;
  bool failed;
  bool unwritable; /* a number the stored form does not write */
} text;

static void put(text *t, const char *bytes, size_t count) {
  if (t->failed) return;
  if (t->length + count + 1 > t->capacity) {
    size_t wanted = t->capacity == 0 ? 4096 : t->capacity;
    char *bigger;
    while (wanted < t->length + count + 1) wanted *= 2;
    bigger = (char *)sprout_arena_take(t->arena, wanted);
    if (bigger == NULL) {
      t->failed = true;
      return;
    }
    if (t->length > 0) memcpy(bigger, t->bytes, t->length);
    t->bytes = bigger;
    t->capacity = wanted;
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

static void put_property(text *t, const sprout_stored_property *p) {
  put_text(t, "{\"type\":");
  put_string(t, p->type);
  put_text(t, ",\"value\":");
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
  put_text(t, "{\"id\":");
  put_string(t, in->id);
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
  put_text(t, "},\"container\":");
  if (in->has_container) put_string(t, in->container);
  else put_text(t, "null");
  put_text(t, ",\"arrival\":");
  if (in->has_arrival) put_whole(t, in->arrival);
  else put_text(t, "null");
  put_text(t, ",\"properties\":");
  put_properties(t, in->property_count, in->properties);
  put_text(t, ",\"links\":{");
  for (i = 0; i < in->link_count; i++) {
    if (i > 0) put_char(t, ',');
    put_string(t, in->links[i].name);
    put_char(t, ':');
    put_string(t, in->links[i].to);
  }
  put_text(t, "},\"wakes\":[");
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
  put_text(t, "],\"memory\":{");
  for (i = 0; i < in->memory_count; i++) {
    if (i > 0) put_char(t, ',');
    put_string(t, in->memory[i].actor);
    put_char(t, ':');
    put_properties(t, in->memory[i].count, in->memory[i].properties);
  }
  put_text(t, "},\"lastTick\":");
  if (in->has_last_tick) put_whole(t, in->last_tick);
  else put_text(t, "null");
  put_char(t, '}');
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

sprout_status sprout_state_write(sprout_state *state, const char **bytes, size_t *length) {
  text t;
  size_t i;
  memset(&t, 0, sizeof t);
  t.arena = &state->arena;
  put_text(&t, "{\"world\":");
  put_string(&t, state->world);
  put_text(&t, ",\"serial\":");
  put_whole(&t, state->serial);
  put_text(&t, ",\"instances\":[");
  for (i = 0; i < state->instance_count; i++) {
    if (i > 0) put_char(&t, ',');
    put_instance(&t, &state->instances[i]);
  }
  put_text(&t, "],\"visitors\":[");
  for (i = 0; i < state->visitor_count; i++) {
    if (i > 0) put_char(&t, ',');
    put_visitor(&t, &state->visitors[i]);
  }
  put_text(&t, "],\"tombstones\":");
  put_ids(&t, state->tombstone_count, state->tombstones);
  put_char(&t, '}');
  if (t.failed) return SPROUT_NO_MEMORY;
  if (t.unwritable) return SPROUT_BAD_INPUT;
  t.bytes[t.length] = '\0';
  *bytes = t.bytes;
  *length = t.length;
  return SPROUT_OK;
}
