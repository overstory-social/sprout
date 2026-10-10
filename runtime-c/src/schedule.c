/*
 * What is to be done with time (see schedule.h). Every read is of the committed state alone: the tree is
 * climbed through decoded instances only, so a dormant record, which the world cannot read now, is nowhere.
 */
#include "schedule.h"

#include <string.h>

#include "world.h"

/* The decoded instance under `id`, or NULL: a dormant record is not one. */
static const sprout_stored_instance *decoded(const sprout_state *state, sprout_str id) {
  const sprout_stored_instance *instance = sprout_state_find(state, id);
  return instance == NULL || instance->dormant || instance->kind == NULL ? NULL : instance;
}

bool schedule_live(const sprout_state *state, sprout_str id) {
  sprout_str at = id;
  size_t guard = 0;
  while (!sprout_str_same(at, state->world)) {
    const sprout_stored_instance *instance = decoded(state, at);
    if (instance == NULL || !instance->has_container || ++guard > state->instance_count + 1) return false;
    at = instance->container;
  }
  return true;
}

bool schedule_is_place(const sprout_state *state, sprout_str id) {
  const sprout_stored_instance *instance;
  if (sprout_str_same(id, state->world) || !schedule_live(state, id)) return false;
  instance = decoded(state, id);
  return instance != NULL && instance->kind->contains_actors;
}

bool schedule_occupied(const sprout_state *state, sprout_str place) {
  size_t i;
  if (!schedule_is_place(state, place)) return false;
  for (i = 0; i < state->visitor_count; i++) {
    const sprout_stored_instance *instance = decoded(state, state->visitors[i].instance);
    if (instance != NULL && instance->has_container && sprout_str_same(instance->container, place)) return true;
  }
  return false;
}

bool schedule_pending(const sprout_state *state, sprout_str object, uint64_t serial, sprout_due_wake *out) {
  const sprout_stored_instance *instance = decoded(state, object);
  size_t i;
  if (instance == NULL || !schedule_live(state, object)) return false;
  for (i = 0; i < instance->wake_count; i++) {
    if (instance->wakes[i].serial != serial) continue;
    out->object = instance->id;
    out->serial = serial;
    out->asked_at = instance->wakes[i].asked_at;
    out->due_at = instance->wakes[i].due_at;
    return true;
  }
  return false;
}

/* Whether `a` is delivered before `b`: the one due first, then the one asked first, then by object. */
static bool before(const sprout_due_wake *a, const sprout_due_wake *b) {
  if (a->due_at != b->due_at) return a->due_at < b->due_at;
  if (a->serial != b->serial) return a->serial < b->serial;
  return sprout_str_compare(a->object, b->object) < 0;
}

sprout_status schedule_due(sprout_arena *arena, const sprout_state *state, uint64_t until, sprout_due_wake **out,
                           size_t *count) {
  size_t total = 0, n = 0, i, j;
  sprout_due_wake *found;
  for (i = 0; i < state->instance_count; i++) total += state->instances[i].wake_count;
  found = (sprout_due_wake *)sprout_arena_take(arena, (total + 1) * sizeof *found);
  if (found == NULL) return SPROUT_NO_MEMORY;
  for (i = 0; i < state->instance_count; i++) {
    const sprout_stored_instance *instance = &state->instances[i];
    bool live;
    if (instance->dormant || instance->kind == NULL || instance->wake_count == 0) continue;
    live = schedule_live(state, instance->id);
    for (j = 0; live && j < instance->wake_count; j++) {
      sprout_due_wake wake;
      if (instance->wakes[j].due_at > until) continue;
      /* Copied, so the list outlives a commit that rebuilds the state's memory. */
      if (!sprout_state_copy_str(arena, instance->id, &wake.object)) return SPROUT_NO_MEMORY;
      wake.serial = instance->wakes[j].serial;
      wake.asked_at = instance->wakes[j].asked_at;
      wake.due_at = instance->wakes[j].due_at;
      /* Inserted in order: the lists are short, and the library has no qsort. */
      {
        size_t at = n++;
        while (at > 0 && before(&wake, &found[at - 1])) {
          found[at] = found[at - 1];
          at--;
        }
        found[at] = wake;
      }
    }
  }
  *out = found;
  *count = n;
  return SPROUT_OK;
}

/* ---- the public reads, over an outcome-like arena of their own ---- */

typedef struct schedule_held {
  sprout_host host;
  sprout_arena anchor, arena;
} schedule_held;

static schedule_held *held_begin(const sprout_host *host) {
  sprout_arena boot;
  schedule_held *keep;
  if (sprout_arena_init(&boot, host) != SPROUT_OK) return NULL;
  keep = (schedule_held *)sprout_arena_take(&boot, sizeof *keep);
  if (keep == NULL) {
    sprout_arena_reset(&boot);
    return NULL;
  }
  keep->host = *host;
  keep->anchor = boot;
  keep->anchor.host = &keep->host;
  sprout_arena_init(&keep->arena, &keep->host);
  return keep;
}

static void held_end(void *held) {
  schedule_held *keep = (schedule_held *)held;
  sprout_host host;
  sprout_arena anchor, data;
  if (keep == NULL) return;
  host = keep->host;
  anchor = keep->anchor;
  data = keep->arena;
  anchor.host = &host;
  data.host = &host;
  sprout_arena_reset(&data);
  sprout_arena_reset(&anchor);
}

sprout_status sprout_places_occupied(const sprout_world *world, const sprout_state *state, const sprout_host *host,
                                     sprout_places *places) {
  schedule_held *keep;
  sprout_str *ids;
  size_t n = 0, i;
  (void)world;
  if (places == NULL) return SPROUT_BAD_HOST;
  memset(places, 0, sizeof *places);
  if (state == NULL || host == NULL) return SPROUT_BAD_INPUT;
  keep = held_begin(host);
  if (keep == NULL) return SPROUT_NO_MEMORY;
  ids = (sprout_str *)sprout_arena_take(&keep->arena, (state->visitor_count + 1) * sizeof *ids);
  if (ids == NULL) {
    held_end(keep);
    return SPROUT_NO_MEMORY;
  }
  for (i = 0; i < state->visitor_count; i++) {
    const sprout_stored_instance *instance = decoded(state, state->visitors[i].instance);
    sprout_str place;
    size_t at;
    if (instance == NULL || !instance->has_container || !schedule_is_place(state, instance->container)) continue;
    place = instance->container;
    for (at = 0; at < n && !sprout_str_same(ids[at], place); at++) {}
    if (at < n) continue;
    /* Kept in code-unit order. */
    at = n++;
    while (at > 0 && sprout_str_compare(place, ids[at - 1]) < 0) {
      ids[at] = ids[at - 1];
      at--;
    }
    ids[at] = place;
  }
  places->count = n;
  places->ids = ids;
  places->held = keep;
  return SPROUT_OK;
}

void sprout_places_free(sprout_places *places) {
  if (places == NULL) return;
  held_end(places->held);
  memset(places, 0, sizeof *places);
}

sprout_status sprout_wakes_due(const sprout_world *world, const sprout_state *state, const sprout_host *host,
                               uint64_t until, sprout_wakes *wakes) {
  schedule_held *keep;
  sprout_due_wake *found;
  size_t count;
  sprout_status status;
  (void)world;
  if (wakes == NULL) return SPROUT_BAD_HOST;
  memset(wakes, 0, sizeof *wakes);
  if (state == NULL || host == NULL) return SPROUT_BAD_INPUT;
  keep = held_begin(host);
  if (keep == NULL) return SPROUT_NO_MEMORY;
  status = schedule_due(&keep->arena, state, until, &found, &count);
  if (status != SPROUT_OK) {
    held_end(keep);
    return status;
  }
  wakes->count = count;
  wakes->wakes = found;
  wakes->held = keep;
  return SPROUT_OK;
}

void sprout_wakes_free(sprout_wakes *wakes) {
  if (wakes == NULL) return;
  held_end(wakes->held);
  memset(wakes, 0, sizeof *wakes);
}
