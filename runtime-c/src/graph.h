/*
 * The graph a cartridge holds (the spec's The compiler > What compiling
 * produces): a flat table of objects, arrays, maps and sets that refer to one
 * another by index, so a thing two parts of the world share is one node. The
 * table is three runs under one numbering (prose nodes, statements and
 * expressions, everything else), and the graph reads it in place: a node is
 * the cartridge's own twelve bytes (table.h), its children are indexes into
 * one pool, its text lies in one run of strings. An entry's index is its
 * place in the table (`sprout_graph_index`), which is how a body's names are
 * bound: the name table maps the node written to the node it reached. A
 * scalar cell (a string, a number, a place, true, false or null) is one node
 * per distinct value, after the entries, which is how it is told from one.
 *
 * Nothing outside graph.c, graph_build.c and table.c touches a node's
 * fields: a node's payload is read through the functions below, with the
 * graph it belongs to. `kind` and `count` are read as fields.
 */
#ifndef SPROUT_GRAPH_H
#define SPROUT_GRAPH_H

#include "json.h"
#include "table.h"

typedef enum sprout_node_kind {
  SPROUT_NODE_NULL = SPROUT_TABLE_NULL,
  SPROUT_NODE_BOOL = SPROUT_TABLE_BOOLEAN,
  SPROUT_NODE_NUMBER = SPROUT_TABLE_NUMBER,
  SPROUT_NODE_STRING = SPROUT_TABLE_STRING,
  SPROUT_NODE_PLACE = SPROUT_TABLE_PLACE, /* a span: a file, a line and a column; file -1 is a place that was not kept */
  SPROUT_NODE_OBJECT = SPROUT_TABLE_OBJECT,
  SPROUT_NODE_ARRAY = SPROUT_TABLE_ARRAY,
  SPROUT_NODE_MAP = SPROUT_TABLE_MAP,
  SPROUT_NODE_SET = SPROUT_TABLE_SET
} sprout_node_kind;

typedef sprout_table_node sprout_node;

/* A graph holds fewer entries than this, so it is also the index a node outside the entries has. */
#define SPROUT_NOT_AN_ENTRY ((size_t)UINT32_MAX)

typedef struct sprout_graph {
  sprout_table table;
  size_t count; /* entries: the table's, which come first among its nodes */
  size_t file_count;
  const char **files; /* the files places name, copied beside the table */
} sprout_graph;

/* ---- reading a node ---- */

/* An object's `i`th value, an array's or set's `i`th element, or a map's `i`th value. */
static inline const sprout_node *sprout_item(const sprout_graph *graph, const sprout_node *node, size_t i) {
  size_t at = node->kind == SPROUT_NODE_MAP ? node->first + 2 * i + 1 : node->first + i;
  return &graph->table.nodes[graph->table.children[at]];
}

/* A map's `i`th key. */
static inline const sprout_node *sprout_map_key(const sprout_graph *graph, const sprout_node *map, size_t i) {
  return &graph->table.nodes[graph->table.children[map->first + 2 * i]];
}

/* An object's `i`th field name. */
static inline const char *sprout_key(const sprout_graph *graph, const sprout_node *object, size_t i) {
  return sprout_table_field(&graph->table, object->shape, i);
}

/* A string node's text, NUL-terminated beyond its length. */
static inline const char *sprout_text(const sprout_graph *graph, const sprout_node *node) {
  return sprout_table_string(&graph->table, node->first);
}

static inline size_t sprout_text_length(const sprout_graph *graph, const sprout_node *node) {
  (void)graph;
  return node->count;
}

static inline double sprout_node_number(const sprout_graph *graph, const sprout_node *node) {
  if ((node->flags & SPROUT_TABLE_INLINE) != 0)
    return node->first >= 0x80000000u ? (double)node->first - 4294967296.0 : (double)node->first;
  return graph->table.doubles[node->first];
}

static inline bool sprout_truth(const sprout_node *node) { return (node->flags & SPROUT_TABLE_TRUE) != 0; }

/* A place's file (-1 where none was kept), line and column, which its node holds. */
static inline int sprout_place_file(const sprout_graph *graph, const sprout_node *place) {
  (void)graph;
  return place->shape == SPROUT_TABLE_NO_FILE ? -1 : (int)place->shape;
}

static inline long sprout_place_line(const sprout_graph *graph, const sprout_node *place) {
  (void)graph;
  return (long)place->first;
}

static inline unsigned sprout_place_column(const sprout_graph *graph, const sprout_node *place) {
  (void)graph;
  return (unsigned)place->count;
}

/* `file:line:column` of a place, in `arena`; `?` where the cartridge kept none, and NULL where the host refuses a page. */
const char *sprout_place_text(const sprout_graph *graph, const sprout_node *place, sprout_arena *arena);

/* ---- the cartridge's graph ---- */

/*
 * Maps `graph` over the table that begins at `block` (eight-aligned, `length`
 * bytes, kept for as long as the graph is read), checking it once, with the
 * files `files` names (a JSON array of strings) copied into `arena`.
 * SPROUT_BAD_INPUT with `error` set to a sentence when the block is not a
 * table, or a place names a file not listed; SPROUT_NO_MEMORY when the host
 * refuses a page.
 */
sprout_status sprout_graph_map(sprout_graph *graph, const unsigned char *block, size_t length, sprout_arena *arena,
                               const sprout_json *files, char *error, size_t error_capacity);

/* An entry's place in the table; SPROUT_NOT_AN_ENTRY for a scalar cell or a node made at run time. */
size_t sprout_graph_index(const sprout_graph *graph, const sprout_node *node);

/* The node a cell stands for, or NULL when the cell refers to no entry. */
const sprout_node *sprout_graph_cell(const sprout_graph *graph, const sprout_json *cell);

/* An object's field, or NULL when it has none (or the node is not an object). */
const sprout_node *sprout_node_get(const sprout_graph *graph, const sprout_node *object, const char *key);

/* The value a map holds for a key node, or NULL. */
const sprout_node *sprout_node_map_get(const sprout_graph *graph, const sprout_node *map, const sprout_node *key);

/* The value a map holds for a string key, or NULL. */
const sprout_node *sprout_node_map_find(const sprout_graph *graph, const sprout_node *map, const char *key);

/* Whether a node is a string equal to `text`. */
bool sprout_node_is(const sprout_graph *graph, const sprout_node *node, const char *text);

/* A string field of an object as a C string, or NULL when absent or not a string. */
const char *sprout_node_text(const sprout_graph *graph, const sprout_node *object, const char *key);

/*
 * A name as the cartridge writes one (an identifier, or an object path's steps
 * joined by dots): a string, or, where the name table binds it, an entry whose
 * `text` field is the name. NULL for anything else.
 */
const char *sprout_name(const sprout_graph *graph, const sprout_node *node);

/* An object's field read as a name (sprout_name), or NULL. */
const char *sprout_node_name(const sprout_graph *graph, const sprout_node *object, const char *key);

/*
 * ---- graph_build.c: nodes made at run time ----
 * The engine's own lines are read into nodes while a turn runs; they belong
 * to a graph of their own, laid out as a cartridge's table is, in an arena,
 * with no entries, so the name table binds none of them. The builder is
 * given its room up front, so a node once made never moves; a build past its
 * room fails, as one the host refuses a page does. An object is built whole,
 * its fields in order.
 */
typedef struct sprout_build_room {
  size_t nodes, children, string_bytes, strings, shapes, shape_fields;
} sprout_build_room;

typedef struct sprout_builder {
  sprout_arena *arena;
  sprout_graph graph;
  sprout_build_room room;
  sprout_table_node *nodes;
  uint32_t *children, *string_offsets, *shape_offsets, *shape_fields;
  char *string_bytes;
  double *doubles;
  bool failed; /* the host refused a page or the room ran out: what was built since is not to be read */
} sprout_builder;

/* Room enough for the engine's own lines. */
#define SPROUT_BUILD_LINE_ROOM {256, 1024, 4096, 128, 32, 128}

/* Begins a builder over `arena` with `room`; failed at once when the host refuses the room. */
void sprout_build_begin(sprout_builder *builder, sprout_arena *arena, sprout_build_room room);

/* An object with these `count` fields, keys and values side by side; NULL and failed on no room or a NULL value. */
const sprout_node *sprout_build_object(sprout_builder *builder, const char *const *keys,
                                       const sprout_node *const *values, size_t count);

/* An array of these `count` elements, copied; NULL and failed on no room or a NULL element. */
const sprout_node *sprout_build_array(sprout_builder *builder, const sprout_node *const *items, size_t count);

/* A string node holding a copy of `length` bytes. */
const sprout_node *sprout_build_string(sprout_builder *builder, const char *bytes, size_t length);

const sprout_node *sprout_build_number(sprout_builder *builder, double number);

/* The graph's one node for true, false or null. */
const sprout_node *sprout_build_bool(const sprout_builder *builder, bool truth);
const sprout_node *sprout_build_null(const sprout_builder *builder);

bool sprout_build_failed(const sprout_builder *builder);

/* The graph the built nodes belong to, valid while the arena is. */
const sprout_graph *sprout_build_graph(const sprout_builder *builder);

#endif
