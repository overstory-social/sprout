/*
 * A state read against the world it belongs to (the spec's The runtime >
 * State; The compiler > What absent means). Opening reconciles what is stored
 * with what the catalogue says now: it keeps what fits and says what it
 * drops, keeps dormant whatever cannot be decoded (its object or its kind is
 * absent), makes the declared objects nothing is stored for, and never makes
 * one past its tombstone. Records end up in the order a save writes them.
 */
#include <string.h>

#include "state.h"

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

sprout_status sprout_state_sort(sprout_state *state) {
  sprout_status status;
  status = sort_records(&state->arena, state->instances, state->instance_count, sizeof *state->instances, by_instance_id);
  if (status != SPROUT_OK) return status;
  status = sort_records(&state->arena, state->visitors, state->visitor_count, sizeof *state->visitors, by_visit);
  if (status != SPROUT_OK) return status;
  status = sort_records(&state->arena, state->tombstones, state->tombstone_count, sizeof *state->tombstones, by_string);
  if (status != SPROUT_OK) return status;
  state->instances_sorted = state->visitors_sorted = state->tombstones_sorted = true;
  return SPROUT_OK;
}

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
  size_t i;
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
  state->arena = boot;
  state->arena.host = &state->host;
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

/* Whether a stored value is a value of the type now declared (the spec's Properties; Limits). */
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

static sprout_status literal_value(sprout_arena *arena, const sprout_literal *literal,
                                   sprout_stored_value *out) {
  size_t i;
  switch (literal->kind) {
    case SPROUT_LITERAL_BOOLEAN:
      out->kind = SPROUT_BOOL;
      out->boolean = literal->boolean;
      return SPROUT_OK;
    case SPROUT_LITERAL_NUMBER:
      out->kind = SPROUT_NUMBER;
      out->number = literal->number;
      return SPROUT_OK;
    case SPROUT_LITERAL_STRING:
    case SPROUT_LITERAL_OPTION:
      out->kind = SPROUT_STRING;
      out->string.length = strlen(literal->text);
      out->string.bytes = sprout_arena_copy(arena, literal->text, out->string.length);
      return out->string.bytes == NULL ? SPROUT_NO_MEMORY : SPROUT_OK;
    case SPROUT_LITERAL_LIST: {
      size_t kept = 0;
      out->kind = SPROUT_LIST;
      out->items = (sprout_stored_value *)sprout_arena_take(arena, (literal->count + 1) * sizeof *out->items);
      if (out->items == NULL) return SPROUT_NO_MEMORY;
      for (i = 0; i < literal->count; i++) {
        sprout_stored_value one;
        size_t j;
        bool repeats = false;
        memset(&one, 0, sizeof one);
        {
          sprout_status status = literal_value(arena, &literal->items[i], &one);
          if (status != SPROUT_OK) return status;
        }
        for (j = 0; j < kept && !repeats; j++) repeats = same_value(&out->items[j], &one);
        if (!repeats) out->items[kept++] = one;
      }
      out->count = kept;
      return SPROUT_OK;
    }
  }
  return SPROUT_OK;
}

static sprout_status copy_cstr(sprout_arena *arena, const char *text, sprout_str *out) {
  out->length = strlen(text);
  out->bytes = sprout_arena_copy(arena, text, out->length);
  return out->bytes == NULL ? SPROUT_NO_MEMORY : SPROUT_OK;
}

/* ---- opening a state against a world ---- */

typedef struct opening {
  sprout_state *state;
  const sprout_world *world;
  sprout_dropped *dropped;
  size_t dropped_count, dropped_capacity;
} opening;

#define PASS(expr)                        \
  do {                                    \
    sprout_status pass_ = (expr);         \
    if (pass_ != SPROUT_OK) return pass_; \
  } while (0)

static sprout_status drop(opening *o, sprout_str id, sprout_str property, const sprout_str *actor,
                          sprout_drop_reason why) {
  sprout_dropped *entry;
  if (o->dropped_count == o->dropped_capacity) {
    size_t wanted = o->dropped_capacity == 0 ? 16 : o->dropped_capacity * 2;
    sprout_dropped *bigger = (sprout_dropped *)sprout_arena_take(&o->state->arena, wanted * sizeof *bigger);
    if (bigger == NULL) return SPROUT_NO_MEMORY;
    if (o->dropped_count > 0) memcpy(bigger, o->dropped, o->dropped_count * sizeof *bigger);
    o->dropped = bigger;
    o->dropped_capacity = wanted;
  }
  entry = &o->dropped[o->dropped_count++];
  entry->id = id;
  entry->property = property;
  entry->has_actor = actor != NULL;
  if (actor != NULL) entry->actor = *actor;
  entry->why = why;
  return SPROUT_OK;
}

/* A stored property read under what is declared now: kept, or why not. */
static bool keep(const opening *o, const sprout_property *declared, bool remembered,
                 const sprout_stored_property *stored, sprout_drop_reason *why) {
  if (declared == NULL) {
    *why = SPROUT_DROP_UNDECLARED;
    return false;
  }
  if (declared->remembered != remembered ||
      !sprout_str_is(stored->type, declared->type->key)) {
    *why = SPROUT_DROP_RETYPED;
    return false;
  }
  if (!fits(declared->type, &stored->value, o->state->host.budgets.list_elements)) {
    *why = SPROUT_DROP_NO_LONGER_FITS;
    return false;
  }
  return true;
}

static const sprout_property *declared_property(const sprout_kind_def *kind, sprout_str name) {
  size_t i;
  for (i = 0; i < kind->property_count; i++)
    if (strlen(kind->properties[i].name) == name.length &&
        memcmp(kind->properties[i].name, name.bytes, name.length) == 0)
      return &kind->properties[i];
  return NULL;
}

static const sprout_stored_property *stored_named(const sprout_stored_property *list, size_t count,
                                                  const char *name) {
  size_t i;
  for (i = 0; i < count; i++)
    if (sprout_str_is(list[i].name, name)) return &list[i];
  return NULL;
}

/* A new property record at the declared default. */
static sprout_status default_property(sprout_arena *arena, const sprout_property *declared,
                                      sprout_stored_property *out) {
  PASS(copy_cstr(arena, declared->name, &out->name));
  PASS(copy_cstr(arena, declared->type->key, &out->type));
  return literal_value(arena, &declared->default_value, &out->value);
}

/* The instance's properties are every plain property its kind declares, kept or defaulted, by name. */
static sprout_status reconcile_properties(opening *o, sprout_stored_instance *in) {
  sprout_arena *arena = &o->state->arena;
  const sprout_kind_def *kind = in->kind;
  sprout_stored_property *sorted_stored, *next;
  size_t i, plain = 0, n = 0;
  bool *kept;
  PASS(sort_records(arena, in->properties, in->property_count, sizeof *in->properties, by_property_name));
  kept = (bool *)sprout_arena_take(arena, (in->property_count + 1) * sizeof(bool));
  if (kept == NULL) return SPROUT_NO_MEMORY;
  sorted_stored = in->properties;
  for (i = 0; i < in->property_count; i++) {
    sprout_drop_reason why = SPROUT_DROP_UNDECLARED;
    const sprout_property *declared = declared_property(kind, sorted_stored[i].name);
    kept[i] = keep(o, declared, false, &sorted_stored[i], &why);
    if (!kept[i]) PASS(drop(o, in->id, sorted_stored[i].name, NULL, why));
  }
  for (i = 0; i < kind->property_count; i++)
    if (!kind->properties[i].remembered) plain++;
  next = (sprout_stored_property *)sprout_arena_take(arena, (plain + 1) * sizeof *next);
  if (next == NULL) return SPROUT_NO_MEMORY;
  for (i = 0; i < kind->property_count; i++) {
    const sprout_property *declared = &kind->properties[i];
    const sprout_stored_property *found;
    if (declared->remembered) continue;
    found = stored_named(sorted_stored, in->property_count, declared->name);
    if (found != NULL && kept[found - sorted_stored]) next[n] = *found;
    else PASS(default_property(arena, declared, &next[n]));
    n++;
  }
  in->properties = next;
  in->property_count = n;
  return sort_records(arena, in->properties, in->property_count, sizeof *in->properties, by_property_name);
}

/* Memory is kept only where it was written and fits. */
static sprout_status reconcile_memory(opening *o, sprout_stored_instance *in) {
  sprout_arena *arena = &o->state->arena;
  size_t actors = 0, i, j;
  PASS(sort_records(arena, in->memory, in->memory_count, sizeof *in->memory, by_actor));
  for (i = 0; i < in->memory_count; i++) {
    sprout_stored_memory *actor = &in->memory[i];
    size_t kept = 0;
    PASS(sort_records(arena, actor->properties, actor->count, sizeof *actor->properties, by_property_name));
    for (j = 0; j < actor->count; j++) {
      sprout_drop_reason why = SPROUT_DROP_UNDECLARED;
      const sprout_property *declared = declared_property(in->kind, actor->properties[j].name);
      if (keep(o, declared, true, &actor->properties[j], &why)) actor->properties[kept++] = actor->properties[j];
      else PASS(drop(o, in->id, actor->properties[j].name, &actor->actor, why));
    }
    actor->count = kept;
    if (kept > 0) in->memory[actors++] = *actor;
  }
  in->memory_count = actors;
  return SPROUT_OK;
}

static const sprout_kind_def *kind_of(const opening *o, const sprout_stored_instance *in) {
  const sprout_world *world = o->world;
  switch (in->made) {
    case SPROUT_MADE_WORLD:
      return world->world_kind;
    case SPROUT_MADE_VISITOR:
      return world->visitor_kind;
    case SPROUT_MADE_DECLARED: {
      const sprout_declared *declared = sprout_world_declared(world, in->id.bytes);
      return declared == NULL ? NULL : declared->kind;
    }
    case SPROUT_MADE_SPAWNED: {
      const sprout_kind_def *kind = sprout_world_kind(world, in->made_kind.bytes);
      return kind != NULL && kind->spawnable ? kind : NULL;
    }
    case SPROUT_MADE_GIVEN: {
      const char **path = (const char **)sprout_arena_take(&o->state->arena, (in->path_count + 1) * sizeof(char *));
      const sprout_content *content;
      size_t i;
      if (path == NULL) return NULL;
      for (i = 0; i < in->path_count; i++) path[i] = in->path[i].bytes;
      content = sprout_world_content_at(world, in->made_kind.bytes, path, in->path_count);
      return content == NULL ? NULL : content->kind;
    }
  }
  return NULL;
}

/* A new instance at its kind's defaults, with no links, wakes, memory or tick. */
static sprout_status new_instance(opening *o, const char *id, sprout_made_from made,
                                  const sprout_kind_def *kind, const char *container,
                                  sprout_stored_instance *out) {
  sprout_arena *arena = &o->state->arena;
  size_t i, n = 0, plain = 0;
  memset(out, 0, sizeof *out);
  PASS(copy_cstr(arena, id, &out->id));
  out->made = made;
  out->kind = kind;
  if (container != NULL) {
    out->has_container = true;
    PASS(copy_cstr(arena, container, &out->container));
  }
  for (i = 0; i < kind->property_count; i++)
    if (!kind->properties[i].remembered) plain++;
  out->properties = (sprout_stored_property *)sprout_arena_take(arena, (plain + 1) * sizeof *out->properties);
  if (out->properties == NULL) return SPROUT_NO_MEMORY;
  for (i = 0; i < kind->property_count; i++) {
    if (kind->properties[i].remembered) continue;
    PASS(default_property(arena, &kind->properties[i], &out->properties[n++]));
  }
  out->property_count = n;
  return sort_records(arena, out->properties, out->property_count, sizeof *out->properties, by_property_name);
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

static sprout_status add_id(sprout_arena *arena, sprout_str **list, size_t *count, size_t *capacity, sprout_str id) {
  if (*count == *capacity) {
    size_t wanted = *capacity == 0 ? 16 : *capacity * 2;
    sprout_str *bigger = (sprout_str *)sprout_arena_take(arena, wanted * sizeof *bigger);
    if (bigger == NULL) return SPROUT_NO_MEMORY;
    if (*count > 0) memcpy(bigger, *list, *count * sizeof *bigger);
    *list = bigger;
    *capacity = wanted;
  }
  (*list)[(*count)++] = id;
  return SPROUT_OK;
}

sprout_status sprout_state_open(sprout_state *state, const sprout_world *world, sprout_opened *report,
                                sprout_refusal *refusal) {
  opening o;
  sprout_arena *arena = &state->arena;
  sprout_str *created = NULL, *dormant = NULL, *stranded = NULL;
  size_t created_count = 0, created_cap = 0, dormant_count = 0, dormant_cap = 0, stranded_count = 0,
         stranded_cap = 0;
  size_t i, extra = 0;
  sprout_stored_instance *made_instances;
  bool *gone;
  sprout_stored_instance *all;
  memset(&o, 0, sizeof o);
  o.state = state;
  o.world = world;
  if (report != NULL) memset(report, 0, sizeof *report);
  if (!sprout_str_is(state->world, world->header.name)) return refuse_world(state, world, refusal);
  PASS(sprout_state_sort(state));

  for (i = 0; i < state->instance_count; i++) {
    sprout_stored_instance *in = &state->instances[i];
    in->kind = kind_of(&o, in);
    in->dormant = in->kind == NULL;
    if (in->dormant) continue;
    if (in->made == SPROUT_MADE_WORLD) {
      in->has_container = false;
      in->has_arrival = false;
    }
    PASS(reconcile_properties(&o, in));
    PASS(reconcile_memory(&o, in));
    PASS(sort_records(arena, in->links, in->link_count, sizeof *in->links, by_link_name));
  }

  /* Declared objects nothing was stored for, outside in, so a container is settled before what it holds. */
  made_instances = (sprout_stored_instance *)sprout_arena_take(
      arena, (world->declared_count + 2) * sizeof *made_instances);
  gone = (bool *)sprout_arena_take(arena, (world->declared_count + 1) * sizeof(bool));
  if (made_instances == NULL || gone == NULL) return SPROUT_NO_MEMORY;
  if (sprout_state_find(state, state->world) == NULL) {
    if (world->world_kind == NULL) {
      sprout_stored_instance *empty = &made_instances[extra++];
      memset(empty, 0, sizeof *empty);
      empty->id = state->world;
      empty->made = SPROUT_MADE_WORLD;
      empty->dormant = true;
    } else {
      PASS(new_instance(&o, world->header.name, SPROUT_MADE_WORLD, world->world_kind, NULL, &made_instances[extra++]));
      PASS(add_id(arena, &created, &created_count, &created_cap, state->world));
    }
  }
  for (i = 0; i < world->declared_count; i++) {
    const sprout_declared *entry = &world->declared[i];
    sprout_str id;
    size_t j;
    id.bytes = entry->id;
    id.length = strlen(entry->id);
    if (sprout_state_tombstoned(state, id)) {
      gone[i] = true;
      continue;
    }
    for (j = 0; j < i && !gone[i]; j++)
      if (gone[j] && strcmp(world->declared[j].id, entry->container) == 0) gone[i] = true;
    if (gone[i] || entry->kind == NULL || sprout_state_find(state, id) != NULL) continue;
    PASS(new_instance(&o, entry->id, SPROUT_MADE_DECLARED, entry->kind, entry->container, &made_instances[extra]));
    PASS(add_id(arena, &created, &created_count, &created_cap, made_instances[extra].id));
    extra++;
  }
  if (extra > 0) {
    all = (sprout_stored_instance *)sprout_arena_take(arena, (state->instance_count + extra) * sizeof *all);
    if (all == NULL) return SPROUT_NO_MEMORY;
    if (state->instance_count > 0) memcpy(all, state->instances, state->instance_count * sizeof *all);
    memcpy(all + state->instance_count, made_instances, extra * sizeof *all);
    state->instances = all;
    state->instance_count += extra;
    PASS(sprout_state_sort(state));
  }

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

  for (i = 0; i < state->instance_count; i++) {
    const sprout_stored_instance *in = &state->instances[i];
    const sprout_stored_instance *holder;
    if (in->dormant) {
      PASS(add_id(arena, &dormant, &dormant_count, &dormant_cap, in->id));
      continue;
    }
    if (!in->has_container || !in->kind->composes_actor) continue;
    holder = sprout_state_find(state, in->container);
    if (holder != NULL && !holder->dormant && !holder->kind->contains_actors)
      PASS(add_id(arena, &stranded, &stranded_count, &stranded_cap, in->id));
  }

  if (report != NULL) {
    report->created_count = created_count;
    report->created = created;
    report->dormant_count = dormant_count;
    report->dormant = dormant;
    report->dropped_count = o.dropped_count;
    report->dropped = o.dropped;
    report->stranded_count = stranded_count;
    report->stranded = stranded;
  }
  return SPROUT_OK;
}
