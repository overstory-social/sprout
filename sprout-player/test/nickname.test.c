/*
 * ui/nickname.c: the nickname screen, driven through the app a frame at a time over the chip_tree
 * world, and its filters on their own. The rules: the names offered are the pool's less the
 * world's words and the names of those present, folded; a returning visitor is offered their
 * last name first; the crank and the d-pad move through the names and wrap; A enters the name
 * shown, and the reader names the visitor by it; a name the engine refuses is told in its words,
 * and A goes back to picking; B closes the world and goes back to the shelf.
 */
#include <stdlib.h>

#include "support.h"
#include "ui/app.h"
#include "ui/message.h"
#include "ui/nickname.h"
#include "ui/reader.h"
#include "ui/shelf.h"

#define LINE FAKE_LINE
#define NAME_TOP 100

static player_app *app;

static const char *drawn_at(int y) {
  const fake_run *run = fake_run_at(fake, PLAYER_MARGIN, y);
  return run != NULL ? run->text : "";
}

static player_nickname *picker(void) {
  return app->screen == &player_nickname_screen ? (player_nickname *)app->ctx : NULL;
}

/* The name drawn as offered, "< Name >", or "". */
static const char *offered(void) { return drawn_at(NAME_TOP); }

/* "< name >" for the name the picker has selected. */
static const char *shown(char *out, size_t size) {
  snprintf(out, size, "< %s >", picker() != NULL && picker()->count > 0 ? picker()->names[picker()->selected] : "");
  return out;
}

static const fake_note *last_note(void) { return fake->note_count > 0 ? &fake->notes[fake->note_count - 1] : NULL; }

static bool sounded(SoundWaveform wave, float pitch) {
  const fake_note *note = last_note();
  return note != NULL && note->wave == wave && note->pitch == pitch;
}

/* The app over the chip_tree world, opened from the shelf and run until the nickname screen is up. */
static void to_nickname(const char *scenario, bool fresh) {
  static const char *const shipped[] = {"chip-tree.sproutworld"};
  const char *why = NULL;
  int n;
  if (fresh) {
    begin(scenario);
    app_folder("app");
    ship(shipped, 1);
  }
  app = player_app_new(&fake->api, &why);
  CHECK(app != NULL, "%s", why);
  fake->api.system->setUpdateCallback(player_app_update, app);
  fake_frame(fake, 0, 0);
  fake_frame(fake, kButtonA, 0);
  for (n = 0; n < 10000 && picker() == NULL; n++) fake_frame(fake, 0, 0);
  CHECK(picker() != NULL, "the nickname screen came up");
}

/* The reader's first paragraph, its first line; "" when the reader is not up. */
static const char *first_told(void) {
  const player_reader *reader = app->screen == &player_reader_screen ? (const player_reader *)app->ctx : NULL;
  if (reader == NULL || reader->lines.count == 0) return "";
  return reader->lines.paragraphs[reader->lines.first].bytes;
}

/* Runs frames until the reader is up; whether it came up. */
static bool reader_within(int most) {
  int n;
  for (n = 0; n < most && app->screen != &player_reader_screen; n++) fake_frame(fake, 0, 0);
  return app->screen == &player_reader_screen;
}

/* ---- the filters ---- */

static void the_filters_fold_as_the_host_folds(void) {
  const char *names[] = {"Guard", "Moss", "Hall", "Wren", "Fern"};
  const char *const words[] = {"guard", "HALL", "north", "the"};
  const sprout_str present[] = {{"  WREN ", 7}, {"moss", 4}, {"Fern Gully", 10}};
  const sprout_str returning = {"fern", 4}, gone = {"Alder", 5}, phrase = {"Old Fern", 8};
  size_t count;
  begin("filters");
  count = nickname_without_words(names, 5, words, 4);
  CHECK(count == 3 && strcmp(names[0], "Moss") == 0 && strcmp(names[1], "Wren") == 0 && strcmp(names[2], "Fern") == 0,
        "a name that is a word of the world, in any case, is not offered: %zu", count);
  CHECK(nickname_preferred(names, count, &returning) == 2, "a returning visitor is offered their name first");
  CHECK(nickname_preferred(names, count, &gone) == 0, "a name no longer offered falls back to the first");
  CHECK(nickname_preferred(names, count, &phrase) == 0, "a name of two words is not the one word");
  CHECK(nickname_preferred(names, count, NULL) == 0, "with no visitor remembered, the first");
  count = nickname_without_present(names, count, present, 3);
  CHECK(count == 1 && strcmp(names[0], "Fern") == 0,
        "a name held by someone present, however it was typed, is not offered; two words are not one: %zu", count);
  end();
}

static void every_name_in_the_pool_is_a_plain_word(void) {
  size_t i, j;
  begin("pool");
  for (i = 0; i < NICKNAME_POOL_SIZE; i++) {
    const char *name = nickname_pool[i];
    bool plain = name[0] >= 'A' && name[0] <= 'Z';
    for (j = 1; name[j] != '\0'; j++) plain = plain && name[j] >= 'a' && name[j] <= 'z';
    CHECK(plain && j <= 24, "%s", name);
  }
  end();
}

/* ---- the screen ---- */

static void the_names_offered_are_the_pools_less_the_worlds_words(void) {
  player_session *s;
  player_opening opened;
  static char words[512][64];
  size_t word_count = 0, i, w, offered_count = 0;
  begin("offered");
  s = session_new();
  opened = player_open_whole(s, "chip-tree.sproutworld");
  CHECK(opened.ok && opened.done && opened.word_count > 0, "%s", opened.reason);
  for (i = 0; opened.ok && i < opened.word_count && i < 512; i++) snprintf(words[word_count++], sizeof words[0], "%s", opened.words[i]);
  player_close(s);
  app_folder("app");
  {
    static const char *const shipped[] = {"chip-tree.sproutworld"};
    ship(shipped, 1);
  }
  to_nickname("offered", false);
  CHECK(strcmp(drawn_at(0), "Who are you in Chip Tree?") == 0, "the screen asks who the visitor is: %s", drawn_at(0));
  for (i = 0; picker() != NULL && i < NICKNAME_POOL_SIZE; i++) {
    bool word = false, shown_too = false;
    const char *name = nickname_pool[i];
    for (w = 0; w < word_count; w++) word = word || strcasecmp(words[w], name) == 0;
    for (w = 0; w < picker()->count; w++) shown_too = shown_too || picker()->names[w] == name;
    CHECK(word != shown_too, "%s is %s a word of the world and is %s offered", name, word ? "" : "not", shown_too ? "" : "not");
    offered_count += shown_too;
  }
  CHECK(offered_count > 1 && offered_count == picker()->count, "the names offered: %zu", offered_count);
  player_app_free(app);
  end();
}

static void the_crank_and_the_d_pad_pick_a_name(void) {
  char want[64];
  size_t count;
  to_nickname("pick", true);
  count = picker()->count;
  CHECK(picker()->selected == 0 && strcmp(offered(), shown(want, sizeof want)) == 0, "a new visitor is offered the first name: %s", offered());
  CHECK(HAS(drawn_at(240 - LINE - 2), "A: enter"), "the keys are said: %s", drawn_at(240 - LINE - 2));
  fake->note_count = 0;
  fake_frame(fake, kButtonDown, 0);
  CHECK(picker()->selected == 1 && strcmp(offered(), shown(want, sizeof want)) == 0, "down offers the next: %s", offered());
  CHECK(fake->note_count == 1 && sounded(kWaveformNoise, 3000.0f), "with a tick");
  fake_frame(fake, kButtonUp, 0);
  fake_frame(fake, kButtonUp, 0);
  CHECK(picker()->selected == count - 1 && strcmp(offered(), shown(want, sizeof want)) == 0, "up from the first wraps to the last: %s", offered());
  fake_frame(fake, 0, 10.0f);
  CHECK(picker()->selected == count - 1, "ten degrees is not yet a name");
  fake_frame(fake, 0, 15.0f);
  CHECK(picker()->selected == 0, "twenty-five degrees is a name, and past the last wraps to the first");
  fake_frame(fake, 0, -49.0f);
  CHECK(picker()->selected == count - 2 && strcmp(offered(), shown(want, sizeof want)) == 0,
        "forty-nine back, less the degree carried, is two names: %s", offered());
  fake->docked = 1;
  fake_frame(fake, 0, 96.0f);
  CHECK(picker()->selected == count - 2, "a docked crank moves nothing");
  fake->docked = 0;
  player_app_free(app);
  end();
}

static void a_name_entered_is_who_the_visitor_is_and_is_offered_first_next_time(void) {
  char name[64], said[160];
  to_nickname("admitted", true);
  fake_frame(fake, kButtonDown, 0);
  fake_frame(fake, kButtonDown, 0);
  snprintf(name, sizeof name, "%s", picker()->names[picker()->selected]);
  fake->note_count = 0;
  fake_frame(fake, kButtonA, 0);
  CHECK(fake->note_count == 1 && sounded(kWaveformTriangle, 660.0f), "the name entered sounds the pick");
  CHECK(reader_within(10000), "the reader came up");
  snprintf(said, sizeof said, "- You are in Chip Tree as %s.", name);
  CHECK(strcmp(first_told(), said) == 0, "the reader names the visitor: %s", first_told());
  player_app_free(app);

  /* The save remembers the visitor, and the next visit offers their name first. */
  to_nickname("admitted", false);
  CHECK(picker() != NULL && strcmp(picker()->names[picker()->selected], name) == 0 && HAS(offered(), name),
        "the returning visitor is offered %s first: %s", name, offered());
  player_app_free(app);
  end();
}

static void a_name_the_engine_refuses_is_told_in_its_words(void) {
  char name[64], said[160];
  to_nickname("refused", true);
  /* No pool name is a reserved word; one stands in for a name the engine turns down. */
  picker()->names[picker()->selected] = "World";
  fake->note_count = 0;
  fake_frame(fake, kButtonA, 0);
  CHECK(picker() != NULL, "a refused name stays on the nickname screen");
  CHECK(fake->note_count == 1 && sounded(kWaveformSawtooth, 110.0f), "the refusal sounds");
  CHECK(HAS(drawn_at(MESSAGE_TOP), "world"), "the engine's words name the word refused: %s", drawn_at(MESSAGE_TOP));
  CHECK(strcmp(drawn_at(240 - LINE - 2), "A to go on") == 0, "and say how to go on: %s", drawn_at(240 - LINE - 2));
  CHECK(strcmp(offered(), "") == 0 || !HAS(offered(), "<"), "the picker is not drawn under the words");
  fake_frame(fake, kButtonDown, 0);
  CHECK(HAS(drawn_at(MESSAGE_TOP), "world"), "the words stay until A or B");
  fake_frame(fake, kButtonA, 0);
  CHECK(strcmp(drawn_at(0), "Who are you in Chip Tree?") == 0 && HAS(offered(), "World"), "A goes back to picking: %s", offered());
  fake_frame(fake, kButtonDown, 0);
  snprintf(name, sizeof name, "%s", picker()->names[picker()->selected]);
  fake_frame(fake, kButtonA, 0);
  CHECK(reader_within(10000), "another name is admitted");
  snprintf(said, sizeof said, "- You are in Chip Tree as %s.", name);
  CHECK(strcmp(first_told(), said) == 0, "the reader names the visitor: %s", first_told());
  player_app_free(app);
  end();
}

static void with_no_name_free_a_enters_nothing_and_says_so(void) {
  to_nickname("none free", true);
  picker()->count = 0;
  fake_frame(fake, kButtonDown, 0);
  CHECK(strcmp(offered(), "No name is free.") == 0, "the screen says no name is free: %s", offered());
  fake_frame(fake, kButtonA, 0);
  CHECK(app->screen == &player_message_screen && HAS(drawn_at(MESSAGE_TOP), "Every name this world allows is taken."),
        "A says why on the message screen: %s", drawn_at(MESSAGE_TOP));
  fake_frame(fake, kButtonA, 0);
  CHECK(app->screen == &player_shelf_screen, "which goes back to the shelf");
  player_app_free(app);
  end();
}

static void b_goes_back_to_the_shelf_and_closes_the_world(void) {
  const char *words = NULL;
  to_nickname("back", true);
  fake->note_count = 0;
  fake_frame(fake, kButtonB, 0);
  CHECK(app->screen == &player_shelf_screen && strcmp(drawn_at(0), "Shelf") == 0, "B goes back to the shelf: %s", drawn_at(0));
  CHECK(fake->note_count == 1 && sounded(kWaveformTriangle, 392.0f), "with the step back's cue");
  CHECK(player_view(app->session, &words) == NULL, "the world is closed");
  fake_frame(fake, kButtonA, 0);
  {
    int n;
    for (n = 0; n < 10000 && picker() == NULL; n++) fake_frame(fake, 0, 0);
  }
  CHECK(picker() != NULL, "and A opens it again");
  player_app_free(app);
  end();
}

int main(void) {
  test_program("nickname");
  the_filters_fold_as_the_host_folds();
  every_name_in_the_pool_is_a_plain_word();
  the_names_offered_are_the_pools_less_the_worlds_words();
  the_crank_and_the_d_pad_pick_a_name();
  a_name_entered_is_who_the_visitor_is_and_is_offered_first_next_time();
  a_name_the_engine_refuses_is_told_in_its_words();
  with_no_name_free_a_enters_nothing_and_says_so();
  b_goes_back_to_the_shelf_and_closes_the_world();
  return finish();
}
