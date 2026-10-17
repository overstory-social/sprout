/*
 * The disc of words drawn, the one chooser of the sentence builder, the nickname screen, the shelf
 * and the download screen (the design doc's The chip tree and the crank sentence builder): between a
 * screen's header and its panel, the hub on the left edge with its marker, the dividing rays of the
 * sectors that hold a word, and every word along its ray (disc.h) in the wheel's font, the front one
 * an inverted label and a greyed one dotted. The owner holds the words and the selection and says
 * what each word is; the wheel holds the disc and a label for each word, drawn once while the words
 * stand and turned while its angle stands. The crank turns it and down and up step it, wrapping,
 * with a tick for each step and a clack when it settles.
 */
#ifndef PLAYER_UI_WHEEL_H
#define PLAYER_UI_WHEEL_H

#include <stdbool.h>
#include <stddef.h>

#include "app.h"
#include "disc.h"

/* The wheel's font, packaged into the pdx from Source/fonts/ and held through the pen. */
#define WHEEL_FONT "fonts/Roobert-11-Medium.pft"

/* One word on the wheel, as its owner says it. */
typedef struct wheel_word {
  const char *text;
  bool greyed; /* drawn dotted: it cannot be chosen, and the owner's panel says why */
} wheel_word;

/* The word of entry `index` of the owner's `ctx`. */
typedef wheel_word (*wheel_words)(const void *ctx, size_t index);

/*
 * A word on the disc: drawn flat once while the words stand, and turned to its ray while its angle
 * stands. A long word is cut at the screen's width, as the screen's edge would cut it.
 */
typedef struct wheel_label {
  LCDBitmap *flat;   /* the word black on white, greyed in a checker where it is; NULL until first shown */
  LCDBitmap *turned; /* `flat` turned to `along`, inverted where `front`; NULL while the word is not shown */
  float angle;       /* its sector's angle from the front, as disc_rows gave it */
  float along;       /* the angle its word is turned to: its ray's, bent, at the word's middle */
  bool front;
  bool shown;        /* placed in the frame last drawn */
  int x, y;          /* where `turned` was placed */
} wheel_label;

typedef struct wheel {
  disc disc;
  wheel_label *labels; /* one for each word */
  size_t label_count;
  unsigned long labels_of; /* the owner's mark for the words the labels were drawn for */
} wheel;

/* Holds the wheel's font from the first time a wheel is shown; where it cannot be read, the words are drawn in the body. */
void wheel_hold_font(player_app *app);

/*
 * A frame of the wheel of `count` words for a screen that only chooses: the crank turns it and down
 * and up step `*selected`, wrapping, each step with a tick and the disc coming to rest with a clack.
 * With no words nothing turns and nothing sounds. Whether the selection moved.
 */
bool wheel_steer(player_app *app, wheel *w, size_t count, size_t *selected, const player_input *input);

/*
 * Draws the wheel of `count` words between `top` and `bottom`, `selected` at the front and turned by
 * the crank's place in its step. `words` gives each word from `ctx`; `words_of` marks them, and the
 * labels are drawn afresh when it or the count changes. A word turned out of sight lets go of its
 * turned pixels.
 */
void wheel_draw(player_app *app, wheel *w, size_t count, size_t selected, wheel_words words, const void *ctx,
                unsigned long words_of, int top, int bottom);

/* Lets go of every label; the next draw makes them again. */
void wheel_free(player_app *app, wheel *w);

#endif
