/*
 * The C app's screens (ui/app.c, ui/arrival.c, ui/reader.c, ui/message.c, ui/pen.c) and its entry
 * point (main.c built with PLAYER_C_UI), driven a frame at a time through the fake PlaydateAPI's
 * update callback, buttons and crank, and judged by what was drawn into its 400 by 240 frame. The
 * app starts on the shelf (shelf.test.c), and A opens the world selected.
 * The reader's checks are rules: read top to bottom, the transcript is the client's line and then
 * exactly what the arrival told; the status is the view's place and ways out; the column is
 * full and nothing is drawn past it; and the crank and the d-pad move it a line at a time.
 */
#include <stdlib.h>

#include "support.h"
#include "ui/app.h"
#include "ui/arrival.h"
#include "ui/clock.h"
#include "ui/downloads.h"
#include "ui/message.h"
#include "ui/shelf.h"
#include "ui/reader.h"
#include "ui/transcript.h"

int eventHandler(PlaydateAPI *pd, PDSystemEvent event, uint32_t arg);

#define LINE FAKE_LINE
#define TOP (LINE + 2)                    /* the first transcript row */
#define PANEL (240 - (LINE * 3 + 8))      /* the line above the keys */

/* The row the shelf draws `n` rows down, and the first line of its panel. */
#define SHELF_ROW(n) (LINE + 4 + 2 + (n) * LINE)

static const fake_run *status_run(void) { return fake_run_at(fake, 2, 0); }

/* Runs frames until the reader is up (its keys are drawn) or `most` have run; how many ran. */
static int frames_until_reader(int most) {
  int n;
  for (n = 1; n <= most; n++) {
    CHECK(fake_frame(fake, 0, 0) == 1, "a frame asks for the display to be updated");
    if (fake_run_at(fake, PLAYER_MARGIN, PANEL + 2) != NULL) return n;
  }
  return n;
}

/* The transcript rows drawn this frame, top to bottom. */
static int rows_drawn(const fake_run **rows, int room) {
  int n = 0;
  while (n < room && (rows[n] = fake_run_at(fake, 2, TOP + n * LINE)) != NULL) n++;
  return n;
}

/* ---- what the arrival told, from a session of the test's own ---- */

static char told_lines[64][2048];
static size_t told_count;

static void record_the_arrival(const char *cartridge, const char *nickname) {
  player_session *s;
  player_opening opened;
  player_loaded loaded;
  player_told admitted;
  size_t i;
  begin("told");
  s = session_new();
  opened = player_open_whole(s, cartridge);
  CHECK(opened.ok && opened.done, "%s", opened.reason);
  loaded = player_load(s);
  CHECK(loaded.ok && loaded.fresh, "%s", loaded.words);
  admitted = player_admit(s, nickname);
  CHECK(admitted.ok && admitted.admitted, "%s", admitted.words);
  told_count = 0;
  for (i = 0; i < admitted.lines.count && told_count < 64; i++) {
    const told *line = &admitted.lines.items[i];
    snprintf(told_lines[told_count++], sizeof told_lines[0], "%s%.*s", transcript_lead(line->kind), (int)line->text_length,
             line->text);
  }
  end();
}

/* The characters of `text` that are not white space, appended to `out`. */
static void ink(const char *text, char *out) {
  out += strlen(out);
  for (; *text != '\0'; text++)
    if (*text != ' ' && *text != '\n' && *text != '\t') *out++ = *text;
  *out = '\0';
}

/* ---- the scenarios ---- */

static void the_c_main_sets_the_update_callback_and_the_app_saves_at_terminate(void) {
  static const char *const shipped[] = {"chip-tree.sproutworld"};
  int frames;
  begin("main");
  app_folder("app");
  ship(shipped, 1);
  eventHandler(&fake->api, kEventInitLua, 0);
  CHECK(fake->function_count == 0, "the C app registers nothing with Lua");
  eventHandler(&fake->api, kEventInit, 0);
  CHECK(fake->update != NULL, "the update callback is set at kEventInit");
  fake_frame(fake, 0, 0);
  CHECK(fake_run_at(fake, PLAYER_MARGIN, 0) != NULL && strcmp(fake_run_at(fake, PLAYER_MARGIN, 0)->text, "Shelf") == 0,
        "the app starts on the shelf");
  CHECK(fake_run_at(fake, PLAYER_MARGIN, SHELF_ROW(0)) != NULL &&
            strcmp(fake_run_at(fake, PLAYER_MARGIN, SHELF_ROW(0))->text, "> Chip Tree") == 0,
        "the shipped world is on it, selected: %s",
        fake_run_at(fake, PLAYER_MARGIN, SHELF_ROW(0)) ? fake_run_at(fake, PLAYER_MARGIN, SHELF_ROW(0))->text : "(none)");
  fake_frame(fake, kButtonA, 0);
  frames = frames_until_reader(10000);
  CHECK(fake_run_at(fake, PLAYER_MARGIN, PANEL + 2) != NULL, "the reader came up after %d frames", frames);
  CHECK(status_run() != NULL && status_run()->text[0] != '\0', "the status line is drawn");
  eventHandler(&fake->api, kEventTerminate, 0);
  {
    char command[1200];
    snprintf(command, sizeof command, "ls '%s/saves' | grep -q '\\.json$'", fake->data);
    CHECK(system(command) == 0, "the visitor left and the world was saved at terminate");
  }
  end();
}

static void the_reader_shows_the_arrival_under_the_status_line(void) {
  static const char *const shipped[] = {"teashop.sproutworld", "printers_shop.sproutworld"};
  const char *why = NULL;
  player_app *app;
  const fake_run *rows[32];
  char top_rows[256][512], newest[32][512], want[16384], got[16384];
  const sprout_seen_view *view;
  const char *words = NULL;
  int n, frames, rows_shown, back, i;
  size_t t;

  record_the_arrival("printers_shop.sproutworld", PLAYER_FIXED_NICKNAME);
  begin("reader");
  app_folder("app");
  fake->glyph = 14; /* twice the fake font's width, so the arrival runs well past the column */
  ship(shipped, 2);
  write_text("worlds/aardvark.txt", "not a cartridge");
  app = player_app_new(&fake->api, &why);
  CHECK(app != NULL, "%s", why);
  fake->api.system->setUpdateCallback(player_app_update, app);

  /* The shelf lists the worlds by path; A on the first reads it behind its loading line. */
  CHECK(fake_frame(fake, 0, 0) == 1, "a frame");
  CHECK(fake_frame(fake, kButtonA, 0) == 1, "a frame");
  CHECK(fake_run_at(fake, PLAYER_MARGIN, 0) != NULL && HAS(fake_run_at(fake, PLAYER_MARGIN, 0)->text, "Loading Printers Shop... "),
        "the loading line names the world chosen");
  frames = frames_until_reader(10000);
  CHECK(fake_run_at(fake, PLAYER_MARGIN, PANEL + 2) != NULL, "the reader after %d frames", frames);

  /* The status line is the view's place and ways out, over a rule across the screen. */
  view = player_view(app->session, &words);
  CHECK(view != NULL, "%s", words);
  if (view != NULL) {
    char status[512];
    size_t at = (size_t)snprintf(status, sizeof status, "%.*s", (int)view->place.name.length, view->place.name.bytes);
    for (t = 0; t < view->exit_count; t++)
      at += (size_t)snprintf(status + at, sizeof status - at, "%s%s", t == 0 ? " - exits: " : ", ",
                             view->exits[t].direction != NULL ? view->exits[t].direction : view->exits[t].label);
    CHECK(view->exit_count > 0, "the shop has ways out");
    CHECK(status_run() != NULL && strcmp(status_run()->text, status) == 0, "status \"%s\", the view says \"%s\"",
          status_run() ? status_run()->text : "(none)", status);
  }
  for (i = 0; i < 400; i++) CHECK(fake_pixel(fake, i, LINE + 1), "the rule under the status at x %d", i);

  /* The column is full: as many rows as fit above the panel, each no wider than the column. */
  rows_shown = rows_drawn(rows, 32);
  CHECK(rows_shown > 0 && TOP + rows_shown * LINE <= PANEL && TOP + (rows_shown + 1) * LINE > PANEL,
        "%d rows between the status and the panel", rows_shown);
  for (n = 0; n < rows_shown; n++)
    CHECK((int)strlen(rows[n]->text) * fake->glyph <= 400 - 2 * PLAYER_MARGIN, "row %d is wider than the column: %s", n, rows[n]->text);
  {
    int y, x, blank = 1;
    for (y = TOP + rows_shown * LINE; y < PANEL; y++)
      for (x = 0; x < 400; x++) blank = blank && !fake_pixel(fake, x, y);
    CHECK(blank, "nothing is drawn between the last row and the panel");
  }
  CHECK(fake_run_at(fake, 390, 240 - LINE) == NULL, "at the newest, nothing waits below");

  /* Up scrolls back a line at a time, every row moving down one, until the top; the top row each time is a line. */
  for (n = 0; n < rows_shown; n++) snprintf(newest[n], sizeof newest[0], "%s", rows[n]->text);
  for (back = 0; back < 255; back++) {
    snprintf(top_rows[back], sizeof top_rows[0], "%s", rows[0]->text);
    fake_frame(fake, kButtonUp, 0);
    rows_drawn(rows, 32);
    if (strcmp(rows[0]->text, top_rows[back]) == 0) break; /* the top: nothing more to scroll back to */
    CHECK(strcmp(rows[1]->text, top_rows[back]) == 0, "after up, the row that was first is second");
    CHECK(fake_run_at(fake, 390, 240 - LINE) != NULL && strcmp(fake_run_at(fake, 390, 240 - LINE)->text, "v") == 0,
          "scrolled back, a mark says more waits below");
  }
  CHECK(back > 0, "the arrival is longer than the column, so it scrolls");
  CHECK(strncmp(rows[0]->text, "- You are in ", 13) == 0, "the transcript begins with who the visitor is: %s",
        rows[0]->text);

  /* Top to bottom, the transcript is the client's line and then exactly what the arrival told. */
  want[0] = got[0] = '\0';
  ink("- You are in Printers Shop as Wren.", want);
  for (t = 0; t < told_count; t++) ink(told_lines[t], want);
  for (n = back; n >= 0; n--) ink(top_rows[n], got);
  for (n = 1; n < rows_shown; n++) ink(newest[n], got);
  CHECK(strcmp(want, got) == 0, "the transcript\n  %s\nis not what was told\n  %s", got, want);

  /* Down comes forward a line; the crank a line for each 12 degrees, a slow turn included; a docked crank not at all. */
  fake_frame(fake, kButtonDown, 0);
  rows_drawn(rows, 32);
  CHECK(strcmp(rows[0]->text, top_rows[back - 1]) == 0, "down comes forward one row");
  CHECK(back >= 3, "the arrival runs at least three lines past the column: %d", back);
  if (back >= 3) {
    fake_frame(fake, 0, -7.0f);
    rows_drawn(rows, 32);
    CHECK(strcmp(rows[0]->text, top_rows[back - 1]) == 0, "seven degrees forward is not yet a line");
    fake_frame(fake, 0, -7.0f);
    rows_drawn(rows, 32);
    CHECK(strcmp(rows[0]->text, top_rows[back - 2]) == 0, "fourteen degrees forward is a line: %s", rows[0]->text);
    fake_frame(fake, 0, 24.0f);
    rows_drawn(rows, 32);
    CHECK(strcmp(rows[0]->text, top_rows[back]) == 0, "twenty-four degrees back is two lines: %s", rows[0]->text);
    fake->docked = 1;
    fake_frame(fake, 0, -48.0f);
    rows_drawn(rows, 32);
    CHECK(strcmp(rows[0]->text, top_rows[back]) == 0, "a docked crank scrolls nothing");
    fake->docked = 0;
  }
  fake_frame(fake, 0, -12.0f * 300);
  rows_drawn(rows, 32);
  CHECK(strcmp(rows[0]->text, top_rows[0]) == 0 && fake_run_at(fake, 390, 240 - LINE) == NULL,
        "cranked forward to the newest and no further");

  player_app_free(app);
  end();
}

static void with_no_world_shipped_the_shelf_says_so(void) {
  const char *why = NULL;
  player_app *app;
  int panel = 240 - (LINE * 3 + 8) + 2;
  begin("none");
  app_folder("app");
  app = player_app_new(&fake->api, &why);
  CHECK(app != NULL, "%s", why);
  fake->api.system->setUpdateCallback(player_app_update, app);
  fake_frame(fake, 0, 0);
  CHECK(fake_run_at(fake, PLAYER_MARGIN, SHELF_ROW(0)) != NULL &&
            strcmp(fake_run_at(fake, PLAYER_MARGIN, SHELF_ROW(0))->text, "> more worlds...") == 0,
        "the one row is more worlds");
  CHECK(fake_run_at(fake, PLAYER_MARGIN, panel) != NULL && HAS(fake_run_at(fake, PLAYER_MARGIN, panel)->text, "No worlds are on the"),
        "the panel says the shelf is empty: %s", fake_run_at(fake, PLAYER_MARGIN, panel) ? fake_run_at(fake, PLAYER_MARGIN, panel)->text : "(none)");
  fake_frame(fake, kButtonA, 0);
  CHECK(app->screen == &player_downloads_screen, "A on more worlds opens the download screen");
  fake_frame(fake, kButtonB, 0);
  CHECK(app->screen == &player_shelf_screen && fake_run_at(fake, PLAYER_MARGIN, panel) != NULL, "and B comes back");
  player_app_free(app);
  end();
}

static void a_cartridge_that_cannot_be_opened_is_told_in_words(void) {
  const char *why = NULL;
  player_app *app;
  const fake_run *said;
  char command[1200];
  int panel = 240 - (LINE * 3 + 8) + 2;
  begin("refused");
  app_folder("app");
  snprintf(command, sizeof command, "mkdir -p '%s/worlds'", fake->data);
  CHECK(system(command) == 0, "%s", command);
  write_text("worlds/broken.sproutworld", "this is not a cartridge");
  app = player_app_new(&fake->api, &why);
  CHECK(app != NULL, "%s", why);
  fake->api.system->setUpdateCallback(player_app_update, app);
  fake_frame(fake, 0, 0);
  said = fake_run_at(fake, PLAYER_MARGIN, SHELF_ROW(0));
  CHECK(said != NULL && strcmp(said->text, "> Broken (cannot be opened)") == 0, "the broken world is shelved: %s",
        said ? said->text : "(nothing)");
  said = fake_run_at(fake, PLAYER_MARGIN, panel);
  CHECK(said != NULL && HAS(said->text, "Sprout"), "the panel gives the engine's reason: %s", said ? said->text : "(nothing)");
  fake_frame(fake, kButtonA, 0);
  said = fake_run_at(fake, PLAYER_MARGIN, MESSAGE_TOP);
  CHECK(app->screen == &player_message_screen && said != NULL && HAS(said->text, "Sprout"),
        "A tells the reason on the message screen: %s", said ? said->text : "(nothing)");
  CHECK(fake_run_at(fake, PLAYER_MARGIN, 240 - LINE - 2) != NULL, "the message says how to go on");
  fake_frame(fake, kButtonA, 0);
  CHECK(app->screen == &player_shelf_screen, "A goes back to the shelf");
  player_app_free(app);
  end();
}

/* How many of the transcript rows drawn this frame hold `words`. */
static int rows_holding(const char *words) {
  const fake_run *rows[32];
  int n = rows_drawn(rows, 32), i, found = 0;
  for (i = 0; i < n; i++)
    if (HAS(rows[i]->text, words)) found++;
  return found;
}

/*
 * The ticks world tells the wind when a tick brings more than thirty seconds: so a tick that ran
 * shows, and one that did not leaves the transcript as it was.
 */
static void the_reader_ticks_while_awake_and_tells_what_a_tick_told(void) {
  static const char *const shipped[] = {"ticks.sproutworld"};
  static const char WIND[] = "The wind picks up in the eaves.";
  begin("ticks");
  app_folder("app");
  ship(shipped, 1);
  eventHandler(&fake->api, kEventInit, 0);
  fake_frame(fake, 0, 0);
  fake_frame(fake, kButtonA, 0);
  frames_until_reader(10000);
  fake->seconds += PLAYER_TICK_SECONDS;
  fake_frame(fake, 0, 0);
  CHECK(rows_holding(WIND) == 0, "the first tick brings no time since arriving, so nothing has blown yet");
  fake->seconds += 35;
  fake_frame(fake, 0, 0);
  CHECK(rows_holding(WIND) == 1, "a tick fell due and what it told is in the transcript, newest at the bottom");
  {
    const fake_run *rows[32];
    int n = rows_drawn(rows, 32);
    CHECK(n > 0 && HAS(rows[n - 1]->text, WIND), "the newest row is the wind: %s", n > 0 ? rows[n - 1]->text : "(none)");
  }

  eventHandler(&fake->api, kEventLock, 0);
  fake->seconds += 100;
  fake_frame(fake, 0, 0);
  fake_frame(fake, 0, 0);
  CHECK(rows_holding(WIND) == 1, "locked, no tick is asked for");
  eventHandler(&fake->api, kEventUnlock, 0);
  fake_frame(fake, 0, 0);
  CHECK(rows_holding(WIND) == 1, "unlocked, none is owed for the time away");
  fake->seconds += PLAYER_TICK_SECONDS - 1;
  fake_frame(fake, 0, 0);
  CHECK(rows_holding(WIND) == 1, "the count began at the unlock");
  fake->seconds += 1;
  fake_frame(fake, 0, 0);
  CHECK(rows_holding(WIND) == 2, "an interval after the unlock, a tick: its elapsed carried the time away");

  eventHandler(&fake->api, kEventLowPower, 0);
  fake->seconds += 100;
  fake_frame(fake, 0, 0);
  CHECK(rows_holding(WIND) == 2, "asleep for a low battery, no tick is asked for");
  eventHandler(&fake->api, kEventUnlock, 0);
  fake->seconds += PLAYER_TICK_SECONDS;
  fake_frame(fake, 0, 0);
  CHECK(rows_holding(WIND) == 3, "the device wakes locked, and its unlock starts the ticks again");

  eventHandler(&fake->api, kEventTerminate, 0);
  {
    char command[1200];
    snprintf(command, sizeof command, "grep -l '\"kind\":\"tick\"' '%s'/saves/*.log >/dev/null", fake->data);
    CHECK(system(command) == 0, "the ticks are in the log the terminate's save wrote");
  }
  end();
}

int main(void) {
  test_program("ui");
  the_c_main_sets_the_update_callback_and_the_app_saves_at_terminate();
  the_reader_shows_the_arrival_under_the_status_line();
  with_no_world_shipped_the_shelf_says_so();
  a_cartridge_that_cannot_be_opened_is_told_in_words();
  the_reader_ticks_while_awake_and_tells_what_a_tick_told();
  return finish();
}
