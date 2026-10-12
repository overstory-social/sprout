/*
 * Nodes made at run time (graph.h's builder): the engine's own lines, read
 * into nodes laid out as a cartridge's table is, in a graph of their own over
 * an arena. The room is taken up front, so a node once made never moves; the
 * first three nodes are null, true and false, and no node is an entry.
 */
#include <string.h>

#include "graph.h"

static void *room_for(sprout_builder *b, size_t count, size_t size, size_t align) {
  void *room = sprout_arena_take_aligned(b->arena, (count == 0 ? 1 : count) * size, align);
  if (room == NULL) b->failed = true;
  return room;
}

void sprout_build_begin(sprout_builder *b, sprout_arena *arena, sprout_build_room room) {
  sprout_table *t;
  memset(b, 0, sizeof *b);
  b->arena = arena;
  b->room = room;
  if (room.nodes < 3) b->room.nodes = 3;
  b->nodes = (sprout_table_node *)room_for(b, b->room.nodes, sizeof *b->nodes, 4);
  b->children = (uint32_t *)room_for(b, room.children, sizeof *b->children, 4);
  b->string_offsets = (uint32_t *)room_for(b, room.strings + 1, sizeof *b->string_offsets, 4);
  b->string_bytes = (char *)room_for(b, room.string_bytes, 1, 1);
  b->shape_offsets = (uint32_t *)room_for(b, room.shapes + 1, sizeof *b->shape_offsets, 4);
  b->shape_fields = (uint32_t *)room_for(b, room.shape_fields, sizeof *b->shape_fields, 4);
  b->doubles = (double *)room_for(b, b->room.nodes, sizeof *b->doubles, 8);
  if (b->failed) return;
  t = &b->graph.table;
  t->nodes = b->nodes;
  t->children = b->children;
  t->string_offsets = b->string_offsets;
  t->string_bytes = b->string_bytes;
  t->shape_offsets = b->shape_offsets;
  t->shape_fields = b->shape_fields;
  t->doubles = b->doubles;
  b->nodes[0].kind = SPROUT_NODE_NULL;
  b->nodes[1].kind = SPROUT_NODE_BOOL;
  b->nodes[1].flags = SPROUT_TABLE_TRUE;
  b->nodes[2].kind = SPROUT_NODE_BOOL;
  t->node_count = 3;
  b->string_offsets[0] = 0;
  b->shape_offsets[0] = 0;
}

/* A fresh node of `kind`, or NULL with the builder failed when the room is used up. */
static sprout_table_node *node_of(sprout_builder *b, sprout_node_kind kind) {
  sprout_table *t = &b->graph.table;
  sprout_table_node *node;
  if (b->failed || t->node_count >= b->room.nodes) {
    b->failed = true;
    return NULL;
  }
  node = &b->nodes[t->node_count++];
  memset(node, 0, sizeof *node);
  node->kind = (uint8_t)kind;
  return node;
}

/* The index of the string `bytes`, interned: the one already held, or a new copy. */
static bool string_index(sprout_builder *b, const char *bytes, size_t length, uint32_t *index) {
  sprout_table *t = &b->graph.table;
  size_t i, at;
  for (i = 0; i < t->string_count; i++) {
    uint32_t start = b->string_offsets[i];
    if (b->string_offsets[i + 1] - start == length + 1 && memcmp(b->string_bytes + start, bytes, length) == 0) {
      *index = (uint32_t)i;
      return true;
    }
  }
  at = t->string_bytes_length;
  if (t->string_count >= b->room.strings || length + 1 > b->room.string_bytes - at) {
    b->failed = true;
    return false;
  }
  memcpy(b->string_bytes + at, bytes, length);
  b->string_bytes[at + length] = '\0';
  t->string_bytes_length = at + length + 1;
  b->string_offsets[t->string_count + 1] = (uint32_t)t->string_bytes_length;
  *index = (uint32_t)t->string_count++;
  return true;
}

/* The index of the shape with these keys, interned. */
static bool shape_index(sprout_builder *b, const char *const *keys, size_t count, uint16_t *index) {
  sprout_table *t = &b->graph.table;
  uint32_t ids[64];
  size_t i, s;
  if (count > sizeof ids / sizeof ids[0]) {
    b->failed = true;
    return false;
  }
  for (i = 0; i < count; i++)
    if (!string_index(b, keys[i], strlen(keys[i]), &ids[i])) return false;
  for (s = 0; s < t->shape_count; s++) {
    uint32_t start = b->shape_offsets[s];
    if (b->shape_offsets[s + 1] - start == count &&
        (count == 0 || memcmp(b->shape_fields + start, ids, count * sizeof ids[0]) == 0)) {
      *index = (uint16_t)s;
      return true;
    }
  }
  if (t->shape_count >= b->room.shapes || count > b->room.shape_fields - t->shape_field_count) {
    b->failed = true;
    return false;
  }
  if (count > 0) memcpy(b->shape_fields + t->shape_field_count, ids, count * sizeof ids[0]);
  t->shape_field_count += count;
  b->shape_offsets[t->shape_count + 1] = (uint32_t)t->shape_field_count;
  *index = (uint16_t)t->shape_count++;
  return true;
}

/* Room for `count` children, filled from `values`; the index of the first, or false with the builder failed. */
static bool children_of(sprout_builder *b, const sprout_node *const *values, size_t count, uint32_t *first) {
  sprout_table *t = &b->graph.table;
  size_t i;
  for (i = 0; i < count; i++)
    if (values[i] == NULL) {
      b->failed = true;
      return false;
    }
  if (count > b->room.children - t->child_count) {
    b->failed = true;
    return false;
  }
  *first = (uint32_t)t->child_count;
  for (i = 0; i < count; i++) b->children[t->child_count + i] = (uint32_t)(values[i] - b->nodes);
  t->child_count += count;
  return true;
}

const sprout_node *sprout_build_object(sprout_builder *b, const char *const *keys,
                                       const sprout_node *const *values, size_t count) {
  sprout_table_node *node;
  uint16_t shape;
  uint32_t first;
  if (b->failed || !shape_index(b, keys, count, &shape) || !children_of(b, values, count, &first)) return NULL;
  node = node_of(b, SPROUT_NODE_OBJECT);
  if (node == NULL) return NULL;
  node->shape = shape;
  node->count = (uint32_t)count;
  node->first = first;
  return node;
}

const sprout_node *sprout_build_array(sprout_builder *b, const sprout_node *const *items, size_t count) {
  sprout_table_node *node;
  uint32_t first;
  if (b->failed || !children_of(b, items, count, &first)) return NULL;
  node = node_of(b, SPROUT_NODE_ARRAY);
  if (node == NULL) return NULL;
  node->count = (uint32_t)count;
  node->first = first;
  return node;
}

const sprout_node *sprout_build_string(sprout_builder *b, const char *bytes, size_t length) {
  sprout_table_node *node;
  uint32_t index;
  if (b->failed || !string_index(b, bytes, length, &index)) return NULL;
  node = node_of(b, SPROUT_NODE_STRING);
  if (node == NULL) return NULL;
  node->count = (uint32_t)length;
  node->first = index;
  return node;
}

const sprout_node *sprout_build_number(sprout_builder *b, double number) {
  sprout_table_node *node = node_of(b, SPROUT_NODE_NUMBER);
  if (node == NULL) return NULL;
  if (number >= -2147483648.0 && number <= 2147483647.0 && (double)(long)number == number) {
    node->flags = SPROUT_TABLE_INLINE;
    node->first = number < 0 ? (uint32_t)(4294967296.0 + number) : (uint32_t)number;
    return node;
  }
  /* The doubles have a slot per node, so one is always free for the node just made. */
  b->doubles[b->graph.table.double_count] = number;
  node->first = (uint32_t)b->graph.table.double_count++;
  return node;
}

const sprout_node *sprout_build_bool(const sprout_builder *b, bool truth) { return &b->nodes[truth ? 1 : 2]; }

const sprout_node *sprout_build_null(const sprout_builder *b) { return &b->nodes[0]; }

bool sprout_build_failed(const sprout_builder *b) { return b->failed; }

const sprout_graph *sprout_build_graph(const sprout_builder *b) { return &b->graph; }
