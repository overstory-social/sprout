/*
 * The pictures screen (ui/pictures.c) and the finding and loading of pictures (ui/images.c), driven
 * a frame at a time through the fake PlaydateAPI in the media_room world, whose cellar shows a
 * picture and whose cabinet shows one when pulled, its cartridge carrying all three. The rules: a
 * picture is built pixel for pixel from what the cartridge carries for it, reading that picture
 * alone; on arrival the place's picture is shown before the reader, centred above the caption line
 * that says where it is among them and how to close it; the crank steps between pictures slat by
 * slat, ticking, and the landing clacks; only the picture on screen is held once one has landed,
 * and none once A closes them; a turn's pictures show once the builder closes; a cartridge that
 * carries no pictures reads as text alone; and a picture that cannot be read says so in its place.
 */
#include <stdlib.h>

#include "assets.h"
#include "inflate.h"
#include "load.h"
#include "support.h"
#include "ui/app.h"
#include "ui/builder.h"
#include "ui/images.h"
#include "ui/nickname.h"
#include "ui/pictures.h"
#include "ui/reader.h"

#define LINE FAKE_SERIF_LINE
#define RULE (240 - LINE - 4)
#define PANEL (240 - (LINE + 4))
#define CARTRIDGE "media-room.sproutworld"

static const char READER_KEYS[] = "A: build a sentence   crank: scroll back";

static player_app *app;

/* ---- the pictures the cartridge carries, read here through the runtime's reader of its assets ---- */

typedef struct carried {
  const char *path;
  int width, height;
  unsigned char *rows; /* `height` rows of `(width + 7) / 8` bytes */
  size_t at, bytes;    /* where its compressed bytes lie in the cartridge */
} carried;

static carried pictures[3] = {{"cellar.png", 0, 0, NULL, 0, 0},
                              {"pictures/cabinet.png", 0, 0, NULL, 0, 0},
                              {"pictures/cabinet-open.png", 0, 0, NULL, 0, 0}};

static unsigned char *cartridge_bytes(size_t *length) {
  char path[1200];
  FILE *file;
  unsigned char *bytes;
  long size;
  snprintf(path, sizeof path, "%s/%s", PLAYER_CARTRIDGES, CARTRIDGE);
  file = fopen(path, "rb");
  CHECK(file != NULL, "%s", path);
  if (file == NULL) exit(1);
  fseek(file, 0, SEEK_END);
  size = ftell(file);
  fseek(file, 0, SEEK_SET);
  bytes = (unsigned char *)malloc((size_t)size);
  CHECK(bytes != NULL && fread(bytes, 1, (size_t)size, file) == (size_t)size, "reading %s", path);
  fclose(file);
  *length = (size_t)size;
  return bytes;
}

/* Reads each picture out of the packed cartridge, as the pack wrote it. */
static void read_pictures(void) {
  size_t length, count = 0, directory_bytes = 0, i;
  unsigned char *bytes = cartridge_bytes(&length);
  sprout_cartridge_layout layout;
  sprout_refusal refusal;
  const unsigned char *section;
  CHECK(sprout_cartridge_check_header(bytes, length, &layout, &refusal) == SPROUT_OK, "%s", refusal.text);
  section = bytes + layout.assets_at;
  CHECK(sprout_assets_prefix(section, layout.assets_bytes, &count, &directory_bytes) && count == 3, "three pictures");
  for (i = 0; i < 3; i++) {
    carried *c = &pictures[i];
    sprout_inflater *inflater = (sprout_inflater *)malloc(sizeof *inflater);
    static unsigned char out[4096];
    size_t got = 0, held = 0;
    const char *why = NULL;
    CHECK(sprout_assets_find(section + SPROUT_ASSETS_PREFIX_BYTES, directory_bytes, count, layout.assets_bytes, c->path,
                             strlen(c->path), &c->at, &c->bytes),
          "%s is carried", c->path);
    c->at += layout.assets_at;
    CHECK(sprout_inflate_begin(inflater, bytes + c->at, c->bytes, &why) == SPROUT_OK, "%s", why);
    while (sprout_inflate_next(inflater, out + held, sizeof out - held, &got, &why) == SPROUT_OK && got > 0) held += got;
    free(inflater);
    c->width = out[0] | (out[1] << 8);
    c->height = out[2] | (out[3] << 8);
    CHECK(held == 4 + (size_t)((c->width + 7) / 8) * (size_t)c->height, "%s inflates to its rows", c->path);
    c->rows = (unsigned char *)malloc(held - 4);
    memcpy(c->rows, out + 4, held - 4);
  }
  free(bytes);
}

static void forget_pictures(void) {
  size_t i;
  for (i = 0; i < 3; i++) free(pictures[i].rows);
}

/* The path of the picture the made bitmap `made` holds, pixel for pixel, or NULL for any other bitmap. */
static const char *picture_of(int made) {
  const fake_made *m;
  int i, x, y;
  if (made < 0 || made >= FAKE_MADE) return NULL;
  m = &fake->made[made];
  if (!m->live || m->mask != NULL) return NULL;
  for (i = 0; i < 3; i++) {
    const carried *c = &pictures[i];
    int stride = (c->width + 7) / 8, same = 1;
    if (m->width != c->width || m->height != c->height) continue;
    for (y = 0; same && y < c->height; y++)
      for (x = 0; same && x < c->width; x++)
        same = ((m->data[y * m->rowbytes + x / 8] >> (7 - x % 8)) & 1) == ((c->rows[y * stride + x / 8] >> (7 - x % 8)) & 1);
    if (same) return c->path;
  }
  return NULL;
}

/* How many pictures are held now. */
static int pictures_held(void) {
  int i, held = 0;
  for (i = 0; i < FAKE_MADE; i++)
    if (picture_of(i) != NULL) held++;
  return held;
}

/* The pictures drawn this frame, in order, into `out`; how many. */
static int pictures_drawn(const fake_placed **out, int room) {
  int i, n = 0;
  for (i = 0; i < fake->placed_count && n < room; i++)
    if (picture_of(fake->placed[i].made) != NULL) out[n++] = &fake->placed[i];
  return n;
}

static int draw_count(void) {
  const fake_placed *placed[4];
  return pictures_drawn(placed, 4);
}

/* The `n`th picture drawn this frame; a placement at no place where there is none. */
static const fake_placed *placement(int n) {
  static const fake_placed none = {-1, -1000, -1000, 0.0f, 0, 0, 0, 0, 0};
  const fake_placed *placed[4];
  return n < pictures_drawn(placed, 4) ? placed[n] : &none;
}

/* The path of the `n`th picture drawn this frame, or "". */
static const char *drawn(int n) {
  const char *path = picture_of(placement(n)->made);
  return path != NULL ? path : "";
}

/* Puts the world into the Data folder's worlds/. */
static void ship_media(void) {
  char command[2000];
  snprintf(command, sizeof command, "mkdir -p '%s/worlds' && cp '%s/%s' '%s/worlds/'", fake->data, PLAYER_CARTRIDGES, CARTRIDGE,
           fake->data);
  CHECK(system(command) == 0, "%s", command);
}

/* Sets `count` bytes of the shipped cartridge from `at` to `value`. */
static void change_shipped(size_t at, int value, size_t count) {
  char path[1200];
  FILE *file;
  snprintf(path, sizeof path, "%s/worlds/%s", fake->data, CARTRIDGE);
  file = fopen(path, "r+b");
  CHECK(file != NULL, "%s", path);
  if (file == NULL) return;
  fseek(file, (long)at, SEEK_SET);
  while (count-- > 0) fputc(value, file);
  fclose(file);
}

static bool on_reader(void) {
  const fake_run *keys = fake_run_at(fake, PLAYER_MARGIN, PANEL + 2);
  return keys != NULL && strcmp(keys->text, READER_KEYS) == 0;
}

/* The words right-aligned on the caption line, as the screen draws them. */
static const fake_run *where_run(const char *words) {
  return fake_run_at(fake, 400 - PLAYER_MARGIN - (int)strlen(words) * FAKE_SERIF_GLYPH, RULE + 2);
}

/* Whether any note since the `from`th was `pitch`. */
static bool played_since(int from, float pitch) {
  int i;
  for (i = from; i < fake->note_count; i++)
    if (fake->notes[i].pitch == pitch) return true;
  return false;
}

/*
 * The app over the media room, its cartridge changed by `changed` where it is given, opened from the shelf, the
 * name offered first entered, and run until pictures, a picture's words or the reader are drawn.
 */
static void arrive(const char *scenario, void (*changed)(void)) {
  const char *why = NULL;
  int n;
  begin(scenario);
  app_folder("app");
  ship_media();
  if (changed != NULL) changed();
  app = player_app_new(&fake->api, &why);
  CHECK(app != NULL, "%s", why);
  fake->api.system->setUpdateCallback(player_app_update, app);
  fake_frame(fake, 0, 0);
  fake_frame(fake, kButtonA, 0);
  for (n = 0; n < 10000 && (app->screen == &player_nickname_screen ||
                            (!on_reader() && draw_count() == 0 && fake_run_at(fake, PLAYER_MARGIN, RULE + 2) == NULL &&
                             fake_run_at(fake, PLAYER_MARGIN, 110) == NULL));
       n++)
    fake_frame(fake, app->screen == &player_nickname_screen ? kButtonA : 0, 0);
}

static void leave(void) {
  player_app_free(app);
  app = NULL;
  CHECK(fake->made_live == 0, "no picture, nor any bitmap, is held once the app ends: %d", fake->made_live);
  end();
}

/* ---- the scenarios ---- */

static void a_picture_is_read_alone_from_the_cartridge_when_it_is_asked_for(void) {
  LCDBitmap *bitmap;
  size_t i;
  begin("alone");
  ship_media();
  for (i = 0; i < 3; i++) {
    const char *built;
    fake->reads = fake->read_largest = fake->seeks = 0;
    bitmap = images_load(&fake->api, "worlds/" CARTRIDGE, pictures[i].path);
    CHECK(bitmap != NULL, "%s loads", pictures[i].path);
    if (bitmap == NULL) continue;
    built = picture_of(fake_made_index(fake, bitmap));
    CHECK(built != NULL && strcmp(built, pictures[i].path) == 0, "%s is the picture packed, pixel for pixel", pictures[i].path);
    CHECK(fake->seeks == 2, "after the header, a seek to the directory and one to the picture: %zu", fake->seeks);
    CHECK(fake->read_largest <= pictures[i].bytes || fake->read_largest <= 256,
          "nothing read but the header, the directory and the picture: %zu bytes at most", fake->read_largest);
    fake->api.graphics->freeBitmap(bitmap);
  }
  CHECK(images_load(&fake->api, "worlds/" CARTRIDGE, "gone.png") == NULL, "a picture it does not carry");
  CHECK(images_load(&fake->api, "worlds/absent.sproutworld", "cellar.png") == NULL, "a cartridge that is not there");
  CHECK(fake->made_live == 0, "nothing held");
  end();
}

static void arriving_shows_the_places_picture_before_the_reader(void) {
  arrive("arrival", NULL);
  CHECK(!on_reader(), "the picture comes before the reader");
  CHECK(draw_count() == 1 && strcmp(drawn(0), "cellar.png") == 0, "the cellar's picture, as the cartridge carries it: %s",
        drawn(0));
  CHECK(placement(0)->x == (400 - 64) / 2 && placement(0)->y == (RULE - 40) / 2 && placement(0)->scale == 1.0f,
        "centred above the caption line, as it is: %d %d", placement(0)->x, placement(0)->y);
  CHECK(fake_pixel(fake, (400 - 64) / 2, (RULE - 40) / 2) == !((pictures[0].rows[0] >> 7) & 1),
        "its pixels are on the screen");
  CHECK(fake_pixel(fake, 200, RULE) && fake_pixel(fake, 0, RULE), "the caption line is ruled");
  CHECK(where_run(PICTURES_CLOSE) != NULL, "one picture: only the key to close it");
  CHECK(fake_run_at(fake, PLAYER_MARGIN, RULE + 2) == NULL, "the cellar's picture has no caption");
  CHECK(pictures_held() == 1, "only the picture on screen is held: %d", pictures_held());
  fake_frame(fake, 0, 90.0f);
  CHECK(draw_count() == 1 && placement(0)->y == (RULE - 40) / 2, "one picture does not move");
  fake_frame(fake, kButtonA, 0);
  CHECK(on_reader(), "A closes it and the reader takes over");
  CHECK(pictures_held() == 0 && draw_count() == 0, "no picture is held or drawn");
  leave();
}

static void the_crank_steps_between_pictures_slat_by_slat(void) {
  static const char CELLAR[] = "{\"image\":\"cellar.png\"}";
  static const char CABINET[] = "{\"image\":\"pictures/cabinet.png\",\"caption\":\"an oak cabinet, its doors shut\"}";
  gallery g;
  int before, n, both = 0;
  arrive("steps", NULL);
  fake_frame(fake, kButtonA, 0);
  CHECK(on_reader(), "the arrival's picture closed");
  gallery_init(&g, &fake->api);
  CHECK(images_take(&g, app->cartridge, "media", "show", CELLAR, strlen(CELLAR)), "the cellar");
  CHECK(images_take(&g, app->cartridge, "media", "show", CABINET, strlen(CABINET)), "the cabinet");
  player_pictures_show(app, (player_reader *)app->ctx, &g);
  CHECK(g.count == 0, "the screen took the pictures");
  fake_frame(fake, 0, 0);
  CHECK(where_run("1 of 2" PICTURES_STEP) != NULL, "the first of two, and the keys");
  CHECK(draw_count() == 1 && strcmp(drawn(0), "cellar.png") == 0, "the cellar first: %s", drawn(0));

  before = fake->note_count;
  fake_frame(fake, 0, GALLERY_DEGREES_PER_STEP);
  CHECK(played_since(before, 3000.0f), "a step of the crank ticks");
  CHECK(where_run("2 of 2" PICTURES_STEP) != NULL, "the next is the one landing");
  CHECK(draw_count() == 2 && placement(0)->y == (RULE - 40) / 2 - GALLERY_STRETCH / GALLERY_HOLD_FRAMES,
        "the cellar held, stretched up a little: %d", placement(0)->y);
  CHECK(placement(1)->y > 240 - 40, "the cabinet waits below the screen: %d", placement(1)->y);
  before = fake->note_count;
  for (n = 0; n < 60 && !played_since(before, 160.0f); n++) {
    fake_frame(fake, 0, 0);
    if (draw_count() == 2) both++;
  }
  CHECK(both > GALLERY_HOLD_FRAMES, "while one leaves both are drawn: %d frames", both);
  CHECK(played_since(before, 160.0f), "the next lands with a clack");
  CHECK(draw_count() == 1 && strcmp(drawn(0), "pictures/cabinet.png") == 0, "the cabinet at rest: %s", drawn(0));
  CHECK(placement(0)->x == (400 - 32) / 2 && placement(0)->y == (RULE - 40) / 2, "centred");
  {
    const fake_run *caption = fake_run_at(fake, PLAYER_MARGIN, RULE + 2);
    CHECK(caption != NULL && strcmp(caption->text, "an oak cabinet, its doors shut") == 0, "its caption");
  }
  CHECK(pictures_held() == 1, "the cellar's picture was let go: %d held", pictures_held());

  before = fake->note_count;
  fake_frame(fake, kButtonDown, 0);
  CHECK(played_since(before, 3000.0f) && where_run("1 of 2" PICTURES_STEP) != NULL, "down steps on, wrapping");
  fake_frame(fake, kButtonA, 0);
  CHECK(on_reader() && pictures_held() == 0, "A closes them mid-step, and nothing is held");
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
  arrive("turn", NULL);
  fake_frame(fake, kButtonA, 0);
  CHECK(on_reader(), "the arrival's pictures closed");
  fake_frame(fake, kButtonA, 0);
  CHECK(step_to(kButtonDown, "pull", 12), "pull");
  fake_frame(fake, kButtonA, 0);
  CHECK(step_to(kButtonDown, "a cabinet", 4), "the cabinet");
  fake_frame(fake, kButtonA, 0);
  fake_frame(fake, kButtonA, 0);
  CHECK(!on_reader() && draw_count() == 1 && strcmp(drawn(0), "pictures/cabinet-open.png") == 0, "the open cabinet: %s",
        drawn(0));
  caption = fake_run_at(fake, PLAYER_MARGIN, RULE + 2);
  CHECK(caption != NULL && strcmp(caption->text, "the cabinet, its doors wide") == 0, "with its caption");
  CHECK(where_run("A: close") != NULL, "one picture: only the key to close it");
  fake_frame(fake, kButtonB, 0);
  CHECK(on_reader() && pictures_held() == 0, "B closes it too");
  leave();
}

/* The shipped cartridge's header saying it carries no assets section. */
static void carrying_none(void) { change_shipped(20, 0, 4); }

static void a_cartridge_that_carries_no_pictures_reads_as_text(void) {
  arrive("no-assets", carrying_none);
  CHECK(on_reader(), "the reader comes straight up");
  CHECK(pictures_held() == 0, "no picture was built");
  leave();
}

/* The middle of the shipped cellar's compressed rows changed, so that its checksum no longer holds. */
static void cellar_damaged(void) { change_shipped(pictures[0].at + pictures[0].bytes / 2, 0x55, 3); }

static void a_picture_that_cannot_be_read_says_so(void) {
  arrive("unreadable", cellar_damaged);
  CHECK(fake_run_at(fake, PLAYER_MARGIN, 110) != NULL && strcmp(fake_run_at(fake, PLAYER_MARGIN, 110)->text, PICTURES_UNREADABLE) == 0,
        "the words in the picture's place");
  CHECK(where_run(PICTURES_CLOSE) != NULL, "the keys are still drawn");
  CHECK(pictures_held() == 0, "nothing half built is held");
  leave();
}

static void effects_that_are_not_a_picture_ask_for_nothing(void) {
  gallery g;
  begin("asked");
  ship_media();
  gallery_init(&g, &fake->api);
  {
    const char *cartridge = "worlds/" CARTRIDGE;
    const char cellar[] = "{\"image\":\"cellar.png\"}";
    CHECK(images_take(&g, cartridge, "slides", "show", cellar, strlen(cellar)) && g.count == 0, "another extension");
    CHECK(images_take(&g, cartridge, "media", "play", cellar, strlen(cellar)) && g.count == 0, "another statement");
    CHECK(images_take(&g, cartridge, "media", "show", "{}", 2) && g.count == 0, "no image");
    CHECK(images_take(&g, cartridge, "media", "show", "{\"image\":7}", 11) && g.count == 0, "an image that is not a name");
    CHECK(images_take(&g, cartridge, "media", "show", "{\"image\":\"gone.png\"}", 20) && g.count == 0, "one the world lacks");
    CHECK(images_take(&g, cartridge, "media", "show", "not json", 8) && g.count == 0, "a payload that does not read");
    CHECK(images_take(&g, "", "media", "show", cellar, strlen(cellar)) && g.count == 0, "no world open");
    CHECK(images_take(&g, cartridge, "media", "show", cellar, strlen(cellar)) && g.count == 1 && g.pictures[0].caption == NULL,
          "the cellar, uncaptioned");
    CHECK(images_has(&fake->api, cartridge, "pictures/cabinet.png") && !images_has(&fake->api, cartridge, "cabinet.png"),
          "a picture by its path inside the cartridge");
    CHECK(!images_has(&fake->api, "worlds/absent.sproutworld", "cellar.png"), "a cartridge that is not there");
  }
  gallery_free(&g);
  end();
}

static void the_app_ending_with_pictures_up_holds_nothing(void) {
  arrive("ending", NULL);
  CHECK(pictures_held() == 1, "a picture on screen");
  leave();
}

int main(void) {
  test_program("pictures");
  read_pictures();
  a_picture_is_read_alone_from_the_cartridge_when_it_is_asked_for();
  effects_that_are_not_a_picture_ask_for_nothing();
  arriving_shows_the_places_picture_before_the_reader();
  the_crank_steps_between_pictures_slat_by_slat();
  a_turns_pictures_show_once_the_builder_closes();
  a_cartridge_that_carries_no_pictures_reads_as_text();
  a_picture_that_cannot_be_read_says_so();
  the_app_ending_with_pictures_up_holds_nothing();
  forget_pictures();
  return finish();
}
