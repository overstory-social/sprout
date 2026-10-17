/*
 * What a write turn gives a host beside what it said (the spec's The runtime > Turns, The view; The host
 * contract > Storage): what a store writes of it, and, where it committed, whose views it made stale; a turn
 * that faulted names nobody, though a faulted wake or departure still writes. A turn may commit more than
 * once (catch-up commits each wake it delivers; a faulted wake or departure commits what is kept after it),
 * so the changes are counted across its commits, as the change from the state before the turn to the state
 * after it. The ids are copied into the outcome's arena; the records themselves stay in the state, and
 * sprout_changes_write reads them from there, so nothing of the state is copied per turn.
 */
#include <string.h>

#include "../exec.h"
#include "../turn.h"

static turn_changes *changes_of(sprout_outcome *outcome) { return &((turn_held *)outcome->held)->changes; }

static size_t index_of(const sprout_str *ids, size_t count, sprout_str id) {
  size_t i;
  for (i = 0; i < count; i++)
    if (sprout_str_same(ids[i], id)) return i;
  return count;
}

static size_t written_index(const turn_changes *acc, sprout_str id) {
  size_t i;
  for (i = 0; i < acc->written_count; i++)
    if (sprout_str_same(acc->written[i].id, id)) return i;
  return acc->written_count;
}

/* Adds a copy of `id` to the list unless it is there. */
static bool listed(sprout_arena *keep, sprout_str **items, size_t *count, size_t *capacity, sprout_str id) {
  sprout_str *slot;
  if (index_of(*items, *count, id) < *count) return true;
  slot = (sprout_str *)sprout_exec_grow(keep, (void **)items, count, capacity, sizeof *slot);
  return slot != NULL && sprout_state_copy_str(keep, id, slot);
}

sprout_status turn_changes_add(sprout_outcome *outcome, const sprout_changes *changes, const sprout_str *made,
                               size_t made_count) {
  sprout_arena *keep = turn_keep(outcome);
  turn_changes *acc = changes_of(outcome);
  size_t i;
  for (i = 0; i < changes->written_count; i++) {
    turn_written *slot;
    if (written_index(acc, changes->written[i]) < acc->written_count) continue;
    slot = (turn_written *)sprout_exec_grow(keep, (void **)&acc->written, &acc->written_count, &acc->written_capacity,
                                            sizeof *slot);
    if (slot == NULL || !sprout_state_copy_str(keep, changes->written[i], &slot->id)) return SPROUT_NO_MEMORY;
    slot->made = index_of(made, made_count, changes->written[i]) < made_count;
  }
  for (i = 0; i < changes->removed_count; i++) {
    size_t at = written_index(acc, changes->removed[i]);
    bool made_here = false;
    if (at < acc->written_count) {
      made_here = acc->written[at].made;
      acc->written[at] = acc->written[--acc->written_count];
    }
    if (!made_here && !listed(keep, &acc->removed, &acc->removed_count, &acc->removed_capacity, changes->removed[i]))
      return SPROUT_NO_MEMORY;
  }
  for (i = 0; i < changes->tombstoned_count; i++)
    if (!listed(keep, &acc->buried, &acc->buried_count, &acc->buried_capacity, changes->tombstoned[i]))
      return SPROUT_NO_MEMORY;
  for (i = 0; i < changes->visitor_count; i++)
    if (!listed(keep, &acc->visitors, &acc->visitor_count, &acc->visitor_capacity, changes->visitors[i]))
      return SPROUT_NO_MEMORY;
  return SPROUT_OK;
}

/* Insertion sort in code-unit order: a turn's lists are short. */
static void sort_ids(sprout_str *ids, size_t count) {
  size_t i, j;
  for (i = 1; i < count; i++) {
    sprout_str one = ids[i];
    for (j = i; j > 0 && sprout_str_compare(ids[j - 1], one) > 0; j--) ids[j] = ids[j - 1];
    ids[j] = one;
  }
}

sprout_status turn_given(const sprout_state *state, sprout_outcome *outcome) {
  sprout_arena *keep = turn_keep(outcome);
  turn_changes *acc = changes_of(outcome);
  sprout_str *upsert, *stale;
  size_t i, stale_count = 0;
  upsert = (sprout_str *)sprout_arena_take(keep, (acc->written_count + 1) * sizeof *upsert);
  stale = (sprout_str *)sprout_arena_take(keep, (state->visitor_count + 1) * sizeof *stale);
  if (upsert == NULL || stale == NULL) return SPROUT_NO_MEMORY;
  for (i = 0; i < acc->written_count; i++) upsert[i] = acc->written[i].id;
  sort_ids(upsert, acc->written_count);
  sort_ids(acc->removed, acc->removed_count);
  sort_ids(acc->buried, acc->buried_count);
  sort_ids(acc->visitors, acc->visitor_count);
  outcome->has_changes = true;
  outcome->changes.serial = state->serial;
  outcome->changes.upsert = upsert;
  outcome->changes.upsert_count = acc->written_count;
  outcome->changes.remove = acc->removed;
  outcome->changes.remove_count = acc->removed_count;
  outcome->changes.tombstones = acc->buried;
  outcome->changes.tombstone_count = acc->buried_count;
  outcome->changes.visitors = acc->visitors;
  outcome->changes.visitor_count = acc->visitor_count;
  /* A turn that faulted names nobody. Present is standing somewhere: a visitor who is away has no container. */
  for (i = 0; outcome->committed && i < state->visitor_count; i++) {
    const sprout_stored_instance *person = sprout_state_find(state, state->visitors[i].instance);
    if (person == NULL || !person->has_container) continue;
    if (!sprout_state_copy_str(keep, state->visitors[i].visit, &stale[stale_count])) return SPROUT_NO_MEMORY;
    stale_count++;
  }
  sort_ids(stale, stale_count);
  outcome->stale = stale;
  outcome->stale_count = stale_count;
  return SPROUT_OK;
}
