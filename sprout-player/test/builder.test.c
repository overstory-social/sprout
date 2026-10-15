/*
 * The sentence builder (ui/builder.c, ui/sentence.c, ui/everything.c, ui/disc.c) driven a frame at a time through
 * the fake PlaydateAPI in the chip_tree world's hall, and judged by what was drawn. The rules: each
 * word on the disc is a label drawn once into a bitmap in the big font and placed along its ray; the
 * front is the selected entry, the only label drawn inverted, level at the hub's height at rest, its
 * neighbours a sector either side in the entries' order, each entry placed once, and the crank's
 * fraction turns every word alike; the dividing rays are drawn only where a word sits; the labels
 * are let go with the builder; the root lists the scene's verbs in the view's order; a greyed
 * chip is drawn greyed (at the front, a dotted inverted label) and its reason is the panel's words;
 * the sentence so far is the picks joined; a confirmed sentence runs and the reader is told it and
 * then what the turn told, and one whose save fails stops play and greys the world on the shelf; the
 * sentence line fits the screen whatever its length, keeping its end in view, while a long word on
 * the disc is cut at the screen's edge; and however the crank turned, the word at the front is the
 * one the panel speaks of and A picks. `everything` comes first on a level whose role
 * would read `all` where two or more things can be done: a set role binds them all, and a role that
 * takes one thing runs a turn for each in the level's order, leaving out what the view refuses,
 * stopping at the first refusal and bounded by what a set role may bind; such a line is one save, its state
 * written once after its last step, and a failure of that save stops play.
 */
#include <stdlib.h>

#include "session_internal.h"
#include "support.h"
#include "ui/app.h"
#include "ui/builder.h"
#include "ui/disc.h"
#include "ui/message.h"
#include "ui/nickname.h"
#include "ui/reader.h"
#include "ui/shelf.h"

#define LINE FAKE_LINE
#define HEADER (LINE + 4)
#define BOTTOM (240 - (LINE * 3 + 8))
#define CENTRE ((HEADER + BOTTOM) / 2)
#define ROOM (400 - 2 * PLAYER_MARGIN)
/* A label: the big font's line and a pixel above and below; at rest the front one is placed level with the hub's centre, from where words start. */
#define LABEL_HEIGHT (FAKE_BIG_LINE + 2)
#define FRONT_X (DISC_HUB_X + DISC_WORD_AT)
#define FRONT_Y (CENTRE - LABEL_HEIGHT / 2)

static const char READER_KEYS[] = "A: build a sentence   crank: scroll back";

static player_app *app;

static const fake_run *panel(void) { return fake_run_at(fake, PLAYER_MARGIN, BOTTOM + 2); }

static bool on_reader(void) { return panel() != NULL && strcmp(panel()->text, READER_KEYS) == 0; }

/* Whether the builder's keys are the panel's words; wrapped, their runs of spaces are one. */
static bool keys_shown(void) { return panel() != NULL && strcmp(panel()->text, "A picks B steps back the crank turns the wheel") == 0; }

/* ---- the disc as drawn ---- */

/* The builder, where it is the screen up; else NULL. */
static player_builder *builder(void) { return app != NULL && app->screen == &player_builder_screen ? (player_builder *)app->ctx : NULL; }

/* The label of the builder's whose turned bitmap is placement `n` of this frame, or NULL. */
static const builder_label *label_placed(int n) {
  player_builder *b = builder();
  size_t i;
  if (b == NULL || n >= fake->placed_count) return NULL;
  for (i = 0; i < b->label_count; i++)
    if (b->labels[i].turned != NULL && fake_made_index(fake, b->labels[i].turned) == fake->placed[n].made) return &b->labels[i];
  return NULL;
}

/* The entry a label stands for. */
static size_t entry_of(const builder_label *label) { return (size_t)(label - builder()->labels); }

/* The text drawn into a label's flat bitmap, and the font it was drawn in. */
static const fake_run *label_run(const builder_label *label) {
  int made = label != NULL && label->flat != NULL ? fake_made_index(fake, label->flat) : -1;
  return made >= 0 && fake->made[made].run_count > 0 ? &fake->made[made].runs[0] : NULL;
}

static const char *label_text(const builder_label *label) {
  const fake_run *run = label_run(label);
  return run != NULL ? run->text : "(no text)";
}

/* Whether placement `n` has a white pixel drawn: the inverted label, as an unturned one has only black. */
static bool inverted(int n) {
  const fake_made *made = &fake->made[fake->placed[n].made];
  int x, y;
  for (y = 0; y < made->height; y++)
    for (x = 0; x < made->width; x++)
      if (fake_made_pixel(fake, fake->placed[n].made, x, y) == kColorWhite) return true;
  return false;
}

/* The placement of the front label this frame: the one drawn inverted; -1 where there is none. */
static int front_placed(void) {
  int n;
  for (n = 0; n < fake->placed_count; n++)
    if (inverted(n)) return n;
  return -1;
}

/* The word at the front: the inverted label's, wherever the turning disc has carried it. */
static const char *front(void) {
  int n = front_placed();
  return n >= 0 ? label_text(label_placed(n)) : "(no front)";
}

/* The placement of the label for entry `index` this frame, or -1. */
static int placed_entry(size_t index) {
  int n;
  for (n = 0; n < fake->placed_count; n++)
    if (label_placed(n) != NULL && entry_of(label_placed(n)) == index) return n;
  return -1;
}

/* Whether a ray at `angle` is drawn: a black pixel at, or a pixel from, where its bent line passes 100 pixels from the hub. */
static bool ray_at(float angle) {
  int x, y, dx, dy;
  disc_point(disc_bent(angle, 100.0f), 100.0f, &x, &y);
  for (dy = -1; dy <= 1; dy++)
    for (dx = -1; dx <= 1; dx++)
      if (fake_pixel(fake, DISC_HUB_X + x + dx, CENTRE + y + dy)) return true;
  return false;
}

/* The sentence so far, as drawn above the disc. */
static const char *phrase(void) {
  const fake_run *run = fake_run_at(fake, PLAYER_MARGIN, 0);
  return run != NULL ? run->text : "(no line)";
}

/* The app over the cartridge `world`, the only one on the shelf, opened and run until the reader is up. */
static void arrive_in(const char *scenario, const char *world) {
  const char *const shipped[] = {world};
  const char *why = NULL;
  int n;
  begin(scenario);
  app_folder("app");
  ship(shipped, 1);
  app = player_app_new(&fake->api, &why);
  CHECK(app != NULL, "%s", why);
  fake->api.system->setUpdateCallback(player_app_update, app);
  fake_frame(fake, 0, 0);
  fake_frame(fake, kButtonA, 0);
  for (n = 0; n < 10000 && !on_reader(); n++) fake_frame(fake, app->screen == &player_nickname_screen ? kButtonA : 0, 0);
  CHECK(on_reader(), "the reader came up");
}

static void arrive(const char *scenario) { arrive_in(scenario, "chip-tree.sproutworld"); }

static void leave(void) {
  player_app_free(app);
  app = NULL;
  CHECK(fake->made_live == 0, "no label is held once the app ends: %d", fake->made_live);
  end();
}

/* Presses `button` until the front reads `label`, at most `most` times; whether it does. */
static bool step_to(PDButtons button, const char *label, int most) {
  int n;
  for (n = 0; n <= most; n++) {
    if (strcmp(front(), label) == 0) return true;
    fake_frame(fake, button, 0);
  }
  return strcmp(front(), label) == 0;
}

/* A verb's name without its library, as the disc shows it. */
static const char *bare(const char *verb) {
  const char *dot = strrchr(verb, '.');
  return dot != NULL ? dot + 1 : verb;
}

/* ---- the scenarios ---- */

static void the_root_is_the_scenes_verbs_on_a_disc_turned_by_the_crank(void) {
  static char verbs[32][64];
  player_chip_level root;
  size_t count, i;
  int n, front_at;
  float rest_angle[32];
  arrive("root");
  fake_frame(fake, kButtonA, 0);
  CHECK(!on_reader() && keys_shown(), "A opens the builder, its keys below the disc");
  CHECK(strcmp(phrase(), "") == 0, "nothing is built yet: %s", phrase());
  root = player_chips(app->session, NULL, 0);
  CHECK(root.ok && root.choice_count >= 12, "the scene's verbs");
  count = root.choice_count < 32 ? root.choice_count : 32;
  for (i = 0; i < count; i++) snprintf(verbs[i], sizeof verbs[0], "%s", bare(root.choices[i].verb));
  CHECK(strcmp(verbs[0], "juggle") == 0 && strcmp(verbs[11], "ask") == 0, "the chip_tree hall's verbs: %s ... %s", verbs[0], verbs[11]);

  /* The front is the first verb, the one label drawn inverted, unturned and level with the hub, its word from where words start. */
  front_at = front_placed();
  CHECK(strcmp(front(), verbs[0]) == 0, "the front is %s, the first verb: %s", verbs[0], front());
  CHECK(front_at >= 0 && fake->placed[front_at].x == FRONT_X && fake->placed[front_at].y == FRONT_Y &&
            fake->made[fake->placed[front_at].made].height == LABEL_HEIGHT,
        "level at the front: %d %d", front_at >= 0 ? fake->placed[front_at].x : -1, front_at >= 0 ? fake->placed[front_at].y : -1);
  CHECK(fake_pixel(fake, FRONT_X + 1, FRONT_Y + 1) && !fake_pixel(fake, FRONT_X + 4, FRONT_Y + 4),
        "a black label with its word in white");
  /* A sector either side in the entries' order, the disc wrapping; every word a label in the big font, placed once. */
  CHECK(fake->placed_count == DISC_MOST_ROWS, "as many words as sectors are shown: %d", fake->placed_count);
  for (n = 0; n < fake->placed_count; n++) {
    const builder_label *label = label_placed(n);
    long k;
    int m;
    CHECK(label != NULL && label_run(label) != NULL && label_run(label)->font == FAKE_FONT_BIG, "placement %d is a word in the big font", n);
    if (label == NULL) continue;
    k = label->angle > 0 ? (long)(label->angle / DISC_SECTOR_DEGREES + 0.5f) : -(long)(-label->angle / DISC_SECTOR_DEGREES + 0.5f);
    CHECK(label->angle == (float)k * DISC_SECTOR_DEGREES, "on a sector: %f", (double)label->angle);
    CHECK(strcmp(label_text(label), verbs[(size_t)((long)count + k) % count]) == 0, "%ld sectors round is %s: %s", k,
          verbs[(size_t)((long)count + k) % count], label_text(label));
    CHECK((k == 0) == (n == front_at), "only the front is inverted");
    CHECK(k == 0 || (k > 0) == (fake->placed[n].y > FRONT_Y), "below the front further on, above it further back");
    for (m = n + 1; m < fake->placed_count; m++) CHECK(label_placed(m) != label, "%s placed once", label_text(label));
    if (entry_of(label) < 32) rest_angle[entry_of(label)] = label->angle;
  }
  CHECK(placed_entry(1) >= 0 && label_placed(placed_entry(1))->angle == DISC_SECTOR_DEGREES, "the next verb a sector below");
  CHECK(placed_entry(count - 1) >= 0 && label_placed(placed_entry(count - 1))->angle == -DISC_SECTOR_DEGREES, "the last a sector above");
  /* The hub, its marker at the front, and the rays between the sectors that hold words. */
  CHECK(fake->ellipses == 1 && fake_pixel(fake, DISC_HUB_X + DISC_HUB_RADIUS / 2, CENTRE - DISC_HUB_RADIUS * 7 / 8 + 1) &&
            !fake_pixel(fake, DISC_HUB_X + DISC_HUB_RADIUS / 2, CENTRE - DISC_HUB_RADIUS * 7 / 8 + 6),
        "the hub on the left edge, a ring");
  CHECK(fake_pixel(fake, DISC_HUB_X + DISC_HUB_RADIUS + 2, CENTRE), "its marker pointing at the front");
  CHECK(ray_at(DISC_SECTOR_DEGREES / 2) && ray_at(-DISC_SECTOR_DEGREES / 2) && ray_at(1.5f * DISC_SECTOR_DEGREES),
        "rays between the front and its neighbours, and beyond");

  /* Each 24 degrees of crank is a verb, round the whole disc and back to the first; less is not yet one. */
  for (i = 1; i <= count; i++) {
    fake_frame(fake, 0, 24.0f);
    CHECK(strcmp(front(), verbs[i % count]) == 0, "after %zu steps the front is %s: %s", i, verbs[i % count], front());
  }
  /* Ten degrees turns every word ten degrees up, the front off level; the labels stay the ones drawn at rest. */
  fake_frame(fake, 0, 10.0f);
  CHECK(strcmp(front(), verbs[0]) == 0, "ten degrees is not a step");
  CHECK(fake->placed_count == DISC_MOST_ROWS, "the same words shown");
  for (n = 0; n < fake->placed_count; n++) {
    const builder_label *label = label_placed(n);
    if (label == NULL || entry_of(label) >= 32) continue;
    CHECK(label->angle > rest_angle[entry_of(label)] - 10.01f && label->angle < rest_angle[entry_of(label)] - 9.99f,
          "%s turned ten degrees up: %f from %f", label_text(label), (double)label->angle, (double)rest_angle[entry_of(label)]);
  }
  front_at = front_placed();
  CHECK(front_at >= 0 && fake->made[fake->placed[front_at].made].height > LABEL_HEIGHT && fake->placed[front_at].y < FRONT_Y,
        "the front word tilts up off level");
  fake_frame(fake, 0, -34.0f);
  CHECK(strcmp(front(), verbs[count - 1]) == 0, "twenty-four back is a step back: %s", front());
  fake_frame(fake, kButtonDown, 0);
  CHECK(strcmp(front(), verbs[0]) == 0, "down steps forward");
  fake_frame(fake, kButtonUp, 0);
  CHECK(strcmp(front(), verbs[count - 1]) == 0, "up steps back");

  /* Left past halfway, the next verb is the front, still turned below level, and the disc rolls it level once the crank rests. */
  fake_frame(fake, 0, 14.0f);
  front_at = front_placed();
  CHECK(strcmp(front(), verbs[0]) == 0 && front_at >= 0 && label_placed(front_at)->angle > 9.99f &&
            label_placed(front_at)->angle < 10.01f && fake->placed[front_at].y > FRONT_Y,
        "fourteen degrees on, the next verb has turned most of the way to the front: %s", front());
  for (i = 0; i < DISC_REST_FRAMES + 20; i++) fake_frame(fake, 0, 0);
  front_at = front_placed();
  CHECK(strcmp(front(), verbs[0]) == 0 && front_at >= 0 && fake->placed[front_at].x == FRONT_X && fake->placed[front_at].y == FRONT_Y,
        "settled level on the next verb: %s", front());

  fake_frame(fake, kButtonB, 0);
  CHECK(on_reader(), "B at the verbs closes the builder");
  CHECK(fake->made_live == 0, "and lets go of its labels: %d held", fake->made_live);
  leave();
}

/* A label made for each word shown, drawn again only when the level's entries change. */
static void a_label_is_drawn_once_while_its_level_stands(void) {
  const builder_label *front_label;
  int n, made;
  arrive("labels");
  fake_frame(fake, kButtonA, 0);
  for (n = 0; n < DISC_REST_FRAMES + 20; n++) fake_frame(fake, 0, 0);
  front_label = label_placed(front_placed());
  CHECK(front_label != NULL, "a front");
  if (front_label == NULL) {
    leave();
    return;
  }
  made = fake->made_total;
  fake_frame(fake, 0, 0);
  CHECK(fake->made_total == made && fake->placed_count == DISC_MOST_ROWS, "at rest, nothing is drawn again: %d made",
        fake->made_total - made);
  made = fake->made_total;
  fake_frame(fake, 0, 5.0f);
  CHECK(fake->made_total - made == fake->placed_count, "turned, each word shown is turned again but not drawn again: %d made for %d",
        fake->made_total - made, fake->placed_count);
  fake_frame(fake, kButtonA, 0);
  CHECK(builder()->labels_of == builder()->sentence.made && fake->made_live <= 2 * DISC_MOST_ROWS,
        "a level picked, its labels are new and the last level's let go: %d held", fake->made_live);
  leave();
}

/* The white and black pixels of the first character of the label at the front, at rest. */
static void first_character(int *white, int *black) {
  const fake_run *run = label_run(label_placed(front_placed()));
  int x, y, x0 = FRONT_X + (run != NULL ? run->x : 0), y0 = FRONT_Y + (run != NULL ? run->y : 0);
  *white = *black = 0;
  for (y = y0 + 3; y < y0 + FAKE_BIG_LINE - 3; y++)
    for (x = x0 + 1; x < x0 + FAKE_BIG_GLYPH - 1; x++) {
      *black += fake_pixel(fake, x, y);
      *white += !fake_pixel(fake, x, y);
    }
}

static void a_greyed_chip_is_drawn_greyed_and_says_why(void) {
  const int area = (FAKE_BIG_GLYPH - 2) * (FAKE_BIG_LINE - 6);
  int white, black, n, greyed_below = 0;
  arrive("greyed");
  fake_frame(fake, kButtonA, 0);
  first_character(&white, &black);
  CHECK(white == area && black == 0, "a word that can be done is solid white on the black label: %d white, %d black", white, black);
  CHECK(step_to(kButtonDown, "drop", 20), "the disc reaches drop");
  for (n = 0; n < DISC_REST_FRAMES + 20; n++) fake_frame(fake, 0, 0);
  /* Nothing is held, so nothing can be dropped: the verb is greyed once the disc reaches it. */
  CHECK(panel() != NULL && strcmp(panel()->text, "You are not holding a guard.") == 0, "the panel says why: %s",
        panel() ? panel()->text : "(none)");
  /* At the front a greyed word is dotted: half its pixels white, half the label's black, in a checker. */
  first_character(&white, &black);
  CHECK(white == area / 2 && black == area / 2, "the word is drawn in a checker: %d white, %d black", white, black);
  CHECK(fake_pixel(fake, FRONT_X + 1, FRONT_Y + 1), "on a black label");
  CHECK(step_to(kButtonUp, "take", 1), "back to take");
  for (n = 0; n < DISC_REST_FRAMES + 20; n++) fake_frame(fake, 0, 0);
  /* Off the front a greyed word keeps its checker: half the pixels of each of its characters are black. */
  n = placed_entry(builder()->sentence.state.selected + 1);
  if (n >= 0 && strcmp(label_text(label_placed(n)), "drop") == 0) {
    int made = fake_made_index(fake, label_placed(n)->flat), x, y, drawn = 0;
    for (y = 0; y < fake->made[made].height; y++)
      for (x = 0; x < fake->made[made].width; x++) drawn += fake_made_pixel(fake, made, x, y) == kColorBlack;
    greyed_below = drawn == 4 * area / 2;
  }
  CHECK(greyed_below, "drop, a sector below, is drawn greyed");
  CHECK(step_to(kButtonUp, "take", 1), "back to take");
  CHECK(keys_shown(), "a chip that can be done shows the keys");

  /* A greyed sentence cannot be run: A says why, and A again goes on. */
  CHECK(step_to(kButtonDown, "give", 5), "give");
  fake_frame(fake, kButtonA, 0);
  CHECK(strcmp(phrase(), "give") == 0, "a greyed verb can be looked into: %s", phrase());
  fake_frame(fake, kButtonA, 0);
  fake_frame(fake, kButtonA, 0);
  CHECK(HAS(phrase(), "give -> "), "two picks: %s", phrase());
  CHECK(HAS(front(), "give -> "), "the whole sentence at the front: %s", front());
  CHECK(panel() != NULL && HAS(panel()->text, "You are not holding"), "and why it cannot be: %s", panel() ? panel()->text : "");
  fake_frame(fake, kButtonA, 0);
  CHECK(fake_run_at(fake, PLAYER_MARGIN, 40) != NULL && HAS(fake_run_at(fake, PLAYER_MARGIN, 40)->text, "You are not holding"),
        "A on it says why in full");
  fake_frame(fake, kButtonA, 0);
  CHECK(HAS(front(), "give -> "), "and A again goes back to the sentence");
  leave();
}

static void descending_into_a_verb_and_back(void) {
  arrive("descend");
  fake_frame(fake, kButtonA, 0);
  CHECK(step_to(kButtonUp, "ask", 1), "up from the first verb wraps to the last");
  fake_frame(fake, kButtonA, 0);
  CHECK(strcmp(phrase(), "ask") == 0, "the sentence so far: %s", phrase());
  CHECK(strcmp(front(), "everything") == 0, "everything first, as `ask` reads `all`: %s", front());
  CHECK(step_to(kButtonDown, "a hall", 1), "then what can be asked, in the view's order: %s", front());
  CHECK(step_to(kButtonDown, "a guard", 1), "the guard is next");
  fake_frame(fake, kButtonA, 0);
  CHECK(strcmp(phrase(), "ask -> a guard") == 0, "%s", phrase());
  CHECK(strcmp(front(), "bridge") == 0, "the words the guard hears: %s", front());
  fake_frame(fake, kButtonB, 0);
  CHECK(strcmp(phrase(), "ask") == 0 && strcmp(front(), "a guard") == 0, "B steps back to where the disc was: %s", front());
  fake_frame(fake, kButtonB, 0);
  CHECK(strcmp(phrase(), "") == 0 && strcmp(front(), "ask") == 0, "and back to the verbs: %s", front());
  fake_frame(fake, kButtonB, 0);
  CHECK(on_reader(), "and closed");
  leave();
}

/* Whether a transcript row drawn holds `text`. */
static bool shown_text(const char *text) {
  int i;
  for (i = 0; i < fake->run_count; i++)
    if (HAS(fake->runs[i].text, text)) return true;
  return false;
}

static void a_completed_reading_runs_and_the_reader_is_told(void) {
  arrive("run");
  fake_frame(fake, kButtonA, 0);
  CHECK(step_to(kButtonUp, "ask", 1), "ask");
  fake_frame(fake, kButtonA, 0);
  CHECK(step_to(kButtonDown, "a guard", 1), "the guard");
  fake_frame(fake, kButtonA, 0);
  CHECK(step_to(kButtonDown, "weather", 2), "the weather");
  fake_frame(fake, kButtonA, 0);
  CHECK(strcmp(front(), "ask -> a guard -> weather") == 0, "the whole sentence to confirm: %s", front());
  fake_frame(fake, kButtonA, 0);
  CHECK(on_reader(), "the reader takes over");
  CHECK(shown_text("> ask -> a guard -> weather"), "the reader is told the sentence as typed");
  CHECK(shown_text("The guard nods."), "and what the turn told");

  /* A number role: the crank and up take it up, left and right by ten, held within its range. */
  fake_frame(fake, kButtonA, 0);
  CHECK(step_to(kButtonDown, "turn", 1), "turn");
  fake_frame(fake, kButtonA, 0);
  CHECK(step_to(kButtonDown, "a dial", 3), "the dial");
  fake_frame(fake, kButtonA, 0);
  CHECK(strcmp(front(), "0") == 0, "the notch starts at the least it takes: %s", front());
  fake_frame(fake, kButtonRight, 0);
  CHECK(strcmp(front(), "9") == 0, "ten more is past the end, so the end: %s", front());
  fake_frame(fake, kButtonLeft, 0);
  CHECK(strcmp(front(), "0") == 0, "and ten less the start: %s", front());
  fake_frame(fake, kButtonUp, 0);
  fake_frame(fake, 0, 48.0f);
  CHECK(strcmp(front(), "3") == 0, "up and two steps of crank: %s", front());
  fake_frame(fake, kButtonDown, 0);
  fake_frame(fake, kButtonUp, 0);
  fake_frame(fake, kButtonA, 0);
  CHECK(strcmp(front(), "turn -> a dial -> 3") == 0, "%s", front());
  fake_frame(fake, kButtonA, 0);
  CHECK(on_reader() && shown_text("> turn -> a dial -> 3") && shown_text("Click."), "the dial turned");

  /* A set role, joined from the things the view offers one at a time. */
  fake_frame(fake, kButtonA, 0);
  CHECK(step_to(kButtonDown, "juggle", 0), "juggle");
  fake_frame(fake, kButtonA, 0);
  CHECK(step_to(kButtonDown, "a pebble", 4), "the pebble");
  fake_frame(fake, kButtonA, 0);
  CHECK(strcmp(phrase(), "juggle -> a pebble") == 0, "%s", phrase());
  CHECK(step_to(kButtonDown, "and a shell", 5), "the others are offered: %s", front());
  fake_frame(fake, kButtonA, 0);
  CHECK(strcmp(phrase(), "juggle -> a pebble, a shell") == 0, "%s", phrase());
  CHECK(!step_to(kButtonDown, "and a shell", 5), "a thing joins once");
  CHECK(step_to(kButtonDown, "that's all", 5), "that's all");
  fake_frame(fake, kButtonA, 0);
  CHECK(strcmp(front(), "juggle -> a pebble, a shell") == 0, "%s", front());
  fake_frame(fake, kButtonA, 0);
  CHECK(on_reader() && shown_text("> juggle -> a pebble, a shell"), "the set juggled");
  leave();
}

static void a_turn_whose_save_fails_stops_play_and_greys_the_world(void) {
  const fake_run *said;
  arrive("unsaved");
  fake_frame(fake, kButtonA, 0);
  CHECK(step_to(kButtonUp, "ask", 1), "ask");
  fake_frame(fake, kButtonA, 0);
  CHECK(step_to(kButtonDown, "a guard", 1), "the guard");
  fake_frame(fake, kButtonA, 0);
  CHECK(step_to(kButtonDown, "weather", 2), "the weather");
  fake_frame(fake, kButtonA, 0);
  fake->fail_writes = 1;
  fake_frame(fake, kButtonA, 0);
  said = fake_run_at(fake, PLAYER_MARGIN, MESSAGE_TOP);
  CHECK(app->screen == &player_message_screen && said != NULL && HAS(said->text, "The save could not be written"),
        "play stops on the message screen: %s", said != NULL ? said->text : "(nothing)");
  fake_frame(fake, kButtonA, 0);
  CHECK(app->screen == &player_shelf_screen, "A goes back to the shelf");
  CHECK(player_shelf_blocked(app->shelf, "worlds/chip-tree.sproutworld"), "the world is greyed there");
  fake->fail_writes = 0;
  leave();
}

static void the_sentence_line_fits_the_screen_and_keeps_its_end(void) {
  const fake_run *line;
  int width;
  const char *built = "juggle -> a pebble, a hall, a guard, a dial";
  size_t length = strlen(built), shown;
  arrive("long");
  fake_frame(fake, kButtonA, 0);
  fake_frame(fake, kButtonA, 0);
  CHECK(step_to(kButtonDown, "a pebble", 4), "the pebble");
  fake_frame(fake, kButtonA, 0);
  CHECK(step_to(kButtonDown, "and a hall", 5), "a hall");
  fake_frame(fake, kButtonA, 0);
  CHECK(step_to(kButtonDown, "and a guard", 5), "a guard");
  fake_frame(fake, kButtonA, 0);
  CHECK(step_to(kButtonDown, "and a dial", 5), "a dial");
  fake_frame(fake, kButtonA, 0);
  CHECK(strcmp(phrase(), built) == 0 && fake_run_at(fake, PLAYER_MARGIN, 0)->font == FAKE_FONT_SYSTEM,
        "it fits in the system font: %s", phrase());

  /* Wider type: the small font where the system font does not fit. */
  fake->glyph = 20;
  fake_frame(fake, 0, 0);
  line = fake_run_at(fake, PLAYER_MARGIN, 0);
  CHECK(line != NULL && strcmp(line->text, built) == 0 && line->font == FAKE_FONT_SMALL, "the small font: %s", phrase());

  /* Wider still: trimmed from the left, so the end of the sentence, the part being built, is in view. */
  fake->small_glyph = 20;
  fake_frame(fake, 0, 0);
  line = fake_run_at(fake, PLAYER_MARGIN, 0);
  CHECK(line != NULL && line->font == FAKE_FONT_SMALL, "the small font");
  if (line != NULL) {
    shown = strlen(line->text);
    width = (int)shown * fake->small_glyph;
    CHECK(strncmp(line->text, BUILDER_TRIMMED, strlen(BUILDER_TRIMMED)) == 0, "led by the mark of a trimmed line: %s", line->text);
    CHECK(width <= ROOM, "it fits: %d pixels", width);
    CHECK(width + fake->small_glyph > ROOM, "and no character more would: %d pixels", width);
    shown -= strlen(BUILDER_TRIMMED);
    CHECK(shown < length && strcmp(line->text + strlen(BUILDER_TRIMMED), built + length - shown) == 0, "it ends as the sentence does: %s",
          line->text);
  }
  /* The rest of the screen's text fits it too. */
  {
    int i;
    for (i = 0; i < fake->run_count; i++)
      CHECK(fake->runs[i].x >= 0 && fake->runs[i].x + (int)strlen(fake->runs[i].text) * fake_glyph(fake, fake->runs[i].font) <= 400,
            "%s is drawn inside the screen", fake->runs[i].text);
  }
  /* A word on the disc is not fitted: the whole sentence at the front runs off the screen's edge, cut there. */
  CHECK(step_to(kButtonDown, "that's all", 10), "that's all");
  fake_frame(fake, kButtonA, 0);
  {
    int n = front_placed(), i;
    const builder_label *label = n >= 0 ? label_placed(n) : NULL;
    CHECK(label != NULL && strcmp(label_text(label), built) == 0, "the whole sentence is drawn at the front: %s", front());
    CHECK(n >= 0 && fake->made[fake->placed[n].made].width == 400, "into a label as wide as the screen, past which nothing shows: %d",
          n >= 0 ? fake->made[fake->placed[n].made].width : 0);
    for (i = 0; i < fake->placed_count; i++)
      CHECK(fake->placed[i].clipped && fake->placed[i].clip_x == 0 && fake->placed[i].clip_y == HEADER &&
                fake->placed[i].clip_width == 400 && fake->placed[i].clip_height == BOTTOM - HEADER,
            "every word is drawn clipped to the disc, between the sentence line and the panel");
  }
  leave();
}

/* ---- everything ---- */

static sentence *built(void) { return &((player_builder *)app->ctx)->sentence; }

/* Whether the disc's first entry is `everything`. */
static bool everything_first(void) {
  size_t count;
  const sentence_entry *entries = sentence_entries(built(), &count);
  return entries[0].kind == SENTENCE_ENTRY_EVERYTHING && strcmp(entries[0].label, "everything") == 0;
}

/* Whether any entry on the disc is `everything`. */
static bool everything_offered(void) {
  size_t count, i;
  const sentence_entry *entries = sentence_entries(built(), &count);
  for (i = 0; i < count; i++)
    if (entries[i].kind == SENTENCE_ENTRY_EVERYTHING) return true;
  return false;
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

/* Whether `texts` are each in `whole`, in order. */
static bool in_order(const char *whole, const char *const *texts, size_t count) {
  size_t i;
  for (i = 0; i < count; i++) {
    const char *found = strstr(whole, texts[i]);
    if (found == NULL) return false;
    whole = found + strlen(texts[i]);
  }
  return true;
}

/* How many lines of the fake's file log write a file whose path holds `part`. */
static int writes_of(const char *part) {
  const char *line = fake->file_log;
  int count = 0;
  for (; *line != '\0'; line = strchr(line, '\n') + 1) {
    const char *end = strchr(line, '\n');
    const char *found = strstr(line, part);
    if (strncmp(line, "write ", 6) == 0 && found != NULL && found < end) count++;
  }
  return count;
}

/* Runs frames until the save owed is written; whether it was. */
static bool saved_out(void) {
  int n;
  for (n = 0; n < 10000 && player_saving(app->session); n++) fake_frame(fake, 0, 0);
  return !player_saving(app->session);
}

static void everything_for_a_role_that_takes_one_thing_runs_a_turn_each_and_stops_at_a_refusal(void) {
  static const char *const turns[] = {"> examine -> an apple", "A red apple.", "> examine -> a bell", "A brass bell.",
                                      "> examine -> a lamp", "Too bright to look at."};
  size_t logged, i, alike = 0;
  const char *whole;
  arrive_in("each", "all-in-order.sproutworld");
  fake_frame(fake, kButtonA, 0);
  CHECK(step_to(kButtonDown, "examine", 20), "examine");
  fake_frame(fake, kButtonA, 0);
  CHECK(everything_first() && strcmp(front(), "everything") == 0, "everything comes first, at the front: %s", front());
  fake_frame(fake, kButtonA, 0);
  CHECK(strcmp(phrase(), "examine -> everything") == 0, "the sentence so far says everything: %s", phrase());
  CHECK(strcmp(front(), "examine -> everything") == 0, "and is the sentence to confirm: %s", front());
  CHECK(sentence_each_count(built()) == 5, "a turn for each thing but the place: %zu", sentence_each_count(built()));
  logged = app->session->log_count;
  CHECK(player_save_settle(app->session).ok, "nothing is owed before the line");
  fake->file_log[0] = '\0';
  fake_frame(fake, kButtonA, 0);
  CHECK(on_reader(), "the reader takes over");
  CHECK(writes_of(".json.part") == 0, "no step of the line writes the state:\n%s", fake->file_log);
  CHECK(saved_out() && writes_of(".json.part") == 1, "the line stopped at a refusal writes it once, after:\n%s",
        fake->file_log);
  whole = told_so_far();
  /* The bell's glint dazzles the lamp after the line was read, so the lamp refuses on its turn and the line stops. */
  CHECK(in_order(whole, turns, sizeof turns / sizeof turns[0]), "each turn told as its own sentence, in the walk's order: %s", whole);
  CHECK(strstr(whole, "a mirror") == NULL && strstr(whole, "a pear") == NULL, "nothing after the refusal runs: %s", whole);
  CHECK(app->session->log_count == logged + 3, "three turns are logged: %zu", app->session->log_count - logged);
  for (i = logged; i < app->session->log_count; i++) alike += strstr(app->session->log[i], "\"text\":\"examine -> everything\"") != NULL;
  CHECK(alike == 3, "each under the whole sentence, as a line of `all` logs each turn under the line typed: %zu", alike);
  leave();
}

/* The examine of the sack, the ball and the lunch, run as one line in the left-out world's hall. */
static void examine_everything(void) {
  fake_frame(fake, kButtonA, 0);
  CHECK(step_to(kButtonDown, "examine", 20), "examine");
  fake_frame(fake, kButtonA, 0);
  CHECK(everything_first(), "everything comes first: %s", front());
  fake_frame(fake, kButtonA, 0);
  CHECK(sentence_each_count(built()) == 3, "three things: %zu", sentence_each_count(built()));
  CHECK(player_save_settle(app->session).ok, "nothing is owed before the line");
  fake->file_log[0] = '\0';
  fake_frame(fake, kButtonA, 0);
}

/* One input is one save: a line's steps append the log tail each, and the state is written once, after the last. */
static void a_line_of_turns_writes_the_state_once(void) {
  static const char *const turns[] = {"> examine -> a sack", "> examine -> a ball", "> examine -> a lunch"};
  arrive_in("one save", "all-leaves-out-refused.sproutworld");
  examine_everything();
  CHECK(on_reader() && in_order(told_so_far(), turns, 3), "every step ran: %s", told_so_far());
  CHECK(writes_of(".log") == 3, "the log tail is written at each step:\n%s", fake->file_log);
  CHECK(writes_of(".json.part") == 0 && player_saving(app->session), "and the state is owed, not written:\n%s",
        fake->file_log);
  CHECK(saved_out() && writes_of(".json.part") == 1, "then written once:\n%s", fake->file_log);
  leave();
}

/* The save a line owes failing stops play, as a single turn's does. */
static void a_line_whose_save_fails_stops_play(void) {
  const fake_run *said;
  arrive_in("line unsaved", "all-leaves-out-refused.sproutworld");
  examine_everything();
  CHECK(on_reader() && player_saving(app->session), "the line ran and owes its state");
  fake->fail_writes = 1;
  fake_frame(fake, 0, 0);
  said = fake_run_at(fake, PLAYER_MARGIN, MESSAGE_TOP);
  CHECK(app->screen == &player_message_screen && said != NULL && HAS(said->text, "The save could not be written"),
        "play stops on the message screen: %s", said != NULL ? said->text : "(nothing)");
  fake_frame(fake, kButtonA, 0);
  CHECK(app->screen == &player_shelf_screen && player_shelf_blocked(app->shelf, "worlds/all-leaves-out-refused.sproutworld"),
        "and the world is greyed on the shelf");
  fake->fail_writes = 0;
  leave();
}

static void everything_for_a_set_role_binds_them_all(void) {
  const sentence_state *state;
  arrive("set");
  fake_frame(fake, kButtonA, 0);
  CHECK(step_to(kButtonDown, "juggle", 0), "juggle");
  fake_frame(fake, kButtonA, 0);
  CHECK(everything_first(), "everything comes first: %s", front());
  fake_frame(fake, kButtonA, 0);
  state = &built()->state;
  CHECK(strcmp(phrase(), "juggle -> everything") == 0, "the sentence so far says everything: %s", phrase());
  /* The hall is the place and the guard someone here: the dial, the pebble and the shell. */
  CHECK(state->pick_count == 1 && state->picks[0].everything && state->picks[0].count == 3 &&
            strcmp(state->joined[0]->name.bytes, "a dial") == 0 && strcmp(state->joined[2]->name.bytes, "a shell") == 0,
        "the set role binds every thing it takes at once: %zu", state->picks[0].count);
  CHECK(sentence_each_count(built()) == 0, "and is one turn");
  fake_frame(fake, kButtonA, 0);
  CHECK(on_reader() && shown_text("> juggle -> everything"), "run as the one sentence");
  leave();
}

static void everything_leaves_out_what_is_greyed_and_needs_two_things(void) {
  arrive_in("left out", "all-leaves-out-refused.sproutworld");
  fake_frame(fake, kButtonA, 0);
  CHECK(step_to(kButtonDown, "examine", 20), "examine");
  fake_frame(fake, kButtonA, 0);
  CHECK(everything_first(), "everything comes first: %s", front());
  fake_frame(fake, kButtonA, 0);
  CHECK(sentence_each_count(built()) == 3, "the sack, the lunch and the ball, the lamp's refusal left out: %zu",
        sentence_each_count(built()));
  {
    size_t k;
    for (k = 0; k < sentence_each_count(built()); k++)
      CHECK(strcmp(built()->each[k]->thing.name.bytes, "a lamp") != 0, "the greyed lamp is not among them");
  }
  fake_frame(fake, kButtonB, 0);
  fake_frame(fake, kButtonB, 0);
  CHECK(step_to(kButtonDown, "drop", 20), "drop");
  fake_frame(fake, kButtonA, 0);
  CHECK(!everything_offered(), "nothing is held, so nothing can be dropped and nothing is everything");
  fake_frame(fake, kButtonB, 0);
  CHECK(step_to(kButtonDown, "take", 20), "take");
  fake_frame(fake, kButtonA, 0);
  CHECK(step_to(kButtonDown, "a ball", 5), "a ball");
  fake_frame(fake, kButtonA, 0);
  while (strcmp(front(), "take -> a ball") != 0 && !on_reader() && step_to(kButtonDown, "that's all", 5)) fake_frame(fake, kButtonA, 0);
  fake_frame(fake, kButtonA, 0);
  CHECK(on_reader() && shown_text("> take -> a ball"), "the ball taken");
  fake_frame(fake, kButtonA, 0);
  CHECK(step_to(kButtonDown, "drop", 20), "drop");
  fake_frame(fake, kButtonA, 0);
  CHECK(!everything_offered(), "only the ball can be dropped: one thing is no everything");
  leave();
}

static void everything_runs_at_most_what_a_set_role_may_bind(void) {
  arrive_in("bound", "all-leaves-out-refused.sproutworld");
  fake_frame(fake, kButtonA, 0);
  CHECK(step_to(kButtonDown, "go", 20), "go");
  fake_frame(fake, kButtonA, 0);
  CHECK(!everything_offered(), "a way out is no thing");
  CHECK(step_to(kButtonDown, "down", 5), "down");
  fake_frame(fake, kButtonA, 0);
  fake_frame(fake, kButtonA, 0);
  CHECK(on_reader(), "gone down");
  fake_frame(fake, kButtonA, 0);
  CHECK(step_to(kButtonDown, "take", 20), "take");
  fake_frame(fake, kButtonA, 0);
  CHECK(everything_first(), "everything comes first: %s", front());
  fake_frame(fake, kButtonA, 0);
  while (strcmp(front(), "take -> everything") != 0 && step_to(kButtonDown, "that's all", 5)) fake_frame(fake, kButtonA, 0);
  CHECK(strcmp(front(), "take -> everything") == 0, "the sentence: %s", front());
  CHECK(sentence_each_count(built()) == 8, "nine marbles, and a set role binds eight: %zu", sentence_each_count(built()));
  leave();
}

/* Rests the crank long enough for the disc to settle. */
static void rest(void) {
  int n;
  for (n = 0; n < DISC_REST_FRAMES + 60; n++) fake_frame(fake, 0, 0);
}

/* Turns the crank by `degrees` a frame, `frames` times, `still` frames of rest after each. */
static void turn(float degrees, int frames, int still) {
  int n, m;
  for (n = 0; n < frames; n++) {
    fake_frame(fake, 0, degrees);
    for (m = 0; m < still; m++) fake_frame(fake, 0, 0);
  }
}

/* Whether `text` ends with `tail`. */
static bool ends_with(const char *text, const char *tail) {
  size_t a = strlen(text), b = strlen(tail);
  return a >= b && strcmp(text + a - b, tail) == 0;
}

/*
 * The disc agrees with itself: the word at the front, the inverted label, has its reason in the
 * panel (or the keys, where it has none), and A picks it. `shape` names how the disc got there.
 * Whether A moved the builder on a level; a sentence to confirm is not run.
 */
static bool front_is_the_pick(const char *shape) {
  char word[512];
  const sentence_entry *entries, *entry = NULL;
  size_t count, i, depth;
  CHECK(front_placed() >= 0, "%s: a word at the front", shape);
  if (front_placed() < 0) return false;
  snprintf(word, sizeof word, "%s", front());
  entries = sentence_entries(&((player_builder *)app->ctx)->sentence, &count);
  for (i = 0; i < count; i++)
    if (strcmp(entries[i].label, word) == 0) entry = &entries[i];
  CHECK(entry != NULL, "%s: %s is on the disc", shape, word);
  if (entry == NULL) return false;
  if (entry->reason != NULL)
    CHECK(panel() != NULL && strncmp(entry->reason, panel()->text, strlen(panel()->text)) == 0, "%s: the panel is %s's reason: %s",
          shape, word, panel() != NULL ? panel()->text : "(none)");
  else
    CHECK(keys_shown(), "%s: %s has no reason, so the panel shows the keys: %s", shape, word, panel() != NULL ? panel()->text : "(none)");
  if (entry->kind == SENTENCE_ENTRY_CONFIRM || entry->kind == SENTENCE_ENTRY_NONE) return false;
  depth = ((player_builder *)app->ctx)->sentence.history_count;
  fake_frame(fake, kButtonA, 0);
  CHECK(((player_builder *)app->ctx)->sentence.history_count == depth + 1 && ends_with(phrase(), word),
        "%s: A on %s picks it: the sentence reads %s", shape, word, phrase());
  return ((player_builder *)app->ctx)->sentence.history_count == depth + 1;
}

/* At rest on the verbs, the verb at the front has been asked after, so its reason, if it has one, is known. */
static void asked_after(const char *shape) {
  const sentence *sentence = &((player_builder *)app->ctx)->sentence;
  size_t count;
  const sentence_entry *entry = &sentence_entries(sentence, &count)[sentence->state.selected];
  CHECK(entry->kind == SENTENCE_ENTRY_VERB && sentence->choices[entry->index].greyed != PLAYER_GREYED_UNKNOWN,
        "%s: the verb at rest at the front, %s, has been asked after", shape, entry->label);
}

/* Steps back to the verbs. */
static void back_to_the_verbs(const char *shape) {
  int n;
  for (n = 0; n < SENTENCE_MOST_PARTS && strcmp(phrase(), "") != 0; n++) fake_frame(fake, kButtonB, 0);
  CHECK(strcmp(phrase(), "") == 0 && !on_reader(), "%s: back at the verbs: %s", shape, phrase());
}

static void after_any_crank_turn_the_front_is_what_a_picks(void) {
  /* Shapes of turn: steady, jumpy with rests between, reversing, stopped between sectors, a crank that never quite rests. */
  static const struct {
    const char *name;
    float degrees[3];
    int frames[3], still[3];
  } shapes[] = {
      {"a steady turn on", {5.0f, 0, 0}, {10, 0, 0}, {0, 0, 0}},
      {"a steady turn back", {-7.0f, 0, 0}, {9, 0, 0}, {0, 0, 0}},
      {"twelve quick presses back", {-14.0f, 0, 0}, {12, 0, 0}, {1, 0, 0}},
      {"twelve presses back, a rest between", {-14.0f, 0, 0}, {12, 0, 0}, {3, 0, 0}},
      {"presses on, resting almost long enough to settle", {14.0f, 0, 0}, {7, 0, 0}, {DISC_REST_FRAMES - 1, 0, 0}},
      {"presses on, settling between", {14.0f, 0, 0}, {5, 0, 0}, {DISC_REST_FRAMES + 2, 0, 0}},
      {"on and then back", {20.0f, -14.0f, 0}, {3, 4, 0}, {0, 2, 0}},
      {"back and then on", {-9.0f, 13.0f, -3.0f}, {5, 3, 1}, {1, 0, 0}},
      {"stopped short of halfway", {11.0f, 0, 0}, {1, 0, 0}, {0, 0, 0}},
      {"stopped past halfway", {13.0f, 0, 0}, {1, 0, 0}, {0, 0, 0}},
      {"stopped past halfway back", {-13.0f, 0, 0}, {1, 0, 0}, {0, 0, 0}},
      {"stopped exactly halfway", {12.0f, 0, 0}, {1, 0, 0}, {0, 0, 0}},
      {"stopped exactly halfway back", {-12.0f, 0, 0}, {1, 0, 0}, {0, 0, 0}},
      {"a step and most of another on", {40.0f, 0, 0}, {1, 0, 0}, {0, 0, 0}},
      {"a crank that never quite rests", {-14.0f, 0.01f, 0}, {1, 60, 0}, {0, 0, 0}},
  };
  size_t i, j;
  arrive("crank");
  fake_frame(fake, kButtonA, 0);
  CHECK(keys_shown(), "the builder is open");
  for (i = 0; i < sizeof shapes / sizeof shapes[0]; i++) {
    const char *shape = shapes[i].name;
    for (j = 0; j < 3; j++) turn(shapes[i].degrees[j], shapes[i].frames[j], shapes[i].still[j]);
    front_is_the_pick(shape);
    /* Turned and let rest, and then on the level A opened: from the start, and after a turn of its own. */
    back_to_the_verbs(shape);
    for (j = 0; j < 3; j++) turn(shapes[i].degrees[j], shapes[i].frames[j], shapes[i].still[j]);
    rest();
    asked_after(shape);
    if (front_is_the_pick(shape)) {
      front_is_the_pick("the level opened after the turn");
      fake_frame(fake, kButtonB, 0);
      rest();
      front_is_the_pick("the level opened, at rest");
      fake_frame(fake, kButtonB, 0);
      for (j = 0; j < 3; j++) turn(shapes[i].degrees[j], shapes[i].frames[j], shapes[i].still[j]);
      rest();
      front_is_the_pick("a turn on the level opened");
    }
    back_to_the_verbs(shape);
  }
  leave();
}

static void the_fit_trims_a_character_at_a_time_and_never_inside_one(void) {
  LCDFont *fonts[1];
  LCDFont *font = NULL;
  const char *why = NULL;
  char out[64];
  const char *fitted;
  begin("fit");
  fonts[0] = fake->api.graphics->loadFont(BUILDER_SMALL_FONT, &why);
  CHECK(fonts[0] != NULL, "%s", why);
  fitted = player_builder_fit(&fake->api, fonts, 1, "short", ROOM, out, sizeof out, &font);
  CHECK(strcmp(fitted, "short") == 0 && font == fonts[0], "what fits is drawn as it is");
  fake->small_glyph = 100;
  /* Room for four characters: the lead and one more, which is the last; a two-byte character is never split. */
  fitted = player_builder_fit(&fake->api, fonts, 1, "abcd\xc3\xa9", 400, out, sizeof out, &font);
  CHECK(strcmp(fitted, "...\xc3\xa9") == 0, "the last character whole: %s", fitted);
  fitted = player_builder_fit(&fake->api, fonts, 1, "abcdef", 300, out, sizeof out, &font);
  CHECK(strcmp(fitted, "...") == 0, "nothing past the lead fits: %s", fitted);
  end();
}

int main(void) {
  test_program("builder");
  the_fit_trims_a_character_at_a_time_and_never_inside_one();
  the_root_is_the_scenes_verbs_on_a_disc_turned_by_the_crank();
  a_label_is_drawn_once_while_its_level_stands();
  a_greyed_chip_is_drawn_greyed_and_says_why();
  descending_into_a_verb_and_back();
  a_completed_reading_runs_and_the_reader_is_told();
  a_turn_whose_save_fails_stops_play_and_greys_the_world();
  the_sentence_line_fits_the_screen_and_keeps_its_end();
  everything_for_a_role_that_takes_one_thing_runs_a_turn_each_and_stops_at_a_refusal();
  a_line_of_turns_writes_the_state_once();
  a_line_whose_save_fails_stops_play();
  everything_for_a_set_role_binds_them_all();
  everything_leaves_out_what_is_greyed_and_needs_two_things();
  everything_runs_at_most_what_a_set_role_may_bind();
  after_any_crank_turn_the_front_is_what_a_picks();
  return finish();
}
