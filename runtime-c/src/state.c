/*
 * A state read against the world it belongs to (the spec's The runtime >
 * State; The compiler > What absent means). Opening lays the stored diff over
 * the world a fresh load makes: every record is read under its declaration,
 * and one the declaration cannot explain, a property the kind does not
 * declare or a value not of its type is refused in a sentence naming the
 * record, since a save is keyed to the cartridge that wrote it; the declared
 * objects nothing is stored for are made at their defaults, and never one
 * past its tombstone. Records end up in the order a save writes them.
 */
#include <string.h>

#include "state.h"

#define PASS(expr)                        \
  do {                                    \
    sprout_status pass_ = (expr);         \
    if (pass_ != SPROUT_OK) return pass_; \
  } while (0)

/* ---- lookups and order ---- */

static int by_instance_id(const void *a, const void *b) {
  return sprout_str_compare(((const sprout_stored_instance *)a)->id, ((const sprout_stored_instance *)b)->id);
}
static int by_visit(const void *a, const void *b) {
  return sprout_str_compare(((const sprout_stored_visitor *)a)->visit, ((const sprout_stored_visitor *)b)->visit);
}
static int by_string(const void *a, const void *b) {
  return sprout_str_compare(*(const sprout_str *)a, *(const sprout_str *)b);
}
static int by_property_name(const void *a, const void *b) {
  return sprout_str_compare(((const sprout_stored_property *)a)->name, ((const sprout_stored_property *)b)->name);
}
static int by_link_name(const void *a, const void *b) {
  return sprout_str_compare(((const sprout_stored_link *)a)->name, ((const sprout_stored_link *)b)->name);
}
static int by_actor(const void *a, const void *b) {
  return sprout_str_compare(((const sprout_stored_memory *)a)->actor, ((const sprout_stored_memory *)b)->actor);
}

/*
 * A stable merge sort of `count` records of `size` bytes in place, through
 * `scratch`; the library has no qsort. Records are moved as bytes, which is
 * safe for the plain structs the state holds.
 */
static sprout_status sort_records(sprout_arena *arena, void *records, size_t count, size_t size,
                                  int (*compare)(const void *, const void *)) {
  char *a = (char *)records, *tmp;
  size_t width, i;
  if (count < 2) return SPROUT_OK;
  tmp = (char *)sprout_arena_take(arena, count * size);
  if (tmp == NULL) return SPROUT_NO_MEMORY;
  for (width = 1; width < count; width *= 2) {
    for (i = 0; i < count; i += 2 * width) {
      size_t mid = i + width < count ? i + width : count;
      size_t right = i + 2 * width < count ? i + 2 * width : count;
      size_t l = i, r = mid, k = i;
      while (l < mid && r < right) {
        if (compare(a + l * size, a + r * size) <= 0) memcpy(tmp + k++ * size, a + l++ * size, size);
        else memcpy(tmp + k++ * size, a + r++ * size, size);
      }
      while (l < mid) memcpy(tmp + k++ * size, a + l++ * size, size);
      while (r < right) memcpy(tmp + k++ * size, a + r++ * size, size);
    }
    memcpy(a, tmp, count * size);
  }
  return SPROUT_OK;
}

sprout_status sprout_state_sort(sprout_state *state, sprout_arena *scratch) {
  sprout_status status;
  status = sort_records(scratch, state->instances, state->instance_count, sizeof *state->instances, by_instance_id);
  if (status != SPROUT_OK) return status;
  status = sort_records(scratch, state->visitors, state->visitor_count, sizeof *state->visitors, by_visit);
  if (status != SPROUT_OK) return status;
  status = sort_records(scratch, state->tombstones, state->tombstone_count, sizeof *state->tombstones, by_string);
  if (status != SPROUT_OK) return status;
  state->instances_sorted = state->visitors_sorted = state->tombstones_sorted = true;
  return SPROUT_OK;
}

/* The slack an array is rebuilt with, so the commits after it insert in place: an eighth, and eight at least. */
static size_t with_slack(size_t count) { return count + count / 8 + 8; }

bool sprout_state_has_room(const sprout_state *state, size_t instances, size_t visitors, size_t tombstones) {
  return state->instances_sorted && state->visitors_sorted && state->tombstones_sorted &&
         state->instance_count + instances <= state->instance_capacity &&
         state->visitor_count + visitors <= state->visitor_capacity &&
         state->tombstone_count + tombstones <= state->tombstone_capacity;
}

sprout_status sprout_state_rebuild(sprout_state *state, size_t instances, size_t visitors, size_t tombstones) {
  sprout_arena fresh, stale;
  sprout_stored_instance *all;
  sprout_stored_visitor *visits;
  sprout_str *stones, world;
  size_t i, instance_capacity = with_slack(state->instance_count + instances),
            visitor_capacity = with_slack(state->visitor_count + visitors),
            tombstone_capacity = with_slack(state->tombstone_count + tombstones);
  sprout_status status = sprout_arena_init(&fresh, &state->host);
  if (status != SPROUT_OK) return status;
  all = (sprout_stored_instance *)sprout_arena_take(&fresh, instance_capacity * sizeof *all);
  visits = (sprout_stored_visitor *)sprout_arena_take(&fresh, visitor_capacity * sizeof *visits);
  stones = (sprout_str *)sprout_arena_take(&fresh, tombstone_capacity * sizeof *stones);
  status = all == NULL || visits == NULL || stones == NULL || !sprout_state_copy_str(&fresh, state->world, &world)
               ? SPROUT_NO_MEMORY
               : SPROUT_OK;
  for (i = 0; status == SPROUT_OK && i < state->instance_count; i++)
    status = sprout_stored_instance_copy(&fresh, &state->instances[i], &all[i]);
  for (i = 0; status == SPROUT_OK && i < state->visitor_count; i++)
    status = sprout_stored_visitor_copy(&fresh, &state->visitors[i], &visits[i]);
  for (i = 0; status == SPROUT_OK && i < state->tombstone_count; i++)
    if (!sprout_state_copy_str(&fresh, state->tombstones[i], &stones[i])) status = SPROUT_NO_MEMORY;
  if (status != SPROUT_OK) {
    sprout_arena_reset(&fresh);
    return status;
  }
  stale = state->arena;
  state->arena = fresh;
  state->world = world;
  state->instances = all;
  state->instance_capacity = instance_capacity;
  state->visitors = visits;
  state->visitor_capacity = visitor_capacity;
  state->tombstones = stones;
  state->tombstone_capacity = tombstone_capacity;
  /* The old arena is the sort's scratch, so the rebuilt one holds the records and nothing else. */
  status = state->instances_sorted && state->visitors_sorted && state->tombstones_sorted
               ? SPROUT_OK
               : sprout_state_sort(state, &stale);
  sprout_arena_reset(&stale);
  state->settled = state->arena.held;
  return status;
}

bool sprout_state_crowded(const sprout_state *state) {
  return state->arena.held > state->settled + state->settled / 4 + state->host.page_bytes;
}

sprout_status sprout_state_compact(sprout_state *state) { return sprout_state_rebuild(state, 0, 0, 0); }

sprout_stored_instance *sprout_state_find(const sprout_state *state, sprout_str id) {
  size_t lo = 0, hi = state->instance_count;
  if (!state->instances_sorted) {
    for (lo = 0; lo < hi; lo++)
      if (sprout_str_same(state->instances[lo].id, id)) return &state->instances[lo];
    return NULL;
  }
  while (lo < hi) {
    size_t mid = lo + (hi - lo) / 2;
    int order = sprout_str_compare(state->instances[mid].id, id);
    if (order == 0) return &state->instances[mid];
    if (order < 0) lo = mid + 1;
    else hi = mid;
  }
  return NULL;
}

sprout_stored_visitor *sprout_state_find_visitor(const sprout_state *state, sprout_str visit) {
  size_t i;
  for (i = 0; i < state->visitor_count; i++)
    if (sprout_str_same(state->visitors[i].visit, visit)) return &state->visitors[i];
  return NULL;
}

bool sprout_state_tombstoned(const sprout_state *state, sprout_str id) {
  size_t i, lo = 0, hi = state->tombstone_count;
  if (state->tombstones_sorted) {
    while (lo < hi) {
      size_t mid = lo + (hi - lo) / 2;
      int order = sprout_str_compare(state->tombstones[mid], id);
      if (order == 0) return true;
      if (order < 0) lo = mid + 1;
      else hi = mid;
    }
    return false;
  }
  for (i = 0; i < state->tombstone_count; i++)
    if (sprout_str_same(state->tombstones[i], id)) return true;
  return false;
}

sprout_status sprout_state_empty(const sprout_host *host, const char *world_id, sprout_state **out) {
  sprout_arena boot;
  sprout_state *state;
  sprout_status status;
  *out = NULL;
  if (host == NULL) return SPROUT_BAD_HOST;
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
  state->world.length = strlen(world_id);
  state->world.bytes = sprout_arena_copy(&state->arena, world_id, state->world.length);
  if (state->world.bytes == NULL) {
    sprout_state_free(state);
    return SPROUT_NO_MEMORY;
  }
  state->instances_sorted = state->visitors_sorted = state->tombstones_sorted = true;
  *out = state;
  return SPROUT_OK;
}

/* ---- copies and key order ---- */

static sprout_status copy_value(sprout_arena *arena, const sprout_stored_value *from, sprout_stored_value *to) {
  size_t i;
  *to = *from;
  if (from->kind == SPROUT_STRING) {
    if (!sprout_state_copy_str(arena, from->string, &to->string)) return SPROUT_NO_MEMORY;
  } else if (from->kind == SPROUT_LIST) {
    to->items = (sprout_stored_value *)sprout_arena_take(arena, (from->count + 1) * sizeof *to->items);
    if (to->items == NULL) return SPROUT_NO_MEMORY;
    for (i = 0; i < from->count; i++) {
      sprout_status status = copy_value(arena, &from->items[i], &to->items[i]);
      if (status != SPROUT_OK) return status;
    }
  }
  return SPROUT_OK;
}

#define COPY_STR(from, to) \
  do {                     \
    if (!sprout_state_copy_str(arena, (from), &(to))) return SPROUT_NO_MEMORY; \
  } while (0)

static sprout_status copy_property(sprout_arena *arena, const sprout_stored_property *from, sprout_stored_property *to) {
  COPY_STR(from->name, to->name);
  return copy_value(arena, &from->value, &to->value);
}

static sprout_status copy_properties(sprout_arena *arena, const sprout_stored_property *from, size_t count,
                                     sprout_stored_property **to) {
  size_t i;
  *to = (sprout_stored_property *)sprout_arena_take(arena, (count + 1) * sizeof **to);
  if (*to == NULL) return SPROUT_NO_MEMORY;
  for (i = 0; i < count; i++) PASS(copy_property(arena, &from[i], &(*to)[i]));
  return SPROUT_OK;
}

static sprout_status copy_strs(sprout_arena *arena, const sprout_str *from, size_t count, sprout_str **to) {
  size_t i;
  *to = (sprout_str *)sprout_arena_take(arena, (count + 1) * sizeof **to);
  if (*to == NULL) return SPROUT_NO_MEMORY;
  for (i = 0; i < count; i++) COPY_STR(from[i], (*to)[i]);
  return SPROUT_OK;
}

sprout_status sprout_stored_instance_copy(sprout_arena *arena, const sprout_stored_instance *from,
                                          sprout_stored_instance *to) {
  size_t i;
  *to = *from;
  COPY_STR(from->id, to->id);
  COPY_STR(from->made_kind, to->made_kind);
  COPY_STR(from->container, to->container);
  PASS(copy_strs(arena, from->path, from->path_count, &to->path));
  PASS(copy_properties(arena, from->properties, from->property_count, &to->properties));
  to->links = (sprout_stored_link *)sprout_arena_take(arena, (from->link_count + 1) * sizeof *to->links);
  to->wakes = (sprout_stored_wake *)sprout_arena_take(arena, (from->wake_count + 1) * sizeof *to->wakes);
  to->memory = (sprout_stored_memory *)sprout_arena_take(arena, (from->memory_count + 1) * sizeof *to->memory);
  if (to->links == NULL || to->wakes == NULL || to->memory == NULL) return SPROUT_NO_MEMORY;
  for (i = 0; i < from->link_count; i++) {
    COPY_STR(from->links[i].name, to->links[i].name);
    COPY_STR(from->links[i].to, to->links[i].to);
  }
  if (from->wake_count > 0) memcpy(to->wakes, from->wakes, from->wake_count * sizeof *to->wakes);
  for (i = 0; i < from->memory_count; i++) {
    COPY_STR(from->memory[i].actor, to->memory[i].actor);
    to->memory[i].count = from->memory[i].count;
    PASS(copy_properties(arena, from->memory[i].properties, from->memory[i].count, &to->memory[i].properties));
  }
  return SPROUT_OK;
}

sprout_status sprout_stored_visitor_copy(sprout_arena *arena, const sprout_stored_visitor *from,
                                         sprout_stored_visitor *to) {
  size_t i;
  *to = *from;
  COPY_STR(from->visit, to->visit);
  COPY_STR(from->nickname, to->nickname);
  COPY_STR(from->instance, to->instance);
  COPY_STR(from->last_place, to->last_place);
  PASS(copy_strs(arena, from->referents, from->referent_count, &to->referents));
  if (!from->has_reading) return SPROUT_OK;
  COPY_STR(from->reading.library, to->reading.library);
  COPY_STR(from->reading.name, to->reading.name);
  to->reading.bindings = (sprout_stored_binding *)sprout_arena_take(
      arena, (from->reading.binding_count + 1) * sizeof *to->reading.bindings);
  if (to->reading.bindings == NULL) return SPROUT_NO_MEMORY;
  for (i = 0; i < from->reading.binding_count; i++) {
    const sprout_stored_bound *b = &from->reading.bindings[i].bound;
    sprout_stored_bound *t = &to->reading.bindings[i].bound;
    COPY_STR(from->reading.bindings[i].role, to->reading.bindings[i].role);
    *t = *b;
    COPY_STR(b->object, t->object);
    COPY_STR(b->value_string, t->value_string);
    COPY_STR(b->direction, t->direction);
    COPY_STR(b->label, t->label);
    COPY_STR(b->to, t->to);
    PASS(copy_strs(arena, b->set, b->set_count, &t->set));
  }
  return SPROUT_OK;
}

sprout_status sprout_stored_instance_order(sprout_arena *arena, sprout_stored_instance *in) {
  size_t j;
  PASS(sort_records(arena, in->properties, in->property_count, sizeof *in->properties, by_property_name));
  PASS(sort_records(arena, in->links, in->link_count, sizeof *in->links, by_link_name));
  PASS(sort_records(arena, in->memory, in->memory_count, sizeof *in->memory, by_actor));
  for (j = 0; j < in->memory_count; j++)
    PASS(sort_records(arena, in->memory[j].properties, in->memory[j].count,
                      sizeof *in->memory[j].properties, by_property_name));
  return SPROUT_OK;
}

/* ---- stored values against declared types ---- */

static bool whole(double n) {
  return n >= -9007199254740991.0 && n <= 9007199254740991.0 && n == (double)(long long)n;
}

static bool same_value(const sprout_stored_value *a, const sprout_stored_value *b) {
  size_t i;
  if (a->kind != b->kind) return false;
  switch (a->kind) {
    case SPROUT_BOOL:
      return a->boolean == b->boolean;
    case SPROUT_NUMBER:
      return a->number == b->number;
    case SPROUT_STRING:
      return sprout_str_same(a->string, b->string);
    case SPROUT_LIST:
      if (a->count != b->count) return false;
      for (i = 0; i < a->count; i++)
        if (!same_value(&a->items[i], &b->items[i])) return false;
      return true;
  }
  return false;
}

/* Whether a stored value is a value of the declared type (the spec's Properties; Limits). */
static bool fits(const sprout_decl_type *type, const sprout_stored_value *value, sprout_limit cap) {
  size_t i, j;
  switch (type->kind) {
    case SPROUT_DECL_BOOLEAN:
      return value->kind == SPROUT_BOOL;
    case SPROUT_DECL_STRING:
    case SPROUT_DECL_EXTENSION:
      return value->kind == SPROUT_STRING;
    case SPROUT_DECL_INTEGER:
      return value->kind == SPROUT_NUMBER && whole(value->number) && value->number >= type->min &&
             value->number <= type->max;
    case SPROUT_DECL_SYMBOL:
      if (value->kind != SPROUT_STRING) return false;
      for (i = 0; i < type->option_count; i++)
        if (strlen(type->options[i]) == value->string.length &&
            memcmp(type->options[i], value->string.bytes, value->string.length) == 0)
          return true;
      return false;
    case SPROUT_DECL_LIST:
      if (value->kind != SPROUT_LIST) return false;
      if (cap.set && value->count > cap.value) return false;
      for (i = 0; i < value->count; i++) {
        if (!fits(type->element, &value->items[i], cap)) return false;
        /* A list holds no duplicates, so a stored one that repeats an element was never a list of this type. */
        for (j = 0; j < i; j++)
          if (same_value(&value->items[i], &value->items[j])) return false;
      }
      return true;
  }
  return false;
}

static bool same_literal(const sprout_literal *a, const sprout_literal *b);

/* Whether a literal is one value with a stored one: an option is its text, a list its items with repeats dropped. */
static bool literal_same_as(const sprout_literal *literal, const sprout_stored_value *value) {
  size_t i, j, next = 0;
  switch (literal->kind) {
    case SPROUT_LITERAL_BOOLEAN:
      return value->kind == SPROUT_BOOL && value->boolean == literal->boolean;
    case SPROUT_LITERAL_NUMBER:
      return value->kind == SPROUT_NUMBER && value->number == literal->number;
    case SPROUT_LITERAL_STRING:
    case SPROUT_LITERAL_OPTION:
      return value->kind == SPROUT_STRING && sprout_str_is(value->string, literal->text);
    case SPROUT_LITERAL_LIST:
      if (value->kind != SPROUT_LIST) return false;
      for (i = 0; i < literal->count; i++) {
        bool repeats = false;
        for (j = 0; j < i && !repeats; j++) repeats = same_literal(&literal->items[j], &literal->items[i]);
        if (repeats) continue;
        if (next >= value->count || !literal_same_as(&literal->items[i], &value->items[next])) return false;
        next++;
      }
      return next == value->count;
  }
  return false;
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

bool sprout_value_is_default(const sprout_property *declared, const sprout_stored_value *value) {
  return literal_same_as(&declared->default_value, value);
}

static sprout_status copy_cstr(sprout_arena *arena, const char *text, sprout_str *out) {
  out->length = strlen(text);
  out->bytes = sprout_arena_copy(arena, text, out->length);
  return out->bytes == NULL ? SPROUT_NO_MEMORY : SPROUT_OK;
}

/* ---- opening a state against a world ---- */

/* A declared object's id with its place in the tree, to find a container by id. */
typedef struct by_id {
  const char *id;
  size_t index;
} by_id;

static int by_declared_id(const void *a, const void *b) {
  return strcmp(((const by_id *)a)->id, ((const by_id *)b)->id);
}

static size_t declared_index(const by_id *sorted, size_t count, const char *id) {
  size_t lo = 0, hi = count;
  while (lo < hi) {
    size_t mid = lo + (hi - lo) / 2;
    int order = strcmp(sorted[mid].id, id);
    if (order == 0) return sorted[mid].index;
    if (order < 0) lo = mid + 1;
    else hi = mid;
  }
  return (size_t)-1;
}

typedef struct opening {
  sprout_state *state;
  const sprout_world *world;
  sprout_refusal *refusal;
  char path[64];
} opening;

/* "The stored state is not readable at instances[i]<field>: <parts joined>", the first problem found. */
static sprout_status refuse_at(opening *o, size_t i, const char *field, const char *const *parts, size_t count) {
  char text[320], digits[24], reversed[24];
  size_t used = 0, k, n = 0;
  const char *at[4];
  do {
    reversed[n++] = (char)('0' + i % 10);
    i /= 10;
  } while (i > 0);
  for (k = 0; k < n; k++) digits[k] = reversed[n - 1 - k];
  digits[n] = '\0';
  at[0] = "instances[";
  at[1] = digits;
  at[2] = "]";
  at[3] = field;
  for (k = 0; k < 4; k++) {
    n = strlen(at[k]);
    if (used + n + 1 > sizeof o->path) n = sizeof o->path - 1 - used;
    memcpy(o->path + used, at[k], n);
    used += n;
  }
  o->path[used] = '\0';
  used = 0;
  for (k = 0; k < count; k++) {
    n = parts[k] == NULL ? 0 : strlen(parts[k]);
    if (used + n + 1 > sizeof text) n = sizeof text - 1 - used;
    if (n > 0) memcpy(text + used, parts[k], n);
    used += n;
  }
  text[used] = '\0';
  return sprout_stored_refuse(o->refusal, o->path, text, NULL, NULL);
}

/* "`id` <a><b><c>" at instances[i]<field>. */
static sprout_status refuse_about(opening *o, size_t i, const char *field, sprout_str id, const char *a,
                                  const char *b, const char *c) {
  const char *parts[5];
  parts[0] = "`";
  parts[1] = id.bytes;
  parts[2] = a;
  parts[3] = b;
  parts[4] = c;
  return refuse_at(o, i, field, parts, 5);
}

/* The kind a record is decoded under, or NULL with the record refused in words. */
static sprout_status kind_of(opening *o, size_t i, const sprout_stored_instance *in, const sprout_kind_def **out) {
  const sprout_world *world = o->world;
  *out = NULL;
  switch (in->made) {
    case SPROUT_MADE_WORLD:
      *out = world->world_kind;
      if (*out == NULL) return refuse_about(o, i, ".id", in->id, "` is the world, which has no kind in this world.", NULL, NULL);
      return SPROUT_OK;
    case SPROUT_MADE_VISITOR:
      *out = world->visitor_kind;
      if (*out == NULL)
        return refuse_about(o, i, ".made", in->id, "` is made from visitor, and this world has nothing for a visitor to be made of.", NULL, NULL);
      return SPROUT_OK;
    case SPROUT_MADE_DECLARED: {
      const sprout_declared *declared = sprout_world_declared(world, in->id.bytes);
      if (declared == NULL || declared->kind == NULL)
        return refuse_about(o, i, ".id", in->id, "` is not an object this world declares.", NULL, NULL);
      *out = declared->kind;
      return SPROUT_OK;
    }
    case SPROUT_MADE_SPAWNED: {
      const sprout_kind_def *kind = sprout_world_kind(world, in->made_kind.bytes);
      if (kind == NULL || !kind->spawnable)
        return refuse_about(o, i, ".made", in->id, "` is a spawn of `", in->made_kind.bytes,
                            kind == NULL ? "`, which this world does not declare." : "`, which cannot be spawned.");
      *out = kind;
      return SPROUT_OK;
    }
    case SPROUT_MADE_GIVEN: {
      const char **path = (const char **)sprout_arena_take(&o->state->arena, (in->path_count + 1) * sizeof(char *));
      const sprout_content *content;
      size_t k;
      if (path == NULL) return SPROUT_NO_MEMORY;
      for (k = 0; k < in->path_count; k++) path[k] = in->path[k].bytes;
      content = sprout_world_content_at(world, in->made_kind.bytes, path, in->path_count);
      if (content == NULL || content->kind == NULL)
        return refuse_about(o, i, ".made", in->id, "` is given by `", in->made_kind.bytes,
                            "`, whose body does not give it.");
      *out = content->kind;
      return SPROUT_OK;
    }
  }
  return SPROUT_OK;
}

static const sprout_property *declared_property(const sprout_kind_def *kind, sprout_str name) {
  size_t i;
  for (i = 0; i < kind->property_count; i++)
    if (strlen(kind->properties[i]->name) == name.length &&
        memcmp(kind->properties[i]->name, name.bytes, name.length) == 0)
      return kind->properties[i];
  return NULL;
}

/* "`id` does not hold `:name`." (or remember), or "`:name` of `id` is not a value of its type, `key`." */
static sprout_status refuse_property(opening *o, size_t i, const char *field, const sprout_stored_instance *in,
                                     sprout_str name, const sprout_property *declared, bool remembered) {
  char named[96];
  const char *parts[7];
  size_t n = name.length < sizeof named - 1 ? name.length : sizeof named - 1;
  memcpy(named, name.bytes, n);
  named[n] = '\0';
  if (declared == NULL)
    return refuse_about(o, i, field, in->id, remembered ? "` does not remember `:" : "` does not hold `:", named, "`.");
  parts[0] = "`:";
  parts[1] = named;
  parts[2] = "` of `";
  parts[3] = in->id.bytes;
  parts[4] = "` is not a value of its type, `";
  parts[5] = declared->type->key;
  parts[6] = "`.";
  return refuse_at(o, i, field, parts, 7);
}

/*
 * The record's properties under its kind: each must be one the kind holds (or, in memory, remembers) and a
 * value of its type, since the cartridge that wrote the save declares them; one at its default is not kept.
 */
static sprout_status read_properties(opening *o, size_t i, const char *field, sprout_stored_instance *in,
                                     sprout_stored_property *list, size_t count, bool remembered, size_t *kept) {
  size_t k, n = 0;
  for (k = 0; k < count; k++) {
    const sprout_property *declared = declared_property(in->kind, list[k].name);
    if (declared == NULL || declared->remembered != remembered)
      return refuse_property(o, i, field, in, list[k].name, NULL, remembered);
    if (!fits(declared->type, &list[k].value, o->state->host.budgets.list_elements))
      return refuse_property(o, i, field, in, list[k].name, declared, remembered);
    if (sprout_value_is_default(declared, &list[k].value)) continue;
    list[n++] = list[k];
  }
  *kept = n;
  return SPROUT_OK;
}

static sprout_status read_record(opening *o, size_t i, sprout_stored_instance *in) {
  sprout_arena *arena = &o->state->arena;
  size_t k, actors = 0;
  PASS(kind_of(o, i, in, &in->kind));
  if (in->made == SPROUT_MADE_WORLD) {
    in->has_container = false;
    in->has_arrival = false;
  }
  PASS(sort_records(arena, in->properties, in->property_count, sizeof *in->properties, by_property_name));
  PASS(read_properties(o, i, ".properties", in, in->properties, in->property_count, false, &in->property_count));
  PASS(sort_records(arena, in->memory, in->memory_count, sizeof *in->memory, by_actor));
  for (k = 0; k < in->memory_count; k++) {
    sprout_stored_memory *about = &in->memory[k];
    PASS(sort_records(arena, about->properties, about->count, sizeof *about->properties, by_property_name));
    PASS(read_properties(o, i, ".memory", in, about->properties, about->count, true, &about->count));
    if (about->count > 0) in->memory[actors++] = *about;
  }
  in->memory_count = actors;
  return sort_records(arena, in->links, in->link_count, sizeof *in->links, by_link_name);
}

sprout_status sprout_stored_instance_defaults(sprout_arena *arena, const sprout_kind_def *kind,
                                              sprout_stored_instance *out) {
  (void)arena;
  memset(out, 0, sizeof *out);
  out->kind = kind;
  return SPROUT_OK;
}

/* A new instance at its kind's defaults, with no links, wakes, memory or tick. */
static sprout_status new_instance(opening *o, const char *id, sprout_made_from made,
                                  const sprout_kind_def *kind, const char *container,
                                  sprout_stored_instance *out) {
  sprout_arena *arena = &o->state->arena;
  PASS(sprout_stored_instance_defaults(arena, kind, out));
  PASS(copy_cstr(arena, id, &out->id));
  out->made = made;
  if (container != NULL) {
    out->has_container = true;
    PASS(copy_cstr(arena, container, &out->container));
  }
  return SPROUT_OK;
}

static sprout_status refuse_world(const sprout_state *state, const sprout_world *world, sprout_refusal *refusal) {
  const char *parts[5];
  char text[320];
  size_t used = 0, i;
  parts[0] = "the store holds `";
  parts[1] = state->world.bytes;
  parts[2] = "`, and this is `";
  parts[3] = world->header.name;
  parts[4] = "`.";
  for (i = 0; i < 5; i++) {
    size_t n = strlen(parts[i]);
    if (used + n + 1 > sizeof text) n = sizeof text - 1 - used;
    memcpy(text + used, parts[i], n);
    used += n;
  }
  text[used] = '\0';
  return sprout_stored_refuse(refusal, "", text, NULL, NULL);
}

sprout_status sprout_state_open(sprout_state *state, const sprout_world *world, sprout_refusal *refusal) {
  opening o;
  sprout_arena *arena = &state->arena;
  size_t i, extra = 0;
  sprout_stored_instance *made_instances;
  bool *gone;
  by_id *ids;
  sprout_stored_instance *all;
  memset(&o, 0, sizeof o);
  o.state = state;
  o.world = world;
  o.refusal = refusal;
  if (refusal != NULL) refusal->text[0] = '\0';
  if (!sprout_str_is(state->world, world->header.name)) return refuse_world(state, world, refusal);
  PASS(sprout_state_sort(state, arena));

  for (i = 0; i < state->instance_count; i++) PASS(read_record(&o, i, &state->instances[i]));

  /* Declared objects nothing was stored for, outside in, so a container is settled before what it holds. */
  made_instances = (sprout_stored_instance *)sprout_arena_take(
      arena, (world->declared_count + 2) * sizeof *made_instances);
  gone = (bool *)sprout_arena_take(arena, (world->declared_count + 1) * sizeof(bool));
  ids = (by_id *)sprout_arena_take(arena, (world->declared_count + 1) * sizeof *ids);
  if (made_instances == NULL || gone == NULL || ids == NULL) return SPROUT_NO_MEMORY;
  for (i = 0; i < world->declared_count; i++) {
    ids[i].id = world->declared[i].id;
    ids[i].index = i;
  }
  PASS(sort_records(arena, ids, world->declared_count, sizeof *ids, by_declared_id));
  if (world->world_kind != NULL && sprout_state_find(state, state->world) == NULL)
    PASS(new_instance(&o, world->header.name, SPROUT_MADE_WORLD, world->world_kind, NULL, &made_instances[extra++]));
  for (i = 0; i < world->declared_count; i++) {
    const sprout_declared *entry = &world->declared[i];
    sprout_str id;
    size_t j;
    bool stored;
    id.bytes = entry->id;
    id.length = strlen(entry->id);
    if (sprout_state_tombstoned(state, id)) {
      gone[i] = true;
      continue;
    }
    /* Gone reaches only what is still where it was declared: a stored one is where its record says. */
    stored = sprout_state_find(state, id) != NULL;
    j = declared_index(ids, world->declared_count, entry->container);
    if (!stored && j != (size_t)-1 && gone[j]) gone[i] = true;
    if (gone[i] || entry->kind == NULL || stored) continue;
    PASS(new_instance(&o, entry->id, SPROUT_MADE_DECLARED, entry->kind, entry->container, &made_instances[extra]));
    extra++;
  }
  if (extra > 0) {
    all = (sprout_stored_instance *)sprout_arena_take(arena, (state->instance_count + extra) * sizeof *all);
    if (all == NULL) return SPROUT_NO_MEMORY;
    if (state->instance_count > 0) memcpy(all, state->instances, state->instance_count * sizeof *all);
    memcpy(all + state->instance_count, made_instances, extra * sizeof *all);
    state->instances = all;
    state->instance_count += extra;
    PASS(sprout_state_sort(state, arena));
  }

  /* A reading of a verb the world does not declare is let go: `again` then has nothing to run. */
  for (i = 0; i < state->visitor_count; i++) {
    sprout_stored_visitor *v = &state->visitors[i];
    size_t k;
    bool known = false;
    if (!v->has_reading) continue;
    for (k = 0; k < world->verb_count && !known; k++)
      known = sprout_str_is(v->reading.library, world->verbs[k]->library) &&
              sprout_str_is(v->reading.name, world->verbs[k]->name);
    if (!known) {
      memset(&v->reading, 0, sizeof v->reading);
      v->has_reading = false;
    }
  }
  return SPROUT_OK;
}
