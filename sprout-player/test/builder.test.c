/*
 * The sentence builder (ui/builder.c, ui/sentence.c, ui/everything.c, ui/drum.c) driven a frame at a time through
 * the fake PlaydateAPI in the chip_tree world's hall, and judged by what was drawn. The rules: the
 * drum's front is the selected entry in the big font, its neighbours curve away in the smaller
 * fonts in the entries' order; the root lists the scene's verbs in the view's order; a greyed
 * chip is drawn greyed and its reason is the panel's words; the sentence so far is the picks
 * joined; a confirmed sentence runs and the reader is told it and then what the turn told, and one
 * whose save fails stops play and greys the world on the shelf; the sentence line fits the screen
 * whatever its length, keeping its end in view; and however the crank turned, the word in the
 * window is the one the panel speaks of and A picks. `everything` comes first on a level whose role
 * would read `all` where two or more things can be done: a set role binds them all, and a role that
 * takes one thing runs a turn for each in the level's order, leaving out what the view refuses,
 * stopping at the first refusal and bounded by what a set role may bind.
 */
#include <stdlib.h>

#include "session_internal.h"
#include "support.h"
#include "ui/app.h"
#include "ui/builder.h"
#include "ui/drum.h"
#include "ui/message.h"
#include "ui/nickname.h"
#include "ui/reader.h"
#include "ui/shelf.h"

#define LINE FAKE_LINE
#define HEADER (LINE + 4)
#define BOTTOM (240 - (LINE * 3 + 8))
#define CENTRE ((HEADER + BOTTOM) / 2)
#define FRONT_Y (CENTRE - FAKE_BIG_LINE / 2)
#define ROOM (400 - 2 * PLAYER_MARGIN)

static const char READER_KEYS[] = "A: build a sentence   crank: scroll back";

static player_app *app;

static const fake_run *panel(void) { return fake_run_at(fake, PLAYER_MARGIN, BOTTOM + 2); }

static bool on_reader(void) { return panel() != NULL && strcmp(panel()->text, READER_KEYS) == 0; }

/* Whether the builder's keys are the panel's words; wrapped, their runs of spaces are one. */
static bool keys_shown(void) { return panel() != NULL && strcmp(panel()->text, "A picks B steps back the crank turns the wheel") == 0; }

/* The run drawn in `font`, the first at `y` where y is not -1; NULL where there is none. */
static const fake_run *run_in(fake_font font, int y) {
  int i;
  for (i = 0; i < fake->run_count; i++)
    if (fake->runs[i].font == font && (y == -1 || fake->runs[i].y == y)) return &fake->runs[i];
  return NULL;
}

/* The word in the window: the one drawn large, wherever the turning drum has carried it. */
static const char *front(void) {
  const fake_run *run = run_in(FAKE_FONT_BIG, -1);
  return run != NULL ? run->text : "(no front)";
}

/* The sentence so far, as drawn above the drum. */
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

/* A verb's name without its library, as the drum shows it. */
static const char *bare(const char *verb) {
  const char *dot = strrchr(verb, '.');
  return dot != NULL ? dot + 1 : verb;
}

/* ---- the scenarios ---- */

static void the_root_is_the_scenes_verbs_on_a_drum_turned_by_the_crank(void) {
  static char verbs[32][64];
  player_chip_level root;
  size_t count, i;
  const fake_run *above, *below, *far_above, *far_below;
  arrive("root");
  fake_frame(fake, kButtonA, 0);
  CHECK(!on_reader() && keys_shown(), "A opens the builder, its keys below the drum");
  CHECK(strcmp(phrase(), "") == 0, "nothing is built yet: %s", phrase());
  root = player_chips(app->session, NULL, 0);
  CHECK(root.ok && root.choice_count >= 12, "the scene's verbs");
  count = root.choice_count < 32 ? root.choice_count : 32;
  for (i = 0; i < count; i++) snprintf(verbs[i], sizeof verbs[0], "%s", bare(root.choices[i].verb));
  CHECK(strcmp(verbs[0], "juggle") == 0 && strcmp(verbs[11], "ask") == 0, "the chip_tree hall's verbs: %s ... %s", verbs[0], verbs[11]);

  /* The front is the first verb, large and centred in the window; the ones beside and beyond it in smaller type. */
  CHECK(strcmp(front(), verbs[0]) == 0, "the front is %s, the first verb: %s", verbs[0], front());
  CHECK(run_in(FAKE_FONT_BIG, FRONT_Y)->x == 200 - (int)strlen(verbs[0]) * FAKE_BIG_GLYPH / 2, "centred");
  below = run_in(FAKE_FONT_SYSTEM, CENTRE + 41 - LINE / 2);
  above = run_in(FAKE_FONT_SYSTEM, CENTRE - 41 - LINE / 2);
  far_below = run_in(FAKE_FONT_SMALL, CENTRE + 67 - FAKE_SMALL_LINE / 2);
  far_above = run_in(FAKE_FONT_SMALL, CENTRE - 67 - FAKE_SMALL_LINE / 2);
  CHECK(below != NULL && strcmp(below->text, verbs[1]) == 0, "the next verb below, in the system font");
  CHECK(above != NULL && strcmp(above->text, verbs[count - 1]) == 0, "the last verb above it, the drum wrapping round");
  CHECK(far_below != NULL && strcmp(far_below->text, verbs[2]) == 0, "two along, curving away small");
  CHECK(far_above != NULL && strcmp(far_above->text, verbs[count - 2]) == 0, "two back, curving away small");
  {
    int x, inside = 1;
    for (x = 0; x < 400; x++) inside = inside && fake_pixel(fake, x, CENTRE - BUILDER_WINDOW) && fake_pixel(fake, x, CENTRE + BUILDER_WINDOW);
    CHECK(inside, "the window's edges cross the screen");
    CHECK(fake_pixel(fake, PLAYER_MARGIN + 1, CENTRE) && fake_pixel(fake, 400 - PLAYER_MARGIN - 1, CENTRE), "the pointers at the window");
  }

  /* Each 24 degrees of crank is a verb, round the whole drum and back to the first; less is not yet one. */
  for (i = 1; i <= count; i++) {
    fake_frame(fake, 0, 24.0f);
    CHECK(strcmp(front(), verbs[i % count]) == 0, "after %zu steps the front is %s: %s", i, verbs[i % count], front());
  }
  fake_frame(fake, 0, 10.0f);
  CHECK(strcmp(front(), verbs[0]) == 0, "ten degrees is not a step");
  fake_frame(fake, 0, -34.0f);
  CHECK(strcmp(front(), verbs[count - 1]) == 0, "twenty-four back is a step back: %s", front());
  fake_frame(fake, kButtonDown, 0);
  CHECK(strcmp(front(), verbs[0]) == 0, "down steps forward");
  fake_frame(fake, kButtonUp, 0);
  CHECK(strcmp(front(), verbs[count - 1]) == 0, "up steps back");

  /* Left past halfway, the next verb is the one in the window, and the drum rolls it to the centre once the crank rests. */
  fake_frame(fake, 0, 14.0f);
  CHECK(run_in(FAKE_FONT_BIG, FRONT_Y) == NULL && run_in(FAKE_FONT_BIG, FRONT_Y + 18) != NULL &&
            strcmp(run_in(FAKE_FONT_BIG, FRONT_Y + 18)->text, verbs[0]) == 0,
        "fourteen degrees on, the next verb has turned most of the way into the window");
  for (i = 0; i < DRUM_REST_FRAMES + 20; i++) fake_frame(fake, 0, 0);
  CHECK(strcmp(front(), verbs[0]) == 0, "settled on the next verb: %s", front());

  fake_frame(fake, kButtonB, 0);
  CHECK(on_reader(), "B at the verbs closes the builder");
  leave();
}

static void a_greyed_chip_is_drawn_greyed_and_says_why(void) {
  const fake_run *drop;
  int x, y, white = 0, black = 0;
  arrive("greyed");
  fake_frame(fake, kButtonA, 0);
  CHECK(step_to(kButtonDown, "drop", 20), "the drum reaches drop");
  /* Nothing is held, so nothing can be dropped: the verb is greyed once the drum reaches it. */
  CHECK(panel() != NULL && strcmp(panel()->text, "You are not holding a guard.") == 0, "the panel says why: %s",
        panel() ? panel()->text : "(none)");
  drop = run_in(FAKE_FONT_BIG, FRONT_Y);
  for (y = drop->y + 3; y < drop->y + FAKE_BIG_LINE - 3; y++)
    for (x = drop->x + 1; x < drop->x + FAKE_BIG_GLYPH - 1; x++) {
      if ((x + y) % 2 == 0) white += !fake_pixel(fake, x, y);
      else black += fake_pixel(fake, x, y);
    }
  CHECK(white == (FAKE_BIG_GLYPH - 2) * (FAKE_BIG_LINE - 6) / 2 && black == white, "the word is drawn in a checker: %d white, %d black",
        white, black);
  CHECK(step_to(kButtonUp, "take", 1), "back to take");
  CHECK(keys_shown(), "a chip that can be done shows the keys");

  /* A greyed sentence cannot be run: A says why, and A again goes on. */
  CHECK(step_to(kButtonDown, "give", 5), "give");
  fake_frame(fake, kButtonA, 0);
  CHECK(strcmp(phrase(), "give") == 0, "a greyed verb can be looked into: %s", phrase());
  fake_frame(fake, kButtonA, 0);
  fake_frame(fake, kButtonA, 0);
  CHECK(HAS(phrase(), "give -> "), "two picks: %s", phrase());
  CHECK(run_in(FAKE_FONT_BIG, FRONT_Y) != NULL && HAS(front(), "give -> "), "the whole sentence at the front: %s", front());
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
  CHECK(strcmp(phrase(), "ask") == 0 && strcmp(front(), "a guard") == 0, "B steps back to where the drum was: %s", front());
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
  /* The drum's own words fit too: the front, each slat, inside the screen. */
  {
    int i;
    for (i = 0; i < fake->run_count; i++)
      CHECK(fake->runs[i].x >= 0 && fake->runs[i].x + (int)strlen(fake->runs[i].text) * fake_glyph(fake, fake->runs[i].font) <= 400,
            "%s is drawn inside the screen", fake->runs[i].text);
  }
  leave();
}

/* ---- everything ---- */

static sentence *built(void) { return &((player_builder *)app->ctx)->sentence; }

/* Whether the drum's first entry is `everything`. */
static bool everything_first(void) {
  size_t count;
  const sentence_entry *entries = sentence_entries(built(), &count);
  return entries[0].kind == SENTENCE_ENTRY_EVERYTHING && strcmp(entries[0].label, "everything") == 0;
}

/* Whether any entry on the drum is `everything`. */
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

static void everything_for_a_role_that_takes_one_thing_runs_a_turn_each_and_stops_at_a_refusal(void) {
  static const char *const turns[] = {"> examine -> an apple", "A red apple.", "> examine -> a bell", "A brass bell.",
                                      "> examine -> a lamp", "Too bright to look at."};
  size_t logged, i, alike = 0;
  const char *whole;
  arrive_in("each", "all-in-order.sproutworld");
  fake_frame(fake, kButtonA, 0);
  CHECK(step_to(kButtonDown, "examine", 20), "examine");
  fake_frame(fake, kButtonA, 0);
  CHECK(everything_first() && strcmp(front(), "everything") == 0, "everything comes first, in the window: %s", front());
  fake_frame(fake, kButtonA, 0);
  CHECK(strcmp(phrase(), "examine -> everything") == 0, "the sentence so far says everything: %s", phrase());
  CHECK(strcmp(front(), "examine -> everything") == 0, "and is the sentence to confirm: %s", front());
  CHECK(sentence_each_count(built()) == 5, "a turn for each thing but the place: %zu", sentence_each_count(built()));
  logged = app->session->log_count;
  fake_frame(fake, kButtonA, 0);
  CHECK(on_reader(), "the reader takes over");
  whole = told_so_far();
  /* The bell's glint dazzles the lamp after the line was read, so the lamp refuses on its turn and the line stops. */
  CHECK(in_order(whole, turns, sizeof turns / sizeof turns[0]), "each turn told as its own sentence, in the walk's order: %s", whole);
  CHECK(strstr(whole, "a mirror") == NULL && strstr(whole, "a pear") == NULL, "nothing after the refusal runs: %s", whole);
  CHECK(app->session->log_count == logged + 3, "three turns are logged: %zu", app->session->log_count - logged);
  for (i = logged; i < app->session->log_count; i++) alike += strstr(app->session->log[i], "\"text\":\"examine -> everything\"") != NULL;
  CHECK(alike == 3, "each under the whole sentence, as a line of `all` logs each turn under the line typed: %zu", alike);
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

/* Rests the crank long enough for the drum to settle. */
static void rest(void) {
  int n;
  for (n = 0; n < DRUM_REST_FRAMES + 60; n++) fake_frame(fake, 0, 0);
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
 * The drum agrees with itself: the word in the window, drawn in the big font, has its reason in the
 * panel (or the keys, where it has none), and A picks it. `shape` names how the drum got there.
 * Whether A moved the builder on a level; a sentence to confirm is not run.
 */
static bool window_is_the_pick(const char *shape) {
  char word[512];
  const fake_run *window = run_in(FAKE_FONT_BIG, -1);
  const sentence_entry *entries, *entry = NULL;
  size_t count, i, depth;
  CHECK(window != NULL, "%s: a word in the window", shape);
  if (window == NULL) return false;
  snprintf(word, sizeof word, "%s", window->text);
  entries = sentence_entries(&((player_builder *)app->ctx)->sentence, &count);
  for (i = 0; i < count; i++)
    if (strcmp(entries[i].label, word) == 0) entry = &entries[i];
  CHECK(entry != NULL, "%s: %s is on the drum", shape, word);
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

/* At rest on the verbs, the verb in the window has been asked after, so its reason, if it has one, is known. */
static void asked_after(const char *shape) {
  const sentence *sentence = &((player_builder *)app->ctx)->sentence;
  size_t count;
  const sentence_entry *entry = &sentence_entries(sentence, &count)[sentence->state.selected];
  CHECK(entry->kind == SENTENCE_ENTRY_VERB && sentence->choices[entry->index].greyed != PLAYER_GREYED_UNKNOWN,
        "%s: the verb at rest in the window, %s, has been asked after", shape, entry->label);
}

/* Steps back to the verbs. */
static void back_to_the_verbs(const char *shape) {
  int n;
  for (n = 0; n < SENTENCE_MOST_PARTS && strcmp(phrase(), "") != 0; n++) fake_frame(fake, kButtonB, 0);
  CHECK(strcmp(phrase(), "") == 0 && !on_reader(), "%s: back at the verbs: %s", shape, phrase());
}

static void after_any_crank_turn_the_window_is_what_a_picks(void) {
  /* Shapes of turn: steady, jumpy with rests between, reversing, stopped between slats, a crank that never quite rests. */
  static const struct {
    const char *name;
    float degrees[3];
    int frames[3], still[3];
  } shapes[] = {
      {"a steady turn on", {5.0f, 0, 0}, {10, 0, 0}, {0, 0, 0}},
      {"a steady turn back", {-7.0f, 0, 0}, {9, 0, 0}, {0, 0, 0}},
      {"twelve quick presses back", {-14.0f, 0, 0}, {12, 0, 0}, {1, 0, 0}},
      {"twelve presses back, a rest between", {-14.0f, 0, 0}, {12, 0, 0}, {3, 0, 0}},
      {"presses on, resting almost long enough to settle", {14.0f, 0, 0}, {7, 0, 0}, {DRUM_REST_FRAMES - 1, 0, 0}},
      {"presses on, settling between", {14.0f, 0, 0}, {5, 0, 0}, {DRUM_REST_FRAMES + 2, 0, 0}},
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
    window_is_the_pick(shape);
    /* Turned and let rest, and then on the level A opened: from the start, and after a turn of its own. */
    back_to_the_verbs(shape);
    for (j = 0; j < 3; j++) turn(shapes[i].degrees[j], shapes[i].frames[j], shapes[i].still[j]);
    rest();
    asked_after(shape);
    if (window_is_the_pick(shape)) {
      window_is_the_pick("the level opened after the turn");
      fake_frame(fake, kButtonB, 0);
      rest();
      window_is_the_pick("the level opened, at rest");
      fake_frame(fake, kButtonB, 0);
      for (j = 0; j < 3; j++) turn(shapes[i].degrees[j], shapes[i].frames[j], shapes[i].still[j]);
      rest();
      window_is_the_pick("a turn on the level opened");
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

static void the_drum_places_each_entry_once_and_settles(void) {
  drum_row rows[DRUM_MOST_ROWS];
  size_t made;
  begin("drum");
  made = drum_rows(1, 0, 0.0f, rows);
  CHECK(made == 1 && rows[0].index == 0 && rows[0].y == 0 && rows[0].tier == DRUM_FRONT, "one entry sits at the front");
  made = drum_rows(3, 0, 0.0f, rows);
  CHECK(made == 3 && rows[2].index == 0, "three entries: the front drawn last");
  CHECK(rows[0].index == 2 && rows[0].y < 0 && rows[1].index == 1 && rows[1].y > 0, "the last above, the next below");
  /* Half a step turned: the selected slat is still the front one, the window nearest it, and the one two back has turned past the drum's edge. */
  made = drum_rows(12, 5, 0.5f, rows);
  CHECK(made == 4, "four slats: %zu", made);
  CHECK(rows[0].index == 4 && rows[0].angle == -54.0f && rows[0].y == -57 && rows[0].tier == DRUM_FAR, "the furthest above first, curving away: %zu %f %d",
        rows[0].index, (double)rows[0].angle, rows[0].y);
  CHECK(rows[1].index == 7 && rows[1].angle == 54.0f && rows[1].y == 57, "then the furthest below");
  CHECK(rows[2].index == 6 && rows[2].angle == 18.0f && rows[2].tier == DRUM_NEAR, "then the next, beside the window");
  CHECK(rows[3].index == 5 && rows[3].angle == -18.0f && rows[3].tier == DRUM_FRONT, "and the selected last, in the window");
  made = drum_rows(12, 5, -0.5f, rows);
  CHECK(made == 4 && rows[3].index == 5 && rows[3].tier == DRUM_FRONT && rows[2].index == 4 && rows[2].tier == DRUM_NEAR,
        "half a step back too");
  end();
}

int main(void) {
  test_program("builder");
  the_drum_places_each_entry_once_and_settles();
  the_fit_trims_a_character_at_a_time_and_never_inside_one();
  the_root_is_the_scenes_verbs_on_a_drum_turned_by_the_crank();
  a_greyed_chip_is_drawn_greyed_and_says_why();
  descending_into_a_verb_and_back();
  a_completed_reading_runs_and_the_reader_is_told();
  a_turn_whose_save_fails_stops_play_and_greys_the_world();
  the_sentence_line_fits_the_screen_and_keeps_its_end();
  everything_for_a_role_that_takes_one_thing_runs_a_turn_each_and_stops_at_a_refusal();
  everything_for_a_set_role_binds_them_all();
  everything_leaves_out_what_is_greyed_and_needs_two_things();
  everything_runs_at_most_what_a_set_role_may_bind();
  after_any_crank_turn_the_window_is_what_a_picks();
  return finish();
}
