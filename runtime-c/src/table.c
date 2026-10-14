/*
 * Mapping a cartridge's table; see table.h. The checks here are the only
 * ones: once a table is mapped, every index in it is known to be in range,
 * every string to end in a NUL, and every object's shape to have as many
 * fields as the object has values. The host is little-endian, as the
 * console and every host of the runtime are, so the words are read as they
 * lie.
 */
#include "table.h"

#include <string.h>

#define HEAD_WORDS 10
#define HEAD_BYTES 48 /* the magic and the counts, padded to eight */
#define NODE_BYTES 12

static size_t padded(size_t bytes) { return (bytes + 7u) & ~(size_t)7u; }

static sprout_status refuse(const char **why, const char *clause) {
  *why = clause;
  return SPROUT_BAD_INPUT;
}

static uint32_t word(const unsigned char *at) {
  return (uint32_t)at[0] | ((uint32_t)at[1] << 8) | ((uint32_t)at[2] << 16) | ((uint32_t)at[3] << 24);
}

/* The sections located from the counts; SPROUT_BAD_INPUT when the block is shorter than they need. */
static sprout_status locate(const unsigned char *bytes, size_t length, sprout_table *t, const char **why) {
  uint32_t counts[HEAD_WORDS];
  size_t at, i;
  if (length < HEAD_BYTES || memcmp(bytes, SPROUT_TABLE_MAGIC, 4) != 0) return refuse(why, "it does not begin with `TBL4`");
  for (i = 0; i < HEAD_WORDS; i++) counts[i] = word(bytes + 4 + i * 4);
  memset(t, 0, sizeof *t);
  t->node_count = counts[0];
  t->entry_count = counts[1];
  t->runs[0] = counts[2];
  t->runs[1] = counts[3];
  t->runs[2] = counts[4];
  t->child_count = counts[5];
  t->string_count = counts[6];
  t->string_bytes_length = counts[7];
  t->double_count = counts[8];
  t->shape_count = counts[9];
  if (t->entry_count > t->node_count || t->runs[0] + t->runs[1] + t->runs[2] != t->entry_count)
    return refuse(why, "its counts do not agree");
  if (t->shape_count > 65535) return refuse(why, "it holds more shapes than a node names");
  /* Each section's size is bounded so the sum cannot wrap on a 32-bit host. */
  if (t->node_count > length / NODE_BYTES || t->child_count > length / 4 || t->string_count > length / 4 ||
      t->string_bytes_length > length || t->double_count > length / 8)
    return refuse(why, "it ends before its sections do");
  at = HEAD_BYTES;
  t->nodes = (const sprout_table_node *)(bytes + at);
  at += padded(t->node_count * NODE_BYTES);
  t->children = (const uint32_t *)(bytes + at);
  at += padded(t->child_count * 4);
  t->string_offsets = (const uint32_t *)(bytes + at);
  at += padded((t->string_count + 1) * 4);
  t->string_bytes = (const char *)(bytes + at);
  at += padded(t->string_bytes_length);
  t->doubles = (const double *)(bytes + at);
  at += t->double_count * 8;
  t->shape_offsets = (const uint32_t *)(bytes + at);
  at += padded((t->shape_count + 1) * 4);
  if (at > length) return refuse(why, "it ends before its sections do");
  t->shape_field_count = t->shape_offsets[t->shape_count];
  if (t->shape_field_count > length / 4) return refuse(why, "it ends before its sections do");
  t->shape_fields = (const uint32_t *)(bytes + at);
  at += padded(t->shape_field_count * 4);
  if (at > length) return refuse(why, "it ends before its sections do");
  return SPROUT_OK;
}

sprout_status sprout_table_map(const unsigned char *bytes, size_t length, sprout_table *t, const char **why) {
  size_t i;
  sprout_status status;
  *why = NULL;
  if (((uintptr_t)bytes & 7u) != 0) return refuse(why, "it does not begin on an eight-byte boundary");
  status = locate(bytes, length, t, why);
  if (status != SPROUT_OK) return status;
  if (t->string_offsets[0] != 0) return refuse(why, "a string lies outside its bytes");
  for (i = 0; i < t->string_count; i++) {
    uint32_t start = t->string_offsets[i], end = t->string_offsets[i + 1];
    if (end <= start || end > t->string_bytes_length) return refuse(why, "a string lies outside its bytes");
    if (t->string_bytes[end - 1] != '\0') return refuse(why, "a string has no NUL after it");
  }
  if (t->shape_offsets[0] != 0) return refuse(why, "a shape lies outside its fields");
  for (i = 0; i < t->shape_count; i++)
    if (t->shape_offsets[i + 1] < t->shape_offsets[i] || t->shape_offsets[i + 1] > t->shape_field_count)
      return refuse(why, "a shape lies outside its fields");
  for (i = 0; i < t->shape_field_count; i++)
    if (t->shape_fields[i] >= t->string_count) return refuse(why, "a shape names a string it does not hold");
  for (i = 0; i < t->child_count; i++)
    if (t->children[i] >= t->node_count) return refuse(why, "it refers to a node it does not hold");
  for (i = 0; i < t->node_count; i++) {
    const sprout_table_node *n = &t->nodes[i];
    bool entry = i < t->entry_count;
    switch (n->kind) {
      case SPROUT_TABLE_OBJECT:
        if (!entry) return refuse(why, "a scalar is not a scalar");
        if (n->shape >= t->shape_count) return refuse(why, "an object has a shape it does not hold");
        if (t->shape_offsets[n->shape + 1] - t->shape_offsets[n->shape] != n->count)
          return refuse(why, "an object's shape does not match its count");
        if (n->count > t->child_count || n->first > t->child_count - n->count)
          return refuse(why, "an entry reaches past the children");
        break;
      case SPROUT_TABLE_ARRAY:
      case SPROUT_TABLE_SET:
        if (!entry) return refuse(why, "a scalar is not a scalar");
        if (n->count > t->child_count || n->first > t->child_count - n->count)
          return refuse(why, "an entry reaches past the children");
        break;
      case SPROUT_TABLE_MAP:
        if (!entry) return refuse(why, "a scalar is not a scalar");
        if (n->count > t->child_count / 2 || n->first > t->child_count - 2 * n->count)
          return refuse(why, "an entry reaches past the children");
        break;
      case SPROUT_TABLE_STRING:
        if (entry) return refuse(why, "an entry is not an object, an array, a map or a set");
        if (n->first >= t->string_count) return refuse(why, "it names a string it does not hold");
        if (t->string_offsets[n->first + 1] - t->string_offsets[n->first] != n->count + 1)
          return refuse(why, "a string's length is not its bytes'");
        break;
      case SPROUT_TABLE_NUMBER:
        if (entry) return refuse(why, "an entry is not an object, an array, a map or a set");
        if ((n->flags & SPROUT_TABLE_INLINE) == 0 && n->first >= t->double_count)
          return refuse(why, "it names a number it does not hold");
        break;
      case SPROUT_TABLE_PLACE:
        if (entry) return refuse(why, "an entry is not an object, an array, a map or a set");
        break;
      case SPROUT_TABLE_NULL:
      case SPROUT_TABLE_BOOLEAN:
        if (entry) return refuse(why, "an entry is not an object, an array, a map or a set");
        break;
      default:
        return refuse(why, "a node is of no kind this runtime reads");
    }
  }
  return SPROUT_OK;
}
