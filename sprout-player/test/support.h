/*
 * What the C tests share: a check macro, a scenario's fake PlaydateAPI over its own Data folder
 * (the app's folder is the packed corpus cartridges), the session's calls with readings made as
 * the sentence builder makes them, and files read and written under the Data folder.
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

/* A scenario: a fresh Data folder and a fake. */
void begin(const char *scenario);
/* Ends it: the session freed and no page left out. */
void end(void);

/* Opens the world at `path` on `session`, stepping until it is done; the answer of the open or the step that failed, or the last. */
player_opening player_open_whole(player_session *session, const char *path);

/* A session over the fake, for the tests that call the session's functions directly. */
player_session *session_new(void);

char *file_text(const char *path);
/* Whether `font`, a `fonts/<name>.pft` path the app loads, names a `.fnt` under Source/fonts, which pdc packages into the pdx. */
bool shipped_font(const char *font);
/* Puts the packed cartridges named into the Data folder's worlds/, as a pdx's shipped worlds are found. */
void ship(const char *const *names, size_t count);
/* Points the app folder at an empty folder of the scenario's own, `name`, so the shelf lists only what a test puts there. */
void app_folder(const char *name);
/* The text of a file under test/fixtures (`../` reaches test/), without its trailing newlines, from malloc. */
char *fixture_text(const char *name);
void write_text(const char *path, const char *text);
bool exists(const char *path);

/*
 * Writes to `path` under the Data folder a build of the packed teashop (version 0.1.0 by Ada) whose
 * manifest says `version` and `author`, the same lengths as those, and whose bundle hash's first
 * digit is moved on by `digit`, 1 to 9, so that each build is a world of its own to the session.
 */
void build_of(const char *path, const char *version, const char *author, char digit);

/* The save's paths for a world's bundle hash. */
void save_paths(const char *hash, char *state, char *log, size_t size);

/* A JSON object's string member `key`, or "". */
const char *string_at(const sprout_json *node, const char *key);

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
