/*
 * A PlaydateAPI with only the functions the glue and the screens call, so both are exercised
 * without the SDK's runtime: a clock a test sets, a Data folder and an app folder on the
 * desktop's disk, a Lua stack that holds the arguments a test passes and the strings the glue
 * pushes back, and a screen: graphics that draw into a 400 by 240 one-bit frame, as the
 * Simulator's is, with the text drawn kept as runs, and buttons and a crank a test sets. Three
 * fonts load: the system font, `glyph` pixels a character (FAKE_GLYPH unless a test says
 * otherwise) and FAKE_LINE tall, and the sentence builder's big and small fonts from the pdx's
 * fonts/; a character is drawn as a block. A pattern fill paints what its mask lets through, aligned
 * to the screen as the device's is. The SDK's headers are the declarations; nothing of the SDK is linked.
 */
#ifndef FAKE_PLAYDATE_H
#define FAKE_PLAYDATE_H

#include "pd_api.h"

#define FAKE_ARGS 4
#define FAKE_FUNCTIONS 16
#define FAKE_RUNS 128
#define FAKE_GLYPH 7
#define FAKE_LINE 18
#define FAKE_BIG_GLYPH 12
#define FAKE_BIG_LINE 30
#define FAKE_SMALL_GLYPH 5
#define FAKE_SMALL_LINE 12

/* The fonts the fake loads; a run says which it was drawn in. */
typedef enum fake_font { FAKE_FONT_NONE, FAKE_FONT_SYSTEM, FAKE_FONT_BIG, FAKE_FONT_SMALL } fake_font;

/* One drawText call: its text, where its top left was, and its font. */
typedef struct fake_run {
  char text[512];
  int x, y;
  fake_font font;
} fake_run;

typedef struct fake_playdate {
  PlaydateAPI api;
  struct playdate_sys sys;
  struct playdate_file file;
  struct playdate_lua lua;
  struct playdate_graphics gfx;
  /* the clock: seconds since 2000 and the millisecond counter */
  unsigned seconds, milliseconds, counter;
  /* where kFileWrite and kFileReadData go, and where kFileRead looks */
  char data[512], app[512];
  /* the Lua stack */
  const char *args[FAKE_ARGS];
  int arg_count;
  char pushed[1 << 19];
  int push_count;
  /* what addFunction was given */
  const char *names[FAKE_FUNCTIONS];
  lua_CFunction functions[FAKE_FUNCTIONS];
  int function_count;
  int pages;
  size_t largest; /* the largest single block asked of the allocator */
  /* when set, every file opened for writing fails to open, as on a full disk */
  int fail_writes;
  /* the screen: the frame (a set bit is black), the text drawn since it was cleared, the font loaded */
  uint8_t frame[LCD_ROWS * LCD_ROWSIZE];
  fake_run runs[FAKE_RUNS];
  int run_count;
  fake_font font_set; /* the font set; drawing in none is a fault */
  int glyph;          /* the width of a system font character, FAKE_GLYPH unless a test widens it */
  int big_glyph, small_glyph; /* the same for the builder's fonts, FAKE_BIG_GLYPH and FAKE_SMALL_GLYPH unless a test says */
  /* the input the next frame reads, and the update callback the game set */
  PDButtons buttons_held, buttons_pushed;
  float crank;
  int docked;
  PDCallbackFunction *update;
  void *update_ctx;
} fake_playdate;

/* A fake over the two folders. */
void fake_init(fake_playdate *fake, const char *data, const char *app);

/* Calls the registered function `name` with up to one string argument; the string it pushed, or NULL if none. */
const char *fake_call(fake_playdate *fake, const char *name, const char *argument);

/* The same with `count` string arguments. */
const char *fake_call_with(fake_playdate *fake, const char *name, int count, const char *const *arguments);

/* Whether the pixel at (x, y) is black. */
int fake_pixel(const fake_playdate *fake, int x, int y);

/* The run of text drawn at the top left (x, y), or NULL. */
const fake_run *fake_run_at(const fake_playdate *fake, int x, int y);

/* The width of a character and the height of a line in `font`. */
int fake_glyph(const fake_playdate *fake, fake_font font);
int fake_line(fake_font font);

/* Runs one frame through the update callback the game set, with `pushed` pressed and the crank turned `crank` degrees. */
int fake_frame(fake_playdate *fake, PDButtons pushed, float crank);

#endif
