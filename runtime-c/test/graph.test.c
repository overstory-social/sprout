/*
 * Tests for src/graph.c: a cartridge's table maps into a graph whose entries
 * are its first nodes and whose scalar cells lie past them, read in place
 * through the accessors, a place as `file:line:column`; a cell names an entry;
 * the lookups find fields and map values; a block that is not a table, or a place naming a file not
 * listed, is refused in words.
 */
#include "check.h"
#include "corpus.h"
#include "graph.h"
#include "inflate.h"

/* The inflated body of a corpus cartridge in `arena`, and where its table begins. */
static unsigned char *body_of(sprout_arena *arena, const char *name, size_t *length, size_t *table_at) {
  size_t packed_length, body_length;
  char *packed = corpus_cartridge(name, &packed_length);
  char *body;
  const char *why;
  const unsigned char *header = (const unsigned char *)packed;
  *length = (size_t)header[8] | ((size_t)header[9] << 8) | ((size_t)header[10] << 16) | ((size_t)header[11] << 24);
  *table_at = (size_t)header[12] | ((size_t)header[13] << 8) | ((size_t)header[14] << 16) | ((size_t)header[15] << 24);
  CHECK_INT(sprout_gunzip(arena, header + 16, packed_length - 16, &body, &body_length, &why), SPROUT_OK);
  free(packed);
  return (unsigned char *)body;
}

/* The files the preamble names, as the JSON array the loader hands the graph. */
static const sprout_json *files_of(sprout_arena *arena, const unsigned char *body, size_t table_at) {
  sprout_json *root;
  sprout_json_error e;
  size_t length = table_at;
  while (length > 0 && body[length - 1] == '\0') length--;
  CHECK_INT(sprout_json_read(arena, (const char *)body, length, &root, &e), SPROUT_OK);
  return sprout_json_get(sprout_json_get(root, "table"), "files");
}

static void a_packed_world_maps_with_its_entries_first_and_its_cells_after(void) {
  test_heap heap;
  sprout_host host = corpus_host(&heap);
  sprout_arena arena;
  sprout_graph graph;
  char error[200];
  size_t length, at, i, places = 0, strings = 0;
  unsigned char *body;
  sprout_arena_init(&arena, &host);
  body = body_of(&arena, "printers_shop", &length, &at);
  CHECK_INT(sprout_graph_map(&graph, body + at, length - at, &arena, files_of(&arena, body, at), error, sizeof error), SPROUT_OK);
  CHECK(graph.count > 0 && graph.count < graph.table.node_count);
  CHECK(graph.file_count > 3);
  {
    bool named = false;
    for (i = 0; i < graph.file_count; i++) named = named || strcmp(graph.files[i], "printers_shop.sprout") == 0;
    CHECK(named);
  }
  for (i = 0; i < graph.count; i++) {
    const sprout_node *n = &graph.table.nodes[i];
    CHECK_INT(sprout_graph_index(&graph, n), i);
    CHECK(n->kind >= SPROUT_NODE_OBJECT);
    if (n->kind == SPROUT_NODE_OBJECT) {
      /* An object's `kind` is a string cell where it is a node's kind, and a kind entry where it is an object's. */
      const sprout_node *kind = sprout_node_get(&graph, n, "kind");
      if (kind != NULL && kind->kind == SPROUT_NODE_STRING) {
        CHECK(sprout_graph_index(&graph, kind) == SPROUT_NOT_AN_ENTRY);
        CHECK_INT(kind->kind, SPROUT_NODE_STRING);
        CHECK(strlen(sprout_text(&graph, kind)) == sprout_text_length(&graph, kind));
        CHECK(sprout_node_is(&graph, kind, sprout_text(&graph, kind)));
        CHECK_STR(sprout_node_text(&graph, n, "kind"), sprout_text(&graph, kind));
      }
    }
  }
  for (i = graph.count; i < graph.table.node_count; i++) {
    const sprout_node *n = &graph.table.nodes[i];
    CHECK(sprout_graph_index(&graph, n) == SPROUT_NOT_AN_ENTRY);
    if (n->kind == SPROUT_NODE_PLACE) {
      places++;
      CHECK(sprout_place_file(&graph, n) >= -1 && sprout_place_file(&graph, n) < (int)graph.file_count);
      CHECK(sprout_place_line(&graph, n) >= 0);
      if (sprout_place_file(&graph, n) >= 0) {
        /* A kept place reads as its file, its line and its column. */
        char want[200];
        snprintf(want, sizeof want, "%s:%ld:%u", graph.files[sprout_place_file(&graph, n)], sprout_place_line(&graph, n),
                 sprout_place_column(&graph, n));
        CHECK_STR(sprout_place_text(&graph, n, &arena), want);
      } else {
        CHECK_STR(sprout_place_text(&graph, n, &arena), "?");
      }
    }
    if (n->kind == SPROUT_NODE_STRING) strings++;
  }
  CHECK(places > 0 && strings > 0);
  /* What is no place reads as none kept. */
  CHECK_STR(sprout_place_text(&graph, NULL, &arena), "?");
  CHECK_STR(sprout_place_text(&graph, &graph.table.nodes[0], &arena), "?");
  CHECK(sprout_graph_index(&graph, NULL) == SPROUT_NOT_AN_ENTRY);
  CHECK(sprout_graph_index(NULL, &graph.table.nodes[0]) == SPROUT_NOT_AN_ENTRY);
  CHECK(sprout_graph_cell(&graph, NULL) == NULL);
  {
    sprout_json *cell;
    sprout_json_error e;
    CHECK_INT(sprout_json_read(&arena, "[1]", 3, &cell, &e), SPROUT_OK);
    CHECK(sprout_graph_cell(&graph, cell) == &graph.table.nodes[1]);
    CHECK_INT(sprout_json_read(&arena, "[99999999]", 10, &cell, &e), SPROUT_OK);
    CHECK(sprout_graph_cell(&graph, cell) == NULL);
    CHECK_INT(sprout_json_read(&arena, "\"x\"", 3, &cell, &e), SPROUT_OK);
    CHECK(sprout_graph_cell(&graph, cell) == NULL);
  }
  sprout_arena_reset(&arena);
  CHECK_INT(heap.pages, 0);
}

static void the_lookups_find_fields_elements_and_map_values_in_built_nodes(void) {
  sprout_build_room room = SPROUT_BUILD_LINE_ROOM;
  test_heap heap;
  sprout_host host = test_host(&heap);
  sprout_arena arena;
  sprout_builder b;
  const sprout_graph *g;
  static const char *const keys[] = {"kind", "value", "at", "big", "negative"};
  const sprout_node *values[5], *object, *list, *elements[3];
  sprout_arena_init(&arena, &host);
  sprout_build_begin(&b, &arena, room);
  values[0] = sprout_build_string(&b, "integer", 7);
  values[1] = sprout_build_number(&b, 8);
  values[2] = sprout_build_null(&b);
  values[3] = sprout_build_number(&b, 1099511627776.0);
  values[4] = sprout_build_number(&b, -7);
  object = sprout_build_object(&b, keys, values, 5);
  elements[0] = object;
  elements[1] = sprout_build_bool(&b, true);
  elements[2] = sprout_build_string(&b, "integer", 7);
  list = sprout_build_array(&b, elements, 3);
  g = sprout_build_graph(&b);
  CHECK(!sprout_build_failed(&b));
  CHECK_STR(sprout_key(g, object, 1), "value");
  CHECK(sprout_node_get(g, object, "value") == values[1]);
  CHECK(sprout_node_number(g, values[1]) == 8);
  CHECK(sprout_node_number(g, values[3]) == 1099511627776.0);
  CHECK(sprout_node_number(g, values[4]) == -7);
  CHECK_INT(sprout_node_get(g, object, "at")->kind, SPROUT_NODE_NULL);
  CHECK(sprout_node_get(g, object, "missing") == NULL);
  CHECK(sprout_node_get(g, list, "kind") == NULL);
  CHECK(sprout_item(g, list, 0) == object && sprout_truth(sprout_item(g, list, 1)));
  CHECK(sprout_item(g, list, 2) != values[0] && sprout_node_is(g, sprout_item(g, list, 2), "integer")); /* built twice: two nodes, one text */
  CHECK(sprout_node_is(g, values[0], "integer") && !sprout_node_is(g, values[0], "other") && !sprout_node_is(g, NULL, "x"));
  CHECK(sprout_node_text(g, object, "value") == NULL);
  CHECK(sprout_node_map_get(g, object, values[0]) == NULL);
  CHECK(sprout_node_map_find(g, list, "x") == NULL);
  sprout_arena_reset(&arena);
  CHECK_INT(heap.pages, 0);
}

/* Fields whose names share a first byte are told apart whole. */
static void fields_whose_names_share_a_first_byte_are_told_apart(void) {
  sprout_build_room room = SPROUT_BUILD_LINE_ROOM;
  test_heap heap;
  sprout_host host = test_host(&heap);
  sprout_arena arena;
  sprout_builder b;
  const sprout_graph *g;
  static const char *const keys[] = {"kind", "key", "k", "kinds"};
  const sprout_node *values[4], *object;
  size_t i;
  sprout_arena_init(&arena, &host);
  sprout_build_begin(&b, &arena, room);
  for (i = 0; i < 4; i++) values[i] = sprout_build_number(&b, (double)i);
  object = sprout_build_object(&b, keys, values, 4);
  g = sprout_build_graph(&b);
  CHECK(!sprout_build_failed(&b));
  for (i = 0; i < 4; i++) CHECK(sprout_node_get(g, object, keys[i]) == values[i]);
  CHECK(sprout_node_get(g, object, "ki") == NULL);
  CHECK(sprout_node_get(g, object, "kindly") == NULL);
  CHECK(sprout_node_get(g, object, "") == NULL);
  sprout_arena_reset(&arena);
  CHECK_INT(heap.pages, 0);
}

static void a_name_is_a_string_or_a_bound_entrys_text(void) {
  test_heap heap;
  sprout_host host = corpus_host(&heap);
  sprout_build_room room = SPROUT_BUILD_LINE_ROOM;
  sprout_arena arena;
  sprout_builder b;
  sprout_graph graph;
  const sprout_graph *g;
  char error[200];
  size_t length, at, i, strings = 0, entries = 0;
  unsigned char *body;
  static const char *const keys[] = {"kind", "text"};
  const sprout_node *values[2], *bound, *plain, *number;
  sprout_arena_init(&arena, &host);
  sprout_build_begin(&b, &arena, room);
  values[0] = sprout_build_string(&b, "path", 4);
  values[1] = sprout_build_string(&b, "kiln.shelf", 10);
  bound = sprout_build_object(&b, keys, values, 2);
  plain = sprout_build_string(&b, "lamp", 4);
  number = sprout_build_number(&b, 1);
  g = sprout_build_graph(&b);
  CHECK_STR(sprout_name(g, bound), "kiln.shelf");
  CHECK_STR(sprout_name(g, plain), "lamp");
  CHECK(sprout_name(g, number) == NULL && sprout_name(g, NULL) == NULL);
  CHECK(sprout_node_name(g, bound, "kind") != NULL && sprout_node_name(g, bound, "missing") == NULL);
  /* In a packed world a binding's name is its text, or an entry where the name table binds it. */
  body = body_of(&arena, "printers_shop", &length, &at);
  CHECK_INT(sprout_graph_map(&graph, body + at, length - at, &arena, files_of(&arena, body, at), error, sizeof error), SPROUT_OK);
  for (i = 0; i < graph.count; i++) {
    const sprout_node *n = &graph.table.nodes[i], *name;
    if (!sprout_node_is(&graph, sprout_node_get(&graph, n, "kind"), "binding")) continue;
    name = sprout_node_get(&graph, n, "name");
    CHECK(sprout_node_name(&graph, n, "name") != NULL);
    if (name->kind == SPROUT_NODE_STRING) strings++;
    else if (sprout_node_is(&graph, sprout_node_get(&graph, name, "kind"), "ident") &&
             sprout_node_get(&graph, name, "at") == NULL)
      entries++;
  }
  CHECK(strings > 0 && entries > 0);
  sprout_arena_reset(&arena);
  CHECK_INT(heap.pages, 0);
}

static void a_map_is_read_by_its_key_node_or_its_text(void) {
  test_heap heap;
  sprout_host host = corpus_host(&heap);
  sprout_arena arena;
  sprout_graph graph;
  char error[200];
  size_t length, at, i;
  unsigned char *body;
  const sprout_node *map = NULL;
  sprout_arena_init(&arena, &host);
  body = body_of(&arena, "printers_shop", &length, &at);
  CHECK_INT(sprout_graph_map(&graph, body + at, length - at, &arena, files_of(&arena, body, at), error, sizeof error), SPROUT_OK);
  for (i = 0; i < graph.count && map == NULL; i++) {
    const sprout_node *n = &graph.table.nodes[i];
    if (n->kind == SPROUT_NODE_MAP && n->count > 1 && sprout_map_key(&graph, n, 0)->kind == SPROUT_NODE_STRING) map = n;
  }
  CHECK(map != NULL);
  if (map != NULL) {
    const sprout_node *key = sprout_map_key(&graph, map, 1);
    CHECK(sprout_node_map_get(&graph, map, key) == sprout_item(&graph, map, 1));
    CHECK(sprout_node_map_find(&graph, map, sprout_text(&graph, key)) == sprout_item(&graph, map, 1));
    CHECK(sprout_node_map_find(&graph, map, "no such key at all") == NULL);
    CHECK(sprout_node_map_get(&graph, map, map) == NULL);
  }
  sprout_arena_reset(&arena);
  CHECK_INT(heap.pages, 0);
}

static void a_block_that_is_not_a_table_or_names_a_file_not_listed_is_refused(void) {
  test_heap heap;
  sprout_host host = corpus_host(&heap);
  sprout_arena arena;
  sprout_graph graph;
  char error[200];
  size_t length, at;
  unsigned char *body;
  sprout_json *few;
  sprout_json_error e;
  sprout_arena_init(&arena, &host);
  body = body_of(&arena, "printers_shop", &length, &at);
  CHECK_INT(sprout_graph_map(&graph, body + at + 8, length - at - 8, &arena, files_of(&arena, body, at), error, sizeof error),
            SPROUT_BAD_INPUT);
  CHECK_STR(error, "the cartridge's table is not one this runtime reads: it does not begin with `TBL4`");
  CHECK_INT(sprout_json_read(&arena, "[\"only.sprout\"]", 15, &few, &e), SPROUT_OK);
  CHECK_INT(sprout_graph_map(&graph, body + at, length - at, &arena, few, error, sizeof error), SPROUT_BAD_INPUT);
  CHECK_STR(error, "the cartridge names a file it does not list.");
  CHECK_INT(sprout_json_read(&arena, "[7]", 3, &few, &e), SPROUT_OK);
  CHECK_INT(sprout_graph_map(&graph, body + at, length - at, &arena, few, error, sizeof error), SPROUT_BAD_INPUT);
  CHECK_STR(error, "the cartridge's list of files holds something that is not a name.");
  CHECK_INT(sprout_json_read(&arena, "{}", 2, &few, &e), SPROUT_OK);
  CHECK_INT(sprout_graph_map(&graph, body + at, length - at, &arena, few, error, sizeof error), SPROUT_BAD_INPUT);
  CHECK_STR(error, "the cartridge's list of files is not a list.");
  sprout_arena_reset(&arena);
  CHECK_INT(heap.pages, 0);
}

static void a_host_that_runs_out_of_memory_is_told_so(void) {
  test_heap heap;
  sprout_host host = corpus_host(&heap);
  sprout_arena arena, scratch;
  sprout_graph graph;
  char error[200];
  size_t length, at;
  unsigned char *body;
  const sprout_json *files;
  sprout_arena_init(&scratch, &host);
  sprout_arena_init(&arena, &host);
  body = body_of(&scratch, "printers_shop", &length, &at);
  files = files_of(&scratch, body, at);
  heap.refuse_after = heap.pages;
  CHECK_INT(sprout_graph_map(&graph, body + at, length - at, &arena, files, error, sizeof error), SPROUT_NO_MEMORY);
  sprout_arena_reset(&arena);
  sprout_arena_reset(&scratch);
  CHECK_INT(heap.pages, 0);
}

int main(void) {
  RUN(a_packed_world_maps_with_its_entries_first_and_its_cells_after);
  RUN(the_lookups_find_fields_elements_and_map_values_in_built_nodes);
  RUN(fields_whose_names_share_a_first_byte_are_told_apart);
  RUN(a_name_is_a_string_or_a_bound_entrys_text);
  RUN(a_map_is_read_by_its_key_node_or_its_text);
  RUN(a_block_that_is_not_a_table_or_names_a_file_not_listed_is_refused);
  RUN(a_host_that_runs_out_of_memory_is_told_so);
  return REPORT();
}
