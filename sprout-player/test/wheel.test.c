/*
 * ui/wheel.c: the disc of words drawn and steered, over an app on the fake PlaydateAPI with words of
 * the test's own. The rules: the crank steps the selection as it passes halfway to the next word and
 * down and up step it, wrapping either way, each step with a tick, and the disc coming to rest
 * clacks once; with no words nothing moves or sounds; the front is the selected word, the one label drawn
 * inverted, its neighbours a sector either side; a greyed word is drawn dotted; a long word is cut at
 * the screen's edge and every word is clipped to the band it is drawn in; the labels are drawn again
 * only when the owner's mark or the count changes, and freeing the wheel lets every one go.
 */
#include "support.h"
#include "ui/app.h"
#include "ui/wheel.h"
#include "wheel_support.h"

#define TOP 30
#define BOTTOM 180

static player_app *app;

static const char *const WORDS[] = {"Alder", "Birch", "Clover", "Dapple", "Ember"};
#define WORD_COUNT 5

/* The test's words; the third greyed where `greyed` says, and the fourth `long_word` where it is not NULL. */
static bool greyed;
static const char *long_word;

static wheel_word word_of(const void *ctx, size_t index) {
  wheel_word word;
  (void)ctx;
  word.text = index == 3 && long_word != NULL ? long_word : WORDS[index];
  word.greyed = greyed && index == 2;
  return word;
}

static const fake_note *last_note(void) { return fake->note_count > 0 ? &fake->notes[fake->note_count - 1] : NULL; }

static bool sounded(SoundWaveform wave, float pitch) {
  const fake_note *note = last_note();
  return note != NULL && note->wave == wave && note->pitch == pitch;
}

static void start(const char *scenario) {
  const char *why = NULL;
  begin(scenario);
  app_folder("app");
  app = player_app_new(&fake->api, &why);
  CHECK(app != NULL, "%s", why);
  wheel_hold_font(app);
  greyed = false;
  long_word = NULL;
}

static void stop(void) {
  player_app_free(app);
  app = NULL;
  end();
}

/* A frame of input to the wheel `w` of `count` words. */
static bool steer(wheel *w, size_t count, size_t *selected, PDButtons pushed, float crank) {
  player_input input;
  memset(&input, 0, sizeof input);
  input.pushed = pushed;
  input.crank = crank;
  return wheel_steer(app, w, count, selected, &input);
}

/* Draws `w` afresh into a cleared frame. */
static void draw(wheel *w, size_t selected, unsigned long mark) {
  app->pd->graphics->clear(kColorWhite);
  wheel_draw(app, w, WORD_COUNT, selected, word_of, NULL, mark, TOP, BOTTOM);
}

static void the_crank_and_the_d_pad_step_it_round_with_a_tick_and_it_settles_with_a_clack(void) {
  wheel w;
  size_t selected = 0;
  int n;
  start("steer");
  memset(&w, 0, sizeof w);
  fake->note_count = 0;
  CHECK(steer(&w, WORD_COUNT, &selected, kButtonDown, 0) && selected == 1, "down steps on");
  CHECK(fake->note_count == 1 && sounded(kWaveformNoise, 3000.0f), "with a tick");
  CHECK(steer(&w, WORD_COUNT, &selected, kButtonUp, 0) && steer(&w, WORD_COUNT, &selected, kButtonUp, 0) && selected == WORD_COUNT - 1,
        "up steps back, past the first to the last");
  CHECK(!steer(&w, WORD_COUNT, &selected, 0, 11.0f) && selected == WORD_COUNT - 1, "eleven degrees is short of halfway");
  fake->note_count = 0;
  CHECK(steer(&w, WORD_COUNT, &selected, 0, 2.0f) && selected == 0, "thirteen is past it: a step, past the last to the first");
  CHECK(fake->note_count == 1 && sounded(kWaveformNoise, 3000.0f), "with a tick");
  CHECK(steer(&w, WORD_COUNT, &selected, 0, -48.0f) && selected == WORD_COUNT - 2, "forty-eight back is two steps");
  fake->note_count = 0;
  for (n = 0; n < DISC_REST_FRAMES + 30; n++) steer(&w, WORD_COUNT, &selected, 0, 0);
  CHECK(fake->note_count == 1 && sounded(kWaveformSquare, 160.0f), "resting, it settles with one clack: %d notes", fake->note_count);
  CHECK(disc_at_rest(&w.disc) && disc_fraction(&w.disc) == 0.0f && selected == WORD_COUNT - 2, "on the word stepped to");
  selected = 0;
  fake->note_count = 0;
  CHECK(!steer(&w, 0, &selected, kButtonDown, 30.0f) && selected == 0 && fake->note_count == 0, "with no words nothing moves or sounds");
  stop();
}

static void the_front_is_the_selected_word_and_its_neighbours_lie_either_side(void) {
  wheel w;
  int n, front;
  start("drawn");
  memset(&w, 0, sizeof w);
  draw(&w, 1, 0);
  front = wheel_front_placed();
  CHECK(strcmp(wheel_front(&w), "Birch") == 0, "the selected word is the front: %s", wheel_front(&w));
  CHECK(fake->placed_count == WORD_COUNT, "every word of five is placed once: %d", fake->placed_count);
  for (n = 0; n < fake->placed_count; n++) {
    const wheel_label *label = wheel_placed(&w, n);
    size_t index;
    long k;
    CHECK(label != NULL && wheel_label_run(label) != NULL && wheel_label_run(label)->font == FAKE_FONT_SANS, "placement %d is a word in the wheel's font", n);
    if (label == NULL) continue;
    index = (size_t)(label - w.labels);
    k = label->angle > 0 ? (long)(label->angle / DISC_SECTOR_DEGREES + 0.5f) : -(long)(-label->angle / DISC_SECTOR_DEGREES + 0.5f);
    CHECK(index == (size_t)((WORD_COUNT + 1 + k) % WORD_COUNT), "%s sits %ld sectors round", wheel_label_text(label), k);
    CHECK(strcmp(wheel_label_text(label), WORDS[index]) == 0, "its own word: %s", wheel_label_text(label));
    CHECK((k == 0) == (n == front), "only the front is inverted");
  }
  CHECK(fake->ellipses == 1, "the hub");
  /* Turned a quarter step on, every word is drawn turned up by the detent of it. */
  disc_crank(&w.disc, 6.0f);
  draw(&w, 1, 0);
  n = wheel_placed_entry(&w, 1);
  CHECK(n >= 0 && wheel_placed(&w, n)->angle == -disc_detent(0.25f) * DISC_SECTOR_DEGREES, "the front turned up by the detent: %f",
        n >= 0 ? (double)wheel_placed(&w, n)->angle : 0.0);
  wheel_free(app, &w);
  CHECK(fake->made_live == 0 && w.labels == NULL, "freed, the wheel holds no label: %d", fake->made_live);
  stop();
}

static void a_greyed_word_is_dotted_and_a_long_one_cut_at_the_edge(void) {
  static char long_text[200];
  wheel w;
  int n, i;
  start("greyed");
  memset(&w, 0, sizeof w);
  memset(long_text, 'w', sizeof long_text - 1);
  long_text[sizeof long_text - 1] = '\0';
  greyed = true;
  long_word = long_text;
  draw(&w, 2, 0);
  n = wheel_front_placed();
  CHECK(n >= 0 && wheel_label_greyed(wheel_placed(&w, n)), "the greyed word at the front is dotted");
  n = wheel_placed_entry(&w, 1);
  CHECK(n >= 0 && !wheel_label_greyed(wheel_placed(&w, n)), "a word that is not greyed is solid");
  n = wheel_placed_entry(&w, 3);
  CHECK(n >= 0 && fake->made[fake_made_index(fake, wheel_placed(&w, n)->flat)].width == PLAYER_SCREEN_WIDTH,
        "the long word is drawn into a label as wide as the screen");
  for (i = 0; i < fake->placed_count; i++)
    CHECK(fake->placed[i].clipped && fake->placed[i].clip_y == TOP && fake->placed[i].clip_height == BOTTOM - TOP,
          "every word is clipped to the wheel's band");
  wheel_free(app, &w);
  stop();
}

static void the_labels_are_drawn_again_only_when_the_words_change(void) {
  wheel w;
  int made;
  start("marks");
  memset(&w, 0, sizeof w);
  draw(&w, 0, 7);
  made = fake->made_total;
  draw(&w, 0, 7);
  CHECK(fake->made_total == made, "the same words, nothing drawn again: %d made", fake->made_total - made);
  greyed = true;
  draw(&w, 0, 8);
  CHECK(fake->made_total > made && wheel_label_greyed(wheel_placed(&w, wheel_placed_entry(&w, 2))),
        "a new mark draws them again, as they now are");
  CHECK(fake->made_live <= 2 * WORD_COUNT, "and lets the old ones go: %d held", fake->made_live);
  wheel_free(app, &w);
  CHECK(fake->made_live == 0, "freed, none held: %d", fake->made_live);
  stop();
}

int main(void) {
  test_program("wheel");
  the_crank_and_the_d_pad_step_it_round_with_a_tick_and_it_settles_with_a_clack();
  the_front_is_the_selected_word_and_its_neighbours_lie_either_side();
  a_greyed_word_is_dotted_and_a_long_one_cut_at_the_edge();
  the_labels_are_drawn_again_only_when_the_words_change();
  return finish();
}
