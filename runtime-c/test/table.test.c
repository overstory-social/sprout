/* Tests for src/table.c: a cartridge's table maps over its block, checked once, and a damaged one is refused in words. */
#include "arena.h"
#include "check.h"
#include "corpus.h"
#include "inflate.h"
#include "table.h"

static void a_packed_world_maps_with_its_runs_strings_and_shapes_in_place(void) {
  test_heap heap;
  sprout_host host = corpus_host(&heap);
  sprout_arena arena;
  sprout_table table;
  const char *why = NULL;
  size_t length, at, i, objects = 0, strings = 0;
  unsigned char *body;
  sprout_arena_init(&arena, &host);
  body = corpus_body(&arena, "printers_shop", &length, &at);
  CHECK(at % 8 == 0 && at < length);
  CHECK_INT(sprout_table_map(body + at, length - at, &table, &why), SPROUT_OK);
  CHECK(why == NULL);
  CHECK(table.entry_count > 0 && table.entry_count <= table.node_count);
  CHECK_INT(table.runs[0] + table.runs[1] + table.runs[2], table.entry_count);
  CHECK(table.runs[0] > 0 && table.runs[1] > 0 && table.runs[2] > 0);
  for (i = 0; i < table.entry_count; i++) {
    const sprout_table_node *n = &table.nodes[i];
    CHECK(n->kind >= SPROUT_TABLE_OBJECT && n->kind <= SPROUT_TABLE_SET);
    if (n->kind == SPROUT_TABLE_OBJECT) {
      objects++;
      /* Every object carries its kind as its first field, as the compiler writes them. */
      if (n->count > 0 && strcmp(sprout_table_field(&table, n->shape, 0), "kind") == 0) {
        const sprout_table_node *kind = &table.nodes[table.children[n->first]];
        CHECK_INT(kind->kind, SPROUT_TABLE_STRING);
        CHECK(strlen(sprout_table_string(&table, kind->first)) == kind->count);
      }
    }
  }
  for (i = table.entry_count; i < table.node_count; i++) {
    const sprout_table_node *n = &table.nodes[i];
    CHECK(n->kind < SPROUT_TABLE_OBJECT);
    if (n->kind == SPROUT_TABLE_STRING) strings++;
  }
  CHECK(objects > 0 && strings > 0);
  CHECK(table.shape_count > 0 && table.shape_count < objects);
  CHECK(table.string_count >= strings);
  CHECK_INT(table.string_bytes[table.string_bytes_length - 1], '\0');
  sprout_arena_reset(&arena);
  CHECK_INT(heap.pages, 0);
}

static void a_damaged_table_is_refused_in_words(void) {
  test_heap heap;
  sprout_host host = corpus_host(&heap);
  sprout_arena arena;
  sprout_table table;
  const char *why = NULL;
  size_t length, at;
  unsigned char *body, *copy;
  uint32_t *children;
  sprout_arena_init(&arena, &host);
  body = corpus_body(&arena, "printers_shop", &length, &at);
  copy = (unsigned char *)sprout_arena_take(&arena, length);
  memcpy(copy, body, length);

  CHECK_INT(sprout_table_map(copy + at, 8, &table, &why), SPROUT_BAD_INPUT);
  CHECK_STR(why, "it does not begin with `TBL4`");
  CHECK_INT(sprout_table_map(copy + at + 8, length - at - 8, &table, &why), SPROUT_BAD_INPUT);
  CHECK_STR(why, "it does not begin with `TBL4`");
  CHECK_INT(sprout_table_map(copy + at + 4, length - at - 4, &table, &why), SPROUT_BAD_INPUT);
  CHECK_STR(why, "it does not begin on an eight-byte boundary");
  CHECK_INT(sprout_table_map(copy + at, length - at - 64, &table, &why), SPROUT_BAD_INPUT);
  CHECK_STR(why, "it ends before its sections do");

  CHECK_INT(sprout_table_map(copy + at, length - at, &table, &why), SPROUT_OK);
  children = (uint32_t *)(copy + at + 48 + ((table.node_count * 12 + 7) & ~(size_t)7));
  CHECK(children == table.children);
  children[0] = (uint32_t)table.node_count;
  CHECK_INT(sprout_table_map(copy + at, length - at, &table, &why), SPROUT_BAD_INPUT);
  CHECK_STR(why, "it refers to a node it does not hold");
  memcpy(copy, body, length);

  copy[at + 4 + 1 * 4] = 1; /* one entry, with the runs saying more */
  CHECK_INT(sprout_table_map(copy + at, length - at, &table, &why), SPROUT_BAD_INPUT);
  CHECK_STR(why, "its counts do not agree");
  memcpy(copy, body, length);

  ((sprout_table_node *)(copy + at + 48))[0].kind = 9;
  CHECK_INT(sprout_table_map(copy + at, length - at, &table, &why), SPROUT_BAD_INPUT);
  CHECK_STR(why, "a node is of no kind this runtime reads");
  memcpy(copy, body, length);

  ((sprout_table_node *)(copy + at + 48))[0].kind = SPROUT_TABLE_STRING;
  CHECK_INT(sprout_table_map(copy + at, length - at, &table, &why), SPROUT_BAD_INPUT);
  CHECK_STR(why, "an entry is not an object, an array, a map or a set");
  memcpy(copy, body, length);

  ((sprout_table_node *)(copy + at + 48))[table.entry_count].kind = SPROUT_TABLE_ARRAY;
  CHECK_INT(sprout_table_map(copy + at, length - at, &table, &why), SPROUT_BAD_INPUT);
  CHECK_STR(why, "a scalar is not a scalar");
  memcpy(copy, body, length);

  sprout_arena_reset(&arena);
  CHECK_INT(heap.pages, 0);
}

int main(void) {
  RUN(a_packed_world_maps_with_its_runs_strings_and_shapes_in_place);
  RUN(a_damaged_table_is_refused_in_words);
  return REPORT();
}
