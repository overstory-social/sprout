/*
 * ui/shelf.c: the shelf screen, driven through the app a frame at a time. The rules: it lists the
 * cartridges at the root and in worlds/ of the app and the Data folder, each once, in path order,
 * titled by the world's title or else its name as words, and nothing else, each a word on the wheel and "more worlds..." the
 * last; the wheel turns with the d-pad and the crank, a step as the crank passes halfway, ticking
 * and settling with a clack, and wraps through "more worlds..."; a world refused at its open keeps
 * the reason on the shelf, greyed, the reason on the panel; a world whose save could not be written
 * is greyed until a save of it succeeds; the wheel's labels go when the shelf's screen does. Of
 * the builds of one world, one title and author, only the newest is a word, by the ranking the
 * download screen uses (newest.h), and the first in path order among equals; the others stay on
 * disk, still on the shelf to the download screen, and a newest refused at its open stays the
 * word, greyed; a world by another author is a word of its own. The newest opens with the save of
 * the newest build it outranks that has one, where it has none of its own: carried, told, and the
 * newer's from then on, under a version that keeps it; anew and told once under one that breaks it,
 * the old save kept; anew and quietly where no build has a save; and a carried world started over
 * stays so.
 */
#include <stdlib.h>

#include "host/pd_host.h"
#include "support.h"
#include "ui/app.h"
#include "ui/message.h"
#include "ui/nickname.h"
#include "ui/reader.h"
#include "ui/shelf.h"
#include "ui/transcript.h"
#include "wheel_support.h"

#define LINE FAKE_SERIF_LINE
#define PANEL (240 - (LINE * 3 + 8) + 2)

static player_app *app;

static void start(void) {
  const char *why = NULL;
  app = player_app_new(&fake->api, &why);
  CHECK(app != NULL, "%s", why);
  fake->api.system->setUpdateCallback(player_app_update, app);
}

/* The word at the wheel's front, drawn last frame. */
static const char *front(void) { return wheel_front(&app->shelf->wheel); }

/* The label of entry `n` on the wheel, drawn last frame, or NULL. */
static const wheel_label *label(size_t n) {
  int at = wheel_placed_entry(&app->shelf->wheel, n);
  return at >= 0 ? wheel_placed(&app->shelf->wheel, at) : NULL;
}

static const char *word(size_t n) { return label(n) != NULL ? wheel_label_text(label(n)) : ""; }

static bool greyed(size_t n) { return label(n) != NULL && wheel_label_greyed(label(n)); }

static const fake_note *last_note(void) { return fake->note_count > 0 ? &fake->notes[fake->note_count - 1] : NULL; }

static bool sounded(SoundWaveform wave, float pitch) {
  const fake_note *note = last_note();
  return note != NULL && note->wave == wave && note->pitch == pitch;
}

static const char *panel(void) {
  const fake_run *run = fake_run_at(fake, PLAYER_MARGIN, PANEL);
  return run != NULL ? run->text : "";
}

/* Copies a packed cartridge to `path` under `folder` ("app" or "data"). */
static void put(const char *folder, const char *cartridge, const char *path) {
  char command[2400];
  snprintf(command, sizeof command, "mkdir -p \"$(dirname '%s/%s')\" && cp '%s/%s' '%s/%s'",
           strcmp(folder, "app") == 0 ? fake->app : fake->data, path, PLAYER_CARTRIDGES, cartridge,
           strcmp(folder, "app") == 0 ? fake->app : fake->data, path);
  CHECK(system(command) == 0, "%s", command);
}

/* What the next frame presses: A on the nickname screen, which enters the name offered first, else nothing. */
static PDButtons enter_name(void) { return app->screen == &player_nickname_screen ? kButtonA : 0; }

/* Runs frames until the reader is up, or `most` have run; whether it came up. */
static bool reader_within(int most) {
  int n;
  for (n = 0; n < most; n++) {
    fake_frame(fake, enter_name(), 0);
    if (app->screen == &player_reader_screen) return true;
  }
  return app->screen == &player_reader_screen;
}

static void the_shelf_lists_the_shipped_worlds_once_in_path_order(void) {
  begin("lists");
  app_folder("app");
  put("app", "teashop.sproutworld", "teashop.sproutworld");
  put("app", "printers_shop.sproutworld", "worlds/printers_shop.sproutworld");
  put("data", "printers_shop.sproutworld", "worlds/printers_shop.sproutworld"); /* the Data folder's copy shadows the app's */
  put("data", "chip-tree.sproutworld", "worlds/zz_renamed.sproutworld");
  write_text("worlds/notes.txt", "not a cartridge");
  write_text("worlds/.sproutworld", "only a suffix");
  start();
  fake_frame(fake, 0, 0);
  CHECK(app->shelf->count == 3, "three cartridges, each once: %zu", app->shelf->count);
  CHECK(strcmp(front(), "Teashop") == 0 && strcmp(word(0), "Teashop") == 0, "the root's cartridge, at the front: %s", front());
  CHECK(strcmp(word(1), "Printers Shop") == 0, "%s", word(1));
  CHECK(strcmp(word(2), "Chip Tree") == 0, "a cartridge is titled by its world's name, not its file's: %s", word(2));
  CHECK(strcmp(word(3), "more worlds...") == 0, "more worlds comes last: %s", word(3));
  CHECK(fake->placed_count == 4 && !greyed(0) && !greyed(1) && !greyed(2) && !greyed(3), "each word once, none greyed");
  CHECK(strcmp(panel(), "A opens it.") == 0, "%s", panel());
  CHECK(fake_run_at(fake, PLAYER_MARGIN, 0) != NULL && strcmp(fake_run_at(fake, PLAYER_MARGIN, 0)->text, "Shelf") == 0, "the title");
  player_app_free(app);
  end();
}

static void the_wheel_turns_with_the_d_pad_and_the_crank_and_wraps(void) {
  static const char *const shipped[] = {"teashop.sproutworld", "printers_shop.sproutworld"};
  int n;
  begin("moves");
  app_folder("app");
  ship(shipped, 2);
  start();
  fake_frame(fake, 0, 0);
  CHECK(app->shelf->selected == 0, "the first is selected");
  fake->note_count = 0;
  fake_frame(fake, kButtonDown, 0);
  CHECK(app->shelf->selected == 1 && strcmp(front(), "Teashop") == 0, "down: %s", front());
  CHECK(fake->note_count == 1 && sounded(kWaveformNoise, 3000.0f), "with a tick");
  fake_frame(fake, 0, 11.0f);
  CHECK(app->shelf->selected == 1, "eleven degrees is short of halfway to the next");
  fake_frame(fake, 0, 2.0f);
  CHECK(app->shelf->selected == 2 && strcmp(front(), "more worlds...") == 0, "thirteen is past it: %s", front());
  CHECK(fake->note_count == 2 && sounded(kWaveformNoise, 3000.0f), "a step of the crank ticks");
  CHECK(strcmp(panel(), "A looks for more worlds to download.") == 0, "the panel says what more worlds is: %s", panel());
  for (n = 0; n < DISC_REST_FRAMES + 20; n++) fake_frame(fake, 0, 0);
  CHECK(fake->note_count == 3 && sounded(kWaveformSquare, 160.0f), "resting, the wheel settles with a clack");
  fake_frame(fake, kButtonDown, 0);
  CHECK(app->shelf->selected == 0, "down from the last wraps to the first");
  fake_frame(fake, kButtonUp, 0);
  CHECK(app->shelf->selected == 2, "up from the first wraps to the last");
  fake_frame(fake, 0, -48.0f);
  CHECK(app->shelf->selected == 0 && strcmp(front(), word(0)) == 0, "the crank back two words: %s", front());
  fake_frame(fake, kButtonA, 0);
  CHECK(app->screen != &player_shelf_screen && app->shelf->wheel.labels == NULL, "A opens the world at the front, and the wheel's labels go");
  player_app_free(app);
  end();
}

static void opening_a_world_reaches_the_reader(void) {
  static const char *const shipped[] = {"printers_shop.sproutworld"};
  begin("opens");
  app_folder("app");
  ship(shipped, 1);
  start();
  fake_frame(fake, 0, 0);
  fake_frame(fake, kButtonA, 0);
  CHECK(fake_run_at(fake, PLAYER_MARGIN, 0) != NULL && HAS(fake_run_at(fake, PLAYER_MARGIN, 0)->text, "Loading Printers Shop... 0%"),
        "A shows the loading line");
  CHECK(reader_within(10000), "the reader came up");
  player_app_free(app);
  end();
}

static void a_world_refused_at_its_open_keeps_the_reason_on_the_shelf(void) {
  char command[2400], *why;
  int n;
  begin("open-refused");
  app_folder("app");
  put("data", "printers_shop.sproutworld", "worlds/printers_shop.sproutworld");
  /* The header and its caps are whole, so the shelf takes it; the body is scrambled, so reading it fails. */
  snprintf(command, sizeof command,
           "dd if=/dev/zero of='%s/worlds/printers_shop.sproutworld' bs=1 seek=20000 count=4000 conv=notrunc status=none",
           fake->data);
  CHECK(system(command) == 0, "%s", command);
  start();
  fake_frame(fake, 0, 0);
  CHECK(strcmp(front(), "Printers Shop") == 0 && !greyed(0), "inspected, it can be shelved: %s", front());
  fake_frame(fake, kButtonA, 0);
  for (n = 0; n < 1000 && app->screen != &player_message_screen; n++) fake_frame(fake, 0, 0);
  CHECK(app->screen == &player_message_screen, "the open was refused on the message screen");
  why = strdup(fake_run_at(fake, PLAYER_MARGIN, MESSAGE_TOP) != NULL ? fake_run_at(fake, PLAYER_MARGIN, MESSAGE_TOP)->text : "");
  CHECK(why[0] != '\0', "the message says why");
  fake_frame(fake, kButtonB, 0);
  CHECK(app->screen == &player_shelf_screen, "B goes back to the shelf");
  CHECK(strcmp(front(), "Printers Shop") == 0 && greyed(0), "the shelf keeps the refusal, the world greyed: %s", front());
  CHECK(strncmp(panel(), why, strlen(panel())) == 0, "the panel gives the same reason: %s / %s", panel(), why);
  fake_frame(fake, kButtonA, 0);
  CHECK(app->screen == &player_message_screen, "A on it tells the reason again and opens nothing");
  free(why);
  player_app_free(app);
  end();
}

static void a_world_whose_save_failed_is_greyed_until_a_save_is_written(void) {
  static const char *const shipped[] = {"printers_shop.sproutworld"};
  int n;
  begin("unsaved");
  app_folder("app");
  ship(shipped, 1);
  start();
  fake_frame(fake, 0, 0);
  fake->fail_writes = 1;
  fake_frame(fake, kButtonA, 0);
  for (n = 0; n < 10000 && app->screen != &player_message_screen && app->screen != &player_reader_screen; n++) fake_frame(fake, enter_name(), 0);
  CHECK(app->screen == &player_message_screen, "the arrival stopped on the message screen");
  CHECK(fake_run_at(fake, PLAYER_MARGIN, MESSAGE_TOP) != NULL &&
            HAS(fake_run_at(fake, PLAYER_MARGIN, MESSAGE_TOP)->text, "The save could not be written"),
        "it says the save failed");
  fake_frame(fake, kButtonA, 0);
  CHECK(strcmp(front(), "Printers Shop") == 0 && greyed(0), "greyed on the shelf: %s", front());
  CHECK(HAS(panel(), "The save could not be written"), "the panel says why: %s", panel());
  fake_frame(fake, kButtonA, 0);
  for (n = 0; n < 10000 && app->screen != &player_message_screen && app->screen != &player_reader_screen; n++) fake_frame(fake, enter_name(), 0);
  CHECK(app->screen == &player_message_screen, "still unwritable, it stops again");
  fake_frame(fake, kButtonA, 0);
  fake->fail_writes = 0;
  fake_frame(fake, kButtonA, 0);
  CHECK(reader_within(10000), "with room again, A opens it and the reader comes up");
  CHECK(!player_shelf_blocked(app->shelf, "worlds/printers_shop.sproutworld"), "and the world is no longer greyed");
  player_app_free(app);
  end();
}

static void a_world_is_titled_by_its_title_or_its_name_as_words(void) {
  char title[64];
  begin("titles");
  player_world_title("printers_shop", NULL, title, sizeof title);
  CHECK(strcmp(title, "Printers Shop") == 0, "%s", title);
  player_world_title("old_3d_room's_door", NULL, title, sizeof title);
  CHECK(strcmp(title, "Old 3D Room's Door") == 0, "%s", title);
  player_world_title("printers_shop", NULL, title, 5);
  CHECK(strcmp(title, "Prin") == 0, "cut to the room: %s", title);
  player_world_title("underground_caverns_2", "Underground Caverns 2: The Revenge", title, sizeof title);
  CHECK(strcmp(title, "Underground Caverns 2: The Revenge") == 0, "the title, as written: %s", title);
  player_world_title("printers_shop", "", title, sizeof title);
  CHECK(strcmp(title, "Printers Shop") == 0, "an empty title is none: %s", title);
  end();
}

#define TITLED "Titled: A World Shown by Its Title"

static void a_titled_world_is_shown_by_its_title_from_the_shelf_to_the_reader(void) {
  const player_reader *reader;
  const char *first;
  int n;
  begin("titled");
  app_folder("app");
  put("app", "titled.sproutworld", "titled.sproutworld");
  start();
  fake_frame(fake, 0, 0);
  CHECK(strcmp(front(), TITLED) == 0, "the shelf shows the manifest's title: %s", front());
  fake_frame(fake, kButtonA, 0);
  CHECK(fake_run_at(fake, PLAYER_MARGIN, 0) != NULL && HAS(fake_run_at(fake, PLAYER_MARGIN, 0)->text, "Loading " TITLED "... "),
        "the loading line names it by its title");
  for (n = 0; n < 10000 && app->screen != &player_nickname_screen; n++) fake_frame(fake, 0, 0);
  CHECK(app->screen == &player_nickname_screen, "the picker came up");
  CHECK(fake_run_at(fake, PLAYER_MARGIN, 0) != NULL && strcmp(fake_run_at(fake, PLAYER_MARGIN, 0)->text, "Who are you in " TITLED "?") == 0,
        "the picker asks by the title: %s", fake_run_at(fake, PLAYER_MARGIN, 0) != NULL ? fake_run_at(fake, PLAYER_MARGIN, 0)->text : "");
  CHECK(reader_within(10000), "the reader came up");
  reader = (const player_reader *)app->ctx;
  first = reader->lines.count > 0 ? reader->lines.paragraphs[reader->lines.first].bytes : "";
  /* The line is wrapped to the column, so the title is its first row whole. */
  CHECK(strncmp(first, "- You are in " TITLED " as", strlen("- You are in " TITLED " as")) == 0,
        "the reader's first line names it by its title: %s", first);
  player_app_free(app);
  end();
}

/* ---- builds of one world ---- */

/* The path of the world entry `n` of the shelf is, or "". */
static const char *path_of(size_t n) { return n < app->shelf->count ? app->shelf->entries[n].path : ""; }

static void of_two_builds_of_one_world_the_wheel_shows_the_newer(void) {
  static const char *const shipped[] = {"printers_shop.sproutworld"};
  int arrangement;
  /* The newer build last in path order, then first, so neither the path nor the order found decides. */
  for (arrangement = 0; arrangement < 2; arrangement++) {
    const char *newer = arrangement == 0 ? "worlds/teashop-b.sproutworld" : "worlds/teashop-a.sproutworld";
    const char *older = arrangement == 0 ? "worlds/teashop-a.sproutworld" : "worlds/teashop-b.sproutworld";
    begin(arrangement == 0 ? "newer-last" : "newer-first");
    app_folder("app");
    ship(shipped, 1);
    build_of(older, "0.9.0", "Ada", '3');
    build_of(newer, "1.0.0", "Ada", '4');
    start();
    fake_frame(fake, 0, 0);
    CHECK(app->shelf->count == 2 && app->shelf->held == 3, "three cartridges, two worlds: %zu of %zu", app->shelf->count,
          app->shelf->held);
    CHECK(strcmp(word(0), "Printers Shop") == 0 && strcmp(word(1), "Teashop") == 0 &&
              strcmp(word(2), "more worlds...") == 0 && fake->placed_count == 3,
          "the teashop is one word: %s, %s, %s", word(0), word(1), word(2));
    CHECK(strcmp(path_of(1), newer) == 0, "the word is the newer build: %s", path_of(1));
    CHECK(exists(older), "the older build stays on disk");
    fake_frame(fake, kButtonDown, 0);
    fake_frame(fake, kButtonA, 0);
    CHECK(strcmp(app->shelf->opened, newer) == 0, "A opens the newer build: %s", app->shelf->opened);
    player_app_free(app);
    end();
  }
}

static void an_outranked_build_is_held_and_a_refused_newest_is_not_shown_through(void) {
  const shelf_entry *outranked;
  begin("outranked");
  app_folder("app");
  build_of("worlds/teashop-a.sproutworld", "0.9.0", "Ada", '3');
  build_of("worlds/teashop-b.sproutworld", "1.0.0", "Ada", '4');
  start();
  fake_frame(fake, 0, 0);
  outranked = app->shelf->held == 2 ? &app->shelf->entries[1] : NULL;
  CHECK(outranked != NULL && strcmp(outranked->path, "worlds/teashop-a.sproutworld") == 0, "the older build is held, unlisted");
  CHECK(outranked != NULL && player_shelf_holds(app->shelf, outranked->hash),
        "an outranked build counts as on the shelf, so the download screen does not offer it again");
  player_shelf_refuse(app->shelf, "worlds/teashop-b.sproutworld", "Refused.");
  player_shelf_list(app);
  fake_frame(fake, 0, 0);
  CHECK(app->shelf->count == 1 && strcmp(path_of(0), "worlds/teashop-b.sproutworld") == 0 && greyed(0),
        "the newest, refused at its open, stays the word, greyed: %s", path_of(0));
  CHECK(strcmp(panel(), "Refused.") == 0, "with its reason: %s", panel());
  player_app_free(app);
  end();
}

static void of_builds_of_one_version_the_first_in_path_order_is_shown(void) {
  begin("equal");
  app_folder("app");
  build_of("worlds/teashop-b.sproutworld", "0.1.0", "Ada", '3');
  build_of("worlds/teashop-a.sproutworld", "0.1.0", "Ada", '4');
  start();
  fake_frame(fake, 0, 0);
  CHECK(app->shelf->count == 1 && app->shelf->held == 2, "two cartridges, one world: %zu of %zu", app->shelf->count,
        app->shelf->held);
  CHECK(strcmp(path_of(0), "worlds/teashop-a.sproutworld") == 0, "the first found: %s", path_of(0));
  player_app_free(app);
  end();
}

static void a_world_of_one_title_by_another_author_is_a_word_of_its_own(void) {
  begin("authors");
  app_folder("app");
  build_of("worlds/teashop-a.sproutworld", "0.1.0", "Ada", '3');
  build_of("worlds/teashop-b.sproutworld", "0.2.0", "Bob", '4');
  start();
  fake_frame(fake, 0, 0);
  CHECK(app->shelf->count == 2 && strcmp(word(0), "Teashop") == 0 && strcmp(word(1), "Teashop") == 0,
        "two words: %zu, %s, %s", app->shelf->count, word(0), word(1));
  player_app_free(app);
  end();
}

/* ---- a save across versions ---- */

#define OLDER_BUILD "worlds/teashop-a.sproutworld"
#define NEWER_BUILD "worlds/teashop-b.sproutworld"

/* The teashop at 0.1.0 played, apart from the app, by Alder into the kitchen, who left; and a build at `newer` beside it. Its hash into `older`. */
static void played_the_older(const char *newer, char *older) {
  sprout_filling way = fill_exit("way", "north", "through the bead curtain", "teashop.kitchen");
  player_session *s = session_new();
  player_opening opened;
  build_of(OLDER_BUILD, "0.1.0", "Ada", '3');
  opened = player_open_whole(s, OLDER_BUILD);
  snprintf(older, 72, "%s", opened.ok ? opened.hash : "");
  player_load(s, NULL);
  player_admit(s, "Alder");
  CHECK(turn_of(s, "sprout.go", NULL, 1, &way).committed, "Alder goes north in the older build");
  player_close(s);
  build_of(NEWER_BUILD, newer, "Ada", '4');
}

/* The reader's transcript, every line of every paragraph oldest first, joined by spaces. */
static const char *told_so_far(void) {
  static char all[32768];
  const transcript *t = &((player_reader *)app->ctx)->lines;
  size_t at = 0, i, k;
  all[0] = '\0';
  for (i = 0; i < t->count; i++) {
    const wrapped *paragraph = &t->paragraphs[(t->first + i) % TRANSCRIPT_KEEP];
    const char *line = paragraph->bytes;
    for (k = 0; k < paragraph->line_count; k++, line = wrap_next(line))
      at += (size_t)snprintf(all + at, sizeof all - at, "%s ", line);
  }
  return all;
}

/* Where the app's visitor stands, by place id, or "". */
static const char *standing(void) {
  static char place[100];
  const char *words;
  const sprout_seen_view *view = player_view(app->session, &words);
  snprintf(place, sizeof place, "%.*s", view != NULL ? (int)view->place.id.length : 0, view != NULL ? view->place.id.bytes : "");
  return place;
}

/* Opens the world at the shelf's front and runs frames until the reader is up; whether it came up. */
static bool opened_to_the_reader(void) {
  fake_frame(fake, 0, 0);
  fake_frame(fake, kButtonA, 0);
  return reader_within(10000);
}

static void a_newer_compatible_build_opens_with_the_older_save(void) {
  char older[72], state[200], log[200], newer_state[200], newer_log[200];
  const shelf_entry *earlier;
  begin("carried");
  app_folder("app");
  played_the_older("0.1.1", older);
  start();
  fake_frame(fake, 0, 0);
  CHECK(app->shelf->count == 1 && strcmp(path_of(0), NEWER_BUILD) == 0, "the wheel shows the newer build: %s", path_of(0));
  earlier = player_shelf_earlier(app, app->shelf, &app->shelf->entries[0]);
  CHECK(earlier != NULL && strcmp(earlier->path, OLDER_BUILD) == 0, "the older build's save is the one to carry");
  CHECK(opened_to_the_reader(), "the reader came up");
  CHECK(HAS(told_so_far(), "You are in Teashop as Alder.") &&
            HAS(told_so_far(), "This world is now version 0.1.1, and your place in it carries over from version 0.1.0."),
        "the save's name was offered first, and the player is told: %s", told_so_far());
  CHECK(strcmp(standing(), "teashop.kitchen") == 0, "back where they left the older build: %s", standing());
  save_paths(older, state, log, sizeof state);
  save_paths(app->shelf->entries[0].hash, newer_state, newer_log, sizeof newer_state);
  player_app_free(app);
  CHECK(exists(newer_state) && exists(state) && exists(OLDER_BUILD),
        "the save is now the newer build's, and the older build and its save stay on disk, hidden");

  start();
  CHECK(opened_to_the_reader() && !HAS(told_so_far(), "carries over"), "the next opening says nothing of it: %s", told_so_far());
  player_app_free(app);
  end();
}

static void a_newer_breaking_build_starts_anew_and_says_so_once(void) {
  char older[72], state[200], log[200];
  char *before, *after;
  begin("outgrown");
  app_folder("app");
  played_the_older("0.2.0", older);
  save_paths(older, state, log, sizeof state);
  before = file_text(state);
  start();
  CHECK(opened_to_the_reader(), "the reader came up");
  CHECK(HAS(told_so_far(), "This world has changed too much since version 0.1.0 for your old save, so it starts again from "
                           "the beginning. Your old save is kept."),
        "the player is told before any move of theirs: %s", told_so_far());
  CHECK(strcmp(standing(), "teashop.front_room") == 0, "where the world begins: %s", standing());
  player_app_free(app);
  after = file_text(state);
  CHECK(before != NULL && after != NULL && strcmp(before, after) == 0 && exists(log), "the old save is kept as it was");
  free(before);
  free(after);

  start();
  CHECK(opened_to_the_reader() && !HAS(told_so_far(), "changed too much"), "told once: %s", told_so_far());
  player_app_free(app);
  end();
}

static void of_two_builds_with_no_save_the_newer_starts_anew_quietly(void) {
  begin("two-unsaved");
  app_folder("app");
  build_of(OLDER_BUILD, "0.1.0", "Ada", '3');
  build_of(NEWER_BUILD, "0.1.1", "Ada", '4');
  start();
  fake_frame(fake, 0, 0);
  CHECK(player_shelf_earlier(app, app->shelf, &app->shelf->entries[0]) == NULL, "no build has a save to carry");
  CHECK(opened_to_the_reader(), "the reader came up");
  CHECK(!HAS(told_so_far(), "version"), "nothing is said of versions: %s", told_so_far());
  CHECK(strcmp(standing(), "teashop.front_room") == 0, "where the world begins: %s", standing());
  player_app_free(app);
  end();
}

/* A carried world started over is written at once, so leaving before arriving does not carry the older save into it again. */
static void a_carried_world_started_over_stays_started_over(void) {
  char older[72];
  int n;
  begin("carried-restart");
  app_folder("app");
  played_the_older("0.1.1", older);
  start();
  CHECK(opened_to_the_reader() && strcmp(standing(), "teashop.kitchen") == 0, "carried: %s", standing());
  CHECK(fake_menu(fake, "start over"), "start over, chosen in the reader");
  fake_frame(fake, 0, 0);
  fake_frame(fake, kButtonA, 0);
  CHECK(app->screen == &player_nickname_screen, "the nickname screen is up again");
  fake_frame(fake, kButtonB, 0);
  for (n = 0; n < 10 && app->screen != &player_shelf_screen; n++) fake_frame(fake, 0, 0);
  CHECK(app->screen == &player_shelf_screen, "B goes back to the shelf without arriving");
  CHECK(opened_to_the_reader(), "opened again");
  CHECK(!HAS(told_so_far(), "carries over") && strcmp(standing(), "teashop.front_room") == 0,
        "the world stays started over: %s", standing());
  player_app_free(app);
  end();
}

int main(void) {
  test_program("shelf");
  the_shelf_lists_the_shipped_worlds_once_in_path_order();
  the_wheel_turns_with_the_d_pad_and_the_crank_and_wraps();
  opening_a_world_reaches_the_reader();
  a_world_refused_at_its_open_keeps_the_reason_on_the_shelf();
  a_world_whose_save_failed_is_greyed_until_a_save_is_written();
  a_world_is_titled_by_its_title_or_its_name_as_words();
  a_titled_world_is_shown_by_its_title_from_the_shelf_to_the_reader();
  of_two_builds_of_one_world_the_wheel_shows_the_newer();
  of_builds_of_one_version_the_first_in_path_order_is_shown();
  an_outranked_build_is_held_and_a_refused_newest_is_not_shown_through();
  a_world_of_one_title_by_another_author_is_a_word_of_its_own();
  a_newer_compatible_build_opens_with_the_older_save();
  a_newer_breaking_build_starts_anew_and_says_so_once();
  of_two_builds_with_no_save_the_newer_starts_anew_quietly();
  a_carried_world_started_over_stays_started_over();
  return finish();
}
