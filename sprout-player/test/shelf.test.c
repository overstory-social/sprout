/*
 * ui/shelf.c: the shelf screen, driven through the app a frame at a time. The rules: it lists the
 * cartridges at the root and in worlds/ of the app and the Data folder, each once, in path order,
 * titled by the world's name, and nothing else; the selection moves with the d-pad and the crank
 * and wraps through "more worlds..."; a world refused at its open keeps the reason on the shelf;
 * a world whose save could not be written is greyed until a save of it succeeds.
 */
#include <stdlib.h>

#include "support.h"
#include "ui/app.h"
#include "ui/message.h"
#include "ui/nickname.h"
#include "ui/reader.h"
#include "ui/shelf.h"

#define LINE FAKE_SERIF_LINE
#define ROW(n) (LINE + 4 + 2 + (n) * LINE)
#define PANEL (240 - (LINE * 3 + 8) + 2)

static player_app *app;

static void start(void) {
  const char *why = NULL;
  app = player_app_new(&fake->api, &why);
  CHECK(app != NULL, "%s", why);
  fake->api.system->setUpdateCallback(player_app_update, app);
}

static const char *row(int n) {
  const fake_run *run = fake_run_at(fake, PLAYER_MARGIN, ROW(n));
  return run != NULL ? run->text : "";
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
  CHECK(strcmp(row(0), "> Teashop") == 0, "the root's cartridge, selected: %s", row(0));
  CHECK(strcmp(row(1), "  Printers Shop") == 0, "%s", row(1));
  CHECK(app->shelf->count == 3 && strcmp(app->shelf->entries[2].title, "Chip Tree") == 0,
        "a cartridge is titled by its world's name, not its file's: %s", app->shelf->count == 3 ? app->shelf->entries[2].title : "");
  CHECK(strcmp(row(3), "  more worlds...") == 0, "more worlds comes last: %s", row(3));
  CHECK(strcmp(panel(), "A opens it.") == 0, "%s", panel());
  CHECK(fake_run_at(fake, PLAYER_MARGIN, 0) != NULL && strcmp(fake_run_at(fake, PLAYER_MARGIN, 0)->text, "Shelf") == 0, "the title");
  player_app_free(app);
  end();
}

static void the_selection_moves_with_the_d_pad_and_the_crank_and_wraps(void) {
  static const char *const shipped[] = {"teashop.sproutworld", "printers_shop.sproutworld"};
  begin("moves");
  app_folder("app");
  ship(shipped, 2);
  start();
  fake_frame(fake, 0, 0);
  CHECK(app->shelf->selected == 0, "the first is selected");
  fake_frame(fake, kButtonDown, 0);
  CHECK(app->shelf->selected == 1 && strcmp(row(1), "> Teashop") == 0, "down: %s", row(1));
  fake_frame(fake, 0, 20.0f);
  CHECK(app->shelf->selected == 1, "twenty degrees is not yet a row");
  fake_frame(fake, 0, 4.0f);
  CHECK(app->shelf->selected == 2 && strcmp(row(2), "> more worlds...") == 0, "twenty-four is a row: %s", row(2));
  CHECK(strcmp(panel(), "A looks for more worlds to download.") == 0, "the panel says what more worlds is: %s", panel());
  fake_frame(fake, kButtonDown, 0);
  CHECK(app->shelf->selected == 0, "down from the last wraps to the first");
  fake_frame(fake, kButtonUp, 0);
  CHECK(app->shelf->selected == 2, "up from the first wraps to the last");
  fake_frame(fake, 0, -48.0f);
  CHECK(app->shelf->selected == 0, "the crank back two rows");
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
  CHECK(strcmp(row(0), "> Printers Shop") == 0, "inspected, it can be shelved: %s", row(0));
  fake_frame(fake, kButtonA, 0);
  for (n = 0; n < 1000 && app->screen != &player_message_screen; n++) fake_frame(fake, 0, 0);
  CHECK(app->screen == &player_message_screen, "the open was refused on the message screen");
  why = strdup(fake_run_at(fake, PLAYER_MARGIN, MESSAGE_TOP) != NULL ? fake_run_at(fake, PLAYER_MARGIN, MESSAGE_TOP)->text : "");
  CHECK(why[0] != '\0', "the message says why");
  fake_frame(fake, kButtonB, 0);
  CHECK(app->screen == &player_shelf_screen, "B goes back to the shelf");
  CHECK(strcmp(row(0), "> Printers Shop (cannot be opened)") == 0, "the shelf keeps the refusal: %s", row(0));
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
  CHECK(strcmp(row(0), "> Printers Shop (its save failed)") == 0, "greyed on the shelf: %s", row(0));
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

static void a_world_is_titled_by_its_name_as_words(void) {
  char title[64];
  begin("titles");
  player_world_title("printers_shop", title, sizeof title);
  CHECK(strcmp(title, "Printers Shop") == 0, "%s", title);
  player_world_title("old_3d_room's_door", title, sizeof title);
  CHECK(strcmp(title, "Old 3D Room's Door") == 0, "%s", title);
  player_world_title("printers_shop", title, 5);
  CHECK(strcmp(title, "Prin") == 0, "cut to the room: %s", title);
  end();
}

int main(void) {
  test_program("shelf");
  the_shelf_lists_the_shipped_worlds_once_in_path_order();
  the_selection_moves_with_the_d_pad_and_the_crank_and_wraps();
  opening_a_world_reaches_the_reader();
  a_world_refused_at_its_open_keeps_the_reason_on_the_shelf();
  a_world_whose_save_failed_is_greyed_until_a_save_is_written();
  a_world_is_titled_by_its_name_as_words();
  return finish();
}
