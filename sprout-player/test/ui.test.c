/*
 * The app's screens (ui/app.c, ui/arrival.c, ui/reader.c, ui/message.c, ui/pen.c), its system
 * menu and its entry point (main.c), driven a frame at a time through the fake PlaydateAPI's
 * update callback, buttons, crank and menu, and judged by what was drawn into its 400 by 240 frame. The
 * app starts on the shelf (shelf.test.c), A opens the world selected, and A on the nickname
 * screen (nickname.test.c) enters the name it offers first.
 * The reader's checks are rules: read top to bottom, the transcript is the client's line and then
 * exactly what the arrival told; the status is the view's place and ways out, wrapped to the column
 * and at most three lines; the column is full under it and nothing is drawn past it; the keys take
 * one line; and the crank and the d-pad move it a line at a time.
 */
#include <stdlib.h>

#include "shipping.h"
#include "support.h"
#include "ui/app.h"
#include "ui/arrival.h"
#include "ui/clock.h"
#include "ui/downloads.h"
#include "ui/message.h"
#include "ui/nickname.h"
#include "ui/shelf.h"
#include "ui/reader.h"
#include "ui/text_size.h"
#include "ui/transcript.h"
#include "wheel_support.h"

int eventHandler(PlaydateAPI *pd, PDSystemEvent event, uint32_t arg);

#define LINE FAKE_SERIF_LINE
#define PANEL (240 - (LINE + 4)) /* the reader's rule above the keys, in the frame */
#define SHELF_TOP (LINE + 4)                /* the shelf's rule under its title */
#define SHELF_PANEL (240 - (LINE * 3 + 8)) /* the shelf's rule above its panel */


static const char READER_KEYS[] = "A: build a sentence   crank: scroll back";

static const fake_run *status_run(void) { return fake_run_at(fake, 2, 0); }

/* Whether the reader was drawn last frame: its keys are on the panel's one line. */
static bool on_reader(void) {
  const fake_run *keys = fake_run_at(fake, PLAYER_MARGIN, PANEL + 2);
  return keys != NULL && strcmp(keys->text, READER_KEYS) == 0;
}

/* How many lines of status were drawn: the runs at the top of the column, one under another. */
static int status_lines_drawn(void) {
  int n = 0;
  while (n < READER_STATUS_MOST_LINES && fake_run_at(fake, 2, n * LINE) != NULL) n++;
  return n;
}

/* The first transcript row: under the status's lines (one, blank, before the first view) and the rule. */
static int top(void) {
  int lines = status_lines_drawn();
  return (lines > 0 ? lines : 1) * LINE + 2;
}

/* The status's lines joined by one space, into `out`. */
static void status_joined(char *out, size_t room) {
  int n = status_lines_drawn(), i;
  out[0] = '\0';
  for (i = 0; i < n; i++) snprintf(out + strlen(out), room - strlen(out), "%s%s", i > 0 ? " " : "", fake_run_at(fake, 2, i * LINE)->text);
}

/* The app the update callback runs. */
static player_app *running(void) { return (player_app *)fake->update_ctx; }

/* The word at the front of the shelf's wheel, as drawn last frame. */
static const char *shelf_front(void) { return running() != NULL ? wheel_front(&running()->shelf->wheel) : "(no app)"; }

/* The name at the front of the nickname screen's wheel, as drawn last frame; "" off that screen. */
static const char *name_offered(void) {
  player_app *app = running();
  return app != NULL && app->screen == &player_nickname_screen ? wheel_front(&((player_nickname *)app->ctx)->wheel) : "";
}

/* Whether the nickname screen was drawn last frame. */
static bool on_nickname(void) {
  const fake_run *top = fake_run_at(fake, PLAYER_MARGIN, 0);
  return top != NULL && strncmp(top->text, "Who are you in ", 15) == 0;
}

/* Runs frames, entering the name offered first, until the reader is up (its keys are drawn) or `most` have run; how many ran. */
static int frames_until_reader(int most) {
  int n;
  for (n = 1; n <= most; n++) {
    CHECK(fake_frame(fake, on_nickname() ? kButtonA : 0, 0) == 1, "a frame asks for the display to be updated");
    if (on_reader()) return n;
  }
  return n;
}

/* The transcript rows drawn this frame, top to bottom. */
static int rows_drawn(const fake_run **rows, int room) {
  int n = 0, first = top();
  while (n < room && (rows[n] = fake_run_at(fake, 2, first + n * LINE)) != NULL) n++;
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
  loaded = player_load(s, NULL);
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

static void main_sets_the_update_callback_and_the_app_saves_at_terminate(void) {
  static const char *const shipped[] = {"chip-tree.sproutworld"};
  int frames;
  begin("main");
  app_folder("app");
  ship(shipped, 1);
  eventHandler(&fake->api, kEventInitLua, 0);
  CHECK(fake->update == NULL, "the app starts at kEventInit and at no other event");
  eventHandler(&fake->api, kEventInit, 0);
  CHECK(fake->update != NULL, "the update callback is set at kEventInit");
  fake_frame(fake, 0, 0);
  CHECK(fake_run_at(fake, PLAYER_MARGIN, 0) != NULL && strcmp(fake_run_at(fake, PLAYER_MARGIN, 0)->text, "Shelf") == 0,
        "the app starts on the shelf");
  CHECK(strcmp(shelf_front(), "Chip Tree") == 0, "the shipped world is on it, at the wheel's front: %s", shelf_front());
  fake_frame(fake, kButtonA, 0);
  frames = frames_until_reader(10000);
  CHECK(on_reader(), "the reader came up after %d frames", frames);
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

  record_the_arrival("printers_shop.sproutworld", nickname_pool[0]);
  begin("reader");
  app_folder("app");
  fake->serif_glyph = 14; /* twice the fake font's width, so the arrival runs well past the column */
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
  CHECK(on_reader(), "the reader after %d frames", frames);

  /* The status is the view's place and ways out, wrapped to the column, over a rule across the screen. */
  view = player_view(app->session, &words);
  CHECK(view != NULL, "%s", words);
  if (view != NULL) {
    char status[512], joined[512];
    size_t at = (size_t)snprintf(status, sizeof status, "%.*s", (int)view->place.name.length, view->place.name.bytes);
    for (t = 0; t < view->exit_count; t++)
      at += (size_t)snprintf(status + at, sizeof status - at, "%s%s", t == 0 ? " - exits: " : ", ",
                             view->exits[t].direction != NULL ? view->exits[t].direction : view->exits[t].label);
    CHECK(view->exit_count > 0, "the shop has ways out");
    CHECK((int)at * fake->serif_glyph > 400 - 2 * PLAYER_MARGIN, "the status is wider than the column, so it wraps");
    status_joined(joined, sizeof joined);
    CHECK(status_lines_drawn() >= 2 && strcmp(joined, status) == 0, "%d status lines read \"%s\", the view says \"%s\"",
          status_lines_drawn(), joined, status);
    for (n = 0; n < status_lines_drawn(); n++)
      CHECK((int)strlen(fake_run_at(fake, 2, n * LINE)->text) * fake->serif_glyph <= 400 - 2 * PLAYER_MARGIN,
            "status line %d is wider than the column", n);
  }
  for (i = 0; i < 400; i++) CHECK(fake_pixel(fake, i, top() - 1), "the rule under the status at x %d", i);
  CHECK(status_run() != NULL && !fake_pixel(fake, 200, 0), "the status sits at the top of the screen");

  /* The column is full under the status: as many rows as fit above the panel, each no wider than the column. */
  rows_shown = rows_drawn(rows, 32);
  CHECK(rows_shown > 0 && top() + rows_shown * LINE <= PANEL && top() + (rows_shown + 1) * LINE > PANEL,
        "%d rows between the status and the panel", rows_shown);
  CHECK((size_t)rows_shown == player_reader_rows(LINE, LINE, (size_t)status_lines_drawn()),
        "the rows were fitted under the %d status lines: %d", status_lines_drawn(), rows_shown);
  for (n = 0; n < rows_shown; n++)
    CHECK((int)strlen(rows[n]->text) * fake->serif_glyph <= 400 - 2 * PLAYER_MARGIN, "row %d is wider than the column: %s", n, rows[n]->text);
  {
    int y, x, blank = 1;
    for (y = top() + rows_shown * LINE; y < PANEL; y++)
      for (x = 0; x < 400; x++) blank = blank && !fake_pixel(fake, x, y);
    CHECK(blank, "nothing is drawn between the last row and the panel");
  }
  CHECK(fake_run_at(fake, 390, 240 - LINE) == NULL, "at the newest, nothing waits below");
  CHECK(on_reader() && fake_run_at(fake, PLAYER_MARGIN, PANEL + 2 + LINE) == NULL, "the keys take the one line under the panel's rule");
  for (i = 0; i < 400; i++) CHECK(fake_pixel(fake, i, PANEL), "the panel's rule at x %d", i);

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
  ink("- You are in Printers Shop as Alder.", want);
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

/* The rows fill the space between the header and the one-line panel, and a status line costs one row. */
static void the_rows_fill_the_column_under_the_status(void) {
  size_t lines;
  begin("rows");
  for (lines = 1; lines <= READER_STATUS_MOST_LINES; lines++) {
    int room = PANEL - ((int)lines * LINE + 2);
    size_t rows = player_reader_rows(LINE, LINE, lines);
    CHECK(rows > 0 && (int)rows * LINE <= room && (int)(rows + 1) * LINE > room, "%zu status lines: %zu rows in %d px", lines, rows,
          room);
  }
  CHECK(player_reader_rows(LINE, LINE, 2) == player_reader_rows(LINE, LINE, 1) - 1 && player_reader_rows(LINE, LINE, 3) == player_reader_rows(LINE, LINE, 2) - 1,
        "each status line costs one row: %zu, %zu, %zu", player_reader_rows(LINE, LINE, 1), player_reader_rows(LINE, LINE, 2),
        player_reader_rows(LINE, LINE, 3));
  CHECK(player_reader_rows(0, LINE, 1) == 0 && player_reader_rows(240, LINE, 1) == 0, "no rows fit a font of no height or a screen's");
  end();
}

/*
 * A place whose ways out run past three lines in a wide font: the status shows its first three lines
 * and the rest is clipped, and the transcript keeps the rows three lines leave it.
 */
static void a_status_past_three_lines_is_clipped_and_the_transcript_keeps_its_rows(void) {
  static const char *const shipped[] = {"printers_shop.sproutworld"};
  const char *why = NULL;
  player_app *app;
  const fake_run *rows[32];
  int rows_shown, n, frames;
  begin("status-cap");
  app_folder("app");
  fake->serif_glyph = 40; /* nine characters to a line: the shop's name and its ways out take many */
  ship(shipped, 1);
  app = player_app_new(&fake->api, &why);
  CHECK(app != NULL, "%s", why);
  fake->api.system->setUpdateCallback(player_app_update, app);
  fake_frame(fake, 0, 0);
  fake_frame(fake, kButtonA, 0);
  frames = frames_until_reader(10000);
  CHECK(on_reader(), "the reader after %d frames", frames);
  CHECK(status_lines_drawn() == READER_STATUS_MOST_LINES, "%d status lines", status_lines_drawn());
  CHECK(fake_run_at(fake, 2, READER_STATUS_MOST_LINES * LINE) == NULL, "the fourth line is clipped");
  rows_shown = rows_drawn(rows, 32);
  CHECK((size_t)rows_shown == player_reader_rows(LINE, LINE, READER_STATUS_MOST_LINES) && top() + rows_shown * LINE <= PANEL &&
            top() + (rows_shown + 1) * LINE > PANEL,
        "%d rows under three status lines", rows_shown);
  for (n = 0; n < rows_shown; n++)
    CHECK((int)strlen(rows[n]->text) * fake->serif_glyph <= 400 - 2 * PLAYER_MARGIN, "row %d is wider than the column: %s", n, rows[n]->text);
  CHECK(rows_shown > 0 && strncmp(rows[0]->text, "- You", 5) != 0, "the arrival runs past the column, so the first line has scrolled off");
  player_app_free(app);
  end();
}

/* The panel's lines drawn this frame, joined by a space as the wrap broke them. */
static void panel_said(int panel, char *out, size_t size) {
  const fake_run *line;
  int n;
  out[0] = '\0';
  for (n = 0; n < 3 && (line = fake_run_at(fake, PLAYER_MARGIN, panel + n * LINE)) != NULL; n++)
    snprintf(out + strlen(out), size - strlen(out), "%s%s", n > 0 ? " " : "", line->text);
}

/*
 * A fresh install: the app carries no worlds and none are in its Data folder, so the shelf holds only
 * "more worlds..." and its panel says the shelf is empty and how to fill it.
 */
static void on_a_fresh_install_the_shelf_holds_only_more_worlds(void) {
  const char *why = NULL;
  player_app *app;
  char said[1024];
  int panel = 240 - (LINE * 3 + 8) + 2;
  begin("none");
  app_folder("app");
  app = player_app_new(&fake->api, &why);
  CHECK(app != NULL, "%s", why);
  fake->api.system->setUpdateCallback(player_app_update, app);
  fake_frame(fake, 0, 0);
  CHECK(strcmp(shelf_front(), "more worlds...") == 0 && fake->placed_count == 1, "the one word is more worlds: %s", shelf_front());
  panel_said(panel, said, sizeof said);
  CHECK(strcmp(said, "No worlds are on the shelf. A looks for more worlds to download.") == 0, "the panel says the shelf is empty: %s",
        said);
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
  CHECK(strcmp(shelf_front(), "Broken") == 0 && wheel_label_greyed(wheel_placed(&app->shelf->wheel, wheel_front_placed())),
        "the broken world is shelved, greyed: %s", shelf_front());
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
  fake->counter += PLAYER_REST_MILLISECONDS;
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

/*
 * A due tick waits for the hands to rest: none runs in a frame with the crank turning or a button
 * down, nor within PLAYER_REST_MILLISECONDS of one, and the ticks that fell due meanwhile are one
 * when the hands rest, its `elapsed` carrying the time between.
 */
static void a_due_tick_waits_for_the_hands_to_rest(void) {
  static const char *const shipped[] = {"ticks.sproutworld"};
  static const char WIND[] = "The wind picks up in the eaves.";
  int i;
  begin("rest");
  app_folder("app");
  ship(shipped, 1);
  eventHandler(&fake->api, kEventInit, 0);
  fake_frame(fake, 0, 0);
  fake_frame(fake, kButtonA, 0);
  frames_until_reader(10000);
  fake->counter += PLAYER_REST_MILLISECONDS;
  fake->seconds += PLAYER_TICK_SECONDS;
  fake_frame(fake, 0, 0);
  CHECK(on_reader() && rows_holding(WIND) == 0, "the first tick, at rest, brings no time since arriving");
  for (i = 0; i < 4; i++) {
    fake->seconds += PLAYER_TICK_SECONDS;
    fake_frame(fake, 0, 1.0f);
    CHECK(rows_holding(WIND) == 0, "the crank is turning as interval %d falls due: no tick runs under it", i + 1);
  }
  fake->seconds += PLAYER_TICK_SECONDS;
  fake_frame(fake, kButtonB, 0);
  CHECK(rows_holding(WIND) == 0, "nor under a button");
  fake->counter += PLAYER_REST_MILLISECONDS / 2;
  fake_frame(fake, 0, 0);
  CHECK(rows_holding(WIND) == 0, "half the rest later, with the hands off, still none");
  fake->counter += PLAYER_REST_MILLISECONDS;
  fake_frame(fake, 0, 0);
  CHECK(rows_holding(WIND) == 1, "rested, the tick runs, and its elapsed carried every interval that fell due: %d", rows_holding(WIND));
  fake_frame(fake, 0, 0);
  CHECK(rows_holding(WIND) == 1, "once: the intervals under the hands were one tick");
  fake->seconds += PLAYER_TICK_SECONDS - 1;
  fake_frame(fake, 0, 0);
  CHECK(rows_holding(WIND) == 1, "and the count began again when it ran");
  eventHandler(&fake->api, kEventTerminate, 0);
  end();
}

/*
 * "leave world" in the system menu: chosen on the shelf it does nothing; chosen in the reader the
 * visitor leaves, the departure is logged and saved, and the app goes back to the shelf.
 */
static void leave_world_in_the_system_menu_goes_back_to_the_shelf(void) {
  static const char *const shipped[] = {"chip-tree.sproutworld"};
  char command[1200];
  int frames;
  begin("leave");
  app_folder("app");
  ship(shipped, 1);
  eventHandler(&fake->api, kEventInit, 0);
  CHECK(fake_menu_holds(fake, "leave world"), "the system menu offers to leave");
  fake_frame(fake, 0, 0);
  CHECK(fake_menu(fake, "leave world"), "it can be chosen on the shelf");
  fake_frame(fake, 0, 0);
  CHECK(fake_run_at(fake, PLAYER_MARGIN, 0) != NULL && strcmp(fake_run_at(fake, PLAYER_MARGIN, 0)->text, "Shelf") == 0,
        "where nothing is open it does nothing");
  fake_frame(fake, kButtonA, 0);
  frames = frames_until_reader(10000);
  CHECK(on_reader(), "the reader came up after %d frames", frames);
  fake->note_count = 0;
  CHECK(fake_menu(fake, "leave world"), "chosen in the reader");
  fake_frame(fake, 0, 0);
  CHECK(fake_run_at(fake, PLAYER_MARGIN, 0) != NULL && strcmp(fake_run_at(fake, PLAYER_MARGIN, 0)->text, "Shelf") == 0,
        "the next frame is the shelf");
  CHECK(fake->note_count == 1, "with the back cue: %d notes", fake->note_count);
  snprintf(command, sizeof command, "grep -l '\"kind\":\"departure\"' '%s'/saves/*.log >/dev/null", fake->data);
  CHECK(system(command) == 0, "the visitor left, and the departure is in the saved log");
  eventHandler(&fake->api, kEventTerminate, 0);
  CHECK(fake_menu_count(fake) == 0, "the items are taken out of the menu when the app ends");
  end();
}

/* Runs frames until the nickname screen is drawn, or `most` have run; how many ran. */
static int frames_until_nickname(int most) {
  int n;
  for (n = 1; n <= most && !on_nickname(); n++) fake_frame(fake, 0, 0);
  return n;
}

/* Whether a file of the Data folder's `saves/` ends in `suffix`. */
static bool saved_file(const char *suffix) {
  char command[1200];
  snprintf(command, sizeof command, "ls '%s'/saves/*%s >/dev/null 2>&1", fake->data, suffix);
  return system(command) == 0;
}

/*
 * "start over" in the system menu: chosen on the shelf it does nothing; chosen in the reader it asks
 * on screen what it will do, B goes back to the reader as it was, and A forgets the world's save, writes
 * the fresh world's at once, and brings the nickname screen up again, the name the visitor had offered
 * first, for a fresh arrival.
 */
static void start_over_in_the_system_menu_asks_and_begins_the_world_again(void) {
  static const char *const shipped[] = {"chip-tree.sproutworld"};
  const fake_run *first;
  char before[64], command[1200];
  int frames;
  begin("restart");
  app_folder("app");
  ship(shipped, 1);
  eventHandler(&fake->api, kEventInit, 0);
  CHECK(fake_menu_holds(fake, "start over") && fake_menu_holds(fake, "leave world"), "the system menu offers both items");
  fake_frame(fake, 0, 0);
  CHECK(fake_menu(fake, "start over"), "it can be chosen on the shelf");
  fake_frame(fake, 0, 0);
  CHECK(fake_run_at(fake, PLAYER_MARGIN, 0) != NULL && strcmp(fake_run_at(fake, PLAYER_MARGIN, 0)->text, "Shelf") == 0,
        "where nothing is open it does nothing");
  fake_frame(fake, kButtonA, 0);
  frames = frames_until_nickname(10000);
  CHECK(on_nickname(), "the nickname screen came up after %d frames", frames);
  fake_frame(fake, kButtonDown, 0);
  fake_frame(fake, 0, 0);
  CHECK(name_offered()[0] != '\0' && name_offered()[0] != '(', "a name is offered: %s", name_offered());
  snprintf(before, sizeof before, "%s", name_offered());
  frames = frames_until_reader(100);
  CHECK(on_reader(), "the reader came up after %d frames", frames);
  for (frames = 0; frames < 100 && !saved_file(".json"); frames++) fake_frame(fake, 0, 0);
  CHECK(saved_file(".json") && saved_file(".log"), "the arrival is saved over the frames after it: %d", frames);

  fake->note_count = 0;
  CHECK(fake_menu(fake, "start over"), "chosen in the reader");
  fake_frame(fake, 0, 0);
  CHECK(fake_run_at(fake, PLAYER_MARGIN, MESSAGE_TOP) != NULL &&
            strcmp(fake_run_at(fake, PLAYER_MARGIN, MESSAGE_TOP)->text, PLAYER_RESTART_QUESTION) == 0,
        "the question is asked on screen");
  CHECK(fake_run_at(fake, PLAYER_MARGIN, MESSAGE_TOP + LINE) != NULL &&
            strcmp(fake_run_at(fake, PLAYER_MARGIN, MESSAGE_TOP + LINE)->text, PLAYER_RESTART_WARNING) == 0,
        "and says what starting over does");
  CHECK(fake_run_at(fake, PLAYER_MARGIN, 240 - LINE - 2) != NULL &&
            strcmp(fake_run_at(fake, PLAYER_MARGIN, 240 - LINE - 2)->text, PLAYER_RESTART_KEYS) == 0,
        "with its keys");
  CHECK((int)strlen(PLAYER_RESTART_WARNING) * fake->serif_glyph <= 400 - 2 * PLAYER_MARGIN &&
            (int)strlen(PLAYER_RESTART_QUESTION) * fake->serif_glyph <= 400 - 2 * PLAYER_MARGIN,
        "each line fits the screen");
  CHECK(!on_reader(), "the reader is not drawn under it");
  fake_frame(fake, 0, 0);
  CHECK(fake_run_at(fake, PLAYER_MARGIN, MESSAGE_TOP) != NULL, "it stays until A or B");
  fake_frame(fake, kButtonB, 0);
  CHECK(on_reader(), "B goes back to the reader");
  first = fake_run_at(fake, 2, top());
  CHECK(first != NULL && strncmp(first->text, "- You are in ", 13) == 0, "as it was");
  CHECK(fake->note_count == 1 && saved_file(".json") && saved_file(".log"), "with the back cue, and nothing forgotten");

  fake_menu(fake, "start over");
  fake_frame(fake, 0, 0);
  fake_frame(fake, kButtonA, 0);
  CHECK(on_nickname(), "A brings the nickname screen up again, with no loading between");
  snprintf(command, sizeof command, "! grep -q '\"kind\"' '%s'/saves/*.log", fake->data);
  CHECK(saved_file(".json") && saved_file(".log") && system(command) == 0,
        "the save and the log are the fresh world's, written at once, with no entry from before");
  CHECK(strcmp(name_offered(), before) == 0, "the name the visitor had is offered first: %s, was %s", name_offered(), before);
  frames = frames_until_reader(100);
  CHECK(on_reader(), "the reader came up after %d frames", frames);
  snprintf(command, sizeof command, "test $(grep -c '\"kind\":\"arrival\"' '%s'/saves/*.log) -eq 1", fake->data);
  CHECK(system(command) == 0, "the new log holds the one fresh arrival and nothing from before");
  eventHandler(&fake->api, kEventTerminate, 0);
  end();
}

#define CAVERNS_INDEX "https://w.example/sprout/index.json"

static bool trusts_anything(void *ctx, const char *canonical, const char *signature) {
  (void)ctx;
  (void)canonical;
  (void)signature;
  return true;
}

/* Runs frames until the shelf's panel, or the download screen's, says `words`, or `most` have run; whether it did. */
static bool panel_until(const char *words, int most) {
  char said[2048];
  int n;
  for (n = 0; n < most; n++) {
    fake_frame(fake, 0, 0);
    panel_said(SHELF_PANEL + 2, said, sizeof said);
    if (HAS(said, words)) return true;
  }
  return false;
}

/*
 * The caverns are not shipped (sprout-player/worlds.json lists them as test-only): the app starts
 * on an empty shelf and they arrive by download, from an index listing the cartridge the gate packed
 * into `folder`, served whole. `cartridge` holds its bytes, from malloc, while the fake serves them.
 */
static bool caverns_downloaded(const char *folder, char **cartridge) {
  char command[2600], sha[65], hash[65], index[1024], served[1200];
  size_t bytes = 0;
  long size;
  FILE *file;
  player_opening seen;
  player_downloads *d;
  *cartridge = NULL;
  write_text(PLAYER_DOWNLOADS_SETTINGS, "{ \"indexUrl\": \"" CAVERNS_INDEX "\" }");
  snprintf(command, sizeof command, "mkdir -p '%s'/served && cp '%s'/underground_caverns.sproutworld '%s'/served/", fake->data, folder,
           fake->data);
  CHECK(system(command) == 0, "the caverns' cartridge is on the fake server");
  eventHandler(&fake->api, kEventInit, 0);
  fake_frame(fake, 0, 0);
  CHECK(strcmp(shelf_front(), "more worlds...") == 0 && running()->shelf->count == 0, "nothing is shipped: %s", shelf_front());
  seen = player_inspect(running()->session, "served/underground_caverns.sproutworld");
  CHECK(seen.ok && seen.hash != NULL, "%s", seen.reason != NULL ? seen.reason : "");
  snprintf(hash, sizeof hash, "%s", seen.ok && seen.hash != NULL ? seen.hash : "");
  CHECK(player_digest(&fake->api, "served/underground_caverns.sproutworld", sha, &bytes) == NULL, "the digest");
  snprintf(served, sizeof served, "%s/served/underground_caverns.sproutworld", fake->data);
  file = fopen(served, "rb");
  CHECK(file != NULL, "%s", served);
  if (file == NULL) return false;
  fseek(file, 0, SEEK_END);
  size = ftell(file);
  fseek(file, 0, SEEK_SET);
  *cartridge = (char *)malloc((size_t)size);
  CHECK(size > 0 && (size_t)size == bytes && fread(*cartridge, 1, bytes, file) == bytes, "reading %s", served);
  fclose(file);
  snprintf(index, sizeof index,
           "{\"worlds\":[{\"title\":\"Underground Caverns\",\"author\":\"studio\",\"version\":\"0.1.0\",\"bytes\":%zu,"
           "\"hash\":\"%s\",\"sha256\":\"%s\",\"url\":\"underground_caverns.sproutworld\"}],\"signed\":\"00\"}",
           bytes, hash, sha);
  fake_serve(fake, CAVERNS_INDEX, 200, index, strlen(index));
  fake_serve(fake, "https://w.example/sprout/underground_caverns.sproutworld", 200, *cartridge, bytes);
  fake->piece = 65536;
  fake_frame(fake, kButtonA, 0);
  d = running()->screen == &player_downloads_screen ? (player_downloads *)running()->ctx : NULL;
  CHECK(d != NULL, "A on more worlds opens the download screen");
  if (d == NULL) return false;
  d->trusts = trusts_anything; /* the index's signature is downloads.test.c's to check */
  CHECK(panel_until("A downloads it.", 20), "the caverns are listed");
  fake_frame(fake, kButtonA, 0);
  CHECK(panel_until("Underground Caverns is on your shelf.", 1000), "the caverns arrive whole");
  fake_frame(fake, kButtonB, 0);
  fake_frame(fake, 0, 0);
  CHECK(running()->screen == &player_shelf_screen && strcmp(shelf_front(), "Underground Caverns") == 0,
        "the shelf lists the caverns downloaded: %s", shelf_front());
  return strcmp(shelf_front(), "Underground Caverns") == 0;
}

/*
 * The arrival's log line is on disk when the reader comes up, and its state follows a slice a frame
 * behind it; opening the system menu (kEventPause) writes the rest at once. The world is the caverns,
 * the biggest state the gate has, downloaded as a player gets them.
 */
static void the_save_follows_the_reply_and_the_system_menu_finishes_it(void) {
  const char *folder = getenv("PLAYER_TEST_WORLDS_DIR");
  char command[2600], *cartridge = NULL;
  int slices = 0, drawn = 0;
  if (folder == NULL || folder[0] == '\0') {
    printf("ui: PLAYER_TEST_WORLDS_DIR is not set, the caverns' save is not watched\n");
    return;
  }
  begin("save-frames");
  app_folder("app");
  if (!caverns_downloaded(folder, &cartridge)) {
    if (fake->update != NULL) eventHandler(&fake->api, kEventTerminate, 0);
    free(cartridge);
    end();
    return;
  }
  fake_frame(fake, kButtonA, 0);
  frames_until_nickname(10000);
  fake_frame(fake, kButtonA, 0);
  CHECK(saved_file(".log") && !saved_file(".json"), "the arrival told, its log line is written and its state is not yet");
  while (!saved_file(".json") && slices < 1000) {
    fake_frame(fake, 0, 0);
    slices++;
    if (saved_file(".part") && on_reader()) drawn++;
  }
  CHECK(slices >= 1 && slices < 1000, "the caverns' state is written over frames of %u bytes: %d", PLAYER_SAVE_SLICE, slices);
  CHECK(drawn + 2 >= slices, "the reader is drawn in the frames it is written in: %d of %d", drawn, slices);
  snprintf(command, sizeof command, "rm -f '%s'/saves/*.json", fake->data);
  CHECK(system(command) == 0, "the save removed, to watch it written again");
  fake_menu(fake, "leave world");
  fake_frame(fake, 0, 0);
  CHECK(saved_file(".json") && !saved_file(".part"), "leaving writes the departure's save whole before the shelf");
  eventHandler(&fake->api, kEventTerminate, 0);
  free(cartridge);
  end();
}

/* The system menu opening writes what the save owes, whole, before the person can end the app from it. */
static void pausing_writes_the_save_owed(void) {
  static const char *const shipped[] = {"chip-tree.sproutworld"};
  begin("pause");
  app_folder("app");
  ship(shipped, 1);
  eventHandler(&fake->api, kEventInit, 0);
  fake_frame(fake, 0, 0);
  fake_frame(fake, kButtonA, 0);
  frames_until_nickname(10000);
  fake_frame(fake, kButtonA, 0);
  CHECK(!saved_file(".json") && !saved_file(".part"), "the arrival's state is owed");
  eventHandler(&fake->api, kEventPause, 0);
  CHECK(saved_file(".json") && !saved_file(".part"), "the pause wrote it whole");
  eventHandler(&fake->api, kEventTerminate, 0);
  end();
}

/* The status's lines drawn this frame in a font `line` tall. */
static int status_lines_at(int line) {
  int n = 0;
  while (n < READER_STATUS_MOST_LINES && fake_run_at(fake, 2, n * line) != NULL) n++;
  return n;
}

/* The transcript rows drawn this frame: the runs at the column's left under the status's lines, which are the frame's, top to bottom. */
static int column_runs(const fake_run **rows, int room) {
  int i, n = 0, under = status_lines_at(LINE) * LINE;
  for (i = 0; i < fake->run_count && n < room; i++)
    if (fake->runs[i].x == 2 && fake->runs[i].y >= under) rows[n++] = &fake->runs[i];
  return n;
}

/* Whether the bands drawn this frame, above `top` and from `bottom` down, are in the frame's font and every run between them in `body`, with some of each. */
static bool banded(fake_font body, int top, int bottom) {
  int i, frame = 0, between = 0;
  for (i = 0; i < fake->run_count; i++) {
    const fake_run *run = &fake->runs[i];
    bool band = run->y < top || run->y >= bottom;
    if (run->font != (band ? FAKE_FONT_SERIF : body)) return false;
    if (band)
      frame++;
    else
      between++;
  }
  return frame > 0 && between > 0;
}

/*
 * Whether the shelf was drawn last frame as it is at every size: its title and panel in the frame's
 * font, nothing in the body between, and its wheel's words in the wheel's.
 */
static bool shelf_drawn(void) {
  const wheel_label *front = wheel_placed(&running()->shelf->wheel, wheel_front_placed());
  int i;
  for (i = 0; i < fake->run_count; i++)
    if (fake->runs[i].font != FAKE_FONT_SERIF || (fake->runs[i].y >= SHELF_TOP && fake->runs[i].y < SHELF_PANEL)) return false;
  return fake->run_count > 0 && front != NULL && wheel_label_run(front)->font == FAKE_FONT_SANS;
}

/* The reader's bands this frame: `banded` under the status's lines and over its keys. */
static bool reader_banded(fake_font body) { return banded(body, status_lines_at(LINE) * LINE + 2, PANEL); }

/* The characters of the whole transcript, scrolled through from its top, without spaces, into `out`. */
static void transcript_ink(char *out, size_t size) {
  const fake_run *rows[64];
  int n, i;
  (void)size;
  out[0] = '\0';
  fake_frame(fake, 0, 12.0f * 1000);
  n = column_runs(rows, 64);
  for (i = 0; i < n; i++) ink(rows[i]->text, out);
  while (fake_run_at(fake, 390, 240 - LINE) != NULL) {
    fake_frame(fake, kButtonDown, 0);
    n = column_runs(rows, 64);
    ink(rows[n - 1]->text, out);
  }
}

/*
 * "text" in the system menu, S and L, S where nothing is remembered: set on the shelf, the body is
 * that font from the next frame, and the shelf, whose title and panel are the frame's and whose
 * words are the wheel's, is drawn as it was; set in the reader, the next frame draws the transcript
 * in that font, its rows spaced by its line height, as many as the column holds under the status's
 * frame lines, each no wider than the column, with everything told still there top to bottom; the
 * frame's font, the body's and the wheel's are the fonts held, each file once, so S, the frame's
 * own, and L, the wheel's, add none; the choice is written beside the saves, and the app started
 * again begins at it; a choice that cannot be written is taken all the same, and said not to be
 * remembered.
 */
static void text_in_the_system_menu_sets_the_size_and_is_remembered(void) {
  static const char *const shipped[] = {"printers_shop.sproutworld"};
  const char *const *options = NULL;
  const fake_run *rows[64];
  char *remembered;
  static char at_s[16384], at_l[16384];
  int frames, n, i;
  begin("text");
  app_folder("app");
  ship(shipped, 1);
  eventHandler(&fake->api, kEventInit, 0);
  CHECK(fake_menu_options(fake, PLAYER_TEXT_ITEM, &options) == 2 && strcmp(options[0], "S") == 0 && strcmp(options[1], "L") == 0,
        "the item offers S and L");
  CHECK(fake_menu_value(fake, PLAYER_TEXT_ITEM) == 0 && fake_fonts_held(fake) == 1, "S to begin with: the frame's font, which is S's, the one held");
  fake_frame(fake, 0, 0);
  CHECK(shelf_drawn() && fake_fonts_held(fake) == 2, "the shelf is drawn, the frame's font and the wheel's held");
  CHECK(fake_menu_set(fake, PLAYER_TEXT_ITEM, 1), "set to L on the shelf");
  fake_frame(fake, 0, 0);
  CHECK(running()->pen.size == PLAYER_TEXT_L && fake_fonts_held(fake) == 2, "the next frame the body is L, the wheel's file: two held");
  CHECK(shelf_drawn(), "and the shelf is drawn as it was");
  fake_menu_set(fake, PLAYER_TEXT_ITEM, 0);
  fake_frame(fake, 0, 0);
  CHECK(running()->pen.size == PLAYER_TEXT_S && shelf_drawn() && fake_fonts_held(fake) == 2, "and back to S, L kept for the wheel");

  fake_frame(fake, kButtonA, 0);
  frames = frames_until_reader(10000);
  CHECK(fake_run_at(fake, PLAYER_MARGIN, PANEL + 2) != NULL, "the reader came up after %d frames", frames);
  transcript_ink(at_s, sizeof at_s);
  CHECK(fake_menu_set(fake, PLAYER_TEXT_ITEM, 1), "set to L in the reader");
  fake_frame(fake, 0, 0);
  CHECK(reader_banded(FAKE_FONT_SANS) && fake_fonts_held(fake) == 2,
        "the next frame draws the transcript in L under the frame's status and over its keys, the two fonts held");
  n = column_runs(rows, 64);
  CHECK(n > 1 && (size_t)n == player_reader_rows(FAKE_SANS_LINE, LINE, (size_t)status_lines_at(LINE)),
        "the column holds the rows the L line height allows under the status's frame lines: %d", n);
  for (i = 1; i < n; i++) CHECK(rows[i]->y - rows[i - 1]->y == FAKE_SANS_LINE, "row %d is not an L line under the last", i);
  for (i = 0; i < n; i++)
    CHECK((int)strlen(rows[i]->text) * fake->sans_glyph <= 400 - 2 * PLAYER_MARGIN, "row %d is wider than the column in L: %s", i,
          rows[i]->text);
  transcript_ink(at_l, sizeof at_l);
  CHECK(strlen(at_s) > 0 && strcmp(at_s, at_l) == 0, "wrapped again in L, the transcript is what it was:\n%s\n%s", at_s, at_l);
  remembered = file_text(PLAYER_TEXT_SIZE_FILE);
  CHECK(remembered != NULL && strcmp(remembered, "L") == 0, "the choice is written beside the saves: %s",
        remembered != NULL ? remembered : "(none)");
  free(remembered);
  eventHandler(&fake->api, kEventTerminate, 0);
  CHECK(fake_fonts_held(fake) == 0 && fake_menu_count(fake) == 0, "the font and the item go with the app");

  eventHandler(&fake->api, kEventInit, 0);
  CHECK(fake_menu_value(fake, PLAYER_TEXT_ITEM) == 1, "started again, the item shows L");
  fake_frame(fake, 0, 0);
  CHECK(running()->pen.size == PLAYER_TEXT_L && shelf_drawn() && fake_fonts_held(fake) == 2,
        "and the body is L, the wheel's file, on a shelf drawn as ever");
  fake_menu_set(fake, PLAYER_TEXT_ITEM, 0);
  fake_frame(fake, 0, 0);
  remembered = file_text(PLAYER_TEXT_SIZE_FILE);
  CHECK(remembered != NULL && strcmp(remembered, "S") == 0, "set back to S, S is written: %s", remembered != NULL ? remembered : "(none)");
  free(remembered);

  fake->fail_writes = 1;
  fake_menu_set(fake, PLAYER_TEXT_ITEM, 1);
  fake_frame(fake, 0, 0);
  fake->fail_writes = 0;
  CHECK(fake_run_at(fake, PLAYER_MARGIN, MESSAGE_TOP) != NULL &&
            strncmp(fake_run_at(fake, PLAYER_MARGIN, MESSAGE_TOP)->text, PLAYER_TEXT_UNKEPT, 20) == 0 && banded(FAKE_FONT_SANS, 0, PANEL),
        "a choice that cannot be written is taken, in L, and the screen says it is not remembered, its key in the frame's font");
  fake_frame(fake, kButtonA, 0);
  CHECK(shelf_drawn() && running()->pen.size == PLAYER_TEXT_L, "A puts the shelf back, the body in L");
  remembered = file_text(PLAYER_TEXT_SIZE_FILE);
  CHECK(remembered != NULL && strcmp(remembered, "S") == 0, "S is what stays remembered: %s", remembered != NULL ? remembered : "(none)");
  free(remembered);
  eventHandler(&fake->api, kEventTerminate, 0);
  end();
}

/*
 * A size whose font the device does not have: the pen keeps the font it has, the item goes back to
 * that size, and the screen says so until A, which puts the screen on show back; the same at the
 * start, where the size remembered cannot be had and S is used; once the device has the font, the
 * size is taken.
 */
static void a_font_the_device_does_not_have_leaves_the_text_as_it_was_and_says_so(void) {
  static const char *const shipped[] = {"chip-tree.sproutworld"};
  const fake_run *said;
  char *remembered;
  begin("nofont");
  app_folder("app");
  ship(shipped, 1);
  snprintf(fake->missing_font, sizeof fake->missing_font, "%s", PLAYER_TEXT_SIZE_FONTS[PLAYER_TEXT_L]);
  write_text(PLAYER_TEXT_SIZE_FILE, "L");
  eventHandler(&fake->api, kEventInit, 0);
  CHECK(fake_menu_value(fake, PLAYER_TEXT_ITEM) == 0 && fake_fonts_held(fake) == 1, "L remembered but not to be had: S, one font");
  fake_frame(fake, 0, 0);
  said = fake_run_at(fake, PLAYER_MARGIN, MESSAGE_TOP);
  CHECK(said != NULL && HAS(said->text, PLAYER_TEXT_KEPT) && banded(FAKE_FONT_SERIF, 0, PANEL), "the first frame says so, in S: %s",
        said != NULL ? said->text : "(none)");
  CHECK(fake_run_at(fake, PLAYER_MARGIN, 0) == NULL, "the shelf waits under the notice");
  fake_frame(fake, kButtonA, 0);
  CHECK(fake_run_at(fake, PLAYER_MARGIN, 0) != NULL && strcmp(fake_run_at(fake, PLAYER_MARGIN, 0)->text, "Shelf") == 0,
        "A puts the shelf back");

  fake_menu_set(fake, PLAYER_TEXT_ITEM, 1);
  fake_frame(fake, 0, 0);
  said = fake_run_at(fake, PLAYER_MARGIN, MESSAGE_TOP);
  CHECK(said != NULL && HAS(said->text, PLAYER_TEXT_KEPT) && HAS(said->text, "no such font"),
        "set to L from the menu, the screen says the text stays and why: %s", said != NULL ? said->text : "(none)");
  CHECK(fake_menu_value(fake, PLAYER_TEXT_ITEM) == 0 && fake_fonts_held(fake) == 1 && banded(FAKE_FONT_SERIF, 0, PANEL),
        "the item is back to S and the pen keeps its font");
  CHECK(fake_run_at(fake, PLAYER_MARGIN, 240 - LINE - 2) != NULL &&
            strcmp(fake_run_at(fake, PLAYER_MARGIN, 240 - LINE - 2)->text, PLAYER_NOTICE_KEYS) == 0,
        "with its key");
  fake_frame(fake, 0, 0);
  CHECK(fake_run_at(fake, PLAYER_MARGIN, MESSAGE_TOP) != NULL, "it stays until A or B");
  fake_frame(fake, kButtonB, 0);
  CHECK(fake_run_at(fake, PLAYER_MARGIN, 0) != NULL && strcmp(fake_run_at(fake, PLAYER_MARGIN, 0)->text, "Shelf") == 0,
        "B puts the shelf back");
  remembered = file_text(PLAYER_TEXT_SIZE_FILE);
  CHECK(remembered != NULL && strcmp(remembered, "L") == 0, "what was remembered stays: %s", remembered != NULL ? remembered : "(none)");
  free(remembered);
  fake->missing_font[0] = '\0';
  fake_menu_set(fake, PLAYER_TEXT_ITEM, 1);
  fake_frame(fake, 0, 0);
  CHECK(running()->pen.size == PLAYER_TEXT_L && shelf_drawn() && fake_menu_value(fake, PLAYER_TEXT_ITEM) == 1,
        "L, once the device has it, is taken");
  eventHandler(&fake->api, kEventTerminate, 0);
  end();
}

/*
 * The reader's rows at each text size, under a status of one line in the frame: the column holds
 * some, they fit between the frame's bands, a taller body line means fewer, and a taller frame
 * costs rows of whatever body.
 */
static void the_reader_fits_its_rows_to_each_text_size(void) {
  const int room = 240 - (FAKE_SERIF_LINE + 2) - (FAKE_SERIF_LINE + 4);
  size_t s = player_reader_rows(FAKE_SERIF_LINE, FAKE_SERIF_LINE, 1), l = player_reader_rows(FAKE_SANS_LINE, FAKE_SERIF_LINE, 1);
  begin("rows");
  CHECK(l > 1 && s > l, "L's taller line leaves fewer rows than S's: S %zu, L %zu rows", s, l);
  CHECK((int)s * FAKE_SERIF_LINE <= room && (int)l * FAKE_SANS_LINE <= room, "each fits between the bands");
  CHECK(player_reader_rows(FAKE_SERIF_LINE, 2 * FAKE_SERIF_LINE, 1) < s, "a taller frame leaves fewer rows");
  CHECK(s <= READER_MOST_ROWS, "no more than the reader can show");
  end();
}

int main(void) {
  test_program("ui");
  main_sets_the_update_callback_and_the_app_saves_at_terminate();
  the_reader_shows_the_arrival_under_the_status_line();
  the_rows_fill_the_column_under_the_status();
  a_status_past_three_lines_is_clipped_and_the_transcript_keeps_its_rows();
  on_a_fresh_install_the_shelf_holds_only_more_worlds();
  a_cartridge_that_cannot_be_opened_is_told_in_words();
  the_reader_ticks_while_awake_and_tells_what_a_tick_told();
  a_due_tick_waits_for_the_hands_to_rest();
  leave_world_in_the_system_menu_goes_back_to_the_shelf();
  start_over_in_the_system_menu_asks_and_begins_the_world_again();
  the_save_follows_the_reply_and_the_system_menu_finishes_it();
  pausing_writes_the_save_owed();
  text_in_the_system_menu_sets_the_size_and_is_remembered();
  a_font_the_device_does_not_have_leaves_the_text_as_it_was_and_says_so();
  the_reader_fits_its_rows_to_each_text_size();
  return finish();
}
