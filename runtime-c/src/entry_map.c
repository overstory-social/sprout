/* A table keyed by a graph entry's index; see entry_map.h. */
#include "entry_map.h"

#include <string.h>

/* An index past this is no graph's entry (graph.h's SPROUT_NOT_AN_ENTRY and above). */
#define LAST_ENTRY ((size_t)UINT32_MAX - 1u)

static size_t slot_of(uint32_t key, size_t capacity) {
  uint32_t x = key;
  x ^= x >> 16;
  x *= 0x45d9f3bu;
  x ^= x >> 16;
  return (size_t)x & (capacity - 1u);
}

/* Fresh zeroed slots for `capacity`, a power of two. */
static sprout_status take_slots(sprout_entry_map *map, sprout_arena *arena, size_t capacity) {
  uint32_t *keys = (uint32_t *)sprout_arena_take_aligned(arena, capacity * sizeof(uint32_t), sizeof(uint32_t));
  const void **values;
  if (keys == NULL) return SPROUT_NO_MEMORY;
  values = (const void **)sprout_arena_take_aligned(arena, capacity * sizeof(void *), sizeof(void *));
  if (values == NULL) return SPROUT_NO_MEMORY;
  map->keys = keys;
  map->values = values;
  map->capacity = capacity;
  return SPROUT_OK;
}

/* The slot holding `key`, or the empty slot where it would go. */
static size_t find(const sprout_entry_map *map, uint32_t key) {
  size_t at = slot_of(key, map->capacity);
  while (map->keys[at] != 0 && map->keys[at] != key) at = (at + 1u) & (map->capacity - 1u);
  return at;
}

/* The fewest slots, a power of two and eight at least, that hold `count` entries at three quarters full. */
static size_t slots_for(size_t count) {
  size_t capacity = 8;
  while (capacity / 4u * 3u < count) {
    if (capacity > (size_t)-1 / 2u) return 0;
    capacity *= 2u;
  }
  return capacity;
}

sprout_status sprout_entry_map_init(sprout_entry_map *map, sprout_arena *arena, size_t count) {
  size_t capacity = slots_for(count);
  memset(map, 0, sizeof *map);
  if (capacity == 0 || capacity > (size_t)-1 / sizeof(void *)) return SPROUT_NO_MEMORY;
  return take_slots(map, arena, capacity);
}

static sprout_status grow(sprout_entry_map *map, sprout_arena *arena) {
  sprout_entry_map bigger = *map;
  size_t i;
  if (map->capacity > (size_t)-1 / 2u / sizeof(void *)) return SPROUT_NO_MEMORY;
  if (take_slots(&bigger, arena, map->capacity * 2u) != SPROUT_OK) return SPROUT_NO_MEMORY;
  for (i = 0; i < map->capacity; i++) {
    if (map->keys[i] != 0) {
      size_t at = find(&bigger, map->keys[i]);
      bigger.keys[at] = map->keys[i];
      bigger.values[at] = map->values[i];
    }
  }
  *map = bigger;
  return SPROUT_OK;
}

sprout_status sprout_entry_map_put(sprout_entry_map *map, sprout_arena *arena, size_t at, const void *value) {
  uint32_t key;
  size_t slot;
  if (at >= LAST_ENTRY || value == NULL) return SPROUT_BAD_INPUT;
  key = (uint32_t)(at + 1u);
  if (map->capacity == 0 || (map->count + 1u) > map->capacity / 4u * 3u) {
    sprout_status status = map->capacity == 0 ? take_slots(map, arena, 8) : grow(map, arena);
    if (status != SPROUT_OK) return status;
  }
  slot = find(map, key);
  if (map->keys[slot] == 0) {
    map->keys[slot] = key;
    map->count++;
  }
  map->values[slot] = value;
  return SPROUT_OK;
}

const void *sprout_entry_map_get(const sprout_entry_map *map, size_t at) {
  size_t slot;
  if (map->capacity == 0 || at >= LAST_ENTRY) return NULL;
  slot = find(map, (uint32_t)(at + 1u));
  return map->keys[slot] == 0 ? NULL : map->values[slot];
}
