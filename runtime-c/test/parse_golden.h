/*
 * `corpus/goldens/addresses.json`, written by runtime/parser/goldens.spec.ts: for a visitor arriving in every corpus
 * world, the state they arrive in, each live instance's address, and what the visitor may name. Each world is opened
 * on a bench in that state for a check to run.
 */
#ifndef SPROUT_TEST_PARSE_GOLDEN_H
#define SPROUT_TEST_PARSE_GOLDEN_H

#include "parse_fixture.h"

/* Calls `each` with every world of the golden opened on a bench, and the world's entry. */
static inline void golden_worlds(void (*each)(bench *b, const sprout_json *world)) {
  test_heap heap;
  sprout_host host = test_host(&heap);
  sprout_arena arena;
  size_t length, i;
  char *text = test_golden("addresses.json", &length);
  sprout_json *root = NULL;
  sprout_json_error error;
  host.page_bytes = 65536;
  sprout_arena_init(&arena, &host);
  if (sprout_json_read(&arena, text, length, &root, &error) != SPROUT_OK) {
    fprintf(stderr, "addresses.json: %s\n", error.text);
    exit(2);
  }
  free(text);
  CHECK(root->count > 80);
  for (i = 0; i < root->count; i++) {
    const sprout_json *world = root->items[i], *state = sprout_json_get(world, "state");
    const sprout_json *name = sprout_json_get(world, "world"), *visit = sprout_json_get(world, "visit");
    bench b;
    bench_stored(&b, name->bytes, state->bytes, state->length, visit->bytes);
    each(&b, world);
    bench_close(&b);
  }
  sprout_arena_reset(&arena);
  CHECK_INT(heap.pages, 0);
}

#endif
