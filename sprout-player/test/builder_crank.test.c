/*
 * The sentence builder's disc under the crank (ui/builder.c, ui/disc.c), driven through the fake
 * PlaydateAPI in the chip_tree world's hall. The rule: however the crank turned, and whether the disc
 * has come to rest, the word at the front is the one the panel speaks of and A picks.
 */
#include "builder_support.h"

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

int main(void) {
  test_program("builder_crank");
  after_any_crank_turn_the_front_is_what_a_picks();
  return finish();
}
