/*
 * The graph a cartridge holds (the spec's The compiler > What compiling
 * produces): a flat table of objects, arrays, maps and sets that refer to one
 * another by index, so a thing two parts of the world share is one node. The
 * table is three runs under one numbering (prose nodes, statements and
 * expressions, everything else). Reading it gives each entry a node whose
 * `index` is its place in the table, which is how a body's names are bound:
 * the name table maps the node written to the node it reached.
 */
#ifndef SPROUT_GRAPH_H
#define SPROUT_GRAPH_H

#include "json.h"

typedef enum sprout_node_kind {
  SPROUT_NODE_NULL,
  SPROUT_NODE_BOOL,
  SPROUT_NODE_NUMBER,
  SPROUT_NODE_STRING,
  SPROUT_NODE_PLACE, /* a span: a file, a line and a column; file -1 is a place that was not kept */
  SPROUT_NODE_OBJECT,
  SPROUT_NODE_ARRAY,
  SPROUT_NODE_MAP,
  SPROUT_NODE_SET
} sprout_node_kind;

typedef struct sprout_node sprout_node;

struct sprout_node {
  sprout_node_kind kind;
  bool boolean;
  double number;
  const char *text; /* a string, NUL-terminated beyond length */
  size_t length;
  long file, line, column; /* a place */
  size_t count;            /* fields, elements, members or pairs */
  const char **keys;       /* an object's field names; a map's keys are nodes instead */
  const sprout_node **items;     /* an object's values, an array's or set's elements, a map's values */
  const sprout_node **map_keys;  /* a map's keys, beside items */
  size_t index;            /* the entry's place in the table, or SIZE_MAX for a scalar cell */
};

#define SPROUT_NOT_AN_ENTRY ((size_t)-1)

typedef struct sprout_graph {
  size_t count; /* entries */
  sprout_node *entries;
  size_t file_count;
  const char **files;
  sprout_node null_node; /* the one node every null cell is */
} sprout_graph;

/*
 * Reads the three runs of entries and the files spans name. SPROUT_BAD_INPUT
 * with `error` set to a sentence when an entry is malformed or refers past the table.
 */
sprout_status sprout_graph_read(sprout_arena *arena, const sprout_json *files,
                                const sprout_json *prose, const sprout_json *bodies,
                                const sprout_json *rest, sprout_graph *graph, char *error,
                                size_t error_capacity);

/* The node a cell stands for, or NULL when the cell refers to no entry. */
const sprout_node *sprout_graph_cell(const sprout_graph *graph, const sprout_json *cell);

/* An object's field, or NULL when it has none (or the node is not an object). */
const sprout_node *sprout_node_get(const sprout_node *object, const char *key);

/* The value a map holds for a key node, or NULL. */
const sprout_node *sprout_node_map_get(const sprout_node *map, const sprout_node *key);

/* The value a map holds for a string key, or NULL. */
const sprout_node *sprout_node_map_find(const sprout_node *map, const char *key);

/* Whether a node is a string equal to `text`. */
bool sprout_node_is(const sprout_node *node, const char *text);

/* A string field of an object as a C string, or NULL when absent or not a string. */
const char *sprout_node_text(const sprout_node *object, const char *key);

#endif
