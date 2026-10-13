/*
 * A PlaydateAPI with only the functions the glue and the screens call, so both are exercised
 * without the SDK's runtime: a clock a test sets, a Data folder and an app folder on the
 * desktop's disk, a Lua stack that holds the arguments a test passes and the strings the glue
 * pushes back, and a screen: graphics that draw into a 400 by 240 one-bit frame, as the
 * Simulator's is, with the text drawn kept as runs, and buttons and a crank a test sets. The
 * fake font is `glyph` pixels a character (FAKE_GLYPH unless a test says otherwise) and
 * FAKE_LINE tall; a character is drawn as a block. The SDK's headers are the declarations; nothing of the SDK is linked.
 */
#ifndef FAKE_PLAYDATE_H
#define FAKE_PLAYDATE_H

#include "pd_api.h"

#define FAKE_ARGS 4
#define FAKE_FUNCTIONS 16
#define FAKE_RUNS 128
#define FAKE_GLYPH 7
#define FAKE_LINE 18

/* One drawText call: its text and where its top left was. */
typedef struct fake_run {
  char text[512];
  int x, y;
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
  int font_set; /* whether the font set is the one loaded */
  int glyph;    /* the width of a character, FAKE_GLYPH unless a test widens it */
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

/* Runs one frame through the update callback the game set, with `pushed` pressed and the crank turned `crank` degrees. */
int fake_frame(fake_playdate *fake, PDButtons pushed, float crank);

#endif
