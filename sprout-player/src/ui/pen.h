/*
 * Text on the screen in the display font: one of the system's own fonts (text_size.h), which the
 * C API loads from the system's fonts by path (it has no call that hands back the system font).
 * The pen holds one loaded font at a time; a change of size loads the next before letting the
 * last go, so a font that cannot be read leaves the pen as it was. Text is UTF-8 and is drawn as
 * written, on the reading that the C API's drawText, which takes no font family, has no bold or
 * italic to read `*` and `_` as (the design doc's The Playdate app). Widths come from the font, never
 * from a character count.
 */
#ifndef PLAYER_UI_PEN_H
#define PLAYER_UI_PEN_H

#include <stdbool.h>
#include <stddef.h>

#include "pd_api.h"
#include "text_size.h"

typedef struct player_pen {
  PlaydateAPI *pd;
  LCDFont *font;
  player_text_size size;
  int line_height;
} player_pen;

/* Loads the font of `size`; false, with the system's words in `*why`, when it cannot be. */
bool player_pen_init(player_pen *pen, PlaydateAPI *pd, player_text_size size, const char **why);

/*
 * Changes the pen to the font of `size`, which every line is measured and drawn in from now; false,
 * with the system's words in `*why` and the pen as it was, when that font cannot be read.
 */
bool player_pen_resize(player_pen *pen, player_text_size size, const char **why);

/* Lets the font go; the pen draws nothing after. */
void player_pen_free(player_pen *pen);

/* The width in pixels of the `length` bytes of UTF-8 at `text`; `pen` is a player_pen, as wrap.h measures. */
int player_pen_width(void *pen, const char *text, size_t length);

/* Draws the `length` bytes of UTF-8 at `text` with its top left at (x, y). */
void player_pen_text(const player_pen *pen, const char *text, size_t length, int x, int y);

/* The same for a NUL-terminated string. */
void player_pen_say(const player_pen *pen, const char *text, int x, int y);

/* The characters in the `length` bytes of UTF-8 at `text`: what the C API's text functions count. */
size_t player_utf8_count(const char *text, size_t length);

#endif
