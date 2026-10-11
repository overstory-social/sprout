/*
 * Reads a cartridge's table of entries into nodes (the spec's The compiler >
 * What compiling produces). Every entry is allocated before any is filled,
 * so a reference may point forward or back, and a shared entry is one node.
 * Scalar cells and field names are interned: a table in the load's scratch
 * finds the node already made for an equal value, so a word the table writes
 * a thousand times is one node and one copy of its text. The reader fills one
 * entry at a time, so a loader may read the entries from a stream.
 */
#include "graph.h"

#include <string.h>

typedef sprout_graph_reader reader;
typedef sprout_intern intern;

static sprout_status refuse(reader *r, const char *words) {
  size_t n = strlen(words);
  if (r->capacity > 0) {
    if (n >= r->capacity) n = r->capacity - 1;
    memcpy(r->error, words, n);
    r->error[n] = '\0';
  }
  return SPROUT_BAD_INPUT;
}

/* ---- interning ---- */

static uint32_t mix(uint32_t hash, uint32_t word) {
  hash ^= word;
  hash *= 16777619u;
  return hash;
}

/* FNV-1a over what makes a scalar node the value it is. */
static uint32_t hash_of(const sprout_node *node) {
  uint32_t hash = 2166136261u;
  size_t i;
  hash = mix(hash, node->kind);
  switch (node->kind) {
    case SPROUT_NODE_STRING:
      for (i = 0; i < node->length; i++) hash = mix(hash, (unsigned char)node->text[i]);
      break;
    case SPROUT_NODE_NUMBER: {
      unsigned char bytes[sizeof(double)];
      memcpy(bytes, &node->number, sizeof bytes);
      for (i = 0; i < sizeof bytes; i++) hash = mix(hash, bytes[i]);
      break;
    }
    case SPROUT_NODE_PLACE:
      hash = mix(hash, (uint32_t)node->line);
      hash = mix(hash, (uint32_t)(uint16_t)node->file);
      hash = mix(hash, node->column);
      break;
    default:
      break;
  }
  return hash;
}

static bool same(const sprout_node *a, const sprout_node *b) {
  if (a->kind != b->kind) return false;
  switch (a->kind) {
    case SPROUT_NODE_STRING:
      return a->length == b->length && memcmp(a->text, b->text, a->length) == 0;
    case SPROUT_NODE_NUMBER:
      return memcmp(&a->number, &b->number, sizeof a->number) == 0;
    case SPROUT_NODE_PLACE:
      return a->line == b->line && a->file == b->file && a->column == b->column;
    default:
      return false;
  }
}

/* A slot for `node`'s value in `slots`: the one holding an equal node, or the empty one it goes in. */
static size_t slot_of(const sprout_node **slots, size_t capacity, const sprout_node *node) {
  size_t i = hash_of(node) & (capacity - 1);
  while (slots[i] != NULL && !same(slots[i], node)) i = (i + 1) & (capacity - 1);
  return i;
}

static sprout_status grow(reader *r) {
  intern *t = &r->table;
  size_t capacity = t->capacity == 0 ? 1024 : t->capacity * 2, i;
  const sprout_node **slots = (const sprout_node **)sprout_arena_take(r->scratch, capacity * sizeof *slots);
  if (slots == NULL) return SPROUT_NO_MEMORY;
  memset(slots, 0, capacity * sizeof *slots);
  for (i = 0; i < t->capacity; i++)
    if (t->slots[i] != NULL) slots[slot_of(slots, capacity, t->slots[i])] = t->slots[i];
  t->slots = slots;
  t->capacity = capacity;
  return SPROUT_OK;
}

/* The node for `probe`'s value: the one made before, or a new one holding its own copy. */
static const sprout_node *interned(reader *r, const sprout_node *probe, sprout_status *status) {
  intern *t = &r->table;
  sprout_node *made;
  size_t i;
  *status = SPROUT_OK;
  if ((t->used + 1) * 2 > t->capacity) {
    *status = grow(r);
    if (*status != SPROUT_OK) return NULL;
  }
  i = slot_of(t->slots, t->capacity, probe);
  if (t->slots[i] != NULL) return t->slots[i];
  made = (sprout_node *)sprout_arena_take(r->arena, sizeof *made);
  if (made == NULL) {
    *status = SPROUT_NO_MEMORY;
    return NULL;
  }
  *made = *probe;
  if (probe->kind == SPROUT_NODE_STRING) {
    made->text = sprout_arena_copy(r->arena, probe->text, probe->length);
    if (made->text == NULL) {
      *status = SPROUT_NO_MEMORY;
      return NULL;
    }
  }
  t->slots[i] = made;
  t->used++;
  return made;
}

static const sprout_node *interned_string(reader *r, const char *bytes, size_t length, sprout_status *status) {
  sprout_node probe;
  memset(&probe, 0, sizeof probe);
  probe.kind = SPROUT_NODE_STRING;
  probe.text = bytes;
  probe.length = length;
  return interned(r, &probe, status);
}

/* ---- cells ---- */

static bool is_array_of_one_count(const sprout_json *cell) {
  return cell->kind == SPROUT_JSON_ARRAY && cell->count == 1 &&
         cell->items[0]->kind == SPROUT_JSON_NUMBER;
}

/* The node a cell stands for; NULL with *status set when it cannot be read. */
static const sprout_node *resolve(reader *r, const sprout_json *cell, sprout_status *status) {
  sprout_node probe;
  *status = SPROUT_OK;
  memset(&probe, 0, sizeof probe);
  switch (cell->kind) {
    case SPROUT_JSON_NULL:
      return &r->graph->null_node;
    case SPROUT_JSON_BOOL:
      return cell->boolean ? &r->graph->true_node : &r->graph->false_node;
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
      double file, line, column;
      if (p == NULL || cell->count != 1 || p->kind != SPROUT_JSON_ARRAY || p->count != 3 ||
          p->items[0]->kind != SPROUT_JSON_NUMBER || p->items[1]->kind != SPROUT_JSON_NUMBER ||
          p->items[2]->kind != SPROUT_JSON_NUMBER) {
        *status = refuse(r, "an entry holds an object where a place or a reference should be.");
        return NULL;
      }
      file = p->items[0]->number;
      line = p->items[1]->number;
      column = p->items[2]->number;
      if (file < -1 || file > INT16_MAX || line < 0 || line > INT32_MAX || column < 0 || column > UINT16_MAX) {
        *status = refuse(r, "a line of the source is longer than 65,535 characters, which a cartridge cannot place.");
        return NULL;
      }
      if ((long)file > r->max_file) r->max_file = (long)file;
      probe.kind = SPROUT_NODE_PLACE;
      probe.file = (int16_t)file;
      probe.line = (int32_t)line;
      probe.column = (uint16_t)column;
      return interned(r, &probe, status);
    }
    case SPROUT_JSON_NUMBER:
      probe.kind = SPROUT_NODE_NUMBER;
      probe.number = cell->number;
      return interned(r, &probe, status);
    default:
      return interned_string(r, cell->bytes, cell->length, status);
  }
}

static sprout_status take_items(reader *r, sprout_node *node, size_t count) {
  node->count = (uint32_t)count;
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
      const sprout_node *key = interned_string(r, body->items[i]->key, body->items[i]->key_length, &status);
      if (status != SPROUT_OK) return status;
      node->keys[i] = key->text;
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

static void scalar(sprout_node *node, sprout_node_kind kind) {
  memset(node, 0, sizeof *node);
  node->kind = (uint8_t)kind;
}

sprout_status sprout_graph_begin(sprout_graph_reader *r, sprout_graph *graph, sprout_arena *arena,
                                 sprout_arena *scratch, size_t prose, size_t bodies, size_t rest,
                                 char *error, size_t error_capacity) {
  size_t total = prose + bodies + rest;
  memset(r, 0, sizeof *r);
  r->arena = arena;
  r->scratch = scratch;
  r->graph = graph;
  r->error = error;
  r->capacity = error_capacity;
  r->max_file = -1;
  memset(graph, 0, sizeof *graph);
  scalar(&graph->null_node, SPROUT_NODE_NULL);
  scalar(&graph->true_node, SPROUT_NODE_BOOL);
  graph->true_node.boolean = true;
  scalar(&graph->false_node, SPROUT_NODE_BOOL);
  if (total < prose || total < bodies || total >= SPROUT_NOT_AN_ENTRY)
    return refuse(r, "the cartridge counts more entries than a graph holds.");
  graph->count = total;
  graph->entries = (sprout_node *)sprout_arena_take(arena, (total == 0 ? 1 : total) * sizeof(sprout_node));
  if (graph->entries == NULL) return SPROUT_NO_MEMORY;
  memset(graph->entries, 0, (total == 0 ? 1 : total) * sizeof(sprout_node));
  return SPROUT_OK;
}

sprout_status sprout_graph_fill(sprout_graph_reader *r, const sprout_json *entry) {
  if (r->filled >= r->graph->count) return refuse(r, "the cartridge holds more entries than its header counts.");
  return fill(r, &r->graph->entries[r->filled++], entry);
}

sprout_status sprout_graph_end(sprout_graph_reader *r, const sprout_json *files) {
  sprout_graph *graph = r->graph;
  sprout_status status;
  size_t i;
  if (r->filled < graph->count) return refuse(r, "the cartridge holds fewer entries than its header counts.");
  if (files == NULL || files->kind != SPROUT_JSON_ARRAY) return refuse(r, "the cartridge's list of files is not a list.");
  if (files->count > INT16_MAX) return refuse(r, "the world has more than 32,767 files, which a cartridge cannot place.");
  if (r->max_file >= (long)files->count) return refuse(r, "the cartridge names a file it does not list.");
  graph->file_count = files->count;
  if (files->count > 0) {
    graph->files = (const char **)sprout_arena_take(r->arena, files->count * sizeof(char *));
    if (graph->files == NULL) return SPROUT_NO_MEMORY;
  }
  for (i = 0; i < files->count; i++) {
    const sprout_node *name;
    if (files->items[i]->kind != SPROUT_JSON_STRING)
      return refuse(r, "the cartridge's list of files holds something that is not a name.");
    name = interned_string(r, files->items[i]->bytes, files->items[i]->length, &status);
    if (status != SPROUT_OK) return status;
    graph->files[i] = name->text;
  }
  return SPROUT_OK;
}

sprout_status sprout_graph_read(sprout_arena *arena, sprout_arena *scratch, const sprout_json *files,
                                const sprout_json *prose, const sprout_json *bodies,
                                const sprout_json *rest, sprout_graph *graph, char *error,
                                size_t error_capacity) {
  sprout_graph_reader r;
  const sprout_json *runs[3];
  size_t i, run;
  sprout_status status;
  runs[0] = prose;
  runs[1] = bodies;
  runs[2] = rest;
  memset(&r, 0, sizeof r);
  r.error = error;
  r.capacity = error_capacity;
  if (files->kind != SPROUT_JSON_ARRAY) return refuse(&r, "the cartridge's list of files is not a list.");
  for (run = 0; run < 3; run++)
    if (runs[run]->kind != SPROUT_JSON_ARRAY) return refuse(&r, "the cartridge's table of entries is not a list.");
  status = sprout_graph_begin(&r, graph, arena, scratch, prose->count, bodies->count, rest->count, error,
                              error_capacity);
  if (status != SPROUT_OK) return status;
  for (run = 0; run < 3; run++) {
    for (i = 0; i < runs[run]->count; i++) {
      status = sprout_graph_fill(&r, runs[run]->items[i]);
      if (status != SPROUT_OK) return status;
    }
  }
  return sprout_graph_end(&r, files);
}

size_t sprout_graph_index(const sprout_graph *graph, const sprout_node *node) {
  uintptr_t at = (uintptr_t)node, first, past;
  if (graph == NULL || node == NULL || graph->entries == NULL) return SPROUT_NOT_AN_ENTRY;
  first = (uintptr_t)graph->entries;
  past = (uintptr_t)(graph->entries + graph->count);
  if (at < first || at >= past) return SPROUT_NOT_AN_ENTRY;
  return (size_t)(node - graph->entries);
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
