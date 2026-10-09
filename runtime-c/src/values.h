/*
 * Values (the spec's The runtime > State): a boolean, a number held as an
 * IEEE double, a string held as UTF-8 with its length in UTF-16 code units
 * kept for ordering, and a list. A value never refers to an object.
 */
#ifndef SPROUT_VALUES_H
#define SPROUT_VALUES_H

#include "arena.h"

typedef enum sprout_kind { SPROUT_BOOL, SPROUT_NUMBER, SPROUT_STRING, SPROUT_LIST } sprout_kind;

/* A type: a list's type names the type of what it holds. */
typedef struct sprout_type {
  sprout_kind kind;
  const struct sprout_type *element; /* for SPROUT_LIST only */
} sprout_type;

typedef struct sprout_list sprout_list;

typedef struct sprout_value {
  sprout_kind kind;
  union {
    bool boolean;
    double number;
    struct {
      const char *bytes; /* UTF-8, NUL-terminated beyond length */
      size_t length;     /* in bytes */
      size_t units;      /* in UTF-16 code units */
    } string;
    const sprout_list *list;
  } as;
} sprout_value;

/* A list: ordered, one element type, no duplicates. Immutable once made. */
struct sprout_list {
  const sprout_type *holds;
  size_t count;
  sprout_value *items;
};

sprout_value sprout_bool(bool boolean);
sprout_value sprout_number(double number);

/* A string over valid UTF-8, copied into the arena; false for bytes that are not UTF-8 or no memory. */
bool sprout_string(sprout_arena *arena, const char *bytes, size_t length, sprout_value *value);

/* The length of valid UTF-8 in UTF-16 code units, or -1 for bytes that are not UTF-8. */
long sprout_utf16_units(const char *bytes, size_t length);

/* Orders strings by UTF-16 code unit, as the spec orders them: negative, zero or positive. */
int sprout_string_compare(const sprout_value *a, const sprout_value *b);

/*
 * A number as text (the spec's Prose > Slots): a minus sign for a negative
 * number, no leading zeros, no exponent, no sign on zero. Whole numbers only;
 * false for a fraction, infinity or NaN, or when `capacity` is too small.
 * Writes a NUL after the text.
 */
bool sprout_number_text(double number, char *out, size_t capacity, size_t *length);

/* Whether two values are the same: scalars by content, lists by element type and elements in order. */
bool sprout_value_same(const sprout_value *a, const sprout_value *b);

/* Whether two types are the same. */
bool sprout_type_same(const sprout_type *a, const sprout_type *b);

#endif
