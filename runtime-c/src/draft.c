/*
 * One write turn's copy-on-write layer over a state (the spec's The runtime >
 * Turns, State; Spawning; Destroying). The overlay is a handful of arrays in
 * the turn arena; the base is read through unless the turn wrote or removed
 * the record. Contents order is derived on demand, never stored.
 */
#include <string.h>

#include "draft.h"

#define NEED(expr)                                \
  do {                                            \
    sprout_draft_result need_ = (expr);           \
    if (need_ != SPROUT_DRAFT_OK) return need_;   \
  } while (0)

#define MEMORY(pointer)                                     \
  do {                                                      \
    if ((pointer) == NULL) return SPROUT_DRAFT_NO_MEMORY;   \
  } while (0)

const char *sprout_draft_text(sprout_draft_result result) {
  switch (result) {
    case SPROUT_DRAFT_OK:
      return "the change was made.";
    case SPROUT_DRAFT_NO_MEMORY:
      return "the host could not give the turn any more memory.";
    case SPROUT_DRAFT_CLOSED:
      return "this turn has committed, and its draft is closed.";
    case SPROUT_DRAFT_MISSING:
      return "that is not an instance in this world.";
    case SPROUT_DRAFT_TAKEN:
      return "that id is taken, and an id is never reused.";
    case SPROUT_DRAFT_CYCLE:
      return "nothing goes inside itself.";
    case SPROUT_DRAFT_THE_WORLD:
      return "the world has no container, and is never moved or destroyed.";
    case SPROUT_DRAFT_NOT_A_VISITOR:
      return "only a visitor goes out of the tree; anything else is always somewhere.";
    case SPROUT_DRAFT_NO_ARRIVAL:
      return "an instance arrives where it is put, so one with a container has an arrival.";
    case SPROUT_DRAFT_MOVED:
      return "where an instance is, and when it arrived, change only through place.";
  }
  return "the draft gave a result it has no words for.";
}

/* ---- the overlay's small vectors ---- */

/* One more slot in an overlay vector, which is a change of the overlay: the list of every record is stale after it. */
static void *push(sprout_draft *draft, void **items, size_t *count, size_t *capacity, size_t size) {
  if (*count == *capacity) {
    size_t wanted = *capacity == 0 ? 8 : *capacity * 2;
    char *bigger = (char *)sprout_arena_take(draft->turn, wanted * size);
    if (bigger == NULL) return NULL;
    if (*count > 0) memcpy(bigger, *items, *count * size);
    *items = bigger;
    *capacity = wanted;
  }
  draft->generation++;
  return (char *)*items + (*count)++ * size;
}

static bool listed(const sprout_str *ids, size_t count, sprout_str id) {
  size_t i;
  for (i = 0; i < count; i++)
    if (sprout_str_same(ids[i], id)) return true;
  return false;
}

sprout_draft_result sprout_draft_open(sprout_draft *draft, sprout_arena *turn, const sprout_world *world,
                                      sprout_state *base) {
  memset(draft, 0, sizeof *draft);
  draft->turn = turn;
  draft->world = world;
  draft->base = base;
  draft->serial = base->serial;
  draft->stored = base->instance_count;
  return SPROUT_DRAFT_OK;
}

size_t sprout_draft_held(const sprout_draft *draft) { return draft->stored; }

/* ---- reading through ---- */

static sprout_stored_instance *overlay(const sprout_draft *draft, sprout_str id) {
  size_t i;
  for (i = 0; i < draft->written_count; i++)
    if (sprout_str_same(draft->written[i].id, id)) return &draft->written[i];
  return NULL;
}

const sprout_stored_instance *sprout_draft_record(const sprout_draft *draft, sprout_str id) {
  const sprout_stored_instance *found;
  if (listed(draft->gone, draft->gone_count, id)) return NULL;
  found = overlay(draft, id);
  return found != NULL ? found : sprout_state_find(draft->base, id);
}

const sprout_stored_instance *sprout_draft_destroyed(const sprout_draft *draft, sprout_str id) {
  size_t i;
  for (i = 0; i < draft->kept_count; i++)
    if (sprout_str_same(draft->kept[i].id, id)) return &draft->kept[i];
  return NULL;
}

const sprout_stored_instance *sprout_draft_instance(const sprout_draft *draft, sprout_str id) {
  const sprout_stored_instance *found = sprout_draft_record(draft, id);
  return found != NULL && !found->dormant ? found : NULL;
}

const sprout_stored_visitor *sprout_draft_visitor(const sprout_draft *draft, sprout_str visit) {
  size_t i;
  for (i = 0; i < draft->visitor_count; i++)
    if (sprout_str_same(draft->visitors[i].visit, visit)) return &draft->visitors[i];
  return sprout_state_find_visitor(draft->base, visit);
}

bool sprout_draft_tombstoned(const sprout_draft *draft, sprout_str id) {
  return listed(draft->buried, draft->buried_count, id) || sprout_state_tombstoned(draft->base, id);
}

/* ---- contents order ---- */

typedef struct ranked {
  const sprout_stored_instance *record;
  size_t rank;
} ranked;

static size_t rank_of(const sprout_draft *draft, sprout_str id) {
  const sprout_declared *declared = sprout_world_declared(draft->world, id.bytes);
  return declared == NULL ? (size_t)-1 : declared->rank;
}

/* Whether `a` comes before `b` in their container: unmoved declared objects by rank, then arrivals by serial, ties by id. */
static bool comes_before(const ranked *a, const ranked *b) {
  if (!a->record->has_arrival && b->record->has_arrival) return true;
  if (a->record->has_arrival && !b->record->has_arrival) return false;
  if (!a->record->has_arrival) {
    if (a->rank != b->rank) return a->rank < b->rank;
  } else if (a->record->arrival != b->record->arrival) {
    return a->record->arrival < b->record->arrival;
  }
  return sprout_str_compare(a->record->id, b->record->id) < 0;
}

/*
 * Every record as the turn stands, in no order: the base's not removed or rewritten, then the turn's
 * writes. Listed once per change of the overlay and read from the draft until the next, since a turn
 * that asks for contents once per object would otherwise take the whole list that many times.
 */
static sprout_draft_result everything(const sprout_draft *draft, const sprout_stored_instance ***out,
                                      size_t *count) {
  sprout_draft *d = (sprout_draft *)draft;
  const sprout_stored_instance **all;
  size_t i, n = 0;
  if (d->all != NULL && d->all_generation == d->generation) {
    *out = d->all;
    *count = d->all_count;
    return SPROUT_DRAFT_OK;
  }
  all = (const sprout_stored_instance **)sprout_arena_take(
      draft->turn, (draft->base->instance_count + draft->written_count + 1) * sizeof *all);
  MEMORY(all);
  for (i = 0; i < draft->base->instance_count; i++) {
    const sprout_stored_instance *one = &draft->base->instances[i];
    if (listed(draft->gone, draft->gone_count, one->id) || overlay(draft, one->id) != NULL) continue;
    all[n++] = one;
  }
  for (i = 0; i < draft->written_count; i++) all[n++] = &draft->written[i];
  d->all = all;
  d->all_count = n;
  d->all_generation = d->generation;
  *out = all;
  *count = n;
  return SPROUT_DRAFT_OK;
}

/* The children of `id` among `all`, in contents order, in exactly the room they need. */
static sprout_draft_result children_in(const sprout_draft *draft, const sprout_stored_instance **all,
                                       size_t total, sprout_str id, const sprout_str **ids, size_t *count) {
  size_t i, n = 0, j, matches = 0;
  ranked *held;
  sprout_str *out;
  for (i = 0; i < total; i++)
    if (!all[i]->dormant && all[i]->has_container && sprout_str_same(all[i]->container, id)) matches++;
  held = (ranked *)sprout_arena_take(draft->turn, (matches + 1) * sizeof *held);
  out = (sprout_str *)sprout_arena_take(draft->turn, (matches + 1) * sizeof *out);
  MEMORY(held);
  MEMORY(out);
  for (i = 0; i < total; i++) {
    ranked next;
    if (all[i]->dormant || !all[i]->has_container || !sprout_str_same(all[i]->container, id)) continue;
    next.record = all[i];
    next.rank = all[i]->has_arrival ? 0 : rank_of(draft, all[i]->id);
    for (j = n; j > 0 && comes_before(&next, &held[j - 1]); j--) held[j] = held[j - 1];
    held[j] = next;
    n++;
  }
  for (i = 0; i < n; i++) out[i] = held[i].record->id;
  *ids = out;
  *count = n;
  return SPROUT_DRAFT_OK;
}

sprout_draft_result sprout_draft_children(const sprout_draft *draft, sprout_str id,
                                          const sprout_str **ids, size_t *count) {
  const sprout_stored_instance **all;
  size_t total;
  NEED(everything(draft, &all, &total));
  return children_in(draft, all, total, id, ids, count);
}

/* ---- serials ---- */

static sprout_draft_result open_check(const sprout_draft *draft) {
  return draft->committed ? SPROUT_DRAFT_CLOSED : SPROUT_DRAFT_OK;
}

sprout_draft_result sprout_draft_next_serial(sprout_draft *draft, uint64_t *serial) {
  NEED(open_check(draft));
  draft->serial += 1;
  *serial = draft->serial;
  return SPROUT_DRAFT_OK;
}

sprout_draft_result sprout_draft_mint(sprout_draft *draft, sprout_str *id) {
  uint64_t serial;
  char digits[24];
  size_t count = 0, i, world = draft->base->world.length;
  char *text;
  NEED(sprout_draft_next_serial(draft, &serial));
  while (serial > 0) {
    digits[count++] = (char)('0' + serial % 10);
    serial /= 10;
  }
  text = (char *)sprout_arena_take(draft->turn, world + 1 + count + 1);
  MEMORY(text);
  memcpy(text, draft->base->world.bytes, world);
  text[world] = '#';
  for (i = 0; i < count; i++) text[world + 1 + i] = digits[count - 1 - i];
  id->bytes = text;
  id->length = world + 1 + count;
  return SPROUT_DRAFT_OK;
}

/* ---- writing ---- */

/* Stores a record in the overlay, replacing the turn's earlier write of it. */
static sprout_draft_result keep(sprout_draft *draft, const sprout_stored_instance *record) {
  sprout_stored_instance *slot = overlay(draft, record->id);
  sprout_stored_instance copy;
  if (sprout_stored_instance_copy(draft->turn, record, &copy) != SPROUT_OK) return SPROUT_DRAFT_NO_MEMORY;
  if (slot == NULL) {
    slot = (sprout_stored_instance *)push(draft, (void **)&draft->written, &draft->written_count,
                                          &draft->written_capacity, sizeof *slot);
    MEMORY(slot);
  }
  *slot = copy;
  return SPROUT_DRAFT_OK;
}

sprout_draft_result sprout_draft_write(sprout_draft *draft, const sprout_stored_instance *next) {
  const sprout_stored_instance *current;
  NEED(open_check(draft));
  current = sprout_draft_instance(draft, next->id);
  if (current == NULL) return SPROUT_DRAFT_MISSING;
  if (next->has_container != current->has_container ||
      (next->has_container && !sprout_str_same(next->container, current->container)) ||
      next->has_arrival != current->has_arrival || next->arrival != current->arrival)
    return SPROUT_DRAFT_MOVED;
  return keep(draft, next);
}

sprout_draft_result sprout_draft_place(sprout_draft *draft, sprout_str id, const sprout_str *container) {
  const sprout_stored_instance *current;
  sprout_stored_instance moved;
  NEED(open_check(draft));
  if (sprout_str_same(id, draft->base->world)) return SPROUT_DRAFT_THE_WORLD;
  current = sprout_draft_instance(draft, id);
  if (current == NULL) return SPROUT_DRAFT_MISSING;
  if (container == NULL && current->made != SPROUT_MADE_VISITOR) return SPROUT_DRAFT_NOT_A_VISITOR;
  if (container != NULL) {
    sprout_str at = *container;
    size_t steps = 0;
    if (!sprout_str_same(*container, draft->base->world) && sprout_draft_instance(draft, *container) == NULL)
      return SPROUT_DRAFT_MISSING;
    /* Climb to the root; a stored chain that loops is cut after as many steps as there are records. */
    for (;;) {
      const sprout_stored_instance *up;
      if (sprout_str_same(at, id)) return SPROUT_DRAFT_CYCLE;
      up = sprout_draft_instance(draft, at);
      if (up == NULL || !up->has_container || ++steps > draft->base->instance_count + draft->written_count) break;
      at = up->container;
    }
  }
  moved = *current;
  if (container == NULL) {
    /* Going away is not an arrival: an away visitor keeps the serial it last arrived under. */
    moved.has_container = false;
    memset(&moved.container, 0, sizeof moved.container);
  } else {
    uint64_t arrival;
    NEED(sprout_draft_next_serial(draft, &arrival));
    moved.has_container = true;
    moved.container = *container;
    moved.has_arrival = true;
    moved.arrival = arrival;
  }
  return keep(draft, &moved);
}

sprout_draft_result sprout_draft_add(sprout_draft *draft, const sprout_stored_instance *created) {
  NEED(open_check(draft));
  if (sprout_str_same(created->id, draft->base->world) || sprout_draft_record(draft, created->id) != NULL ||
      listed(draft->gone, draft->gone_count, created->id) || sprout_draft_tombstoned(draft, created->id))
    return SPROUT_DRAFT_TAKEN;
  if (created->has_container && !created->has_arrival) return SPROUT_DRAFT_NO_ARRIVAL;
  NEED(keep(draft, created));
  draft->stored += 1;
  return SPROUT_DRAFT_OK;
}

sprout_draft_result sprout_draft_put_visitor(sprout_draft *draft, const sprout_stored_visitor *record) {
  size_t i;
  sprout_stored_visitor copy;
  NEED(open_check(draft));
  if (sprout_stored_visitor_copy(draft->turn, record, &copy) != SPROUT_OK) return SPROUT_DRAFT_NO_MEMORY;
  for (i = 0; i < draft->visitor_count; i++)
    if (sprout_str_same(draft->visitors[i].visit, record->visit)) {
      draft->visitors[i] = copy;
      return SPROUT_DRAFT_OK;
    }
  {
    sprout_stored_visitor *slot = (sprout_stored_visitor *)push(
        draft, (void **)&draft->visitors, &draft->visitor_count, &draft->visitor_capacity, sizeof *slot);
    MEMORY(slot);
    *slot = copy;
  }
  return SPROUT_DRAFT_OK;
}

/* ---- removing ---- */

/* `id` and everything inside it, all the way down: decoded contents in order, then dormant records by id; each once. */
sprout_draft_result sprout_draft_subtree(const sprout_draft *draft, sprout_str id, sprout_str **out, size_t *count) {
  sprout_str *found, *pending, *dormant;
  size_t n = 0, top = 0, capacity;
  const sprout_stored_instance **all;
  size_t total, i;
  NEED(everything(draft, &all, &total));
  capacity = total + 2;
  found = (sprout_str *)sprout_arena_take(draft->turn, capacity * sizeof *found);
  pending = (sprout_str *)sprout_arena_take(draft->turn, (capacity * 2 + 2) * sizeof *pending);
  dormant = (sprout_str *)sprout_arena_take(draft->turn, (total + 1) * sizeof *dormant);
  MEMORY(found);
  MEMORY(pending);
  MEMORY(dormant);
  pending[top++] = id;
  while (top > 0) {
    sprout_str at = pending[--top];
    const sprout_str *kids;
    size_t kid_count;
    size_t dormant_count = 0;
    if (listed(found, n, at) || n >= capacity) continue;
    found[n++] = at;
    NEED(children_in(draft, all, total, at, &kids, &kid_count));
    /* Pushed in reverse so the first is visited first; dormant records come after the decoded ones. */
    for (i = 0; i < total; i++)
      if (all[i]->dormant && all[i]->has_container && sprout_str_same(all[i]->container, at))
        dormant[dormant_count++] = all[i]->id;
    for (i = 1; i < dormant_count; i++) {
      sprout_str key = dormant[i];
      size_t j = i;
      while (j > 0 && sprout_str_compare(dormant[j - 1], key) > 0) {
        dormant[j] = dormant[j - 1];
        j--;
      }
      dormant[j] = key;
    }
    if (top + dormant_count + kid_count + 1 > capacity * 2) return SPROUT_DRAFT_NO_MEMORY;
    for (i = dormant_count; i > 0; i--) pending[top++] = dormant[i - 1];
    for (i = kid_count; i > 0; i--) pending[top++] = kids[i - 1];
  }
  *out = found;
  *count = n;
  return SPROUT_DRAFT_OK;
}

sprout_draft_result sprout_draft_remove(sprout_draft *draft, sprout_str id, const sprout_str **removed,
                                        size_t *count) {
  sprout_str *found;
  size_t n, i;
  NEED(open_check(draft));
  if (sprout_str_same(id, draft->base->world)) return SPROUT_DRAFT_THE_WORLD;
  if (sprout_draft_instance(draft, id) == NULL) return SPROUT_DRAFT_MISSING;
  NEED(sprout_draft_subtree(draft, id, &found, &n));
  for (i = 0; i < n; i++) {
    const sprout_stored_instance *one = sprout_draft_record(draft, found[i]);
    sprout_str *slot;
    if (one != NULL && !one->dormant) {
      sprout_stored_instance *copy = (sprout_stored_instance *)push(draft, (void **)&draft->kept, &draft->kept_count,
                                                                    &draft->kept_capacity, sizeof *copy);
      MEMORY(copy);
      if (sprout_stored_instance_copy(draft->turn, one, copy) != SPROUT_OK) return SPROUT_DRAFT_NO_MEMORY;
    }
    if (one != NULL && one->made == SPROUT_MADE_DECLARED) {
      slot = (sprout_str *)push(draft, (void **)&draft->buried, &draft->buried_count,
                                &draft->buried_capacity, sizeof *slot);
      MEMORY(slot);
      *slot = found[i];
    }
    slot = (sprout_str *)push(draft, (void **)&draft->gone, &draft->gone_count, &draft->gone_capacity,
                              sizeof *slot);
    MEMORY(slot);
    *slot = found[i];
    {
      sprout_stored_instance *written = overlay(draft, found[i]);
      if (written != NULL) {
        *written = draft->written[--draft->written_count];
      }
    }
    if (draft->stored > 0) draft->stored -= 1;
  }
  *removed = found;
  *count = n;
  return SPROUT_DRAFT_OK;
}

/* ---- commit ---- */

static sprout_draft_result sorted_ids(sprout_arena *arena, const sprout_str *ids, size_t count,
                                      const sprout_str **out) {
  sprout_str *copy = (sprout_str *)sprout_arena_take(arena, (count + 1) * sizeof *copy);
  size_t i, j;
  MEMORY(copy);
  for (i = 0; i < count; i++) {
    sprout_str key = ids[i];
    for (j = i; j > 0 && sprout_str_compare(copy[j - 1], key) > 0; j--) copy[j] = copy[j - 1];
    copy[j] = key;
  }
  *out = copy;
  return SPROUT_DRAFT_OK;
}

/* Where `id` sits, or would, in the sorted instances: the first index whose id is not before it. */
static size_t instance_slot(const sprout_state *state, sprout_str id, bool *found) {
  size_t lo = 0, hi = state->instance_count;
  while (lo < hi) {
    size_t mid = lo + (hi - lo) / 2;
    if (sprout_str_compare(state->instances[mid].id, id) < 0) lo = mid + 1;
    else hi = mid;
  }
  *found = lo < state->instance_count && sprout_str_same(state->instances[lo].id, id);
  return lo;
}

static size_t visitor_slot(const sprout_state *state, sprout_str visit, bool *found) {
  size_t lo = 0, hi = state->visitor_count;
  while (lo < hi) {
    size_t mid = lo + (hi - lo) / 2;
    if (sprout_str_compare(state->visitors[mid].visit, visit) < 0) lo = mid + 1;
    else hi = mid;
  }
  *found = lo < state->visitor_count && sprout_str_same(state->visitors[lo].visit, visit);
  return lo;
}

static size_t tombstone_slot(const sprout_state *state, sprout_str id, bool *found) {
  size_t lo = 0, hi = state->tombstone_count;
  while (lo < hi) {
    size_t mid = lo + (hi - lo) / 2;
    if (sprout_str_compare(state->tombstones[mid], id) < 0) lo = mid + 1;
    else hi = mid;
  }
  *found = lo < state->tombstone_count && sprout_str_same(state->tombstones[lo], id);
  return lo;
}

/* Puts a record in its sorted place, over the one with its id or between its neighbours; the array has room. */
static void place_instance(sprout_state *state, const sprout_stored_instance *one) {
  bool found;
  size_t at = instance_slot(state, one->id, &found);
  if (!found) {
    memmove(state->instances + at + 1, state->instances + at, (state->instance_count - at) * sizeof *one);
    state->instance_count++;
  }
  state->instances[at] = *one;
}

static void place_visitor(sprout_state *state, const sprout_stored_visitor *one) {
  bool found;
  size_t at = visitor_slot(state, one->visit, &found);
  if (!found) {
    memmove(state->visitors + at + 1, state->visitors + at, (state->visitor_count - at) * sizeof *one);
    state->visitor_count++;
  }
  state->visitors[at] = *one;
}

static void place_tombstone(sprout_state *state, sprout_str id) {
  bool found;
  size_t at = tombstone_slot(state, id, &found);
  if (found) return;
  memmove(state->tombstones + at + 1, state->tombstones + at, (state->tombstone_count - at) * sizeof id);
  state->tombstones[at] = id;
  state->tombstone_count++;
}

/* Takes the record with `id` out, closing the gap; false when there is none. */
static bool unplace_instance(sprout_state *state, sprout_str id) {
  bool found;
  size_t at = instance_slot(state, id, &found);
  if (!found) return false;
  memmove(state->instances + at, state->instances + at + 1, (state->instance_count - at - 1) * sizeof *state->instances);
  state->instance_count--;
  return true;
}

/*
 * The commit writes into the state rather than copying it: the turn's records
 * are copied into the state's arena first, all of them, so a refused page
 * leaves the state as it was; then each is put in its sorted place and what
 * is gone is taken out, which takes nothing. What a written record replaced
 * stays in the arena, counted, until the state is compacted. The state is
 * rebuilt first only when its arrays have no room for what the turn adds, or
 * its records are not sorted.
 */
sprout_draft_result sprout_draft_commit(sprout_draft *draft, sprout_changes *changes) {
  sprout_state *state = draft->base;
  sprout_stored_instance *copies;
  sprout_stored_visitor *visits;
  sprout_str *stones, *written_ids, *visit_ids, *gone_ids, *removed, *buried_ids;
  size_t i, removed_count = 0;
  NEED(open_check(draft));
  copies = (sprout_stored_instance *)sprout_arena_take(draft->turn, (draft->written_count + 1) * sizeof *copies);
  visits = (sprout_stored_visitor *)sprout_arena_take(draft->turn, (draft->visitor_count + 1) * sizeof *visits);
  stones = (sprout_str *)sprout_arena_take(draft->turn, (draft->buried_count + 1) * sizeof *stones);
  written_ids = (sprout_str *)sprout_arena_take(draft->turn, (draft->written_count + 1) * sizeof *written_ids);
  visit_ids = (sprout_str *)sprout_arena_take(draft->turn, (draft->visitor_count + 1) * sizeof *visit_ids);
  gone_ids = (sprout_str *)sprout_arena_take(draft->turn, (draft->gone_count + 1) * sizeof *gone_ids);
  removed = (sprout_str *)sprout_arena_take(draft->turn, (draft->gone_count + 1) * sizeof *removed);
  buried_ids = (sprout_str *)sprout_arena_take(draft->turn, (draft->buried_count + 1) * sizeof *buried_ids);
  if (copies == NULL || visits == NULL || stones == NULL || written_ids == NULL || visit_ids == NULL ||
      gone_ids == NULL || removed == NULL || buried_ids == NULL)
    return SPROUT_DRAFT_NO_MEMORY;
  /* The ids the turn removed and buried name the state's own bytes, which a rebuild releases: the turn keeps its own. */
  for (i = 0; i < draft->gone_count; i++)
    if (!sprout_state_copy_str(draft->turn, draft->gone[i], &gone_ids[i])) return SPROUT_DRAFT_NO_MEMORY;
  for (i = 0; i < draft->buried_count; i++)
    if (!sprout_state_copy_str(draft->turn, draft->buried[i], &buried_ids[i])) return SPROUT_DRAFT_NO_MEMORY;
  if (!sprout_state_has_room(state, draft->written_count, draft->visitor_count, draft->buried_count) &&
      sprout_state_rebuild(state, draft->written_count, draft->visitor_count, draft->buried_count) != SPROUT_OK)
    return SPROUT_DRAFT_NO_MEMORY;
  for (i = 0; i < draft->written_count; i++)
    if (sprout_stored_instance_copy(&state->arena, &draft->written[i], &copies[i]) != SPROUT_OK ||
        sprout_stored_instance_order(draft->turn, &copies[i]) != SPROUT_OK)
      return SPROUT_DRAFT_NO_MEMORY;
  for (i = 0; i < draft->visitor_count; i++)
    if (sprout_stored_visitor_copy(&state->arena, &draft->visitors[i], &visits[i]) != SPROUT_OK)
      return SPROUT_DRAFT_NO_MEMORY;
  for (i = 0; i < draft->buried_count; i++)
    if (!sprout_state_copy_str(&state->arena, buried_ids[i], &stones[i])) return SPROUT_DRAFT_NO_MEMORY;
  for (i = 0; i < draft->gone_count; i++)
    if (unplace_instance(state, gone_ids[i])) removed[removed_count++] = gone_ids[i];
  for (i = 0; i < draft->written_count; i++) {
    place_instance(state, &copies[i]);
    written_ids[i] = copies[i].id;
  }
  for (i = 0; i < draft->visitor_count; i++) {
    place_visitor(state, &visits[i]);
    visit_ids[i] = visits[i].visit;
  }
  for (i = 0; i < draft->buried_count; i++) place_tombstone(state, stones[i]);
  state->serial = draft->serial;
  draft->committed = true;

  memset(changes, 0, sizeof *changes);
  changes->serial = draft->serial;
  changes->written_count = draft->written_count;
  changes->removed_count = removed_count;
  changes->tombstoned_count = draft->buried_count;
  changes->visitor_count = draft->visitor_count;
  NEED(sorted_ids(draft->turn, written_ids, draft->written_count, &changes->written));
  NEED(sorted_ids(draft->turn, removed, removed_count, &changes->removed));
  NEED(sorted_ids(draft->turn, buried_ids, draft->buried_count, &changes->tombstoned));
  NEED(sorted_ids(draft->turn, visit_ids, draft->visitor_count, &changes->visitors));
  return SPROUT_DRAFT_OK;
}
