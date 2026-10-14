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

/* Adds a line to the file log, while there is room for it. */
static void log_file(const char *verb, const char *a, const char *b) {
  size_t used = strlen(current->file_log);
  snprintf(current->file_log + used, sizeof current->file_log - used, "%s %s%s%s\n", verb, a, b != NULL ? " " : "",
           b != NULL ? b : "");
}

static SDFile *fake_open(const char *path, FileOptions mode) {
  char full[1100];
  FILE *file = NULL;
  if (mode & kFileWrite) {
    if (current->fail_writes) return NULL;
    log_file("write", path, NULL);
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
  current->reads++;
  if (length > current->read_largest) current->read_largest = length;
  if (current->fail_reads) return -1;
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
  char full[1100], command[1200];
  log_file("unlink", path, NULL);
  joined(full, sizeof full, current->data, path);
  if (unlink(full) == 0) return 0;
  if (!recursive || strchr(full, '\'') != NULL) return -1;
  snprintf(command, sizeof command, "rm -rf '%s' 2>/dev/null", full);
  return system(command) == 0 ? 0 : -1;
}

static int fake_rename(const char *from, const char *to) {
  char a[1100], b[1100];
  log_file("rename", from, to);
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
  current->draw_count = 0;
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

/* ---- bitmaps ---- */

static int bitmap_of(LCDBitmap *bitmap) {
  int index = (int)((fake_bitmap *)bitmap - current->bitmaps);
  if (index < 0 || index >= current->bitmap_count || !current->bitmaps[index].live) abort();
  return index;
}

/* The size a PNG's header declares, from the file at `path` or `path`.pdi where the game would look. */
static LCDBitmap *fake_load_bitmap(const char *path, const char **error) {
  char compiled[600];
  unsigned char head[24];
  static const unsigned char SIGNATURE[8] = {0x89, 'P', 'N', 'G', '\r', '\n', 0x1A, '\n'};
  SDFile *file = fake_open(path, kFileRead | kFileReadData);
  fake_bitmap *bitmap;
  int got;
  if (file == NULL) {
    snprintf(compiled, sizeof compiled, "%s.pdi", path);
    file = fake_open(compiled, kFileRead | kFileReadData);
  }
  if (file == NULL) {
    *error = "no such image";
    return NULL;
  }
  got = fake_read(file, head, sizeof head);
  fake_close(file);
  if (got != (int)sizeof head || memcmp(head, SIGNATURE, sizeof SIGNATURE) != 0) {
    *error = "not an image the fake reads";
    return NULL;
  }
  if (current->bitmap_count == FAKE_BITMAPS) abort();
  bitmap = &current->bitmaps[current->bitmap_count++];
  bitmap->live = 1;
  snprintf(bitmap->path, sizeof bitmap->path, "%s", path);
  bitmap->width = (int)((unsigned)head[16] << 24 | (unsigned)head[17] << 16 | (unsigned)head[18] << 8 | head[19]);
  bitmap->height = (int)((unsigned)head[20] << 24 | (unsigned)head[21] << 16 | (unsigned)head[22] << 8 | head[23]);
  current->bitmaps_live++;
  return (LCDBitmap *)bitmap;
}

static void fake_free_bitmap(LCDBitmap *bitmap) {
  current->bitmaps[bitmap_of(bitmap)].live = 0;
  current->bitmaps_live--;
}

static void fake_bitmap_data(LCDBitmap *bitmap, int *width, int *height, int *rowbytes, uint8_t **mask, uint8_t **data) {
  const fake_bitmap *held = &current->bitmaps[bitmap_of(bitmap)];
  if (width != NULL) *width = held->width;
  if (height != NULL) *height = held->height;
  if (rowbytes != NULL) *rowbytes = (held->width + 7) / 8;
  if (mask != NULL) *mask = NULL;
  if (data != NULL) *data = NULL;
}

static void drawn_at(LCDBitmap *bitmap, int x, int y, float scale) {
  int index = bitmap_of(bitmap);
  fake_draw *draw;
  if (current->draw_count == FAKE_DRAWS) abort();
  draw = &current->draws[current->draw_count++];
  draw->bitmap = index;
  draw->x = x;
  draw->y = y;
  draw->scale = scale;
  fill(x, y, (int)((float)current->bitmaps[index].width * scale), (int)((float)current->bitmaps[index].height * scale),
       kColorBlack);
}

static void fake_draw_bitmap(LCDBitmap *bitmap, int x, int y, LCDBitmapFlip flip) {
  if (flip != kBitmapUnflipped) abort();
  drawn_at(bitmap, x, y, 1.0f);
}

static void fake_draw_scaled_bitmap(LCDBitmap *bitmap, int x, int y, float xscale, float yscale) {
  if (xscale != yscale) abort();
  drawn_at(bitmap, x, y, xscale);
}

/* ---- sound ---- */

static int synth_of(PDSynth *synth) {
  int index = (int)((fake_synth *)synth - current->synths);
  if (index < 0 || index >= current->synth_count || !current->synths[index].live) abort();
  return index;
}

static PDSynth *fake_new_synth(void) {
  fake_synth *synth;
  if (current->synth_count == FAKE_SYNTHS) return NULL;
  synth = &current->synths[current->synth_count++];
  memset(synth, 0, sizeof *synth);
  synth->live = 1;
  return (PDSynth *)synth;
}

static void fake_free_synth(PDSynth *synth) { current->synths[synth_of(synth)].live = 0; }
static void fake_set_waveform(PDSynth *synth, SoundWaveform wave) { current->synths[synth_of(synth)].wave = wave; }
static void fake_set_attack(PDSynth *synth, float time) { current->synths[synth_of(synth)].attack = time; }
static void fake_set_decay(PDSynth *synth, float time) { current->synths[synth_of(synth)].decay = time; }
static void fake_set_sustain(PDSynth *synth, float level) { current->synths[synth_of(synth)].sustain = level; }
static void fake_set_release(PDSynth *synth, float time) { current->synths[synth_of(synth)].release = time; }

static void fake_play_note(PDSynth *synth, float pitch, float volume, float length, uint32_t when) {
  int index = synth_of(synth);
  fake_note *note;
  if (when != 0) abort(); /* a cue sounds now */
  if (current->note_count == FAKE_NOTES) return;
  note = &current->notes[current->note_count++];
  note->synth = index;
  note->wave = current->synths[index].wave;
  note->pitch = pitch;
  note->volume = volume;
  note->length = length;
}

/* ---- the network ---- */

static fake_connection *connection_of(HTTPConnection *conn) {
  fake_connection *c = (fake_connection *)conn;
  int index = (int)(c - current->connections);
  if (index < 0 || index >= current->connection_count || !c->live) abort();
  return c;
}

fake_answer *fake_serve(fake_playdate *fake, const char *url, int status, const char *body, size_t length) {
  fake_answer *answer;
  if (fake->answer_count == FAKE_ANSWERS) abort();
  answer = &fake->answers[fake->answer_count++];
  memset(answer, 0, sizeof *answer);
  snprintf(answer->url, sizeof answer->url, "%s", url);
  answer->status = status;
  answer->body = body;
  answer->length = length;
  return answer;
}

static WifiStatus fake_wifi_status(void) { return current->wifi; }

static void fake_set_enabled(bool flag, void (*callback)(PDNetErr err)) {
  current->wifi_enabled = flag;
  if (flag && callback != NULL) callback(NET_OK);
}

static enum accessReply fake_request_access(const char *server, int port, bool usessl, const char *purpose,
                                            AccessRequestCallback *callback, void *userdata) {
  (void)server;
  (void)port;
  (void)usessl;
  current->asks++;
  snprintf(current->asked_purpose, sizeof current->asked_purpose, "%s", purpose != NULL ? purpose : "");
  if (current->access == kAccessAsk) {
    current->asked_pending = 1;
    current->ask_callback = callback;
    current->ask_userdata = userdata;
  }
  return current->access;
}

static int access_given(void) {
  return current->access == kAccessAllow || (current->access == kAccessAsk && current->allow_when_asked);
}

static HTTPConnection *fake_new_connection(const char *server, int port, bool usessl) {
  fake_connection *c;
  if (!access_given()) return NULL;
  if (current->connection_count == FAKE_CONNECTIONS) abort();
  c = &current->connections[current->connection_count++];
  memset(c, 0, sizeof *c);
  c->live = 1;
  snprintf(c->server, sizeof c->server, "%s", server);
  c->port = port;
  c->ssl = usessl;
  current->connections_live++;
  return (HTTPConnection *)c;
}

static HTTPConnection *fake_retain(HTTPConnection *conn) { return conn; }

static void fake_release(HTTPConnection *conn) {
  connection_of(conn)->live = 0;
  current->connections_live--;
}

static void fake_set_connect_timeout(HTTPConnection *conn, int ms) {
  connection_of(conn);
  if (ms <= 0) abort();
}

static void fake_set_userdata(HTTPConnection *conn, void *userdata) { connection_of(conn)->userdata = userdata; }
static void *fake_get_userdata(HTTPConnection *conn) { return connection_of(conn)->userdata; }

static void fake_on_header(HTTPConnection *conn, HTTPHeaderCallback *callback) { connection_of(conn)->on_header = callback; }
static void fake_on_complete(HTTPConnection *conn, HTTPConnectionCallback *callback) {
  connection_of(conn)->on_complete = callback;
}
static void fake_on_closed(HTTPConnection *conn, HTTPConnectionCallback *callback) { connection_of(conn)->on_closed = callback; }

static PDNetErr fake_get(HTTPConnection *conn, const char *path, const char *headers, size_t headerlen) {
  fake_connection *c = connection_of(conn);
  char url[1100];
  int i;
  (void)headers;
  (void)headerlen;
  if (c->answer != NULL) abort(); /* one request a connection */
  snprintf(c->path, sizeof c->path, "%s", path);
  if (c->port == (c->ssl ? 443 : 80))
    snprintf(url, sizeof url, "%s://%s%s", c->ssl ? "https" : "http", c->server, path);
  else
    snprintf(url, sizeof url, "%s://%s:%d%s", c->ssl ? "https" : "http", c->server, c->port, path);
  for (i = 0; i < current->answer_count; i++)
    if (strcmp(current->answers[i].url, url) == 0) c->answer = &current->answers[i];
  if (c->answer == NULL) {
    snprintf(c->missing.url, sizeof c->missing.url, "%s", url);
    c->missing.status = 404;
    c->missing.body = "";
    c->answer = &c->missing;
  }
  return NET_OK;
}

static PDNetErr fake_get_error(HTTPConnection *conn) {
  connection_of(conn);
  return NET_OK;
}

static int fake_response_status(HTTPConnection *conn) {
  fake_connection *c = connection_of(conn);
  return c->answer != NULL && (c->sent > 0 || c->complete) ? c->answer->status : 0;
}

static size_t fake_bytes_available(HTTPConnection *conn) {
  fake_connection *c = connection_of(conn);
  return c->sent - c->read;
}

static int fake_net_read(HTTPConnection *conn, void *buffer, unsigned int length) {
  fake_connection *c = connection_of(conn);
  size_t n = c->sent - c->read;
  if (length < n) n = length;
  if (n > 0) memcpy(buffer, c->answer->body + c->read, n);
  c->read += n;
  return (int)n;
}

static void fake_net_close(HTTPConnection *conn) { connection_of(conn); }

void fake_network_step(fake_playdate *fake) {
  int i;
  current = fake;
  if (fake->asked_pending) {
    fake->asked_pending = 0;
    fake->ask_callback(fake->allow_when_asked != 0, fake->ask_userdata);
  }
  for (i = 0; i < fake->connection_count; i++) {
    fake_connection *c = &fake->connections[i];
    size_t piece;
    if (!c->live || c->answer == NULL || c->complete || c->answer->silent) continue;
    if (c->sent == 0 && c->answer->location != NULL && c->on_header != NULL)
      c->on_header((HTTPConnection *)c, "Location", c->answer->location);
    piece = c->answer->length - c->sent < fake->piece ? c->answer->length - c->sent : fake->piece;
    c->sent += piece;
    if (c->sent == c->answer->length) {
      c->complete = 1;
      if (c->on_complete != NULL) c->on_complete((HTTPConnection *)c);
    }
  }
}

/* ---- the input ---- */

static void fake_buttons(PDButtons *held, PDButtons *pushed, PDButtons *released) {
  *held = current->buttons_held;
  *pushed = current->buttons_pushed;
  *released = 0;
}

static float fake_crank_change(void) { return current->crank; }
static int fake_crank_docked(void) { return current->docked; }

static PDMenuItem *fake_add_menu_item(const char *title, PDMenuItemCallbackFunction *callback, void *userdata) {
  int i;
  for (i = 0; i < FAKE_MENU_ITEMS; i++) {
    fake_menu_item *item = &current->menu[i];
    if (item->title[0] != '\0') continue;
    snprintf(item->title, sizeof item->title, "%s", title);
    item->callback = callback;
    item->ctx = userdata;
    return (PDMenuItem *)item;
  }
  return NULL;
}

static void fake_remove_menu_item(PDMenuItem *item) {
  int i;
  for (i = 0; i < FAKE_MENU_ITEMS; i++)
    if (item == (PDMenuItem *)&current->menu[i]) current->menu[i].title[0] = '\0';
}

static const fake_menu_item *menu_item(const fake_playdate *fake, const char *title) {
  int i;
  for (i = 0; i < FAKE_MENU_ITEMS; i++)
    if (fake->menu[i].title[0] != '\0' && strcmp(fake->menu[i].title, title) == 0) return &fake->menu[i];
  return NULL;
}

int fake_menu(fake_playdate *fake, const char *title) {
  const fake_menu_item *item = menu_item(fake, title);
  if (item == NULL) return 0;
  item->callback(item->ctx);
  return 1;
}

int fake_menu_holds(const fake_playdate *fake, const char *title) {
  return menu_item(fake, title) != NULL;
}

int fake_menu_count(const fake_playdate *fake) {
  int i, count = 0;
  for (i = 0; i < FAKE_MENU_ITEMS; i++) count += fake->menu[i].title[0] != '\0';
  return count;
}

static void fake_set_update(PDCallbackFunction *update, void *userdata) {
  current->update = update;
  current->update_ctx = userdata;
}

int fake_frame(fake_playdate *fake, PDButtons pushed, float crank) {
  int shown;
  current = fake;
  if (fake->update == NULL) abort();
  fake_network_step(fake);
  fake->buttons_pushed = pushed;
  fake->buttons_held = pushed;
  fake->crank = crank;
  shown = fake->update(fake->update_ctx);
  fake->buttons_pushed = fake->buttons_held = 0;
  fake->crank = 0;
  return shown;
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
  fake->sys.addMenuItem = fake_add_menu_item;
  fake->sys.removeMenuItem = fake_remove_menu_item;
  fake->gfx.clear = fake_clear;
  fake->gfx.fillRect = fake_fill_rect;
  fake->gfx.fillTriangle = fake_fill_triangle;
  fake->gfx.drawLine = fake_draw_line;
  fake->gfx.drawText = fake_draw_text;
  fake->gfx.getTextWidth = fake_text_width;
  fake->gfx.loadFont = fake_load_font;
  fake->gfx.setFont = fake_set_font;
  fake->gfx.getFontHeight = fake_font_height;
  fake->gfx.loadBitmap = fake_load_bitmap;
  fake->gfx.freeBitmap = fake_free_bitmap;
  fake->gfx.getBitmapData = fake_bitmap_data;
  fake->gfx.drawBitmap = fake_draw_bitmap;
  fake->gfx.drawScaledBitmap = fake_draw_scaled_bitmap;
  fake->synth.newSynth = fake_new_synth;
  fake->synth.freeSynth = fake_free_synth;
  fake->synth.setWaveform = fake_set_waveform;
  fake->synth.setAttackTime = fake_set_attack;
  fake->synth.setDecayTime = fake_set_decay;
  fake->synth.setSustainLevel = fake_set_sustain;
  fake->synth.setReleaseTime = fake_set_release;
  fake->synth.playNote = fake_play_note;
  fake->sound.synth = &fake->synth;
  fake->wifi = kWifiConnected;
  fake->access = kAccessAllow;
  fake->piece = 1024;
  fake->network.http = &fake->http;
  fake->network.getStatus = fake_wifi_status;
  fake->network.setEnabled = fake_set_enabled;
  fake->http.requestAccess = fake_request_access;
  fake->http.newConnection = fake_new_connection;
  fake->http.retain = fake_retain;
  fake->http.release = fake_release;
  fake->http.setConnectTimeout = fake_set_connect_timeout;
  fake->http.setUserdata = fake_set_userdata;
  fake->http.getUserdata = fake_get_userdata;
  fake->http.get = fake_get;
  fake->http.getError = fake_get_error;
  fake->http.getResponseStatus = fake_response_status;
  fake->http.getBytesAvailable = fake_bytes_available;
  fake->http.read = fake_net_read;
  fake->http.close = fake_net_close;
  fake->http.setHeaderReceivedCallback = fake_on_header;
  fake->http.setRequestCompleteCallback = fake_on_complete;
  fake->http.setConnectionClosedCallback = fake_on_closed;
  fake->api.network = &fake->network;
  fake->api.system = &fake->sys;
  fake->api.file = &fake->file;
  fake->api.graphics = &fake->gfx;
  fake->api.sound = &fake->sound;
}
