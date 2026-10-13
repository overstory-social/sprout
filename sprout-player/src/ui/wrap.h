/*
 * Word wrap for a column a number of pixels wide: a newline starts a line, a paragraph is cut at white space with the words of a line joined by one space,
 * each line takes as many words as fit, and a word wider than the column is cut between
 * characters, never inside one. `measure` is the font's (pen.h), so nothing counts characters.
 */
#ifndef PLAYER_UI_WRAP_H
#define PLAYER_UI_WRAP_H

#include <stdbool.h>
#include <stddef.h>

#include "pd_api.h"

typedef int (*wrap_measure)(void *ctx, const char *text, size_t length);

/* Lines one after another, each followed by a NUL, in a block from the device's allocator. */
typedef struct wrapped {
  char *bytes;
  size_t line_count;
} wrapped;

/* The lines the `length` bytes at `text` make in a column `width` wide; false when no block could be had. */
bool wrap_lines(PlaydateAPI *pd, const char *text, size_t length, int width, wrap_measure measure, void *ctx,
                wrapped *out);

/* The line after `line` in a wrapped block. */
const char *wrap_next(const char *line);

#endif
