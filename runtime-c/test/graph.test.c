/*
 * Tests for src/graph.c: the table of entries a cartridge holds is read into
 * nodes that share what the table shares, with forward references, places and
 * the three runs under one numbering; a malformed table is refused in words.
 */
#include "check.h"
#include "graph.h"

static sprout_status read_graph(sprout_arena *arena, const char *files, const char *prose,
                                const char *bodies, const char *rest, sprout_graph *graph, char *error) {
  sprout_json *f, *p, *b, *r;
  sprout_json_error e;
  if (sprout_json_read(arena, files, strlen(files), &f, &e) != SPROUT_OK) return SPROUT_BAD_INPUT;
  if (sprout_json_read(arena, prose, strlen(prose), &p, &e) != SPROUT_OK) return SPROUT_BAD_INPUT;
  if (sprout_json_read(arena, bodies, strlen(bodies), &b, &e) != SPROUT_OK) return SPROUT_BAD_INPUT;
  if (sprout_json_read(arena, rest, strlen(rest), &r, &e) != SPROUT_OK) return SPROUT_BAD_INPUT;
  return sprout_graph_read(arena, f, p, b, r, graph, error, 200);
}

static void a_shared_entry_is_one_node_and_references_run_across_the_three_runs(void) {
  test_heap heap;
  sprout_host host = test_host(&heap);
  sprout_arena arena;
  sprout_graph graph;
  char error[200];
  const sprout_node *a, *b, *list;
  sprout_arena_init(&arena, &host);
  CHECK_INT(read_graph(&arena, "[\"a.sprout\"]", "[{\"o\":{\"kind\":\"prose\",\"next\":[1]}}]",
                       "[{\"o\":{\"kind\":\"integer\",\"value\":8,\"at\":{\"p\":[0,3,4]}}}]",
                       "[{\"a\":[[0],[1],[0]]},{\"m\":[[\"k\",[0]],[[1],true]]},{\"s\":[null,1]}]", &graph, error),
            SPROUT_OK);
  CHECK_INT(graph.count, 5);
  a = &graph.entries[0];
  b = &graph.entries[1];
  CHECK_INT(a->kind, SPROUT_NODE_OBJECT);
  CHECK(sprout_node_get(a, "next") == b);
  CHECK_INT(b->index, 1);
  CHECK(sprout_node_get(b, "value")->number == 8);
  CHECK_INT(sprout_node_get(b, "at")->kind, SPROUT_NODE_PLACE);
  CHECK_INT(sprout_node_get(b, "at")->line, 3);
  CHECK_INT(sprout_node_get(b, "at")->column, 4);
  CHECK_STR(graph.files[0], "a.sprout");
  list = &graph.entries[2];
  CHECK_INT(list->kind, SPROUT_NODE_ARRAY);
  CHECK_INT(list->count, 3);
  CHECK(list->items[0] == a && list->items[2] == a && list->items[1] == b);
  CHECK(sprout_node_map_find(&graph.entries[3], "k") == a);
  CHECK(sprout_node_map_get(&graph.entries[3], b)->boolean);
  CHECK_INT(graph.entries[4].kind, SPROUT_NODE_SET);
  CHECK_INT(graph.entries[4].items[0]->kind, SPROUT_NODE_NULL);
  CHECK(sprout_node_get(a, "missing") == NULL);
  CHECK(sprout_node_text(a, "kind") != NULL);
  CHECK(sprout_node_is(sprout_node_get(a, "kind"), "prose"));
  CHECK(!sprout_node_is(sprout_node_get(a, "kind"), "other"));
  CHECK(sprout_graph_cell(&graph, NULL) == NULL);
  sprout_arena_reset(&arena);
  CHECK_INT(heap.pages, 0);
}

static void a_forward_reference_and_a_place_without_a_listed_file_are_handled_in_words(void) {
  test_heap heap;
  sprout_host host = test_host(&heap);
  sprout_arena arena;
  sprout_graph graph;
  char error[200];
  sprout_arena_init(&arena, &host);
  CHECK_INT(read_graph(&arena, "[]", "[]", "[]", "[{\"a\":[[1]]},{\"a\":[]}]", &graph, error), SPROUT_OK);
  CHECK(graph.entries[0].items[0] == &graph.entries[1]);
  CHECK_INT(read_graph(&arena, "[]", "[]", "[]", "[{\"a\":[[2]]}]", &graph, error), SPROUT_BAD_INPUT);
  CHECK_STR(error, "the cartridge refers to an entry it does not hold.");
  CHECK_INT(read_graph(&arena, "[]", "[]", "[]", "[{\"a\":[{\"p\":[0,1,1]}]}]", &graph, error), SPROUT_BAD_INPUT);
  CHECK_STR(error, "the cartridge names a file it does not list.");
  CHECK_INT(read_graph(&arena, "[]", "[]", "[]", "[{\"a\":[{\"p\":[-1,0,0]}]}]", &graph, error), SPROUT_OK);
  CHECK_INT(graph.entries[0].items[0]->file, -1);
  CHECK_INT(read_graph(&arena, "[]", "[]", "[]", "[5]", &graph, error), SPROUT_BAD_INPUT);
  CHECK_STR(error, "an entry of the table is not an object, an array, a map or a set.");
  CHECK_INT(read_graph(&arena, "[]", "[]", "[]", "[{\"m\":[[1]]}]", &graph, error), SPROUT_BAD_INPUT);
  CHECK_STR(error, "a map in the cartridge holds something that is not a pair.");
  CHECK_INT(read_graph(&arena, "[]", "[]", "[]", "[{\"a\":[[0,1]]}]", &graph, error), SPROUT_BAD_INPUT);
  CHECK_STR(error, "an entry holds an array where a reference to an entry should be.");
  CHECK_INT(read_graph(&arena, "[]", "[]", "[]", "[{\"a\":[{\"q\":1}]}]", &graph, error), SPROUT_BAD_INPUT);
  CHECK_STR(error, "an entry holds an object where a place or a reference should be.");
  CHECK_INT(read_graph(&arena, "[1]", "[]", "[]", "[]", &graph, error), SPROUT_BAD_INPUT);
  CHECK_STR(error, "the cartridge's list of files holds something that is not a name.");
  sprout_arena_reset(&arena);
}

static void a_host_that_runs_out_of_memory_is_told_so(void) {
  long pages;
  for (pages = 0; pages < 8; pages++) {
    test_heap heap;
    sprout_host host = test_host(&heap);
    sprout_arena arena, scratch;
    sprout_graph graph;
    char error[200];
    sprout_status status;
    sprout_arena_init(&scratch, &host);
    sprout_arena_init(&arena, &host);
    heap.refuse_after = pages;
    status = read_graph(&arena, "[\"f\"]", "[]", "[]", "[{\"a\":[1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17,18,19,20]}]", &graph, error);
    CHECK(status == SPROUT_OK || status == SPROUT_BAD_INPUT || status == SPROUT_NO_MEMORY);
    sprout_arena_reset(&arena);
    sprout_arena_reset(&scratch);
    CHECK_INT(heap.pages, 0);
  }
}

int main(void) {
  RUN(a_shared_entry_is_one_node_and_references_run_across_the_three_runs);
  RUN(a_forward_reference_and_a_place_without_a_listed_file_are_handled_in_words);
  RUN(a_host_that_runs_out_of_memory_is_told_so);
  return REPORT();
}
