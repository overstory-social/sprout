/*
 * The sentence's disc of words: a hub on the screen's left edge and every entry a sector fanning to
 * the right, its word along its ray. The selected sector lies level, at the front; the others tilt
 * away above and below it and run off the screen's edges. The disc is virtual: more words than a
 * circle would hold are a longer wheel that wraps, since only a part of it is ever shown. The crank
 * turns it, and once the crank rests it settles on the nearest sector. The sentence (sentence.h)
 * holds the entries and the selection; this is where each sits this frame, when the disc comes to
 * rest, and how a word's pixels are turned to lie along its ray. Nothing here draws: the firmware's
 * own rotation is not used (it corrupts the player's memory on the device), so a label is turned here,
 * a pixel at a time.
 */
#ifndef PLAYER_UI_DISC_H
#define PLAYER_UI_DISC_H

#include <stdbool.h>
#include <stddef.h>
#include <stdint.h>

#include "sentence.h"

/* Degrees of disc between neighbouring sectors. */
#define DISC_SECTOR_DEGREES 24.0f
/* The hub's centre, in pixels from the screen's left edge (negative: off it), and its radius. */
#define DISC_HUB_X -14
#define DISC_HUB_RADIUS 48
/* How far along its ray a word starts. */
#define DISC_WORD_AT 60
/* How far a sector's dividing line reaches. */
#define DISC_REACH 480
/* How much a ray bends outward toward the rim: its angle at the rim is this much more, as a share, than at the hub. */
#define DISC_BEND 0.45f
/* The segments a bent ray is drawn in. */
#define DISC_RAY_SEGMENTS 8
/* Sectors shown each side of the front, where there are words enough. */
#define DISC_SIDE 3
#define DISC_MOST_ROWS (2 * DISC_SIDE + 1)
/* Frames the crank rests before the disc settles on the nearest sector. */
#define DISC_REST_FRAMES 6
/* The share of the way to the sector the disc moves each settling frame. */
#define DISC_SETTLE 0.45f

typedef struct disc_row {
  size_t index; /* the entry */
  float angle;  /* from the front, in degrees; below is positive */
  bool front;   /* the selected one */
} disc_row;

typedef struct disc {
  int still;   /* frames the crank has rested */
  bool turned; /* the crank has moved since the disc last came to rest */
} disc;

/* A rectangle of pixels: its top left, from a point the caller names, and its size. */
typedef struct disc_box {
  int x, y, width, height;
} disc_box;

/*
 * A frame of the disc, the sentence already turned by the crank and `turned` whether the crank moved
 * this frame. True the frame the disc comes to rest on a sector after the crank moved, wherever the
 * crank stopped, so the entry it rests on is always asked after.
 */
bool disc_update(disc *d, sentence *s, bool turned);

/*
 * Where each of `count` entries sits this frame, `selected` at the front and the disc `fraction` of
 * a sector past it toward the next, within half a sector. A sector turned past a quarter turn is left
 * out and each entry appears once, where it is nearest the front; the front one comes first.
 */
size_t disc_rows(size_t count, size_t selected, float fraction, disc_row rows[DISC_MOST_ROWS]);

/* The pixel `radius` along the ray at `angle` from the hub's centre, relative to it. */
void disc_point(float angle, float radius, int *x, int *y);

/* The angle a ray leaving the hub at `angle` has at `radius`, bent outward by DISC_BEND. */
float disc_bent(float angle, float radius);

/*
 * The box a `width` by `height` label covers once turned `angle` degrees (below is positive) about
 * the middle of its left edge, from that point.
 */
disc_box disc_turned_box(int width, int height, float angle);

/*
 * Turns a label's pixels `angle` degrees about the middle of its left edge into `box`, which
 * disc_turned_box gave, by nearest neighbour. `flat` is `width` by `height`, `rowbytes` a row; the
 * turned pixels go to `data` and `mask`, `box_rowbytes` a row. Bits are as the device's bitmaps
 * hold them: a set data bit white, a set mask bit drawn. The label's black pixels are drawn black
 * and the rest left clear; `inverted`, its whole rectangle is drawn black and its black pixels
 * white. Without a mask what would be clear is white.
 */
void disc_turn(const uint8_t *flat, int width, int height, int rowbytes, float angle, bool inverted, disc_box box,
               uint8_t *data, uint8_t *mask, int box_rowbytes);

#endif
