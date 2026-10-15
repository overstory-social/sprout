/*
 * The pictures screen (ui/pictures.c) and the finding and loading of pictures (ui/images.c), driven
 * a frame at a time through the fake PlaydateAPI in the media_room world, whose cellar shows a
 * picture and whose cabinet shows one when pulled. The rules: on arrival the place's picture is
 * shown before the reader, centred above the caption line that says where it is among them and
 * how to close it; the crank steps between pictures slat by slat, ticking, and the landing
 * clacks; only the picture on screen is held once one has landed, and none once A closes them; a
 * turn's pictures show once the builder closes; a world whose assets are missing reads as text
 * alone; and a picture that cannot be read says so in its place.
 */
#include <stdlib.h>

#include "support.h"
#include "ui/app.h"
#include "ui/builder.h"
#include "ui/images.h"
#include "ui/nickname.h"
#include "ui/pictures.h"
#include "ui/reader.h"

#define LINE FAKE_LINE
#define RULE (240 - LINE - 4)
#define PANEL (240 - (LINE * 3 + 8))
#define CARTRIDGE "media-room.sproutworld"

static const char READER_KEYS[] = "A: build a sentence   crank: scroll back";

static player_app *app;

/* Puts the world into the Data folder's worlds/, with its assets where `assets` is set. */
static void ship_media(bool assets) {
  char command[2000];
  snprintf(command, sizeof command, "mkdir -p '%s/worlds' && cp '%s/%s' '%s/worlds/'", fake->data, PLAYER_CARTRIDGES, CARTRIDGE,
           fake->data);
  CHECK(system(command) == 0, "%s", command);
  if (!assets) return;
  snprintf(command, sizeof command, "cp -r '%s/%s.assets' '%s/worlds/'", PLAYER_CARTRIDGES, CARTRIDGE, fake->data);
  CHECK(system(command) == 0, "%s", command);
}

static bool on_reader(void) {
  const fake_run *keys = fake_run_at(fake, PLAYER_MARGIN, PANEL + 2);
  return keys != NULL && strcmp(keys->text, READER_KEYS) == 0;
}

/* The words right-aligned on the caption line, as the screen draws them. */
static const fake_run *where_run(const char *words) {
  return fake_run_at(fake, 400 - PLAYER_MARGIN - (int)strlen(words) * FAKE_GLYPH, RULE + 2);
}

/* The path of the bitmap the frame's `n`th draw drew, or "". */
static const char *drawn(int n) { return n < fake->draw_count ? fake->bitmaps[fake->draws[n].bitmap].path : ""; }

static bool ends_with(const char *text, const char *end) {
  size_t a = strlen(text), b = strlen(end);
  return a >= b && strcmp(text + a - b, end) == 0;
}

/* Whether any note since the `from`th was `pitch`. */
static bool played_since(int from, float pitch) {
  int i;
  for (i = from; i < fake->note_count; i++)
    if (fake->notes[i].pitch == pitch) return true;
  return false;
}

/* The app over the media room, opened from the shelf, the name offered first entered, and run until pictures or the reader are drawn. */
static void arrive(const char *scenario, bool assets) {
  const char *why = NULL;
  int n;
  begin(scenario);
  app_folder("app");
  ship_media(assets);
  app = player_app_new(&fake->api, &why);
  CHECK(app != NULL, "%s", why);
  fake->api.system->setUpdateCallback(player_app_update, app);
  fake_frame(fake, 0, 0);
  fake_frame(fake, kButtonA, 0);
  for (n = 0; n < 10000 && (app->screen == &player_nickname_screen ||
                            (!on_reader() && fake->draw_count == 0 && fake_run_at(fake, PLAYER_MARGIN, RULE + 2) == NULL));
       n++)
    fake_frame(fake, app->screen == &player_nickname_screen ? kButtonA : 0, 0);
}

static void leave(void) {
  player_app_free(app);
  app = NULL;
  CHECK(fake->bitmaps_live == 0, "no picture is held once the app ends: %d", fake->bitmaps_live);
  end();
}

/* ---- the scenarios ---- */

static void arriving_shows_the_places_picture_before_the_reader(void) {
  arrive("arrival", true);
  CHECK(!on_reader(), "the picture comes before the reader");
  CHECK(fake->draw_count == 1 && ends_with(drawn(0), CARTRIDGE ".assets/cellar.png"), "the cellar's picture: %s", drawn(0));
  CHECK(fake->draws[0].x == (400 - 64) / 2 && fake->draws[0].y == (RULE - 40) / 2 && fake->draws[0].scale == 1.0f,
        "centred above the caption line, as it is: %d %d", fake->draws[0].x, fake->draws[0].y);
  CHECK(fake_pixel(fake, 200, RULE) && fake_pixel(fake, 0, RULE), "the caption line is ruled");
  CHECK(where_run(PICTURES_CLOSE) != NULL, "one picture: only the key to close it");
  CHECK(fake_run_at(fake, PLAYER_MARGIN, RULE + 2) == NULL, "the cellar's picture has no caption");
  CHECK(fake->bitmaps_live == 1, "only the picture on screen is held: %d", fake->bitmaps_live);
  fake_frame(fake, 0, 90.0f);
  CHECK(fake->draw_count == 1 && fake->draws[0].y == (RULE - 40) / 2, "one picture does not move");
  fake_frame(fake, kButtonA, 0);
  CHECK(on_reader(), "A closes it and the reader takes over");
  CHECK(fake->bitmaps_live == 0 && fake->draw_count == 0, "no picture is held or drawn");
  leave();
}

static void the_crank_steps_between_pictures_slat_by_slat(void) {
  static const char CELLAR[] = "{\"image\":\"cellar.png\"}";
  static const char CABINET[] = "{\"image\":\"pictures/cabinet.png\",\"caption\":\"an oak cabinet, its doors shut\"}";
  gallery g;
  int before, n, both = 0;
  arrive("steps", true);
  fake_frame(fake, kButtonA, 0);
  CHECK(on_reader(), "the arrival's picture closed");
  gallery_init(&g, &fake->api);
  CHECK(images_take(&g, app->assets, "media", "show", CELLAR, strlen(CELLAR)), "the cellar");
  CHECK(images_take(&g, app->assets, "media", "show", CABINET, strlen(CABINET)), "the cabinet");
  player_pictures_show(app, (player_reader *)app->ctx, &g);
  CHECK(g.count == 0, "the screen took the pictures");
  fake_frame(fake, 0, 0);
  CHECK(where_run("1 of 2" PICTURES_STEP) != NULL, "the first of two, and the keys");
  CHECK(fake->draw_count == 1 && ends_with(drawn(0), "cellar.png"), "the cellar first: %s", drawn(0));

  before = fake->note_count;
  fake_frame(fake, 0, GALLERY_DEGREES_PER_STEP);
  CHECK(played_since(before, 3000.0f), "a step of the crank ticks");
  CHECK(where_run("2 of 2" PICTURES_STEP) != NULL, "the next is the one landing");
  CHECK(fake->draw_count == 2 && fake->draws[0].y == (RULE - 40) / 2 - GALLERY_STRETCH / GALLERY_HOLD_FRAMES,
        "the cellar held, stretched up a little: %d", fake->draws[0].y);
  CHECK(fake->draws[1].y > 240 - 40, "the cabinet waits below the screen: %d", fake->draws[1].y);
  before = fake->note_count;
  for (n = 0; n < 60 && !played_since(before, 160.0f); n++) {
    fake_frame(fake, 0, 0);
    if (fake->draw_count == 2) both++;
  }
  CHECK(both > GALLERY_HOLD_FRAMES, "while one leaves both are drawn: %d frames", both);
  CHECK(played_since(before, 160.0f), "the next lands with a clack");
  CHECK(fake->draw_count == 1 && ends_with(drawn(0), "pictures/cabinet.png"), "the cabinet at rest: %s", drawn(0));
  CHECK(fake->draws[0].x == (400 - 32) / 2 && fake->draws[0].y == (RULE - 40) / 2, "centred");
  {
    const fake_run *caption = fake_run_at(fake, PLAYER_MARGIN, RULE + 2);
    CHECK(caption != NULL && strcmp(caption->text, "an oak cabinet, its doors shut") == 0, "its caption");
  }
  CHECK(fake->bitmaps_live == 1, "the cellar's picture was let go: %d held", fake->bitmaps_live);

  before = fake->note_count;
  fake_frame(fake, kButtonDown, 0);
  CHECK(played_since(before, 3000.0f) && where_run("1 of 2" PICTURES_STEP) != NULL, "down steps on, wrapping");
  fake_frame(fake, kButtonA, 0);
  CHECK(on_reader() && fake->bitmaps_live == 0, "A closes them mid-step, and nothing is held");
  leave();
}

/* Presses `button` until the word at the front of the builder's disc, its selected entry, reads `label`. */
static bool step_to(PDButtons button, const char *label, int most) {
  int n;
  for (n = 0; n <= most; n++) {
    if (app->screen == &player_builder_screen) {
      const sentence *s = &((player_builder *)app->ctx)->sentence;
      size_t count;
      if (strcmp(sentence_entries(s, &count)[s->state.selected].label, label) == 0) return true;
    }
    fake_frame(fake, button, 0);
  }
  return false;
}

static void a_turns_pictures_show_once_the_builder_closes(void) {
  const fake_run *caption;
  arrive("turn", true);
  fake_frame(fake, kButtonA, 0);
  CHECK(on_reader(), "the arrival's pictures closed");
  fake_frame(fake, kButtonA, 0);
  CHECK(step_to(kButtonDown, "pull", 12), "pull");
  fake_frame(fake, kButtonA, 0);
  CHECK(step_to(kButtonDown, "a cabinet", 4), "the cabinet");
  fake_frame(fake, kButtonA, 0);
  fake_frame(fake, kButtonA, 0);
  CHECK(!on_reader() && fake->draw_count == 1 && ends_with(drawn(0), "pictures/cabinet-open.png"), "the open cabinet: %s",
        drawn(0));
  caption = fake_run_at(fake, PLAYER_MARGIN, RULE + 2);
  CHECK(caption != NULL && strcmp(caption->text, "the cabinet, its doors wide") == 0, "with its caption");
  CHECK(where_run("A: close") != NULL, "one picture: only the key to close it");
  fake_frame(fake, kButtonB, 0);
  CHECK(on_reader() && fake->bitmaps_live == 0, "B closes it too");
  leave();
}

static void a_world_without_its_assets_reads_as_text(void) {
  arrive("no-assets", false);
  CHECK(on_reader(), "the reader comes straight up");
  CHECK(fake->bitmap_count == 0, "nothing was loaded");
  leave();
}

static void a_picture_that_cannot_be_read_says_so(void) {
  char path[1200];
  int n;
  begin("unreadable");
  app_folder("app");
  ship_media(true);
  snprintf(path, sizeof path, "worlds/%s.assets/cellar.png", CARTRIDGE);
  write_text(path, "not a picture");
  {
    const char *why = NULL;
    app = player_app_new(&fake->api, &why);
    CHECK(app != NULL, "%s", why);
  }
  fake->api.system->setUpdateCallback(player_app_update, app);
  fake_frame(fake, 0, 0);
  fake_frame(fake, kButtonA, 0);
  for (n = 0; n < 10000 && !on_reader() && fake_run_at(fake, PLAYER_MARGIN, 110) == NULL; n++)
    fake_frame(fake, app->screen == &player_nickname_screen ? kButtonA : 0, 0);
  CHECK(fake_run_at(fake, PLAYER_MARGIN, 110) != NULL && strcmp(fake_run_at(fake, PLAYER_MARGIN, 110)->text, PICTURES_UNREADABLE) == 0,
        "the words in the picture's place");
  CHECK(where_run(PICTURES_CLOSE) != NULL, "the keys are still drawn");
  leave();
}

static void effects_that_are_not_a_picture_ask_for_nothing(void) {
  gallery g;
  begin("asked");
  ship_media(true);
  gallery_init(&g, &fake->api);
  {
    const char *folder = "worlds/" CARTRIDGE ".assets/";
    const char cellar[] = "{\"image\":\"cellar.png\"}";
    CHECK(images_take(&g, folder, "slides", "show", cellar, strlen(cellar)) && g.count == 0, "another extension");
    CHECK(images_take(&g, folder, "media", "play", cellar, strlen(cellar)) && g.count == 0, "another statement");
    CHECK(images_take(&g, folder, "media", "show", "{}", 2) && g.count == 0, "no image");
    CHECK(images_take(&g, folder, "media", "show", "{\"image\":7}", 11) && g.count == 0, "an image that is not a name");
    CHECK(images_take(&g, folder, "media", "show", "{\"image\":\"gone.png\"}", 20) && g.count == 0, "one the world lacks");
    CHECK(images_take(&g, folder, "media", "show", "not json", 8) && g.count == 0, "a payload that does not read");
    CHECK(images_take(&g, "", "media", "show", cellar, strlen(cellar)) && g.count == 0, "no world open");
    CHECK(images_take(&g, folder, "media", "show", cellar, strlen(cellar)) && g.count == 1 && g.pictures[0].caption == NULL,
          "the cellar, uncaptioned");
    CHECK(images_has(&fake->api, folder, "pictures/cabinet.png") && !images_has(&fake->api, folder, "cabinet.png"),
          "a picture by its path inside the assets");
  }
  gallery_free(&g);
  end();
}

static void the_app_ending_with_pictures_up_holds_nothing(void) {
  arrive("ending", true);
  CHECK(fake->bitmaps_live == 1, "a picture on screen");
  leave();
}

int main(void) {
  test_program("pictures");
  effects_that_are_not_a_picture_ask_for_nothing();
  arriving_shows_the_places_picture_before_the_reader();
  the_crank_steps_between_pictures_slat_by_slat();
  a_turns_pictures_show_once_the_builder_closes();
  a_world_without_its_assets_reads_as_text();
  a_picture_that_cannot_be_read_says_so();
  the_app_ending_with_pictures_up_holds_nothing();
  return finish();
}
