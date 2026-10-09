/*
 * A small JSON reader and writer, enough for the cartridge and the stored
 * world. The reader builds a tree in an arena without recursion, so the depth
 * of the text bounds nothing but memory; the writer prints a tree in the
 * stored form's canonical shape: members in the order held, no white space,
 * the escapes JSON.stringify makes.
 */
#ifndef SPROUT_JSON_H
#define SPROUT_JSON_H

#include "arena.h"

typedef enum sprout_json_kind {
  SPROUT_JSON_NULL,
  SPROUT_JSON_BOOL,
  SPROUT_JSON_NUMBER,
  SPROUT_JSON_STRING,
  SPROUT_JSON_ARRAY,
  SPROUT_JSON_OBJECT
} sprout_json_kind;

typedef struct sprout_json sprout_json;

struct sprout_json {
  sprout_json_kind kind;
  bool boolean;
  double number;
  const char *bytes; /* a string's UTF-8, NUL-terminated beyond length */
  size_t length;
  size_t count;       /* members of an array or object */
  sprout_json **items;
  const char *key;    /* when a member of an object: its name */
  size_t key_length;
  sprout_json *parent;
  size_t index;       /* position in the parent */
  sprout_json *next;  /* used while reading */
};

/* Where and why a read stopped, in words for whoever wrote the text. */
typedef struct sprout_json_error {
  size_t line;
  size_t column;
  char text[96];
} sprout_json_error;

/* Reads one value and nothing after it; SPROUT_BAD_INPUT with `error` filled, or SPROUT_NO_MEMORY. */
sprout_status sprout_json_read(sprout_arena *arena, const char *bytes, size_t length,
                               sprout_json **root, sprout_json_error *error);

/* The member of an object with this name (the last, if repeated), or NULL. */
const sprout_json *sprout_json_get(const sprout_json *object, const char *key);

/*
 * The canonical text of a tree, NUL-terminated, in the arena. SPROUT_BAD_INPUT
 * for a number that is not whole, which the stored form does not write.
 */
sprout_status sprout_json_write(sprout_arena *arena, const sprout_json *root, const char **bytes,
                                size_t *length);

#endif
