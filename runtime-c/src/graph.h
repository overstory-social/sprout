/*
 * The graph a cartridge holds (the spec's The compiler > What compiling
 * produces): a flat table of objects, arrays, maps and sets that refer to one
 * another by index, so a thing two parts of the world share is one node. The
 * table is three runs under one numbering (prose nodes, statements and
 * expressions, everything else). Reading it gives each entry a node at its
 * place in the table (`sprout_graph_index`), which is how a body's names are
 * bound: the name table maps the node written to the node it reached.
 *
 * A node is small, because a world holds hundreds of thousands: its payload
 * is a union and nothing else but its kind and count, so it is 16 bytes on a
 * 32-bit console; a scalar cell (a string, a number, a place, true or false)
 * is one node per distinct value, shared by every entry that holds it, and
 * lies outside the entries array, which is how it is told from an entry; and
 * the key array of every object with the same field names in the same order
 * is one array. Nothing a node holds points at the JSON it was read from.
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

/* Only graph.c and graph_build.c write or read these fields; everything else reads a node through the functions below. */
struct sprout_node {
  uint8_t kind; /* a sprout_node_kind */
  bool boolean;
  uint32_t count; /* fields, elements, members or pairs */
  union {
    double number;
    struct {
      const char *text; /* a string, NUL-terminated beyond length */
      size_t length;
    };
    struct {
      int32_t line; /* a place */
      int16_t file;
      uint16_t column;
    };
    struct {
      const sprout_node **items; /* an object's values, an array's or set's elements, a map's values */
      union {
        const char **keys;            /* an object's field names */
        const sprout_node **map_keys; /* a map's keys, beside items */
      };
    };
  };
};

/* The double aligns the union to 8, so the node is two words of header and one union on a 32-bit host. */
_Static_assert(sizeof(void *) != 4 || sizeof(sprout_node) == 16, "a node is 16 bytes on a 32-bit host");

/* A graph holds fewer entries than this, so it is also the index a node outside the entries has. */
#define SPROUT_NOT_AN_ENTRY ((size_t)UINT32_MAX)

typedef struct sprout_graph {
  size_t count; /* entries */
  sprout_node *entries;
  size_t file_count;
  const char **files;
  sprout_node null_node; /* the one node every null cell is */
  sprout_node true_node, false_node;
} sprout_graph;

/*
 * ---- reading a node ----
 * A node's payload is read through these, with the graph it belongs to: the
 * graph is what a node's children, text and field names are read through
 * once the table is the cartridge's own bytes (cartridge format 3 gives it
 * that layout), so nothing outside graph.c and the builder touches the
 * fields. `kind` and `count` are read as fields.
 */

/* An object's `i`th value, an array's or set's `i`th element, or a map's `i`th value. */
static inline const sprout_node *sprout_item(const sprout_graph *graph, const sprout_node *node, size_t i) {
  (void)graph;
  return node->items[i];
}

/* A map's `i`th key. */
static inline const sprout_node *sprout_map_key(const sprout_graph *graph, const sprout_node *map, size_t i) {
  (void)graph;
  return map->map_keys[i];
}

/* An object's `i`th field name. */
static inline const char *sprout_key(const sprout_graph *graph, const sprout_node *object, size_t i) {
  (void)graph;
  return object->keys[i];
}

/* A string node's text, NUL-terminated beyond its length. */
static inline const char *sprout_text(const sprout_graph *graph, const sprout_node *node) {
  (void)graph;
  return node->text;
}

static inline size_t sprout_text_length(const sprout_graph *graph, const sprout_node *node) {
  (void)graph;
  return node->length;
}

static inline double sprout_node_number(const sprout_graph *graph, const sprout_node *node) {
  (void)graph;
  return node->number;
}

static inline bool sprout_truth(const sprout_node *node) { return node->boolean; }

/* A place's file (-1 where none was kept), line and column. */
static inline int sprout_place_file(const sprout_graph *graph, const sprout_node *place) {
  (void)graph;
  return place->file;
}

static inline long sprout_place_line(const sprout_graph *graph, const sprout_node *place) {
  (void)graph;
  return place->line;
}

static inline unsigned sprout_place_column(const sprout_graph *graph, const sprout_node *place) {
  (void)graph;
  return place->column;
}

/* The interning table: open addressing over node pointers, grown by doubling in scratch. */
typedef struct sprout_intern {
  const sprout_node **slots;
  size_t capacity, used;
} sprout_intern;

/* A shape: the key array objects with these field names, in this order, share. */
typedef struct sprout_shape {
  const char **keys;
  uint32_t count;
} sprout_shape;

/* The shapes seen: open addressing over the key sequences, grown by doubling in scratch. */
typedef struct sprout_shape_table {
  sprout_shape *slots;
  size_t capacity, used;
} sprout_shape_table;

/*
 * A graph being read: begun with the entries' counts, so a reference may
 * point forward; filled one entry at a time, in the table's order; ended with
 * the files spans name, which a cartridge gives after its entries.
 */
typedef struct sprout_graph_reader {
  sprout_arena *arena;
  sprout_arena *scratch;
  sprout_graph *graph;
  sprout_intern table;
  sprout_shape_table shapes;
  const char **probe_keys; /* the keys of the object being filled, before its shape is found */
  size_t probe_capacity;
  size_t filled;
  long max_file; /* the highest file a place named, checked against the files at the end */
  char *error;
  size_t capacity;
} sprout_graph_reader;

/*
 * Begins `graph` in `arena` with room for the three runs' entries, interning
 * scalars through a table in `scratch`, which the caller resets once the graph
 * is read. SPROUT_BAD_INPUT with `error` set to a sentence for counts past what
 * a graph holds.
 */
sprout_status sprout_graph_begin(sprout_graph_reader *r, sprout_graph *graph, sprout_arena *arena,
                                 sprout_arena *scratch, size_t prose, size_t bodies, size_t rest,
                                 char *error, size_t error_capacity);

/* Fills the next entry from its JSON. SPROUT_BAD_INPUT with `error` set when it is malformed, refers past the table, or is one more than the counts said. */
sprout_status sprout_graph_fill(sprout_graph_reader *r, const sprout_json *entry);

/* Ends the graph with the files spans name. SPROUT_BAD_INPUT with `error` set when fewer entries came than counted, or a place named a file not listed. */
sprout_status sprout_graph_end(sprout_graph_reader *r, const sprout_json *files);

/*
 * Reads the three runs of entries and the files spans name, whole: begin, fill and end over
 * JSON already read. SPROUT_BAD_INPUT with `error` set to a sentence when an entry is malformed
 * or refers past the table.
 */
sprout_status sprout_graph_read(sprout_arena *arena, sprout_arena *scratch, const sprout_json *files,
                                const sprout_json *prose, const sprout_json *bodies,
                                const sprout_json *rest, sprout_graph *graph, char *error,
                                size_t error_capacity);

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
 * ---- graph_build.c: nodes made at run time ----
 * The engine's own lines are read into nodes while a turn runs; they belong
 * to a graph of their own, built in an arena, with no entries, so the name
 * table binds none of them. An object is built whole, its fields in order.
 */
typedef struct sprout_builder {
  sprout_arena *arena;
  sprout_graph graph;
  bool failed; /* the arena's host refused a page: what was built since is not to be read */
} sprout_builder;

void sprout_build_begin(sprout_builder *builder, sprout_arena *arena);

/* An object with these `count` fields, keys and values side by side; NULL and failed on no memory or a NULL value. */
const sprout_node *sprout_build_object(sprout_builder *builder, const char *const *keys,
                                       const sprout_node *const *values, size_t count);

/* An array of these `count` elements, copied; NULL and failed on no memory or a NULL element. */
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
