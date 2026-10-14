/* Tests for src/entry_map.c. */
#include "entry_map.h"
#include "check.h"

static int values[4096];

static void what_is_put_is_got_and_nothing_else(void) {
  test_heap heap;
  sprout_host host = test_host(&heap);
  sprout_arena arena;
  sprout_entry_map map;
  sprout_arena_init(&arena, &host);
  CHECK_INT(sprout_entry_map_init(&map, &arena, 3), SPROUT_OK);
  CHECK_INT(sprout_entry_map_put(&map, &arena, 0, &values[0]), SPROUT_OK);
  CHECK_INT(sprout_entry_map_put(&map, &arena, 97451, &values[1]), SPROUT_OK);
  CHECK(sprout_entry_map_get(&map, 0) == &values[0]);
  CHECK(sprout_entry_map_get(&map, 97451) == &values[1]);
  CHECK(sprout_entry_map_get(&map, 1) == NULL);
  CHECK(sprout_entry_map_get(&map, 97450) == NULL);
  CHECK_INT(sprout_entry_map_put(&map, &arena, 0, &values[2]), SPROUT_OK); /* a second put replaces */
  CHECK(sprout_entry_map_get(&map, 0) == &values[2]);
  CHECK_INT(map.count, 2);
  sprout_arena_reset(&arena);
}

static void room_is_for_the_entries_put_not_for_the_graph(void) {
  test_heap heap;
  sprout_host host = test_host(&heap);
  sprout_arena arena;
  sprout_entry_map map;
  size_t i, capacity;
  sprout_arena_init(&arena, &host);
  CHECK_INT(sprout_entry_map_init(&map, &arena, 690), SPROUT_OK);
  capacity = map.capacity;
  CHECK(capacity >= 690 && capacity <= 1024);
  for (i = 0; i < 690; i++) CHECK_INT(sprout_entry_map_put(&map, &arena, i * 141, &values[i]), SPROUT_OK);
  CHECK_INT(map.capacity, capacity); /* the count it was made for fits without growing */
  for (i = 0; i < 690; i++) CHECK(sprout_entry_map_get(&map, i * 141) == &values[i]);
  sprout_arena_reset(&arena);
}

static void a_map_grows_and_keeps_what_it_held(void) {
  test_heap heap;
  sprout_host host = test_host(&heap);
  sprout_arena arena;
  sprout_entry_map map;
  size_t i;
  sprout_arena_init(&arena, &host);
  memset(&map, 0, sizeof map); /* a zeroed map is empty, and takes its slots at the first put */
  CHECK(sprout_entry_map_get(&map, 5) == NULL);
  for (i = 0; i < 4096; i++) CHECK_INT(sprout_entry_map_put(&map, &arena, i * 7 + 3, &values[i]), SPROUT_OK);
  CHECK_INT(map.count, 4096);
  CHECK(map.capacity / 4 * 3 >= map.count);
  for (i = 0; i < 4096; i++) CHECK(sprout_entry_map_get(&map, i * 7 + 3) == &values[i]);
  CHECK(sprout_entry_map_get(&map, 4) == NULL);
  sprout_arena_reset(&arena);
}

static void an_index_past_any_entry_or_a_null_value_is_refused(void) {
  test_heap heap;
  sprout_host host = test_host(&heap);
  sprout_arena arena;
  sprout_entry_map map;
  sprout_arena_init(&arena, &host);
  CHECK_INT(sprout_entry_map_init(&map, &arena, 1), SPROUT_OK);
  CHECK_INT(sprout_entry_map_put(&map, &arena, (size_t)UINT32_MAX, &values[0]), SPROUT_BAD_INPUT);
  CHECK_INT(sprout_entry_map_put(&map, &arena, 1, NULL), SPROUT_BAD_INPUT);
  CHECK(sprout_entry_map_get(&map, (size_t)UINT32_MAX) == NULL);
  CHECK_INT(map.count, 0);
  sprout_arena_reset(&arena);
}

static void a_refused_page_is_no_memory(void) {
  test_heap heap;
  sprout_host host = test_host(&heap);
  sprout_arena arena;
  sprout_entry_map map;
  heap.refuse_after = 0;
  sprout_arena_init(&arena, &host);
  CHECK_INT(sprout_entry_map_init(&map, &arena, 10), SPROUT_NO_MEMORY);
  sprout_arena_reset(&arena);
}

int main(void) {
  RUN(what_is_put_is_got_and_nothing_else);
  RUN(room_is_for_the_entries_put_not_for_the_graph);
  RUN(a_map_grows_and_keeps_what_it_held);
  RUN(an_index_past_any_entry_or_a_null_value_is_refused);
  RUN(a_refused_page_is_no_memory);
  return REPORT();
}
