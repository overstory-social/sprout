/* The fake's screen: a 400 by 240 one-bit frame, the shapes drawn into it, and the fonts and the text drawn kept as runs; see fake_playdate.h. */
#include "fake.h"

#include <stdlib.h>
#include <string.h>

/* The made bitmap drawn into now, or -1 for the screen. */
int fake_context(void) { return fake_current->context_count > 0 ? fake_current->contexts[fake_current->context_count - 1] : -1; }

static void put_bit(uint8_t *bytes, int rowbytes, int x, int y, int set) {
  uint8_t *byte = &bytes[y * rowbytes + x / 8], bit = (uint8_t)(0x80u >> (x % 8));
  if (set)
    *byte |= bit;
  else
    *byte &= (uint8_t)~bit;
}

/* Sets a pixel of the context: on the screen inside the clip rect, or in a made bitmap, where it is then drawn. */
void fake_set_pixel(int x, int y, int black) {
  uint8_t *byte;
  int into = fake_context();
  if (into >= 0) {
    fake_made *made = &fake_current->made[into];
    if (x < 0 || y < 0 || x >= made->width || y >= made->height) return;
    put_bit(made->data, made->rowbytes, x, y, !black);
    if (made->mask != NULL) put_bit(made->mask, made->rowbytes, x, y, 1);
    return;
  }
  if (x < 0 || y < 0 || x >= LCD_COLUMNS || y >= LCD_ROWS) return;
  if (fake_current->clipped && (x < fake_current->clip_x || y < fake_current->clip_y || x >= fake_current->clip_x + fake_current->clip_width ||
                           y >= fake_current->clip_y + fake_current->clip_height))
    return;
  byte = &fake_current->frame[y * LCD_ROWSIZE + x / 8];
  if (black)
    *byte |= (uint8_t)(0x80u >> (x % 8));
  else
    *byte &= (uint8_t)~(0x80u >> (x % 8));
}

int fake_pixel(const fake_playdate *fake, int x, int y) {
  if (x < 0 || y < 0 || x >= LCD_COLUMNS || y >= LCD_ROWS) return 0;
  return (fake->frame[y * LCD_ROWSIZE + x / 8] >> (7 - x % 8)) & 1;
}

static void fake_clear(LCDColor color) {
  memset(fake_current->frame, color == kColorBlack ? 0xFF : 0x00, sizeof fake_current->frame);
  fake_current->run_count = 0;
  fake_current->draw_count = 0;
  fake_current->placed_count = 0;
  fake_current->ellipses = 0;
  fake_current->triangles = 0;
}

void fake_fill(int x, int y, int width, int height, LCDColor color) {
  int i, j;
  for (j = y; j < y + height; j++)
    for (i = x; i < x + width; i++) fake_set_pixel(i, j, color == kColorBlack);
}

/* A solid colour, or a pattern: 8 rows of image, a set bit white, then 8 rows of mask, a set bit painted. */
static void fake_fill_rect(int x, int y, int width, int height, LCDColor color) {
  const uint8_t *pattern = (const uint8_t *)color;
  int i, j;
  if (color <= kColorXOR) {
    fake_fill(x, y, width, height, color);
    return;
  }
  for (j = y; j < y + height; j++)
    for (i = x; i < x + width; i++) {
      int bit = 7 - ((i % 8) + 8) % 8, row = ((j % 8) + 8) % 8;
      if ((pattern[8 + row] >> bit) & 1) fake_set_pixel(i, j, !((pattern[row] >> bit) & 1));
    }
}

/* Twice the signed area of the triangle (a, b, c). */
static long turn_of(int ax, int ay, int bx, int by, int cx, int cy) {
  return (long)(bx - ax) * (cy - ay) - (long)(by - ay) * (cx - ax);
}

static void fake_fill_triangle(int x1, int y1, int x2, int y2, int x3, int y3, LCDColor color) {
  int lo_x = x1 < x2 ? (x1 < x3 ? x1 : x3) : (x2 < x3 ? x2 : x3), hi_x = x1 > x2 ? (x1 > x3 ? x1 : x3) : (x2 > x3 ? x2 : x3);
  int lo_y = y1 < y2 ? (y1 < y3 ? y1 : y3) : (y2 < y3 ? y2 : y3), hi_y = y1 > y2 ? (y1 > y3 ? y1 : y3) : (y2 > y3 ? y2 : y3);
  int x, y;
  fake_current->triangles++;
  for (y = lo_y; y <= hi_y; y++)
    for (x = lo_x; x <= hi_x; x++) {
      long a = turn_of(x1, y1, x2, y2, x, y), b = turn_of(x2, y2, x3, y3, x, y), c = turn_of(x3, y3, x1, y1, x, y);
      if ((a >= 0 && b >= 0 && c >= 0) || (a <= 0 && b <= 0 && c <= 0)) fake_set_pixel(x, y, color == kColorBlack);
    }
}

/* A line across or down `width` thick; any other a pixel wide, by Bresenham's walk. */
static void fake_draw_line(int x1, int y1, int x2, int y2, int width, LCDColor color) {
  int lo, hi, dx, dy, sx, sy, err;
  if (y1 == y2) {
    lo = x1 < x2 ? x1 : x2;
    hi = x1 < x2 ? x2 : x1;
    fake_fill(lo, y1, hi - lo + 1, width, color);
    return;
  }
  if (x1 == x2) {
    lo = y1 < y2 ? y1 : y2;
    hi = y1 < y2 ? y2 : y1;
    fake_fill(x1, lo, width, hi - lo + 1, color);
    return;
  }
  dx = x2 > x1 ? x2 - x1 : x1 - x2;
  dy = y2 > y1 ? y1 - y2 : y2 - y1;
  sx = x1 < x2 ? 1 : -1;
  sy = y1 < y2 ? 1 : -1;
  err = dx + dy;
  for (;;) {
    int twice = 2 * err;
    fake_set_pixel(x1, y1, color == kColorBlack);
    if (x1 == x2 && y1 == y2) return;
    if (twice >= dy) {
      err += dy;
      x1 += sx;
    }
    if (twice <= dx) {
      err += dx;
      y1 += sy;
    }
  }
}

/* An ellipse in the rect, stroked `width` thick inside it; only whole ones are drawn. */
static void fake_draw_ellipse(int x, int y, int width, int height, int line, float start, float end, LCDColor color) {
  double a = width / 2.0, b = height / 2.0, cx = x + a, cy = y + b, ia = a - line, ib = b - line;
  int i, j;
  if (start != end) abort();
  fake_current->ellipses++;
  for (j = y; j < y + height; j++)
    for (i = x; i < x + width; i++) {
      double px = i + 0.5 - cx, py = j + 0.5 - cy;
      int outer = px * px / (a * a) + py * py / (b * b) <= 1.0;
      int inner = ia > 0 && ib > 0 && px * px / (ia * ia) + py * py / (ib * ib) < 1.0;
      if (outer && !inner) fake_set_pixel(i, j, color == kColorBlack);
    }
}

static void fake_set_clip_rect(int x, int y, int width, int height) {
  fake_current->clipped = 1;
  fake_current->clip_x = x;
  fake_current->clip_y = y;
  fake_current->clip_width = width;
  fake_current->clip_height = height;
}

static void fake_clear_clip_rect(void) { fake_current->clipped = 0; }

/* The bytes of the first `count` UTF-8 characters of `text`, stopping at a NUL; reads nothing past them. */
static size_t utf8_bytes(const char *text, size_t count) {
  size_t i = 0, seen = 0;
  while (seen < count && text[i] != '\0') {
    unsigned char lead = (unsigned char)text[i];
    size_t n = lead < 0x80u ? 1 : lead >= 0xF0u ? 4 : lead >= 0xE0u ? 3 : lead >= 0xC0u ? 2 : 1, k;
    for (k = 1; k < n && text[i + k] != '\0'; k++) continue;
    i += k;
    seen++;
  }
  return i;
}

/* The fonts the fake loads, by path, in fake_font's order; the font a handle is, FAKE_FONT_NONE for one not held. */
static char fake_fonts[FAKE_FONTS];
static const char *const FONT_PATHS[FAKE_FONTS] = {"/System/Fonts/Asheville-Sans-14-Light.pft", "/System/Fonts/Roobert-20-Medium.pft",
                                                   "/System/Fonts/Asheville-Sans-24-Light.pft", "fonts/Asheville-Sans-24-Light.pft",
                                                   "fonts/Roobert-10-Bold.pft"};

static fake_font font_of(LCDFont *font) {
  int i;
  for (i = 0; i < FAKE_FONTS; i++)
    if (font == (LCDFont *)&fake_fonts[i] && fake_current->fonts_loaded[i]) return (fake_font)(FAKE_FONT_SYSTEM + i);
  return FAKE_FONT_NONE;
}

int fake_glyph(const fake_playdate *fake, fake_font font) {
  switch (font) {
    case FAKE_FONT_MEDIUM: return fake->medium_glyph;
    case FAKE_FONT_LARGE: return fake->large_glyph;
    case FAKE_FONT_BIG: return fake->big_glyph;
    case FAKE_FONT_SMALL: return fake->small_glyph;
    default: return fake->glyph;
  }
}

int fake_line(fake_font font) {
  switch (font) {
    case FAKE_FONT_MEDIUM: return FAKE_MEDIUM_LINE;
    case FAKE_FONT_LARGE: return FAKE_LARGE_LINE;
    case FAKE_FONT_BIG: return FAKE_BIG_LINE;
    case FAKE_FONT_SMALL: return FAKE_SMALL_LINE;
    default: return FAKE_LINE;
  }
}

int fake_fonts_held(const fake_playdate *fake) {
  int i, held = 0;
  for (i = 0; i < FAKE_FONTS; i++) held += fake->fonts_loaded[i];
  return held;
}

int fake_font_release(void *block) {
  int i;
  for (i = 0; i < FAKE_FONTS; i++) {
    if (block != (void *)&fake_fonts[i]) continue;
    if (!fake_current->fonts_loaded[i]) abort(); /* freed twice */
    fake_current->fonts_loaded[i] = 0;
    if (fake_current->font_set == (fake_font)(FAKE_FONT_SYSTEM + i)) fake_current->font_set = FAKE_FONT_NONE;
    return 1;
  }
  return 0;
}

static int fake_text_width(LCDFont *font, const void *text, size_t len, PDStringEncoding encoding, int tracking) {
  const char *bytes = (const char *)text;
  size_t n = utf8_bytes(bytes, len), i;
  int width = 0, glyph = fake_glyph(fake_current, font_of(font));
  (void)encoding;
  (void)tracking;
  if (font_of(font) == FAKE_FONT_NONE) abort();
  for (i = 0; i < n; i++)
    if (((unsigned char)bytes[i] & 0xC0u) != 0x80u) width += glyph;
  return width;
}

static int fake_draw_text(const void *text, size_t len, PDStringEncoding encoding, int x, int y) {
  const char *bytes = (const char *)text;
  size_t n = utf8_bytes(bytes, len), i;
  int at = x, glyph = fake_glyph(fake_current, fake_current->font_set), line = fake_line(fake_current->font_set);
  fake_run *run;
  (void)encoding;
  if (fake_current->font_set == FAKE_FONT_NONE) abort(); /* the screens draw in a font they loaded, never the default */
  if (fake_context() >= 0) {
    fake_made *made = &fake_current->made[fake_context()];
    if (made->run_count == FAKE_MADE_RUNS) abort();
    run = &made->runs[made->run_count++];
  } else {
    if (fake_current->run_count == FAKE_RUNS) abort();
    run = &fake_current->runs[fake_current->run_count++];
  }
  if (n >= sizeof run->text) abort();
  memcpy(run->text, bytes, n);
  run->text[n] = '\0';
  run->x = x;
  run->y = y;
  run->font = fake_current->font_set;
  for (i = 0; i < n; i++) {
    if (((unsigned char)bytes[i] & 0xC0u) == 0x80u) continue;
    if (bytes[i] != ' ') fake_fill(at + 1, y + 3, glyph - 2, line - 6, kColorBlack);
    at += glyph;
  }
  return at - x;
}

static LCDFont *fake_load_font(const char *path, const char **error) {
  int i;
  for (i = 0; i < FAKE_FONTS; i++) {
    if (strcmp(path, FONT_PATHS[i]) != 0 || strcmp(path, fake_current->missing_font) == 0) continue;
    if (fake_current->fonts_loaded[i]) abort(); /* a font is held once: the app loads the one it needs and frees the last */
    fake_current->fonts_loaded[i] = 1;
    return (LCDFont *)&fake_fonts[i];
  }
  *error = "no such font";
  return NULL;
}

static void fake_set_font(LCDFont *font) {
  if (font_of(font) == FAKE_FONT_NONE) abort(); /* a font never loaded, or freed */
  fake_current->font_set = font_of(font);
}

static uint8_t fake_font_height(LCDFont *font) {
  if (font_of(font) == FAKE_FONT_NONE) abort();
  return (uint8_t)fake_line(font_of(font));
}

const fake_run *fake_run_at(const fake_playdate *fake, int x, int y) {
  int i;
  for (i = 0; i < fake->run_count; i++)
    if (fake->runs[i].x == x && fake->runs[i].y == y) return &fake->runs[i];
  return NULL;
}

void fake_install_screen(fake_playdate *fake) {
  fake->glyph = FAKE_GLYPH;
  fake->medium_glyph = FAKE_MEDIUM_GLYPH;
  fake->large_glyph = FAKE_LARGE_GLYPH;
  fake->big_glyph = FAKE_BIG_GLYPH;
  fake->small_glyph = FAKE_SMALL_GLYPH;
  fake->gfx.clear = fake_clear;
  fake->gfx.fillRect = fake_fill_rect;
  fake->gfx.fillTriangle = fake_fill_triangle;
  fake->gfx.drawLine = fake_draw_line;
  fake->gfx.drawEllipse = fake_draw_ellipse;
  fake->gfx.setClipRect = fake_set_clip_rect;
  fake->gfx.clearClipRect = fake_clear_clip_rect;
  fake->gfx.drawText = fake_draw_text;
  fake->gfx.getTextWidth = fake_text_width;
  fake->gfx.loadFont = fake_load_font;
  fake->gfx.setFont = fake_set_font;
  fake->gfx.getFontHeight = fake_font_height;
}
