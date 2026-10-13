/* A PlaydateAPI over the desktop; see fake_playdate.h. */
#include "fake_playdate.h"

#include <stdarg.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/stat.h>
#include <unistd.h>

static fake_playdate *current;

/* ---- the system ---- */

static void *fake_realloc(void *block, size_t bytes) {
  if (bytes == 0) {
    if (block != NULL) current->pages--;
    free(block);
    return NULL;
  }
  if (block == NULL) current->pages++;
  if (bytes > current->largest) current->largest = bytes;
  return realloc(block, bytes);
}

static unsigned fake_seconds(unsigned *milliseconds) {
  if (milliseconds != NULL) *milliseconds = current->milliseconds;
  return current->seconds;
}

static unsigned fake_counter(void) { return current->counter += 3; }

static void fake_log(const char *format, ...) {
  va_list args;
  va_start(args, format);
  vfprintf(stderr, format, args);
  fputc('\n', stderr);
  va_end(args);
}

/* ---- the files ---- */

static void joined(char *out, size_t size, const char *folder, const char *path) {
  snprintf(out, size, "%s/%s", folder, path);
}

static SDFile *fake_open(const char *path, FileOptions mode) {
  char full[1100];
  FILE *file = NULL;
  if (mode & kFileWrite) {
    if (current->fail_writes) return NULL;
    joined(full, sizeof full, current->data, path);
    return fopen(full, "wb");
  }
  if (mode & kFileReadData) {
    joined(full, sizeof full, current->data, path);
    file = fopen(full, "rb");
  }
  if (file == NULL && (mode & kFileRead)) {
    joined(full, sizeof full, current->app, path);
    file = fopen(full, "rb");
  }
  return file;
}

static int fake_close(SDFile *file) { return fclose((FILE *)file); }

static int fake_read(SDFile *file, void *buffer, unsigned length) {
  return (int)fread(buffer, 1, length, (FILE *)file);
}

static int fake_write(SDFile *file, const void *buffer, unsigned length) {
  return (int)fwrite(buffer, 1, length, (FILE *)file);
}

static int fake_mkdir(const char *path) {
  char full[1100];
  joined(full, sizeof full, current->data, path);
  return mkdir(full, 0777);
}

static int fake_unlink(const char *path, int recursive) {
  char full[1100];
  (void)recursive;
  joined(full, sizeof full, current->data, path);
  return unlink(full);
}

static int fake_rename(const char *from, const char *to) {
  char a[1100], b[1100];
  joined(a, sizeof a, current->data, from);
  joined(b, sizeof b, current->data, to);
  return rename(a, b);
}

static int fake_listfiles(const char *path, void (*callback)(const char *path, void *userdata), void *userdata,
                          int showhidden) {
  char full[1100], line[1200];
  const char *folders[2];
  int i, listed = 0;
  (void)showhidden;
  folders[0] = current->app;
  folders[1] = current->data;
  for (i = 0; i < 2; i++) {
    FILE *names;
    snprintf(full, sizeof full, "ls -1Ap '%s/%s' 2>/dev/null", folders[i], path);
    names = popen(full, "r");
    if (names == NULL) continue;
    while (fgets(line, sizeof line, names) != NULL) {
      line[strcspn(line, "\n")] = '\0';
      if (line[0] == '\0' || line[0] == '.') continue;
      callback(line, userdata);
      listed = 1;
    }
    if (pclose(names) == 0) listed = 1;
  }
  return listed ? 0 : -1;
}

/* ---- the screen ---- */

static void set_pixel(int x, int y, int black) {
  uint8_t *byte;
  if (x < 0 || y < 0 || x >= LCD_COLUMNS || y >= LCD_ROWS) return;
  byte = &current->frame[y * LCD_ROWSIZE + x / 8];
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
  memset(current->frame, color == kColorBlack ? 0xFF : 0x00, sizeof current->frame);
  current->run_count = 0;
}

static void fill(int x, int y, int width, int height, LCDColor color) {
  int i, j;
  for (j = y; j < y + height; j++)
    for (i = x; i < x + width; i++) set_pixel(i, j, color == kColorBlack);
}

/* A solid colour, or a pattern: 8 rows of image, a set bit white, then 8 rows of mask, a set bit painted. */
static void fake_fill_rect(int x, int y, int width, int height, LCDColor color) {
  const uint8_t *pattern = (const uint8_t *)color;
  int i, j;
  if (color <= kColorXOR) {
    fill(x, y, width, height, color);
    return;
  }
  for (j = y; j < y + height; j++)
    for (i = x; i < x + width; i++) {
      int bit = 7 - ((i % 8) + 8) % 8, row = ((j % 8) + 8) % 8;
      if ((pattern[8 + row] >> bit) & 1) set_pixel(i, j, !((pattern[row] >> bit) & 1));
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
  for (y = lo_y; y <= hi_y; y++)
    for (x = lo_x; x <= hi_x; x++) {
      long a = turn_of(x1, y1, x2, y2, x, y), b = turn_of(x2, y2, x3, y3, x, y), c = turn_of(x3, y3, x1, y1, x, y);
      if ((a >= 0 && b >= 0 && c >= 0) || (a <= 0 && b <= 0 && c <= 0)) set_pixel(x, y, color == kColorBlack);
    }
}

/* Lines across or down the screen, which is all the screens draw. */
static void fake_draw_line(int x1, int y1, int x2, int y2, int width, LCDColor color) {
  int lo, hi;
  if (y1 == y2) {
    lo = x1 < x2 ? x1 : x2;
    hi = x1 < x2 ? x2 : x1;
    fill(lo, y1, hi - lo + 1, width, color);
  } else if (x1 == x2) {
    lo = y1 < y2 ? y1 : y2;
    hi = y1 < y2 ? y2 : y1;
    fill(x1, lo, width, hi - lo + 1, color);
  } else {
    abort();
  }
}

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

/* The three fonts the fake loads, by path; the font a handle is. */
static char fake_fonts[3];
static const char *const FONT_PATHS[3] = {"/System/Fonts/Asheville-Sans-14-Light.pft", "fonts/Asheville-Sans-24-Light.pft",
                                          "fonts/Roobert-10-Bold.pft"};

static fake_font font_of(LCDFont *font) {
  int i;
  for (i = 0; i < 3; i++)
    if (font == (LCDFont *)&fake_fonts[i]) return (fake_font)(FAKE_FONT_SYSTEM + i);
  return FAKE_FONT_NONE;
}

int fake_glyph(const fake_playdate *fake, fake_font font) {
  return font == FAKE_FONT_BIG ? fake->big_glyph : font == FAKE_FONT_SMALL ? fake->small_glyph : fake->glyph;
}

int fake_line(fake_font font) { return font == FAKE_FONT_BIG ? FAKE_BIG_LINE : font == FAKE_FONT_SMALL ? FAKE_SMALL_LINE : FAKE_LINE; }

static int fake_text_width(LCDFont *font, const void *text, size_t len, PDStringEncoding encoding, int tracking) {
  const char *bytes = (const char *)text;
  size_t n = utf8_bytes(bytes, len), i;
  int width = 0, glyph = fake_glyph(current, font_of(font));
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
  int at = x, glyph = fake_glyph(current, current->font_set), line = fake_line(current->font_set);
  fake_run *run;
  (void)encoding;
  if (current->font_set == FAKE_FONT_NONE) abort(); /* the screens draw in a font they loaded, never the default */
  if (current->run_count == FAKE_RUNS) abort();
  run = &current->runs[current->run_count++];
  if (n >= sizeof run->text) abort();
  memcpy(run->text, bytes, n);
  run->text[n] = '\0';
  run->x = x;
  run->y = y;
  run->font = current->font_set;
  for (i = 0; i < n; i++) {
    if (((unsigned char)bytes[i] & 0xC0u) == 0x80u) continue;
    if (bytes[i] != ' ') fill(at + 1, y + 3, glyph - 2, line - 6, kColorBlack);
    at += glyph;
  }
  return at - x;
}

static LCDFont *fake_load_font(const char *path, const char **error) {
  int i;
  for (i = 0; i < 3; i++)
    if (strcmp(path, FONT_PATHS[i]) == 0) return (LCDFont *)&fake_fonts[i];
  *error = "no such font";
  return NULL;
}

static void fake_set_font(LCDFont *font) { current->font_set = font_of(font); }

static uint8_t fake_font_height(LCDFont *font) { return (uint8_t)fake_line(font_of(font)); }

const fake_run *fake_run_at(const fake_playdate *fake, int x, int y) {
  int i;
  for (i = 0; i < fake->run_count; i++)
    if (fake->runs[i].x == x && fake->runs[i].y == y) return &fake->runs[i];
  return NULL;
}

/* ---- the input ---- */

static void fake_buttons(PDButtons *held, PDButtons *pushed, PDButtons *released) {
  *held = current->buttons_held;
  *pushed = current->buttons_pushed;
  *released = 0;
}

static float fake_crank_change(void) { return current->crank; }
static int fake_crank_docked(void) { return current->docked; }

static void fake_set_update(PDCallbackFunction *update, void *userdata) {
  current->update = update;
  current->update_ctx = userdata;
}

int fake_frame(fake_playdate *fake, PDButtons pushed, float crank) {
  int shown;
  current = fake;
  if (fake->update == NULL) abort();
  fake->buttons_pushed = pushed;
  fake->buttons_held = pushed;
  fake->crank = crank;
  shown = fake->update(fake->update_ctx);
  fake->buttons_pushed = fake->buttons_held = 0;
  fake->crank = 0;
  return shown;
}

/* ---- Lua ---- */

static int fake_add_function(lua_CFunction function, const char *name, const char **error) {
  (void)error;
  if (current->function_count == FAKE_FUNCTIONS) return 0;
  current->names[current->function_count] = name;
  current->functions[current->function_count++] = function;
  return 1;
}

static const char *fake_arg_string(int position) {
  return position >= 1 && position <= current->arg_count ? current->args[position - 1] : NULL;
}

static void fake_push_string(const char *text) {
  if (strlen(text) >= sizeof current->pushed) abort();
  snprintf(current->pushed, sizeof current->pushed, "%s", text);
  current->push_count++;
}

void fake_init(fake_playdate *fake, const char *data, const char *app) {
  memset(fake, 0, sizeof *fake);
  current = fake;
  snprintf(fake->data, sizeof fake->data, "%s", data);
  snprintf(fake->app, sizeof fake->app, "%s", app);
  fake->seconds = 1000000;
  fake->glyph = FAKE_GLYPH;
  fake->big_glyph = FAKE_BIG_GLYPH;
  fake->small_glyph = FAKE_SMALL_GLYPH;
  fake->sys.realloc = fake_realloc;
  fake->sys.getSecondsSinceEpoch = fake_seconds;
  fake->sys.getCurrentTimeMilliseconds = fake_counter;
  fake->sys.logToConsole = fake_log;
  fake->sys.error = fake_log;
  fake->file.open = fake_open;
  fake->file.close = fake_close;
  fake->file.read = fake_read;
  fake->file.write = fake_write;
  fake->file.mkdir = fake_mkdir;
  fake->file.unlink = fake_unlink;
  fake->file.rename = fake_rename;
  fake->file.listfiles = fake_listfiles;
  fake->sys.getButtonState = fake_buttons;
  fake->sys.getCrankChange = fake_crank_change;
  fake->sys.isCrankDocked = fake_crank_docked;
  fake->sys.setUpdateCallback = fake_set_update;
  fake->gfx.clear = fake_clear;
  fake->gfx.fillRect = fake_fill_rect;
  fake->gfx.fillTriangle = fake_fill_triangle;
  fake->gfx.drawLine = fake_draw_line;
  fake->gfx.drawText = fake_draw_text;
  fake->gfx.getTextWidth = fake_text_width;
  fake->gfx.loadFont = fake_load_font;
  fake->gfx.setFont = fake_set_font;
  fake->gfx.getFontHeight = fake_font_height;
  fake->lua.addFunction = fake_add_function;
  fake->lua.getArgString = fake_arg_string;
  fake->lua.pushString = fake_push_string;
  fake->api.system = &fake->sys;
  fake->api.file = &fake->file;
  fake->api.lua = &fake->lua;
  fake->api.graphics = &fake->gfx;
}

const char *fake_call_with(fake_playdate *fake, const char *name, int count, const char *const *arguments) {
  int i, a;
  current = fake;
  for (i = 0; i < fake->function_count; i++) {
    if (strcmp(fake->names[i], name) != 0) continue;
    fake->arg_count = count;
    for (a = 0; a < count && a < FAKE_ARGS; a++) fake->args[a] = arguments[a];
    fake->push_count = 0;
    if (fake->functions[i](NULL) != 1 || fake->push_count != 1) return NULL;
    return fake->pushed;
  }
  return NULL;
}

const char *fake_call(fake_playdate *fake, const char *name, const char *argument) {
  return fake_call_with(fake, name, argument == NULL ? 0 : 1, &argument);
}
