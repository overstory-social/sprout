/*
 * The sentence builder screen (the design doc's The chip tree and the crank sentence builder): the
 * sentence so far at the top, the disc of choices in the middle (wheel.h) with the selected one
 * level at its front as an inverted label, and the selected choice's refusal or the keys at the
 * bottom. The crank turns the disc and up and down step it; A picks, and on the whole sentence
 * runs it; B steps back, and at the verbs closes the builder. A run sentence is told in the reader,
 * led by the sentence as typed, and the pictures its turn asked for are shown (pictures.h) once the
 * builder has closed; one with `everything` for a role that takes one thing is a turn for each
 * thing, each told as its own sentence, until one ends the line. Its cues sound through
 * `player_cue`.
 *
 * The reader lends itself to the builder while it is up (reader.h); the builder hands it back when
 * it closes, or frees it if the app ends first. The sentence so far, in the frame font, fits the
 * screen whatever its length: trimmed from the left so the end, the part being built, is always in
 * view.
 */
#ifndef PLAYER_UI_BUILDER_H
#define PLAYER_UI_BUILDER_H

#include <stdbool.h>

#include "app.h"
#include "gallery.h"
#include "reader.h"
#include "sentence.h"
#include "wheel.h"
#include "wrap.h"

/* What leads a sentence trimmed from the left. */
#define BUILDER_TRIMMED "..."
#define BUILDER_KEYS "A picks   B steps back   the crank turns the wheel"

typedef struct player_builder {
  player_reader *reader; /* lent while the builder is up */
  sentence sentence;
  wheel wheel; /* the level's entries, marked by the sentence's `made` */
  wrapped message; /* words shown over the disc until A or B; no bytes when there are none */
  bool closing;    /* the builder closes once the words are read */
  bool asked;      /* the verb at the front has been asked after since the open: the first update does it, after the first draw */
  gallery pictures; /* what the sentence run asked to show, shown once the builder closes */
  char line[512];  /* the sentence so far as it fits the screen */
} player_builder;

extern const player_screen player_builder_screen;

/*
 * Opens the builder over the visitor's view, the one the session keeps where it stands (a poll only
 * where none does), the reader lent to it, and shows it, the disc drawn before any verb's readings are
 * asked for. Where nothing can be built (the view cannot be had, its poll ran out, nothing can be done)
 * the reader is told why and stays; false then.
 */
bool player_builder_open(player_app *app, player_reader *reader);

/*
 * `text` as it fits `room` pixels in `font`: as it is, or else trimmed from the left and led by
 * BUILDER_TRIMMED into `out`. The text to draw.
 */
const char *player_builder_fit(PlaydateAPI *pd, LCDFont *font, const char *text, int room, char *out, size_t size);

#endif
