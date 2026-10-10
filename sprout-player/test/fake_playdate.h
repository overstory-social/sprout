/*
 * A PlaydateAPI with only the functions the glue calls, so the bridge is exercised without the
 * SDK's runtime: a clock a test sets, a Data folder and an app folder on the desktop's disk, and
 * a Lua stack that holds the arguments a test passes and the strings the glue pushes back. The
 * SDK's headers are the declarations; nothing of the SDK is linked.
 */
#ifndef FAKE_PLAYDATE_H
#define FAKE_PLAYDATE_H

#include "pd_api.h"

#define FAKE_ARGS 4
#define FAKE_FUNCTIONS 16

typedef struct fake_playdate {
  PlaydateAPI api;
  struct playdate_sys sys;
  struct playdate_file file;
  struct playdate_lua lua;
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
} fake_playdate;

/* A fake over the two folders. */
void fake_init(fake_playdate *fake, const char *data, const char *app);

/* Calls the registered function `name` with up to one string argument; the string it pushed, or NULL if none. */
const char *fake_call(fake_playdate *fake, const char *name, const char *argument);

/* The same with `count` string arguments. */
const char *fake_call_with(fake_playdate *fake, const char *name, int count, const char *const *arguments);

#endif
