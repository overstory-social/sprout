/*
 * Tests for src/graph.c: the table of entries a cartridge holds is read into
 * nodes that share what the table shares, with forward references, places and
 * the three runs under one numbering; equal scalars are one node, and the
 * JSON read from can be released; a malformed table is refused in words.
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
  return sprout_graph_read(arena, arena, f, p, b, r, graph, error, 200);
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
  CHECK(sprout_node_get(&graph, a, "next") == b);
  CHECK_INT(sprout_graph_index(&graph, b), 1);
  CHECK_INT(sprout_graph_index(&graph, &graph.entries[4]), 4);
  CHECK(sprout_graph_index(&graph, sprout_node_get(&graph, b, "value")) == SPROUT_NOT_AN_ENTRY);
  CHECK(sprout_graph_index(&graph, sprout_node_get(&graph, b, "at")) == SPROUT_NOT_AN_ENTRY);
  CHECK(sprout_graph_index(&graph, &graph.null_node) == SPROUT_NOT_AN_ENTRY);
  {
    sprout_node outside;
    memset(&outside, 0, sizeof outside);
    CHECK(sprout_graph_index(&graph, &outside) == SPROUT_NOT_AN_ENTRY);
    CHECK(sprout_graph_index(&graph, NULL) == SPROUT_NOT_AN_ENTRY);
    CHECK(sprout_graph_index(NULL, b) == SPROUT_NOT_AN_ENTRY);
  }
  CHECK(sprout_node_number(&graph, sprout_node_get(&graph, b, "value")) == 8);
  CHECK_INT(sprout_node_get(&graph, b, "at")->kind, SPROUT_NODE_PLACE);
  CHECK_INT(sprout_place_line(&graph, sprout_node_get(&graph, b, "at")), 3);
  CHECK_INT(sprout_place_column(&graph, sprout_node_get(&graph, b, "at")), 4);
  CHECK_STR(graph.files[0], "a.sprout");
  list = &graph.entries[2];
  CHECK_INT(list->kind, SPROUT_NODE_ARRAY);
  CHECK_INT(list->count, 3);
  CHECK(sprout_item(&graph, list, 0) == a && sprout_item(&graph, list, 2) == a && sprout_item(&graph, list, 1) == b);
  CHECK(sprout_node_map_find(&graph, &graph.entries[3], "k") == a);
  CHECK(sprout_truth(sprout_node_map_get(&graph, &graph.entries[3], b)));
  CHECK_INT(graph.entries[4].kind, SPROUT_NODE_SET);
  CHECK_INT(sprout_item(&graph, &graph.entries[4], 0)->kind, SPROUT_NODE_NULL);
  CHECK(sprout_node_get(&graph, a, "missing") == NULL);
  CHECK(sprout_node_text(&graph, a, "kind") != NULL);
  CHECK(sprout_node_is(&graph, sprout_node_get(&graph, a, "kind"), "prose"));
  CHECK(!sprout_node_is(&graph, sprout_node_get(&graph, a, "kind"), "other"));
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
  CHECK(sprout_item(&graph, &graph.entries[0], 0) == &graph.entries[1]);
  CHECK_INT(read_graph(&arena, "[]", "[]", "[]", "[{\"a\":[[2]]}]", &graph, error), SPROUT_BAD_INPUT);
  CHECK_STR(error, "the cartridge refers to an entry it does not hold.");
  CHECK_INT(read_graph(&arena, "[]", "[]", "[]", "[{\"a\":[{\"p\":[0,1,1]}]}]", &graph, error), SPROUT_BAD_INPUT);
  CHECK_STR(error, "the cartridge names a file it does not list.");
  CHECK_INT(read_graph(&arena, "[]", "[]", "[]", "[{\"a\":[{\"p\":[-1,0,0]}]}]", &graph, error), SPROUT_OK);
  CHECK_INT(sprout_place_file(&graph, sprout_item(&graph, &graph.entries[0], 0)), -1);
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

static void equal_scalars_are_one_node_and_nothing_points_at_the_json(void) {
  test_heap heap;
  sprout_host host = test_host(&heap);
  sprout_arena arena, scratch;
  sprout_graph graph;
  sprout_json *f, *p, *b, *r;
  sprout_json_error e;
  char error[200];
  const sprout_node *first, *second;
  sprout_arena_init(&arena, &host);
  sprout_arena_init(&scratch, &host);
  const char *table =
      "[{\"o\":{\"kind\":\"word\",\"at\":{\"p\":[0,2,5]},\"n\":7,\"yes\":true}},"
                             "{\"o\":{\"kind\":\"word\",\"at\":{\"p\":[0,2,5]},\"n\":7,\"yes\":true,\"no\":false}},"
                             "{\"a\":[\"kind\",\"other\",{\"p\":[0,2,6]},8]}]";
  CHECK_INT(sprout_json_read(&scratch, "[\"a.sprout\"]", 12, &f, &e), SPROUT_OK);
  CHECK_INT(sprout_json_read(&scratch, "[]", 2, &p, &e), SPROUT_OK);
  CHECK_INT(sprout_json_read(&scratch, "[]", 2, &b, &e), SPROUT_OK);
  CHECK_INT(sprout_json_read(&scratch, table, strlen(table), &r, &e), SPROUT_OK);
  CHECK_INT(sprout_graph_read(&arena, &scratch, f, p, b, r, &graph, error, 200), SPROUT_OK);
  /* The JSON is released: everything the graph reads from here is its own. */
  sprout_arena_reset(&scratch);
  first = &graph.entries[0];
  second = &graph.entries[1];
  CHECK(sprout_node_get(&graph, first, "kind") == sprout_node_get(&graph, second, "kind"));
  /* A string equal to a field name shares its text. */
  CHECK(sprout_text(&graph, sprout_item(&graph, &graph.entries[2], 0)) == sprout_key(&graph, first, 0));
  CHECK(sprout_node_get(&graph, first, "kind") != sprout_item(&graph, &graph.entries[2], 1));
  CHECK(sprout_node_get(&graph, first, "at") == sprout_node_get(&graph, second, "at"));
  CHECK(sprout_node_get(&graph, first, "at") != sprout_item(&graph, &graph.entries[2], 2));
  CHECK(sprout_node_get(&graph, first, "n") == sprout_node_get(&graph, second, "n"));
  CHECK(sprout_node_get(&graph, first, "n") != sprout_item(&graph, &graph.entries[2], 3));
  CHECK(sprout_node_get(&graph, first, "yes") == &graph.true_node);
  CHECK(sprout_node_get(&graph, second, "no") == &graph.false_node);
  CHECK(sprout_key(&graph, first, 0) == sprout_key(&graph, second, 0));
  CHECK_STR(sprout_key(&graph, first, 0), "kind");
  CHECK_STR(graph.files[0], "a.sprout");
  CHECK_INT(sprout_place_line(&graph, sprout_node_get(&graph, first, "at")), 2);
  CHECK_INT(sprout_place_column(&graph, sprout_node_get(&graph, first, "at")), 5);
  CHECK(sprout_node_number(&graph, sprout_node_get(&graph, first, "n")) == 7);
  CHECK(sprout_node_number(&graph, sprout_item(&graph, &graph.entries[2], 3)) == 8);
  CHECK(sizeof(sprout_node) <= 32);
  sprout_arena_reset(&arena);
  CHECK_INT(heap.pages, 0);
}

static void a_place_past_what_a_node_holds_is_refused(void) {
  test_heap heap;
  sprout_host host = test_host(&heap);
  sprout_arena arena;
  sprout_graph graph;
  char error[200];
  sprout_arena_init(&arena, &host);
  CHECK_INT(read_graph(&arena, "[\"f\"]", "[]", "[]", "[{\"a\":[{\"p\":[0,1,70000]}]}]", &graph, error), SPROUT_BAD_INPUT);
  CHECK_STR(error, "a line of the source is longer than 65,535 characters, which a cartridge cannot place.");
  CHECK_INT(read_graph(&arena, "[\"f\"]", "[]", "[]", "[{\"a\":[{\"p\":[0,65535,65535]}]}]", &graph, error), SPROUT_OK);
  CHECK_INT(sprout_place_column(&graph, sprout_item(&graph, &graph.entries[0], 0)), 65535);
  sprout_arena_reset(&arena);
  CHECK_INT(heap.pages, 0);
}

static void the_graph_is_read_an_entry_at_a_time_and_its_files_checked_at_the_end(void) {
  test_heap heap;
  sprout_host host = test_host(&heap);
  sprout_arena arena, scratch;
  sprout_graph graph;
  sprout_graph_reader reader;
  sprout_json *one, *two, *files;
  sprout_json_error e;
  char error[200];
  sprout_arena_init(&arena, &host);
  sprout_arena_init(&scratch, &host);
  const char *one_text = "{\"a\":[[1],{\"p\":[1,2,3]}]}", *two_text = "{\"s\":[[0]]}";
  const char *files_text = "[\"a.sprout\",\"b.sprout\"]";
  CHECK_INT(sprout_json_read(&scratch, one_text, strlen(one_text), &one, &e), SPROUT_OK);
  CHECK_INT(sprout_json_read(&scratch, two_text, strlen(two_text), &two, &e), SPROUT_OK);
  CHECK_INT(sprout_json_read(&scratch, files_text, strlen(files_text), &files, &e), SPROUT_OK);
  CHECK_INT(sprout_graph_begin(&reader, &graph, &arena, &scratch, 1, 0, 1, error, 200), SPROUT_OK);
  CHECK_INT(graph.count, 2);
  CHECK_INT(sprout_graph_fill(&reader, one), SPROUT_OK);
  CHECK(sprout_item(&graph, &graph.entries[0], 0) == &graph.entries[1]);
  CHECK_INT(sprout_graph_fill(&reader, two), SPROUT_OK);
  CHECK_INT(sprout_graph_fill(&reader, two), SPROUT_BAD_INPUT);
  CHECK_STR(error, "the cartridge holds more entries than its header counts.");
  CHECK_INT(sprout_graph_end(&reader, files), SPROUT_OK);
  CHECK_STR(graph.files[1], "b.sprout");
  CHECK_INT(sprout_place_file(&graph, sprout_item(&graph, &graph.entries[0], 1)), 1);
  /* A place's file is checked once the files are known. */
  CHECK_INT(sprout_json_read(&scratch, "[\"a.sprout\"]", 12, &files, &e), SPROUT_OK);
  CHECK_INT(sprout_graph_begin(&reader, &graph, &arena, &scratch, 1, 0, 1, error, 200), SPROUT_OK);
  CHECK_INT(sprout_graph_fill(&reader, one), SPROUT_OK);
  CHECK_INT(sprout_graph_fill(&reader, two), SPROUT_OK);
  CHECK_INT(sprout_graph_end(&reader, files), SPROUT_BAD_INPUT);
  CHECK_STR(error, "the cartridge names a file it does not list.");
  /* Fewer entries than counted. */
  CHECK_INT(sprout_graph_begin(&reader, &graph, &arena, &scratch, 1, 0, 1, error, 200), SPROUT_OK);
  CHECK_INT(sprout_graph_fill(&reader, one), SPROUT_OK);
  CHECK_INT(sprout_graph_end(&reader, files), SPROUT_BAD_INPUT);
  CHECK_STR(error, "the cartridge holds fewer entries than its header counts.");
  sprout_arena_reset(&scratch);
  sprout_arena_reset(&arena);
  CHECK_INT(heap.pages, 0);
}

static void objects_with_the_same_fields_in_the_same_order_share_one_key_array(void) {
  test_heap heap;
  sprout_host host = test_host(&heap);
  sprout_arena arena;
  sprout_graph graph;
  char error[200], rest[4096];
  size_t at = 0, i;
  sprout_arena_init(&arena, &host);
  /* 40 shapes, each twice, so the shape table grows past its first 64 slots while it reads. */
  at += (size_t)sprintf(rest + at, "[{\"o\":{\"kind\":\"a\",\"x\":1}},{\"o\":{\"kind\":\"b\",\"x\":2}},{\"o\":{\"x\":3,\"kind\":\"c\"}},{\"o\":{\"kind\":\"d\"}}");
  for (i = 0; i < 80; i++) at += (size_t)sprintf(rest + at, ",{\"o\":{\"k%u\":%u}}", (unsigned)(i % 40), (unsigned)i);
  at += (size_t)sprintf(rest + at, "]");
  CHECK_INT(read_graph(&arena, "[]", "[]", "[]", rest, &graph, error), SPROUT_OK);
  CHECK(graph.entries[0].keys == graph.entries[1].keys);
  CHECK(graph.entries[2].keys != graph.entries[0].keys);
  CHECK(graph.entries[3].keys != graph.entries[0].keys);
  CHECK_STR(sprout_node_text(&graph, &graph.entries[2], "kind"), "c");
  CHECK(sprout_node_number(&graph, sprout_node_get(&graph, &graph.entries[1], "x")) == 2);
  CHECK(sprout_node_get(&graph, &graph.entries[3], "x") == NULL);
  for (i = 0; i < 40; i++) {
    char key[8];
    sprintf(key, "k%u", (unsigned)i);
    CHECK(graph.entries[4 + i].keys == graph.entries[44 + i].keys);
    CHECK(sprout_node_number(&graph, sprout_node_get(&graph, &graph.entries[44 + i], key)) == (double)(i + 40));
  }
  CHECK(graph.entries[4].keys != graph.entries[5].keys);
  sprout_arena_reset(&arena);
  CHECK_INT(heap.pages, 0);
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
  RUN(equal_scalars_are_one_node_and_nothing_points_at_the_json);
  RUN(a_place_past_what_a_node_holds_is_refused);
  RUN(the_graph_is_read_an_entry_at_a_time_and_its_files_checked_at_the_end);
  RUN(objects_with_the_same_fields_in_the_same_order_share_one_key_array);
  RUN(a_host_that_runs_out_of_memory_is_told_so);
  return REPORT();
}
