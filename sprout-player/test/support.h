/*
 * What the C tests share: a check macro, a scenario's fake PlaydateAPI over its own Data folder
 * (the app's folder is the packed corpus cartridges), the registered Lua functions called as Lua
 * calls them, files read and written under the Data folder, and a little JSON for looking at
 * replies. Each test file is one program: it runs its scenarios and returns `finish()`.
 */
#ifndef PLAYER_TEST_SUPPORT_H
#define PLAYER_TEST_SUPPORT_H

#include <stdbool.h>
#include <stdio.h>
#include <string.h>

#include "fake_playdate.h"
#include "json.h"
#include "session.h"

extern int test_checks, test_failures;

#define CHECK(condition, ...)                                                \
  do {                                                                       \
    test_checks++;                                                           \
    if (!(condition)) {                                                      \
      test_failures++;                                                       \
      fprintf(stderr, "FAIL %s:%d: %s\n  ", __FILE__, __LINE__, #condition); \
      fprintf(stderr, __VA_ARGS__);                                          \
      fputc('\n', stderr);                                                   \
    }                                                                        \
  } while (0)

#define HAS(text, needle) (strstr((text), (needle)) != NULL)

extern fake_playdate *fake;

/* Names the program (its scenarios' folders are under it); call once, first. */
void test_program(const char *name);

/* A scenario: a fresh Data folder and a fake; `begin_bridge` also registers the Lua functions. */
void begin(const char *scenario);
void begin_bridge(const char *scenario);
/* Ends it: the player shut down and no page left out. */
void end(void);

/* Calls a registered function and copies the reply, which the next call overwrites. */
char *call(const char *name, const char *argument);

/* The same with three string arguments. */
char *call3(const char *name, const char *first, const char *second, const char *third);

/* A session over the fake, for the tests that call the session's functions directly. */
player_session *session_new(void);
/* Copies a reply the session handed back. */
char *keep(const char *reply);

char *file_text(const char *path);
void write_text(const char *path, const char *text);
bool exists(const char *path);

/* The save's paths for the hash in the reply to open. */
void save_paths(const char *opened, char *state, char *log, size_t size);

/* JSON for the checks; `json_begin` after `begin`, `json_end` before `end`. */
void json_begin(void);
void json_end(void);
const sprout_json *parse(const char *text);
const char *string_at(const sprout_json *node, const char *key);
const char *line_text(const sprout_json *reply, size_t index);
const char *line_kind(const sprout_json *reply, size_t index);
size_t line_count(const sprout_json *reply);

/* A reading from a view's chips: the verb ending in `verb` and the choice named `thing`. */
void reading_from(const char *view_text, const char *verb, const char *thing, char *out, size_t size);

/* Prints the count and returns the exit code. */
int finish(void);

#endif
