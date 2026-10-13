/* Text in the system font; see pen.h. */
#include "pen.h"

#include <string.h>

bool player_pen_init(player_pen *pen, PlaydateAPI *pd, const char **why) {
  const char *error = NULL;
  pen->pd = pd;
  pen->font = pd->graphics->loadFont(PLAYER_SYSTEM_FONT, &error);
  if (pen->font == NULL) {
    *why = error != NULL ? error : "the system font could not be loaded";
    return false;
  }
  pd->graphics->setFont(pen->font);
  pen->line_height = pd->graphics->getFontHeight(pen->font);
  return true;
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
