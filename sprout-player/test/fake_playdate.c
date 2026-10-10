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
  fake->lua.addFunction = fake_add_function;
  fake->lua.getArgString = fake_arg_string;
  fake->lua.pushString = fake_push_string;
  fake->api.system = &fake->sys;
  fake->api.file = &fake->file;
  fake->api.lua = &fake->lua;
}

const char *fake_call(fake_playdate *fake, const char *name, const char *argument) {
  int i;
  current = fake;
  for (i = 0; i < fake->function_count; i++) {
    if (strcmp(fake->names[i], name) != 0) continue;
    fake->arg_count = argument == NULL ? 0 : 1;
    fake->args[0] = argument;
    fake->push_count = 0;
    if (fake->functions[i](NULL) != 1 || fake->push_count != 1) return NULL;
    return fake->pushed;
  }
  return NULL;
}
