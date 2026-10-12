/*
 * The graph over a cartridge's table (graph.h): mapping it, telling an entry
 * from a cell, and the lookups every reader of nodes shares. A field is found
 * by its name among the object's shape's few fields, and a map's value by its
 * key node, which is one node per value, so a map keyed by a string finds its
 * value by comparing text.
 */
#include "graph.h"

#include <string.h>

static sprout_status refuse(char *error, size_t capacity, const char *a, const char *b) {
  size_t n, m;
  if (capacity == 0) return SPROUT_BAD_INPUT;
  m = strlen(a);
  if (m > capacity - 1) m = capacity - 1;
  memcpy(error, a, m);
  n = m;
  if (b != NULL) {
    m = strlen(b);
    if (m > capacity - 1 - n) m = capacity - 1 - n;
    memcpy(error + n, b, m);
    n += m;
  }
  error[n] = '\0';
  return SPROUT_BAD_INPUT;
}

sprout_status sprout_graph_map(sprout_graph *graph, const unsigned char *block, size_t length, sprout_arena *arena,
                               const sprout_json *files, char *error, size_t error_capacity) {
  const char *why = NULL;
  sprout_status status;
  size_t i;
  memset(graph, 0, sizeof *graph);
  status = sprout_table_map(block, length, &graph->table, &why);
  if (status != SPROUT_OK)
    return refuse(error, error_capacity, "the cartridge's table is not one this runtime reads: ", why);
  graph->count = graph->table.entry_count;
  if (files == NULL || files->kind != SPROUT_JSON_ARRAY)
    return refuse(error, error_capacity, "the cartridge's list of files is not a list.", NULL);
  if (files->count > INT16_MAX)
    return refuse(error, error_capacity, "the world has more than 32,767 files, which a cartridge cannot place.", NULL);
  graph->file_count = files->count;
  if (files->count > 0) {
    graph->files = (const char **)sprout_arena_take_aligned(arena, files->count * sizeof(char *), sizeof(char *));
    if (graph->files == NULL) return SPROUT_NO_MEMORY;
  }
  for (i = 0; i < files->count; i++) {
    if (files->items[i]->kind != SPROUT_JSON_STRING)
      return refuse(error, error_capacity, "the cartridge's list of files holds something that is not a name.", NULL);
    graph->files[i] = sprout_arena_copy(arena, files->items[i]->bytes, files->items[i]->length);
    if (graph->files[i] == NULL) return SPROUT_NO_MEMORY;
  }
  for (i = 0; i < graph->table.place_count; i++)
    if (graph->table.places[i].file >= 0 && (size_t)graph->table.places[i].file >= files->count)
      return refuse(error, error_capacity, "the cartridge names a file it does not list.", NULL);
  return SPROUT_OK;
}

size_t sprout_graph_index(const sprout_graph *graph, const sprout_node *node) {
  uintptr_t at = (uintptr_t)node, first, past;
  if (graph == NULL || node == NULL || graph->table.nodes == NULL) return SPROUT_NOT_AN_ENTRY;
  first = (uintptr_t)graph->table.nodes;
  past = (uintptr_t)(graph->table.nodes + graph->count);
  if (at < first || at >= past) return SPROUT_NOT_AN_ENTRY;
  return (size_t)(node - graph->table.nodes);
}

/* Whether a JSON cell is a reference: an array of one number. */
static bool is_reference(const sprout_json *cell) {
  return cell->kind == SPROUT_JSON_ARRAY && cell->count == 1 && cell->items[0]->kind == SPROUT_JSON_NUMBER;
}

const sprout_node *sprout_graph_cell(const sprout_graph *graph, const sprout_json *cell) {
  double at;
  if (cell == NULL || !is_reference(cell)) return NULL;
  at = cell->items[0]->number;
  if (at < 0 || at >= (double)graph->count) return NULL;
  return &graph->table.nodes[(size_t)at];
}

const sprout_node *sprout_node_get(const sprout_graph *graph, const sprout_node *object, const char *key) {
  size_t i;
  if (object == NULL || object->kind != SPROUT_NODE_OBJECT) return NULL;
  for (i = 0; i < object->count; i++)
    if (strcmp(sprout_key(graph, object, i), key) == 0) return sprout_item(graph, object, i);
  return NULL;
}

const sprout_node *sprout_node_map_get(const sprout_graph *graph, const sprout_node *map, const sprout_node *key) {
  size_t i;
  if (map == NULL || map->kind != SPROUT_NODE_MAP) return NULL;
  for (i = 0; i < map->count; i++)
    if (sprout_map_key(graph, map, i) == key) return sprout_item(graph, map, i);
  return NULL;
}

const sprout_node *sprout_node_map_find(const sprout_graph *graph, const sprout_node *map, const char *key) {
  size_t i;
  if (map == NULL || map->kind != SPROUT_NODE_MAP) return NULL;
  for (i = 0; i < map->count; i++) {
    const sprout_node *k = sprout_map_key(graph, map, i);
    if (k->kind == SPROUT_NODE_STRING && strcmp(sprout_text(graph, k), key) == 0) return sprout_item(graph, map, i);
  }
  return NULL;
}

bool sprout_node_is(const sprout_graph *graph, const sprout_node *node, const char *text) {
  return node != NULL && node->kind == SPROUT_NODE_STRING && strcmp(sprout_text(graph, node), text) == 0;
}

const char *sprout_node_text(const sprout_graph *graph, const sprout_node *object, const char *key) {
  const sprout_node *field = sprout_node_get(graph, object, key);
  return field != NULL && field->kind == SPROUT_NODE_STRING ? sprout_text(graph, field) : NULL;
}
