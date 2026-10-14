/*
 * A table keyed by a graph entry's index (graph.h) that holds a pointer for
 * each entry put in it, not one for every entry the graph has: the name
 * table and the option slots a world keeps, and what the loader read each
 * entry as. Open addressing over a power of two of slots, never more than
 * three quarters full; it grows by doubling in its arena, leaving the old
 * slots there.
 */
#ifndef SPROUT_ENTRY_MAP_H
#define SPROUT_ENTRY_MAP_H

#include <stdint.h>

#include "arena.h"

typedef struct sprout_entry_map {
  size_t capacity; /* slots: zero, or a power of two */
  size_t count;
  uint32_t *keys;  /* an entry's index plus one; zero is an empty slot */
  const void **values;
} sprout_entry_map;

/* An empty map with room for `count` entries before it grows; SPROUT_NO_MEMORY when the host refuses a page. */
sprout_status sprout_entry_map_init(sprout_entry_map *map, sprout_arena *arena, size_t count);

/*
 * Sets the value of entry `at` to `value`, which is not NULL, growing in `arena` when the map would be
 * past three quarters full; SPROUT_BAD_INPUT for an index past any graph's, SPROUT_NO_MEMORY when the
 * host refuses a page.
 */
sprout_status sprout_entry_map_put(sprout_entry_map *map, sprout_arena *arena, size_t at, const void *value);

/* The value of entry `at`, or NULL when none was put. */
const void *sprout_entry_map_get(const sprout_entry_map *map, size_t at);

#endif
