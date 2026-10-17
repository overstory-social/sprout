/*
 * Text on the screen in two faces, both packaged into the pdx from Source/fonts/: the frame, which is
 * always Newsleak Serif Bold and draws the top and bottom lines of every screen (a title, a status,
 * a question, a caption, the keys), and the body, the font of the text size chosen (text_size.h),
 * which draws everything between them. The pen holds every font the player draws with, and a font
 * file is loaded once however many uses hold it: S's body is the frame's font, and the sentence
 * builder's disc holds its font through the pen too. A change of size loads the next body before
 * letting the last go, so a font that cannot be read leaves the pen as it was. Text is UTF-8 and is
 * drawn as written, on the reading that the C API's drawText, which takes no font family, has no bold
 * or italic to read `*` and `_` as (the design doc's The Playdate app). Widths come from the font,
 * never from a character count.
 */
#ifndef PLAYER_UI_PEN_H
#define PLAYER_UI_PEN_H

#include <stdbool.h>
#include <stddef.h>

#include "pd_api.h"
#include "text_size.h"

/* The frame's font. */
#define PLAYER_FRAME_FONT "fonts/Newsleak-Serif-Bold.pft"

/* The most font files held at once: the frame's, the body's and the disc's. */
#define PLAYER_PEN_FONTS 3

/* A font file held: loaded once, let go when its last use is. */
typedef struct pen_font {
  const char *path;
  LCDFont *font;
  int uses;
} pen_font;

typedef struct player_pen {
  PlaydateAPI *pd;
  pen_font held[PLAYER_PEN_FONTS];
  LCDFont *frame;
  LCDFont *body;
  player_text_size size;
  int line_height;  /* the body's */
  int frame_height; /* the frame's */
} player_pen;

/* Loads the frame's font and the body's of `size`; false, with the system's words in `*why`, when either cannot be. */
bool player_pen_init(player_pen *pen, PlaydateAPI *pd, player_text_size size, const char **why);

/*
 * Changes the body to the font of `size`, which every body line is measured and drawn in from now; false,
 * with the system's words in `*why` and the pen as it was, when that font cannot be read.
 */
bool player_pen_resize(player_pen *pen, player_text_size size, const char **why);

/* Lets every font go; the pen draws nothing after. */
void player_pen_free(player_pen *pen);

/*
 * The font in the file at `path`, held for the caller until the pen is freed: loaded now, or the one
 * already loaded for that file; NULL, with the system's words in `*why`, when it cannot be read.
 */
LCDFont *player_pen_hold(player_pen *pen, const char *path, const char **why);

/* The width in pixels of the `length` bytes of UTF-8 at `text` in the body; `pen` is a player_pen, as wrap.h measures. */
int player_pen_width(void *pen, const char *text, size_t length);

/* The same in the frame. */
int player_pen_frame_width(void *pen, const char *text, size_t length);

/* Draws the `length` bytes of UTF-8 at `text` in the body with its top left at (x, y). */
void player_pen_text(const player_pen *pen, const char *text, size_t length, int x, int y);

/* The same for a NUL-terminated string. */
void player_pen_say(const player_pen *pen, const char *text, int x, int y);

/* Draws the NUL-terminated `text` in the frame with its top left at (x, y). */
void player_pen_frame_say(const player_pen *pen, const char *text, int x, int y);

/* The characters in the `length` bytes of UTF-8 at `text`: what the C API's text functions count. */
size_t player_utf8_count(const char *text, size_t length);

#endif
