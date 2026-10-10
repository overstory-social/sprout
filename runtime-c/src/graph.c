/*
 * Reads a cartridge's table of entries into nodes (the spec's The compiler >
 * What compiling produces). Every entry is allocated before any is filled,
 * so a reference may point forward or back, and a shared entry is one node.
 */
#include "graph.h"

#include <string.h>

typedef struct reader {
  sprout_arena *arena;
  sprout_graph *graph;
  char *error;
  size_t capacity;
} reader;

static sprout_status refuse(reader *r, const char *words) {
  size_t n = strlen(words);
  if (r->capacity > 0) {
    if (n >= r->capacity) n = r->capacity - 1;
    memcpy(r->error, words, n);
    r->error[n] = '\0';
  }
  return SPROUT_BAD_INPUT;
}

static bool is_array_of_one_count(const sprout_json *cell) {
  return cell->kind == SPROUT_JSON_ARRAY && cell->count == 1 &&
         cell->items[0]->kind == SPROUT_JSON_NUMBER;
}

/* The node a cell stands for; NULL with *status set when it cannot be read. */
static const sprout_node *resolve(reader *r, const sprout_json *cell, sprout_status *status) {
  sprout_node *node;
  *status = SPROUT_OK;
  switch (cell->kind) {
    case SPROUT_JSON_NULL:
      return &r->graph->null_node;
    case SPROUT_JSON_ARRAY: {
      double at;
      if (!is_array_of_one_count(cell)) {
        *status = refuse(r, "an entry holds an array where a reference to an entry should be.");
        return NULL;
      }
      at = cell->items[0]->number;
      if (at < 0 || at >= (double)r->graph->count) {
        *status = refuse(r, "the cartridge refers to an entry it does not hold.");
        return NULL;
      }
      return &r->graph->entries[(size_t)at];
    }
    case SPROUT_JSON_OBJECT: {
      const sprout_json *p = sprout_json_get(cell, "p");
      if (p == NULL || cell->count != 1 || p->kind != SPROUT_JSON_ARRAY || p->count != 3 ||
          p->items[0]->kind != SPROUT_JSON_NUMBER || p->items[1]->kind != SPROUT_JSON_NUMBER ||
          p->items[2]->kind != SPROUT_JSON_NUMBER) {
        *status = refuse(r, "an entry holds an object where a place or a reference should be.");
        return NULL;
      }
      node = (sprout_node *)sprout_arena_take(r->arena, sizeof *node);
      if (node == NULL) {
        *status = SPROUT_NO_MEMORY;
        return NULL;
      }
      node->kind = SPROUT_NODE_PLACE;
      node->file = (long)p->items[0]->number;
      node->line = (long)p->items[1]->number;
      node->column = (long)p->items[2]->number;
      node->index = SPROUT_NOT_AN_ENTRY;
      if (node->file >= (long)r->graph->file_count) {
        *status = refuse(r, "the cartridge names a file it does not list.");
        return NULL;
      }
      return node;
    }
    default:
      break;
  }
  node = (sprout_node *)sprout_arena_take(r->arena, sizeof *node);
  if (node == NULL) {
    *status = SPROUT_NO_MEMORY;
    return NULL;
  }
  node->index = SPROUT_NOT_AN_ENTRY;
  if (cell->kind == SPROUT_JSON_BOOL) {
    node->kind = SPROUT_NODE_BOOL;
    node->boolean = cell->boolean;
  } else if (cell->kind == SPROUT_JSON_NUMBER) {
    node->kind = SPROUT_NODE_NUMBER;
    node->number = cell->number;
  } else {
    node->kind = SPROUT_NODE_STRING;
    node->text = cell->bytes;
    node->length = cell->length;
  }
  return node;
}

static sprout_status take_items(reader *r, sprout_node *node, size_t count) {
  node->count = count;
  if (count == 0) return SPROUT_OK;
  node->items = (const sprout_node **)sprout_arena_take(r->arena, count * sizeof(sprout_node *));
  return node->items == NULL ? SPROUT_NO_MEMORY : SPROUT_OK;
}

static sprout_status fill(reader *r, sprout_node *node, const sprout_json *entry) {
  const sprout_json *body;
  size_t i;
  sprout_status status = SPROUT_OK;
  if (entry->kind != SPROUT_JSON_OBJECT || entry->count != 1)
    return refuse(r, "an entry of the table is not an object, an array, a map or a set.");
  body = entry->items[0];
  if (strcmp(entry->items[0]->key, "o") == 0 && body->kind == SPROUT_JSON_OBJECT) {
    node->kind = SPROUT_NODE_OBJECT;
    status = take_items(r, node, body->count);
    if (status != SPROUT_OK) return status;
    if (body->count > 0) {
      node->keys = (const char **)sprout_arena_take(r->arena, body->count * sizeof(char *));
      if (node->keys == NULL) return SPROUT_NO_MEMORY;
    }
    for (i = 0; i < body->count; i++) {
      node->keys[i] = body->items[i]->key;
      node->items[i] = resolve(r, body->items[i], &status);
      if (status != SPROUT_OK) return status;
    }
  } else if ((body->kind == SPROUT_JSON_ARRAY) &&
             (strcmp(entry->items[0]->key, "a") == 0 || strcmp(entry->items[0]->key, "s") == 0)) {
    node->kind = strcmp(entry->items[0]->key, "a") == 0 ? SPROUT_NODE_ARRAY : SPROUT_NODE_SET;
    status = take_items(r, node, body->count);
    if (status != SPROUT_OK) return status;
    for (i = 0; i < body->count; i++) {
      node->items[i] = resolve(r, body->items[i], &status);
      if (status != SPROUT_OK) return status;
    }
  } else if (strcmp(entry->items[0]->key, "m") == 0 && body->kind == SPROUT_JSON_ARRAY) {
    node->kind = SPROUT_NODE_MAP;
    status = take_items(r, node, body->count);
    if (status != SPROUT_OK) return status;
    if (body->count > 0) {
      node->map_keys =
          (const sprout_node **)sprout_arena_take(r->arena, body->count * sizeof(sprout_node *));
      if (node->map_keys == NULL) return SPROUT_NO_MEMORY;
    }
    for (i = 0; i < body->count; i++) {
      const sprout_json *pair = body->items[i];
      if (pair->kind != SPROUT_JSON_ARRAY || pair->count != 2)
        return refuse(r, "a map in the cartridge holds something that is not a pair.");
      node->map_keys[i] = resolve(r, pair->items[0], &status);
      if (status != SPROUT_OK) return status;
      node->items[i] = resolve(r, pair->items[1], &status);
      if (status != SPROUT_OK) return status;
    }
  } else {
    return refuse(r, "an entry of the table is not an object, an array, a map or a set.");
  }
  return SPROUT_OK;
}

sprout_status sprout_graph_read(sprout_arena *arena, const sprout_json *files,
                                const sprout_json *prose, const sprout_json *bodies,
                                const sprout_json *rest, sprout_graph *graph, char *error,
                                size_t error_capacity) {
  reader r;
  const sprout_json *runs[3];
  size_t total = 0, at = 0, i, run;
  sprout_status status;
  memset(&r, 0, sizeof r);
  r.arena = arena;
  r.graph = graph;
  r.error = error;
  r.capacity = error_capacity;


  memset(graph, 0, sizeof *graph);
  graph->null_node.kind = SPROUT_NODE_NULL;
  graph->null_node.index = SPROUT_NOT_AN_ENTRY;
  runs[0] = prose;
  runs[1] = bodies;
  runs[2] = rest;
  if (files->kind != SPROUT_JSON_ARRAY) return refuse(&r, "the cartridge's list of files is not a list.");
  for (run = 0; run < 3; run++) {
    if (runs[run]->kind != SPROUT_JSON_ARRAY) return refuse(&r, "the cartridge's table of entries is not a list.");
    total += runs[run]->count;
  }
  graph->file_count = files->count;
  if (files->count > 0) {
    graph->files = (const char **)sprout_arena_take(arena, files->count * sizeof(char *));
    if (graph->files == NULL) return SPROUT_NO_MEMORY;
  }
  for (i = 0; i < files->count; i++) {
    if (files->items[i]->kind != SPROUT_JSON_STRING)
      return refuse(&r, "the cartridge's list of files holds something that is not a name.");
    graph->files[i] = files->items[i]->bytes;
  }
  graph->count = total;
  graph->entries = (sprout_node *)sprout_arena_take(arena, (total == 0 ? 1 : total) * sizeof(sprout_node));
  if (graph->entries == NULL) return SPROUT_NO_MEMORY;
  for (i = 0; i < total; i++) graph->entries[i].index = i;
  for (run = 0; run < 3; run++) {
    for (i = 0; i < runs[run]->count; i++, at++) {
      status = fill(&r, &graph->entries[at], runs[run]->items[i]);
      if (status != SPROUT_OK) return status;
    }
  }
  return SPROUT_OK;
}

const sprout_node *sprout_graph_cell(const sprout_graph *graph, const sprout_json *cell) {
  double at;
  if (cell == NULL || !is_array_of_one_count(cell)) return NULL;
  at = cell->items[0]->number;
  if (at < 0 || at >= (double)graph->count) return NULL;
  return &graph->entries[(size_t)at];
}

const sprout_node *sprout_node_get(const sprout_node *object, const char *key) {
  size_t i;
  if (object == NULL || object->kind != SPROUT_NODE_OBJECT) return NULL;
  for (i = 0; i < object->count; i++)
    if (strcmp(object->keys[i], key) == 0) return object->items[i];
  return NULL;
}

const sprout_node *sprout_node_map_get(const sprout_node *map, const sprout_node *key) {
  size_t i;
  if (map == NULL || map->kind != SPROUT_NODE_MAP) return NULL;
  for (i = 0; i < map->count; i++)
    if (map->map_keys[i] == key) return map->items[i];
  return NULL;
}

const sprout_node *sprout_node_map_find(const sprout_node *map, const char *key) {
  size_t i;
  if (map == NULL || map->kind != SPROUT_NODE_MAP) return NULL;
  for (i = 0; i < map->count; i++)
    if (map->map_keys[i]->kind == SPROUT_NODE_STRING && strcmp(map->map_keys[i]->text, key) == 0)
      return map->items[i];
  return NULL;
}

bool sprout_node_is(const sprout_node *node, const char *text) {
  return node != NULL && node->kind == SPROUT_NODE_STRING && strcmp(node->text, text) == 0;
}

const char *sprout_node_text(const sprout_node *object, const char *key) {
  const sprout_node *field = sprout_node_get(object, key);
  return field != NULL && field->kind == SPROUT_NODE_STRING ? field->text : NULL;
}
