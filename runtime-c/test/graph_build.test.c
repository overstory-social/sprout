/* Tests for src/graph_build.c: nodes made at run time belong to a graph of their own, with no entries. */
#include "check.h"
#include "graph.h"

static void an_object_an_array_and_scalars_are_built_whole_and_read_back(void) {
  sprout_build_room room = SPROUT_BUILD_LINE_ROOM;
  test_heap heap;
  sprout_host host = test_host(&heap);
  sprout_arena arena;
  sprout_builder b;
  static const char *const keys[] = {"kind", "value", "flag", "nothing"};
  const sprout_node *values[4], *object, *array, *elements[2];
  const sprout_graph *g;
  sprout_arena_init(&arena, &host);
  sprout_build_begin(&b, &arena, room);
  values[0] = sprout_build_string(&b, "integer", 7);
  values[1] = sprout_build_number(&b, 8);
  values[2] = sprout_build_bool(&b, true);
  values[3] = sprout_build_null(&b);
  object = sprout_build_object(&b, keys, values, 4);
  elements[0] = object;
  elements[1] = sprout_build_bool(&b, false);
  array = sprout_build_array(&b, elements, 2);
  g = sprout_build_graph(&b);
  CHECK(!sprout_build_failed(&b) && object != NULL && array != NULL);
  CHECK_INT(object->kind, SPROUT_NODE_OBJECT);
  CHECK_INT((int)object->count, 4);
  CHECK_STR(sprout_key(g, object, 1), "value");
  CHECK(sprout_node_get(g, object, "value") == values[1]);
  CHECK(sprout_node_number(g, sprout_node_get(g, object, "value")) == 8);
  CHECK_STR(sprout_node_text(g, object, "kind"), "integer");
  CHECK_INT(sprout_text_length(g, values[0]), 7);
  CHECK(sprout_node_is(g, values[0], "integer"));
  CHECK(sprout_truth(sprout_node_get(g, object, "flag")));
  CHECK_INT(sprout_node_get(g, object, "nothing")->kind, SPROUT_NODE_NULL);
  CHECK(sprout_node_get(g, object, "absent") == NULL);
  CHECK_INT(array->kind, SPROUT_NODE_ARRAY);
  CHECK(sprout_item(g, array, 0) == object && !sprout_truth(sprout_item(g, array, 1)));
  /* Built nodes are no entries: the name table binds none of them. */
  CHECK(sprout_graph_index(g, object) == SPROUT_NOT_AN_ENTRY);
  CHECK(sprout_graph_index(g, values[1]) == SPROUT_NOT_AN_ENTRY);
  CHECK_INT((int)g->count, 0);
  CHECK(sprout_build_object(&b, keys, values, 0) != NULL);
  CHECK(sprout_build_array(&b, elements, 0) != NULL);
  sprout_arena_reset(&arena);
  CHECK_INT(heap.pages, 0);
}

static void a_missing_child_or_a_host_without_memory_fails_the_builder(void) {
  sprout_build_room room = SPROUT_BUILD_LINE_ROOM;
  test_heap heap;
  sprout_host host = test_host(&heap);
  sprout_arena arena;
  sprout_builder b;
  static const char *const keys[] = {"kind"};
  const sprout_node *values[1], *missing[1] = {NULL};
  sprout_arena_init(&arena, &host);
  sprout_build_begin(&b, &arena, room);
  CHECK(sprout_build_object(&b, keys, missing, 1) == NULL);
  CHECK(sprout_build_failed(&b));
  sprout_build_begin(&b, &arena, room);
  CHECK(sprout_build_array(&b, missing, 1) == NULL);
  CHECK(sprout_build_failed(&b));
  {
    /* The room is taken up front, so a build past it fails as one the host refuses does. */
    sprout_build_room small = {4, 2, 8, 2, 1, 2};
    const sprout_node *one, *pair[2];
    sprout_build_begin(&b, &arena, small);
    CHECK(!sprout_build_failed(&b));
    one = sprout_build_string(&b, "x", 1);
    CHECK(one != NULL && !sprout_build_failed(&b));
    CHECK(sprout_build_string(&b, "a longer text", 13) == NULL); /* past the string bytes */
    CHECK(sprout_build_failed(&b));
    sprout_build_begin(&b, &arena, small);
    one = sprout_build_string(&b, "x", 1);
    pair[0] = one, pair[1] = one;
    CHECK(sprout_build_array(&b, pair, 2) == NULL); /* past the nodes: null, true, false and one string fill four */
    CHECK(sprout_build_failed(&b));
  }
  sprout_arena_reset(&arena);
  heap.refuse_after = 0;
  sprout_build_begin(&b, &arena, room);
  CHECK(sprout_build_failed(&b));
  values[0] = sprout_build_string(&b, "x", 1);
  CHECK(values[0] == NULL && sprout_build_failed(&b));
  CHECK(sprout_build_number(&b, 1) == NULL);
  CHECK(sprout_build_object(&b, keys, values, 1) == NULL);
  sprout_arena_reset(&arena);
  CHECK_INT(heap.pages, 0);
}

int main(void) {
  RUN(an_object_an_array_and_scalars_are_built_whole_and_read_back);
  RUN(a_missing_child_or_a_host_without_memory_fails_the_builder);
  return REPORT();
}
