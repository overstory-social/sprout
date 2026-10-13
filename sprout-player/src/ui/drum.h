/*
 * The sentence's drum seen from the side, as Source/wheel.lua lays it out: the selected word sits
 * in a window at the drum's front, the next words curve away above and below it, the drum turns
 * with the crank, and once the crank rests it settles on the nearest slat. The sentence (sentence.h)
 * holds what the drum offers and which word is selected; this is only where each word sits this
 * frame and when the drum comes to rest. Nothing here draws.
 */
#ifndef PLAYER_UI_DRUM_H
#define PLAYER_UI_DRUM_H

#include <stdbool.h>
#include <stddef.h>

#include "sentence.h"

/* Degrees of drum between neighbouring slats. */
#define DRUM_SLAT_DEGREES 36.0f
/* The drum's radius in pixels: how far from the centre line a slat a step from the front sits. */
#define DRUM_RADIUS 70
/* Slats shown each side of the front, where there are words enough. */
#define DRUM_SIDE 2
#define DRUM_MOST_ROWS (2 * DRUM_SIDE + 1)
/* Frames the crank rests before the drum settles on the nearest slat. */
#define DRUM_REST_FRAMES 6
/* The share of the way to the slat the drum moves each settling frame. */
#define DRUM_SETTLE 0.45f

/* The tier a slat is drawn at: the word in the window, the ones beside it, the ones curving away. */
typedef enum drum_tier { DRUM_FRONT, DRUM_NEAR, DRUM_FAR } drum_tier;

typedef struct drum_row {
  size_t index; /* the entry */
  float angle;  /* from the front, in degrees */
  int y;        /* from the centre line, in pixels; below is positive */
  drum_tier tier;
} drum_row;

typedef struct drum {
  int still;   /* frames the crank has rested */
  bool turned; /* the crank has moved since the drum last came to rest */
} drum;

/*
 * A frame of the drum, the sentence already turned by the crank and `turned` whether the crank moved
 * this frame. True the frame the drum comes to rest on a slat after the crank moved, wherever the
 * crank stopped, so the entry it rests on is always asked after.
 */
bool drum_update(drum *d, sentence *s, bool turned);

/*
 * Where each of `count` entries sits this frame, `selected` in the window and the drum `fraction` of a
 * slat past it toward the next, within half a slat. The selected entry is the front one wherever the
 * drum is turned, since it is the one the window is nearest. A slat turned past the drum's edge is left
 * out and each entry appears once. Rows come far to near, the one above first of two as far, so the
 * front one is drawn last.
 */
size_t drum_rows(size_t count, size_t selected, float fraction, drum_row rows[DRUM_MOST_ROWS]);

#endif
