/*
 * Tests for src/catalogue_helpers.c: the refusal sentence, the arena
 * allocation that reports no memory, and the small readers of strings and
 * flags out of graph nodes.
 */
#include "catalogue_build.h"
#include "check.h"

typedef struct bench {
  test_heap heap;
  sprout_host host;
  sprout_arena arena;
  sprout_graph graph;
  loader l;
  char error[160];
} bench;

static void open_bench(bench *b, const char *entries) {
  sprout_json *files, *none, *rest;
  sprout_json_error e;
  char error[100];
  memset(b, 0, sizeof *b);
  b->host = test_host(&b->heap);
  sprout_arena_init(&b->arena, &b->host);
  CHECK_INT(sprout_json_read(&b->arena, "[]", 2, &files, &e), SPROUT_OK);
  CHECK_INT(sprout_json_read(&b->arena, "[]", 2, &none, &e), SPROUT_OK);
  CHECK_INT(sprout_json_read(&b->arena, entries, strlen(entries), &rest, &e), SPROUT_OK);
  CHECK_INT(sprout_graph_read(&b->arena, files, none, none, rest, &b->graph, error, sizeof error), SPROUT_OK);
  b->l.arena = &b->arena;
  b->l.error = b->error;
  b->l.capacity = sizeof b->error;
}

static void a_refusal_is_the_pieces_joined_and_cut_to_fit(void) {
  bench b;
  open_bench(&b, "[]");
  CHECK_INT(cat_fail(&b.l, "one ", "two ", "three"), SPROUT_BAD_INPUT);
  CHECK_STR(b.error, "one two three");
  CHECK_INT(cat_fail(&b.l, "a", NULL, "c"), SPROUT_BAD_INPUT);
  CHECK_STR(b.error, "ac");
  CHECK_INT(cat_fail(&b.l, "0123456789012345678901234567890123456789012345678901234567890123456789012345678901234567890123456789", "0123456789012345678901234567890123456789012345678901234567890123456789012345678901234567890123456789", "xyz"),
            SPROUT_BAD_INPUT);
  CHECK_INT(strlen(b.error), 159);
  CHECK_INT(cat_shaped(&b.l, "kinds.all"), SPROUT_BAD_INPUT);
  CHECK_STR(b.error, "This cartridge is not shaped as a cartridge is at `kinds.all`: it is not what a cartridge holds there.");
  sprout_arena_reset(&b.arena);
}

static void allocation_is_zeroed_and_an_impossible_size_is_refused(void) {
  bench b;
  char *room;
  size_t i;
  open_bench(&b, "[]");
  room = (char *)cat_array(&b.l, 10, 4);
  CHECK(room != NULL);
  for (i = 0; room != NULL && i < 40; i++) CHECK(room[i] == 0);
  CHECK(cat_array(&b.l, (size_t)-1, 16) == NULL);
  CHECK(cat_array(&b.l, 0, 8) != NULL);
  sprout_arena_reset(&b.arena);
}

static void strings_flags_and_arrays_are_read_from_nodes(void) {
  bench b;
  const sprout_node *o;
  size_t count = 0;
  const char **items = NULL;
  char *joined;
  open_bench(&b, "[{\"o\":{\"name\":\"oak\",\"yes\":true,\"no\":false,\"n\":3,\"list\":[1],\"words\":[2],\"bad\":[3]}},"
                 "{\"a\":[\"x\",\"y\"]},{\"s\":[\"z\"]},{\"a\":[\"x\",4]}]");
  o = &b.graph.entries[0];
  CHECK_STR(cat_text(o, "name"), "oak");
  CHECK(cat_text(o, "n") == NULL);
  CHECK(cat_text(o, "absent") == NULL);
  CHECK(cat_bool(o, "yes"));
  CHECK(!cat_bool(o, "no"));
  CHECK(!cat_bool(o, "n"));
  CHECK(!cat_bool(o, "absent"));
  CHECK(cat_is_array(&b.graph.entries[1]) && cat_is_array(&b.graph.entries[2]));
  CHECK(!cat_is_array(o) && !cat_is_array(NULL));
  CHECK_INT(cat_strings(&b.l, &b.graph.entries[1], "words", &count, &items), SPROUT_OK);
  CHECK_INT(count, 2);
  CHECK_STR(items[1], "y");
  CHECK_INT(cat_strings(&b.l, &b.graph.entries[2], "words", &count, &items), SPROUT_OK);
  CHECK_INT(count, 1);
  CHECK_INT(cat_strings(&b.l, &b.graph.entries[3], "words", &count, &items), SPROUT_BAD_INPUT);
  CHECK(strstr(b.error, "`words`") != NULL);
  CHECK_INT(cat_strings(&b.l, o, "words", &count, &items), SPROUT_BAD_INPUT);
  joined = cat_join3(&b.l, "ab", ".", "cd");
  CHECK(joined != NULL);
  if (joined != NULL) CHECK_STR(joined, "ab.cd");
  {
    const char *path[] = {"a", "b"};
    CHECK_STR(cat_id_of(&b.l, "w", 2, path), "w.a.b");
    CHECK_STR(cat_id_of(&b.l, "w", 0, path), "w");
  }
  sprout_arena_reset(&b.arena);
  CHECK_INT(b.heap.pages, 0);
}

int main(void) {
  RUN(a_refusal_is_the_pieces_joined_and_cut_to_fit);
  RUN(allocation_is_zeroed_and_an_impossible_size_is_refused);
  RUN(strings_flags_and_arrays_are_read_from_nodes);
  return REPORT();
}
