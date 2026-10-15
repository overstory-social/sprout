/*
 * The sentence builder screen (the design doc's The chip tree and the crank sentence builder): the
 * sentence so far at the top, the disc of choices in the middle (disc.h) with the selected one
 * level at its front as an inverted label, and the selected choice's refusal or the keys at the
 * bottom. The crank turns the disc and up and down step it; A picks, and on the whole sentence
 * runs it; B steps back, and at the verbs closes the builder. A run sentence is told in the reader, led by the sentence as typed,
 * and the pictures its turn asked for are shown (pictures.h) once the builder has closed; one with
 * `everything` for a role that takes one thing is a turn for each thing, each told as its own
 * sentence, until one ends the line. Its cues sound through `player_cue`.
 *
 * The reader lends itself to the builder while it is up (reader.h); the builder hands it back when
 * it closes, or frees it if the app ends first. The sentence so far fits the screen whatever its
 * length: in the system font, then the small font, then trimmed from the left so the end, the
 * part being built, is always in view.
 */
#ifndef PLAYER_UI_BUILDER_H
#define PLAYER_UI_BUILDER_H

#include <stdbool.h>

#include "app.h"
#include "disc.h"
#include "gallery.h"
#include "reader.h"
#include "sentence.h"
#include "wrap.h"

/* The builder's fonts, packaged into the pdx from Source/fonts/: the disc's words, and the sentence line where it is long. */
#define BUILDER_BIG_FONT "fonts/Asheville-Sans-24-Light.pft"
#define BUILDER_SMALL_FONT "fonts/Roobert-10-Bold.pft"
/* What leads a sentence trimmed from the left. */
#define BUILDER_TRIMMED "..."
#define BUILDER_KEYS "A picks   B steps back   the crank turns the wheel"

/*
 * A word on the disc: drawn flat once while its level's entries stand, and turned to its ray while
 * its angle stands. A long word is cut at the screen's width, as the screen's edge would cut it.
 */
typedef struct builder_label {
  LCDBitmap *flat;   /* the word black on white, greyed in a checker where it is; NULL until first shown */
  LCDBitmap *turned; /* `flat` turned to `along`, inverted where `front`; NULL while the word is not shown */
  float angle;       /* its sector's angle from the front, as disc_rows gave it */
  float along;       /* the angle its word is turned to: its ray's, bent, at the word's middle */
  bool front;
  bool shown;        /* placed in the frame last drawn */
  int x, y;          /* where `turned` was placed */
} builder_label;

typedef struct player_builder {
  player_reader *reader; /* lent while the builder is up */
  sentence sentence;
  disc disc;
  builder_label *labels; /* one for each entry of the sentence's level */
  size_t label_count;
  unsigned long labels_of; /* the sentence's `made` the labels were drawn for */
  wrapped message; /* words shown over the disc until A or B; no bytes when there are none */
  bool closing;    /* the builder closes once the words are read */
  gallery pictures; /* what the sentence run asked to show, shown once the builder closes */
  char line[512];  /* the sentence so far as it fits the screen */
} player_builder;

extern const player_screen player_builder_screen;

/*
 * Opens the builder over the visitor's view, the reader lent to it, and shows it. Where nothing can be
 * built (the view cannot be had, its poll ran out, nothing can be done) the reader is told why and
 * stays; false then.
 */
bool player_builder_open(player_app *app, player_reader *reader);

/*
 * `text` as it fits `room` pixels: in the first of `fonts` it fits, or else in the last, trimmed from
 * the left and led by BUILDER_TRIMMED into `out`. The text to draw; `*font` its font.
 */
const char *player_builder_fit(PlaydateAPI *pd, LCDFont *const *fonts, size_t font_count, const char *text, int room,
                               char *out, size_t size, LCDFont **font);

#endif
