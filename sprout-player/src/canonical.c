/* The canonical text of a JSON value; see canonical.h. */
#include "canonical.h"

#include <string.h>

/* The UTF-16 code unit at `*at` in the `length` bytes of UTF-8 at `bytes`, moving past it; a pair's second half is held in `*low`. */
static unsigned next_unit(const unsigned char *bytes, size_t length, size_t *at, unsigned *low) {
  unsigned scalar, c;
  size_t more, i;
  if (*low != 0) {
    unsigned unit = *low;
    *low = 0;
    return unit;
  }
  c = bytes[(*at)++];
  if (c < 0x80) return c;
  more = c >= 0xF0 ? 3 : c >= 0xE0 ? 2 : 1;
  scalar = c & (0x3Fu >> more);
  for (i = 0; i < more && *at < length; i++) scalar = (scalar << 6) | (bytes[(*at)++] & 0x3Fu);
  if (scalar < 0x10000) return scalar;
  scalar -= 0x10000;
  *low = 0xDC00 + (scalar & 0x3FF);
  return 0xD800 + (scalar >> 10);
}

/* Member `a`'s name against `b`'s as JavaScript's sort orders strings: below 0 when it comes first, 0 when they are the same. */
static int compare_names(const sprout_json *a, const sprout_json *b) {
  const unsigned char *x = (const unsigned char *)a->key, *y = (const unsigned char *)b->key;
  size_t i = 0, j = 0;
  unsigned low_x = 0, low_y = 0;
  while ((i < a->key_length || low_x != 0) && (j < b->key_length || low_y != 0)) {
    unsigned u = next_unit(x, a->key_length, &i, &low_x), v = next_unit(y, b->key_length, &j, &low_y);
    if (u != v) return u < v ? -1 : 1;
  }
  if (i < a->key_length || low_x != 0) return 1;
  if (j < b->key_length || low_y != 0) return -1;
  return 0;
}

/* Sorts an object's members by name, a merge at a time through `spare`; false where a name is repeated. */
static bool sort_members(sprout_json *object, sprout_json **spare) {
  sprout_json **from = object->items, **to = spare, **swap;
  size_t n = object->count, width, i;
  for (width = 1; width < n; width *= 2) {
    for (i = 0; i < n; i += 2 * width) {
      size_t left = i, middle = i + width < n ? i + width : n, right = i + 2 * width < n ? i + 2 * width : n;
      size_t a = left, b = middle, out = left;
      while (a < middle && b < right) {
        to[out++] = compare_names(from[a], from[b]) <= 0 ? from[a++] : from[b++];
      }
      while (a < middle) to[out++] = from[a++];
      while (b < right) to[out++] = from[b++];
    }
    swap = from;
    from = to;
    to = swap;
  }
  if (from != object->items) memcpy(object->items, from, n * sizeof *from);
  for (i = 0; i < n; i++) {
    if (i > 0 && compare_names(object->items[i - 1], object->items[i]) == 0) return false;
    object->items[i]->index = i;
  }
  return true;
}

/* Puts every object under `root` in canonical order; NULL, or why there is no canonical text. */
static const char *put_in_order(sprout_arena *arena, sprout_json *root) {
  sprout_json *node = root;
  for (;;) {
    switch (node->kind) {
      case SPROUT_JSON_NULL: return "a null has no canonical text";
      case SPROUT_JSON_BOOL: return "a true or false has no canonical text";
      case SPROUT_JSON_NUMBER:
        if (node->number == 0) node->number = 0; /* JavaScript writes -0 as 0 */
        break;
      case SPROUT_JSON_STRING: break;
      case SPROUT_JSON_OBJECT:
        if (node->count > 1) {
          sprout_json **spare = (sprout_json **)sprout_arena_take(arena, node->count * sizeof *spare);
          if (spare == NULL) return "the player ran out of memory";
          if (!sort_members(node, spare)) return "an object that names a member twice has no canonical text";
        }
        /* fall through */
      case SPROUT_JSON_ARRAY:
        if (node->count > 0) {
          node = node->items[0];
          continue;
        }
        break;
    }
    /* On to the next member, climbing out of each container finished. */
    for (;;) {
      sprout_json *parent;
      if (node == root) return NULL;
      parent = node->parent;
      if (node->index + 1 < parent->count) {
        node = parent->items[node->index + 1];
        break;
      }
      node = parent;
    }
  }
}

const char *player_canonical(sprout_arena *arena, sprout_json *value, const char **text, size_t *length) {
  const char *why = put_in_order(arena, value);
  sprout_status status;
  if (why != NULL) return why;
  status = sprout_json_write_value(arena, value, text, length);
  if (status == SPROUT_NO_MEMORY) return "the player ran out of memory";
  if (status != SPROUT_OK) return "a number that is not whole has no canonical text";
  return NULL;
}
