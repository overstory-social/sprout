/* Text in the frame and the body; see pen.h. */
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

LCDFont *player_pen_hold(player_pen *pen, const char *path, const char **why) {
  pen_font *free_slot = NULL;
  int i;
  for (i = 0; i < PLAYER_PEN_FONTS; i++) {
    pen_font *held = &pen->held[i];
    if (held->uses > 0 && strcmp(held->path, path) == 0) {
      held->uses++;
      return held->font;
    }
    if (held->uses == 0 && free_slot == NULL) free_slot = held;
  }
  if (free_slot == NULL) {
    *why = "the player holds every font it can";
    return NULL;
  }
  free_slot->font = load_font(pen->pd, path, why);
  if (free_slot->font == NULL) return NULL;
  free_slot->path = path;
  free_slot->uses = 1;
  return free_slot->font;
}

/* Drops one use of `font`; the file is let go with its last. */
static void let_go(player_pen *pen, LCDFont *font) {
  int i;
  for (i = 0; i < PLAYER_PEN_FONTS; i++) {
    pen_font *held = &pen->held[i];
    if (held->uses == 0 || held->font != font) continue;
    if (--held->uses == 0) {
      free_font(pen->pd, held->font);
      held->font = NULL;
      held->path = NULL;
    }
    return;
  }
}

bool player_pen_resize(player_pen *pen, player_text_size size, const char **why) {
  LCDFont *font = player_pen_hold(pen, PLAYER_TEXT_SIZE_FONTS[size], why);
  if (font == NULL) return false;
  if (pen->body != NULL) let_go(pen, pen->body);
  pen->body = font;
  pen->size = size;
  pen->line_height = pen->pd->graphics->getFontHeight(font);
  return true;
}

bool player_pen_init(player_pen *pen, PlaydateAPI *pd, player_text_size size, const char **why) {
  memset(pen, 0, sizeof *pen);
  pen->pd = pd;
  pen->frame = player_pen_hold(pen, PLAYER_FRAME_FONT, why);
  if (pen->frame == NULL) return false;
  pen->frame_height = pd->graphics->getFontHeight(pen->frame);
  if (player_pen_resize(pen, size, why)) return true;
  player_pen_free(pen);
  return false;
}

void player_pen_free(player_pen *pen) {
  int i;
  for (i = 0; i < PLAYER_PEN_FONTS; i++) {
    if (pen->held[i].uses > 0) free_font(pen->pd, pen->held[i].font);
    pen->held[i].uses = 0;
    pen->held[i].font = NULL;
    pen->held[i].path = NULL;
  }
  pen->frame = NULL;
  pen->body = NULL;
  pen->line_height = 0;
  pen->frame_height = 0;
}

size_t player_utf8_count(const char *text, size_t length) {
  size_t i, count = 0;
  for (i = 0; i < length; i++)
    if (((unsigned char)text[i] & 0xC0u) != 0x80u) count++;
  return count;
}

static int width_in(const player_pen *pen, LCDFont *font, const char *text, size_t length) {
  return pen->pd->graphics->getTextWidth(font, text, player_utf8_count(text, length), kUTF8Encoding, 0);
}

int player_pen_width(void *pen, const char *text, size_t length) {
  const player_pen *self = (const player_pen *)pen;
  return width_in(self, self->body, text, length);
}

int player_pen_frame_width(void *pen, const char *text, size_t length) {
  const player_pen *self = (const player_pen *)pen;
  return width_in(self, self->frame, text, length);
}

/* Draws in `font`, which is set first: nothing relies on the font set before. */
static void draw_in(const player_pen *pen, LCDFont *font, const char *text, size_t length, int x, int y) {
  pen->pd->graphics->setFont(font);
  pen->pd->graphics->drawText(text, player_utf8_count(text, length), kUTF8Encoding, x, y);
}

void player_pen_text(const player_pen *pen, const char *text, size_t length, int x, int y) {
  draw_in(pen, pen->body, text, length, x, y);
}

void player_pen_say(const player_pen *pen, const char *text, int x, int y) {
  draw_in(pen, pen->body, text, strlen(text), x, y);
}

void player_pen_frame_say(const player_pen *pen, const char *text, int x, int y) {
  draw_in(pen, pen->frame, text, strlen(text), x, y);
}
