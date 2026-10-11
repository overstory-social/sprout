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
 * lies outside the entries array, which is how it is told from an entry.
 * Nothing a node holds points at the JSON it was read from.
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

/* The interning table: open addressing over node pointers, grown by doubling in scratch. */
typedef struct sprout_intern {
  const sprout_node **slots;
  size_t capacity, used;
} sprout_intern;

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
