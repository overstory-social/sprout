/*
 * Values: constructors, string ordering by UTF-16 code unit, number text and
 * sameness (the spec's The runtime > State). A list is the same as another
 * when it holds the same element type and the same elements in order.
 */
#include "values.h"

#include <math.h>
#include <string.h>

sprout_value sprout_bool(bool boolean) {
  sprout_value value;
  memset(&value, 0, sizeof value);
  value.kind = SPROUT_BOOL;
  value.as.boolean = boolean;
  return value;
}

sprout_value sprout_number(double number) {
  sprout_value value;
  memset(&value, 0, sizeof value);
  value.kind = SPROUT_NUMBER;
  value.as.number = number;
  return value;
}

/* One scalar read from the front of UTF-8: its length in bytes, or 0 if the bytes are not UTF-8. */
static size_t decode(const unsigned char *bytes, size_t length, uint32_t *scalar) {
  unsigned char lead = bytes[0];
  size_t size;
  uint32_t value, least;
  if (lead < 0x80) {
    *scalar = lead;
    return 1;
  }
  if (lead >= 0xC2 && lead <= 0xDF) {
    size = 2;
    value = lead & 0x1Fu;
    least = 0x80;
  } else if (lead >= 0xE0 && lead <= 0xEF) {
    size = 3;
    value = lead & 0x0Fu;
    least = 0x800;
  } else if (lead >= 0xF0 && lead <= 0xF4) {
    size = 4;
    value = lead & 0x07u;
    least = 0x10000;
  } else {
    return 0;
  }
  if (length < size) return 0;
  for (size_t i = 1; i < size; i++) {
    if ((bytes[i] & 0xC0u) != 0x80u) return 0;
    value = (value << 6) | (bytes[i] & 0x3Fu);
  }
  if (value < least || value > 0x10FFFF || (value >= 0xD800 && value <= 0xDFFF)) return 0;
  *scalar = value;
  return size;
}

long sprout_utf16_units(const char *bytes, size_t length) {
  size_t at = 0;
  long units = 0;
  while (at < length) {
    uint32_t scalar;
    size_t size = decode((const unsigned char *)bytes + at, length - at, &scalar);
    if (size == 0) return -1;
    units += scalar >= 0x10000 ? 2 : 1;
    at += size;
  }
  return units;
}

bool sprout_string(sprout_arena *arena, const char *bytes, size_t length, sprout_value *value) {
  long units = sprout_utf16_units(bytes, length);
  char *copy;
  if (units < 0) return false;
  copy = sprout_arena_copy(arena, bytes, length);
  if (copy == NULL) return false;
  memset(value, 0, sizeof *value);
  value->kind = SPROUT_STRING;
  value->as.string.bytes = copy;
  value->as.string.length = length;
  value->as.string.units = (size_t)units;
  return true;
}

/* A cursor over a string's UTF-16 code units. */
typedef struct units {
  const unsigned char *bytes;
  size_t length, at;
  uint16_t low; /* the second half of a pair not yet given, or 0 */
} units;

static bool next_unit(units *cursor, uint16_t *unit) {
  uint32_t scalar = 0xFFFD;
  size_t size;
  if (cursor->low != 0) {
    *unit = cursor->low;
    cursor->low = 0;
    return true;
  }
  if (cursor->at >= cursor->length) return false;
  size = decode(cursor->bytes + cursor->at, cursor->length - cursor->at, &scalar);
  cursor->at += size == 0 ? 1 : size;
  if (scalar >= 0x10000) {
    scalar -= 0x10000;
    *unit = (uint16_t)(0xD800u + (scalar >> 10));
    cursor->low = (uint16_t)(0xDC00u + (scalar & 0x3FFu));
  } else {
    *unit = (uint16_t)scalar;
  }
  return true;
}

int sprout_string_compare(const sprout_value *a, const sprout_value *b) {
  units left = {(const unsigned char *)a->as.string.bytes, a->as.string.length, 0, 0};
  units right = {(const unsigned char *)b->as.string.bytes, b->as.string.length, 0, 0};
  for (;;) {
    uint16_t x, y;
    bool has_x = next_unit(&left, &x), has_y = next_unit(&right, &y);
    if (!has_x || !has_y) return has_x ? 1 : (has_y ? -1 : 0);
    if (x != y) return x < y ? -1 : 1;
  }
}

bool sprout_number_text(double number, char *out, size_t capacity, size_t *length) {
  char digits[24];
  size_t count = 0, at = 0;
  bool negative = number < 0;
  uint64_t whole;
  if (!isfinite(number) || floor(number) != number) return false;
  /* Beyond 2^63 a whole number has an exponent in other renderings; the runtime has none. */
  if (fabs(number) >= 9223372036854775808.0) return false;
  whole = (uint64_t)(negative ? -number : number);
  if (whole == 0) negative = false;
  do {
    digits[count++] = (char)('0' + (int)(whole % 10));
    whole /= 10;
  } while (whole > 0);
  if (capacity < count + (negative ? 1u : 0u) + 1u) return false;
  if (negative) out[at++] = '-';
  while (count > 0) out[at++] = digits[--count];
  out[at] = '\0';
  *length = at;
  return true;
}

bool sprout_type_same(const sprout_type *a, const sprout_type *b) {
  if (a == b) return true;
  if (a == NULL || b == NULL || a->kind != b->kind) return false;
  return a->kind != SPROUT_LIST || sprout_type_same(a->element, b->element);
}

bool sprout_value_same(const sprout_value *a, const sprout_value *b) {
  if (a->kind != b->kind) return false;
  switch (a->kind) {
    case SPROUT_BOOL:
      return a->as.boolean == b->as.boolean;
    case SPROUT_NUMBER:
      return a->as.number == b->as.number;
    case SPROUT_STRING:
      return a->as.string.length == b->as.string.length &&
             memcmp(a->as.string.bytes, b->as.string.bytes, a->as.string.length) == 0;
    case SPROUT_LIST:
      if (a->as.list == b->as.list) return true;
      if (!sprout_type_same(a->as.list->holds, b->as.list->holds)) return false;
      if (a->as.list->count != b->as.list->count) return false;
      for (size_t i = 0; i < a->as.list->count; i++)
        if (!sprout_value_same(&a->as.list->items[i], &b->as.list->items[i])) return false;
      return true;
  }
  return false;
}
