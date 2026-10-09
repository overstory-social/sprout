/* Tests for src/arena.c. */
#include "arena.h"
#include "check.h"

static void a_pieces_are_zeroed_aligned_and_distinct(void) {
  test_heap heap;
  sprout_host host = test_host(&heap);
  sprout_arena arena;
  char *a, *b;
  CHECK_INT(sprout_arena_init(&arena, &host), SPROUT_OK);
  a = (char *)sprout_arena_take(&arena, 10);
  b = (char *)sprout_arena_take(&arena, 10);
  CHECK(a != NULL && b != NULL && a != b);
  CHECK(((uintptr_t)a % 16u) == 0 && ((uintptr_t)b % 16u) == 0);
  for (int i = 0; i < 10; i++) CHECK(a[i] == 0 && b[i] == 0);
  memset(a, 7, 10);
  CHECK(b[0] == 0);
  sprout_arena_reset(&arena);
}

static void it_takes_a_new_page_when_one_is_full_and_reset_releases_them_all(void) {
  test_heap heap;
  sprout_host host = test_host(&heap);
  sprout_arena arena;
  sprout_arena_init(&arena, &host);
  for (int i = 0; i < 50; i++) CHECK(sprout_arena_take(&arena, 40) != NULL);
  CHECK(heap.pages > 3);
  sprout_arena_reset(&arena);
  CHECK_INT(heap.pages, 0);
  CHECK_INT(heap.bytes, 0);
  CHECK(sprout_arena_take(&arena, 8) != NULL);
  sprout_arena_reset(&arena);
  CHECK_INT(heap.pages, 0);
}

static void a_request_larger_than_a_page_gets_its_own_page(void) {
  test_heap heap;
  sprout_host host = test_host(&heap);
  sprout_arena arena;
  char *big;
  sprout_arena_init(&arena, &host);
  CHECK(sprout_arena_take(&arena, 16) != NULL);
  big = (char *)sprout_arena_take(&arena, host.page_bytes * 10);
  CHECK(big != NULL);
  big[host.page_bytes * 10 - 1] = 1;
  CHECK(sprout_arena_take(&arena, 16) != NULL);
  CHECK_INT(heap.pages, 2);
  sprout_arena_reset(&arena);
  CHECK_INT(heap.pages, 0);
}

static void it_copies_bytes_with_a_terminator(void) {
  test_heap heap;
  sprout_host host = test_host(&heap);
  sprout_arena arena;
  char *copy;
  sprout_arena_init(&arena, &host);
  copy = sprout_arena_copy(&arena, "abcdef", 3);
  CHECK_STR(copy, "abc");
  sprout_arena_reset(&arena);
}

static void a_host_that_refuses_is_met_with_null_not_a_crash(void) {
  test_heap heap;
  sprout_host host = test_host(&heap);
  sprout_arena arena;
  sprout_arena_init(&arena, &host);
  heap.refuse_after = 1;
  CHECK(sprout_arena_take(&arena, 8) != NULL);
  CHECK(sprout_arena_take(&arena, host.page_bytes) == NULL);
  CHECK(sprout_arena_copy(&arena, "x", 1) != NULL);
  sprout_arena_reset(&arena);
  CHECK_INT(heap.pages, 0);
}

static void a_host_without_pages_or_callbacks_is_refused(void) {
  test_heap heap;
  sprout_host host = test_host(&heap);
  sprout_arena arena;
  host.page_bytes = 0;
  CHECK_INT(sprout_arena_init(&arena, &host), SPROUT_BAD_HOST);
  host = test_host(&heap);
  host.alloc = NULL;
  CHECK_INT(sprout_arena_init(&arena, &host), SPROUT_BAD_HOST);
  host = test_host(&heap);
  host.release = NULL;
  CHECK_INT(sprout_arena_init(&arena, &host), SPROUT_BAD_HOST);
  CHECK_INT(sprout_arena_init(&arena, NULL), SPROUT_BAD_HOST);
}

int main(void) {
  RUN(a_pieces_are_zeroed_aligned_and_distinct);
  RUN(it_takes_a_new_page_when_one_is_full_and_reset_releases_them_all);
  RUN(a_request_larger_than_a_page_gets_its_own_page);
  RUN(it_copies_bytes_with_a_terminator);
  RUN(a_host_that_refuses_is_met_with_null_not_a_crash);
  RUN(a_host_without_pages_or_callbacks_is_refused);
  return REPORT();
}
