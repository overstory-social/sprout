/* Text in the display font; see pen.h. */
#include "pen.h"

#include <string.h>

#include "host/stack.h"

typedef struct font_load {
  PlaydateAPI *pd;
  const char *path;
  const char *error;
} font_load;

/* The font read from its file on the main stack, where the firmware's file system is called. */
static void *load_thunk(void *ctx) {
  font_load *load = (font_load *)ctx;
  return load->pd->graphics->loadFont(load->path, &load->error);
}

/* A font from the file at `path`; NULL, with the words in `*why`, when it cannot be read. */
static LCDFont *load_font(PlaydateAPI *pd, const char *path, const char **why) {
  font_load load = {pd, path, NULL};
  LCDFont *font = (LCDFont *)player_on_main_stack(load_thunk, &load);
  if (font == NULL) *why = load.error != NULL ? load.error : "the font could not be loaded";
  return font;
}

/* Lets `font` go, as the C API frees a font: through the system's allocator. */
static void free_font(PlaydateAPI *pd, LCDFont *font) {
  pd->system->realloc(font, 0);
}

bool player_pen_resize(player_pen *pen, player_text_size size, const char **why) {
  LCDFont *font = load_font(pen->pd, PLAYER_TEXT_SIZE_FONTS[size], why);
  if (font == NULL) return false;
  if (pen->font != NULL) free_font(pen->pd, pen->font);
  pen->font = font;
  pen->size = size;
  pen->pd->graphics->setFont(font);
  pen->line_height = pen->pd->graphics->getFontHeight(font);
  return true;
}

bool player_pen_init(player_pen *pen, PlaydateAPI *pd, player_text_size size, const char **why) {
  memset(pen, 0, sizeof *pen);
  pen->pd = pd;
  return player_pen_resize(pen, size, why);
}

void player_pen_free(player_pen *pen) {
  if (pen->font != NULL) free_font(pen->pd, pen->font);
  pen->font = NULL;
  pen->line_height = 0;
}

size_t player_utf8_count(const char *text, size_t length) {
  size_t i, count = 0;
  for (i = 0; i < length; i++)
    if (((unsigned char)text[i] & 0xC0u) != 0x80u) count++;
  return count;
}

int player_pen_width(void *pen, const char *text, size_t length) {
  player_pen *self = (player_pen *)pen;
  return self->pd->graphics->getTextWidth(self->font, text, player_utf8_count(text, length), kUTF8Encoding, 0);
}

void player_pen_text(const player_pen *pen, const char *text, size_t length, int x, int y) {
  pen->pd->graphics->drawText(text, player_utf8_count(text, length), kUTF8Encoding, x, y);
}

void player_pen_say(const player_pen *pen, const char *text, int x, int y) {
  player_pen_text(pen, text, strlen(text), x, y);
}
