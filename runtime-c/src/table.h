/*
 * The table a cartridge holds its graph in (the spec's The compiler > What
 * compiling produces), as the compiler's `cartridge-table.ts` lays it out: a
 * block of little-endian words the runtime reads in place. Mapping a block
 * checks it once, every index and offset, so that reading it afterwards
 * needs no check at all. The block must stay where it is for as long as the
 * table is read, and be eight-aligned, as the doubles in it are.
 *
 * Nodes come entries first (the three runs: prose, bodies, the rest), then
 * the scalar cells, one per distinct value; so a node's index below the
 * entry count is an entry's. A node is twelve bytes: its kind, its flags, the
 * shape an object's fields follow, a count and a first word, whose meaning
 * the kind gives (see `sprout_table_node`).
 */
#ifndef SPROUT_TABLE_H
#define SPROUT_TABLE_H

#include "sprout.h"

#define SPROUT_TABLE_MAGIC "TBL3"

/* A node's kind: the same numbering as sprout_node_kind. */
enum {
  SPROUT_TABLE_NULL,
  SPROUT_TABLE_BOOLEAN,
  SPROUT_TABLE_NUMBER,
  SPROUT_TABLE_STRING,
  SPROUT_TABLE_PLACE,
  SPROUT_TABLE_OBJECT,
  SPROUT_TABLE_ARRAY,
  SPROUT_TABLE_MAP,
  SPROUT_TABLE_SET
};

#define SPROUT_TABLE_INLINE 1u /* a number's flag: `first` is a signed 32-bit integer */
#define SPROUT_TABLE_TRUE 1u   /* a boolean's flag: its value */

/*
 * One node. An object's `count` fields are the shape's, their values at
 * `children[first]`; an array's or a set's elements likewise; a map's `count`
 * pairs are key then value from `children[first]`. A string's `first` indexes
 * the strings and `count` is its length in bytes. A number's `first` is a
 * signed integer under the INLINE flag, else an index into the doubles. A
 * place's `first` indexes the places.
 */
typedef struct sprout_table_node {
  uint8_t kind;
  uint8_t flags;
  uint16_t shape;
  uint32_t count;
  uint32_t first;
} sprout_table_node;

typedef struct sprout_table_place {
  int32_t line;
  int16_t file; /* -1 for a place that was not kept */
  uint16_t column;
} sprout_table_place;

/* A table mapped over its block, every section located and checked. */
typedef struct sprout_table {
  const sprout_table_node *nodes;
  size_t node_count, entry_count;
  size_t runs[3]; /* prose, bodies, the rest */
  const uint32_t *children;
  size_t child_count;
  const uint32_t *string_offsets; /* string_count + 1 of them, into string_bytes */
  const char *string_bytes;
  size_t string_count, string_bytes_length;
  const double *doubles;
  size_t double_count;
  const sprout_table_place *places;
  size_t place_count;
  const uint32_t *shape_offsets; /* shape_count + 1 of them, into shape_fields */
  const uint32_t *shape_fields;  /* string indexes */
  size_t shape_count, shape_field_count;
} sprout_table;

/*
 * Maps the table that begins at `bytes` (eight-aligned) and runs `length`
 * bytes, checking every count, index and offset. SPROUT_BAD_INPUT with `why`
 * set to a clause when it is not a table this runtime reads.
 */
sprout_status sprout_table_map(const unsigned char *bytes, size_t length, sprout_table *table, const char **why);

/* The text of string `index`, NUL-terminated. */
static inline const char *sprout_table_string(const sprout_table *table, size_t index) {
  return table->string_bytes + table->string_offsets[index];
}

/* The name of field `i` of an object of `shape`. */
static inline const char *sprout_table_field(const sprout_table *table, size_t shape, size_t i) {
  return sprout_table_string(table, table->shape_fields[table->shape_offsets[shape] + i]);
}

#endif
