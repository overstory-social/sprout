/*
 * Nodes made at run time (graph.h's builder): the engine's own lines, read
 * into the same nodes a cartridge holds, in a graph of their own over an
 * arena. A node is made whole, so nothing writes a node after it is read.
 */
#include <string.h>

#include "graph.h"

void sprout_build_begin(sprout_builder *builder, sprout_arena *arena) {
  memset(builder, 0, sizeof *builder);
  builder->arena = arena;
  builder->graph.null_node.kind = SPROUT_NODE_NULL;
  builder->graph.true_node.kind = SPROUT_NODE_BOOL;
  builder->graph.true_node.boolean = true;
  builder->graph.false_node.kind = SPROUT_NODE_BOOL;
}

/* A fresh node of `kind` in the arena, or NULL with the builder failed. */
static sprout_node *node_of(sprout_builder *builder, sprout_node_kind kind) {
  sprout_node *node = (sprout_node *)sprout_arena_take(builder->arena, sizeof *node);
  if (node == NULL) {
    builder->failed = true;
    return NULL;
  }
  node->kind = (uint8_t)kind;
  return node;
}

const sprout_node *sprout_build_object(sprout_builder *builder, const char *const *keys,
                                       const sprout_node *const *values, size_t count) {
  sprout_node *node;
  size_t i;
  for (i = 0; i < count; i++)
    if (values[i] == NULL) {
      builder->failed = true;
      return NULL;
    }
  node = node_of(builder, SPROUT_NODE_OBJECT);
  if (node == NULL) return NULL;
  node->count = (uint32_t)count;
  if (count == 0) return node;
  node->keys = (const char **)sprout_arena_take_aligned(builder->arena, count * sizeof *node->keys, sizeof(char *));
  node->items = (const sprout_node **)sprout_arena_take_aligned(builder->arena, count * sizeof *node->items,
                                                                sizeof(sprout_node *));
  if (node->keys == NULL || node->items == NULL) {
    builder->failed = true;
    return NULL;
  }
  memcpy(node->keys, keys, count * sizeof *keys);
  memcpy(node->items, values, count * sizeof *values);
  return node;
}

const sprout_node *sprout_build_array(sprout_builder *builder, const sprout_node *const *items, size_t count) {
  sprout_node *node;
  size_t i;
  for (i = 0; i < count; i++)
    if (items[i] == NULL) {
      builder->failed = true;
      return NULL;
    }
  node = node_of(builder, SPROUT_NODE_ARRAY);
  if (node == NULL) return NULL;
  node->count = (uint32_t)count;
  if (count == 0) return node;
  node->items = (const sprout_node **)sprout_arena_take_aligned(builder->arena, count * sizeof *node->items,
                                                                sizeof(sprout_node *));
  if (node->items == NULL) {
    builder->failed = true;
    return NULL;
  }
  memcpy(node->items, items, count * sizeof *items);
  return node;
}

const sprout_node *sprout_build_string(sprout_builder *builder, const char *bytes, size_t length) {
  sprout_node *node = node_of(builder, SPROUT_NODE_STRING);
  if (node == NULL) return NULL;
  node->text = sprout_arena_copy(builder->arena, bytes, length);
  node->length = length;
  if (node->text == NULL) {
    builder->failed = true;
    return NULL;
  }
  return node;
}

const sprout_node *sprout_build_number(sprout_builder *builder, double number) {
  sprout_node *node = node_of(builder, SPROUT_NODE_NUMBER);
  if (node == NULL) return NULL;
  node->number = number;
  return node;
}

const sprout_node *sprout_build_bool(const sprout_builder *builder, bool truth) {
  return truth ? &builder->graph.true_node : &builder->graph.false_node;
}

const sprout_node *sprout_build_null(const sprout_builder *builder) { return &builder->graph.null_node; }

bool sprout_build_failed(const sprout_builder *builder) { return builder->failed; }

const sprout_graph *sprout_build_graph(const sprout_builder *builder) { return &builder->graph; }
