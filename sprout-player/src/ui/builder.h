/*
 * The sentence builder screen, the Lua app's (Source/main.lua's sentence mode over sentence.lua and
 * wheel.lua): the sentence so far at the top, the drum of choices in the middle with the selected
 * one in its window, and the selected choice's refusal or the keys at the bottom. The crank turns
 * the drum and up and down step it; A picks, and on the whole sentence runs it; B steps back, and at
 * the verbs closes the builder. A run sentence is told in the reader, led by the sentence as typed.
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
#include "drum.h"
#include "reader.h"
#include "sentence.h"
#include "wrap.h"

/* The drum's fonts, packaged into the pdx from Source/fonts/. */
#define BUILDER_BIG_FONT "fonts/Asheville-Sans-24-Light.pft"
#define BUILDER_SMALL_FONT "fonts/Roobert-10-Bold.pft"
/* Half the height of the window at the drum's front. */
#define BUILDER_WINDOW 18
/* What leads a sentence trimmed from the left. */
#define BUILDER_TRIMMED "..."
#define BUILDER_KEYS "A picks   B steps back   the crank turns the wheel"

typedef struct player_builder {
  player_reader *reader; /* lent while the builder is up */
  sentence sentence;
  drum drum;
  wrapped message; /* words shown over the drum until A or B; no bytes when there are none */
  bool closing;    /* the builder closes once the words are read */
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
