/*
 * Word wrap for a column a number of pixels wide: a newline starts a line, a paragraph is cut at white space with the words of a line joined by one space,
 * each line takes as many words as fit, and a word wider than the column is cut between
 * characters, never inside one. `measure` is the font's (pen.h), so nothing counts characters.
 * A wrapped block keeps the words it was made from ahead of its lines, so the same words wrap
 * again when the font changes (`wrap_again`), with nothing joined or cut that was not.
 */
#ifndef PLAYER_UI_WRAP_H
#define PLAYER_UI_WRAP_H

#include <stdbool.h>
#include <stddef.h>

#include "pd_api.h"

typedef int (*wrap_measure)(void *ctx, const char *text, size_t length);

/*
 * One block from the device's allocator: the words as given, with a NUL after them, then the
 * lines one after another, each followed by a NUL.
 */
typedef struct wrapped {
  char *bytes; /* the first line */
  size_t line_count;
  char *text; /* the words, the start of the block */
  size_t length;
} wrapped;

/* The lines the `length` bytes at `text` make in a column `width` wide; false when no block could be had. */
bool wrap_lines(PlaydateAPI *pd, const char *text, size_t length, int width, wrap_measure measure, void *ctx,
                wrapped *out);

/*
 * Wraps the block's own words again, for a column or a font that changed; false, with the block
 * as it was, when no block could be had for the new lines.
 */
bool wrap_again(PlaydateAPI *pd, wrapped *w, int width, wrap_measure measure, void *ctx);

/* Releases the block; `w` holds nothing after. A block with no bytes is nothing to release. */
void wrap_free(PlaydateAPI *pd, wrapped *w);

/* The line after `line` in a wrapped block. */
const char *wrap_next(const char *line);

#endif
