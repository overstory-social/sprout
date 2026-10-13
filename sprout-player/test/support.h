/*
 * What the C tests share: a check macro, a scenario's fake PlaydateAPI over its own Data folder
 * (the app's folder is the packed corpus cartridges), the registered Lua functions called as Lua
 * calls them, the session's calls with readings made as the sentence builder makes them, files
 * read and written under the Data folder, and a little JSON for looking at the bridge's replies.
 * Each test file is one program: it runs its scenarios and returns `finish()`.
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

/* Opens the world at `path` through the registered functions, stepping until it is done; the last reply. */
char *open_world(const char *path);

/* Opens the world at `path` on `session`, stepping until it is done; the answer of the open or the step that failed, or the last. */
player_opening player_open_whole(player_session *session, const char *path);

/* The same with three string arguments. */
char *call3(const char *name, const char *first, const char *second, const char *third);

/* A session over the fake, for the tests that call the session's functions directly. */
player_session *session_new(void);
/* Copies a reply the bridge handed back. */
char *keep(const char *reply);

char *file_text(const char *path);
/* Puts the packed cartridges named into the Data folder's worlds/, as a pdx's shipped worlds are found. */
void ship(const char *const *names, size_t count);
/* Points the app folder at an empty folder of the scenario's own, `name`, so the shelf lists only what a test puts there. */
void app_folder(const char *name);
/* The text of a file under test/fixtures (`../` reaches test/), without its trailing newlines, from malloc. */
char *fixture_text(const char *name);
void write_text(const char *path, const char *text);
bool exists(const char *path);

/* The save's paths for a world's bundle hash, or for the hash in the bridge's reply to open. */
void save_paths(const char *hash, char *state, char *log, size_t size);
void save_paths_of_reply(const char *opened, char *state, char *log, size_t size);

/* JSON for the checks; `json_begin` after `begin`, `json_end` before `end`. */
void json_begin(void);
void json_end(void);
const sprout_json *parse(const char *text);
const char *string_at(const sprout_json *node, const char *key);
const char *line_text(const sprout_json *reply, size_t index);
const char *line_kind(const sprout_json *reply, size_t index);
size_t line_count(const sprout_json *reply);

/* A filling of each kind a reading can hold, as the sentence builder makes one. */
sprout_filling fill_object(const char *role, const char *id);
sprout_filling fill_word(const char *role, const char *word);
sprout_filling fill_number(const char *role, double number);
sprout_filling fill_exit(const char *role, const char *direction, const char *label, const char *to);
sprout_filling fill_set(const char *role, size_t count, const char *const *ids);

/* A command turn of `verb` with these fillings, standing for the line `text` (or NULL). */
player_told turn_of(player_session *session, const char *verb, const char *text, size_t count, const sprout_filling *fillings);

/* The text and kind of a line a call told, or "" past the last. */
const char *told_text(const player_told *answer, size_t index);
const char *told_kind(const player_told *answer, size_t index);
/* Whether any line a call told holds `needle`. */
bool told_has(const player_told *answer, const char *needle);

/*
 * A reading from the last view's chips, its verb's readings asked for: the verb ending in `verb`
 * and the choice whose thing is named `thing`. `out` holds it until the next call.
 */
bool reading_from(player_session *session, const char *verb, const char *thing, sprout_reading *out);

/* Prints the count and returns the exit code. */
int finish(void);

#endif
