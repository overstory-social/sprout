/*
 * The sentence's disc of words: a hub on the screen's left edge and every entry a sector fanning to
 * the right, its word along its radius. The selected sector lies level, at the front; the others
 * tilt away above and below it and run off the screen's edges. The disc is virtual: more words than
 * a circle would hold are a longer wheel that wraps, since only a part of it is ever shown. The
 * sentence (sentence.h) holds the entries and the selection; this is only where each sits this
 * frame. Nothing here draws.
 */
#ifndef PLAYER_UI_DISC_H
#define PLAYER_UI_DISC_H

#include <stddef.h>

/* Degrees of disc between neighbouring sectors. */
#define DISC_SECTOR_DEGREES 24.0f
/* The hub's centre, in pixels from the screen's left edge (negative: off it), and its radius. */
#define DISC_HUB_X -14
#define DISC_HUB_RADIUS 48
/* How far along its radius a word starts. */
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

typedef struct disc_row {
  size_t index; /* the entry */
  float angle;  /* from the front, in degrees; below is positive */
  int front;    /* the selected one */
} disc_row;

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

#endif
