/*
 * The pictures screen: what a turn's effects asked for (and, on
 * arrival, the place's own) shown one at a time on the whole screen (gallery.h), each scaled to
 * fit above a caption line that also says `2 of 3  crank: next   A: close`. The crank, or the
 * d-pad, steps between them slat by slat, each step ticking and each landing clacking; A or B
 * closes them and the reader takes over. The reader is lent to the screen while it is up.
 *
 * Only what is on screen is held: a picture is built from the world's cartridge when it is first
 * drawn and freed once another has landed in its place or the screen closes, so pictures never
 * count against the world's memory (the design doc's Images).
 */
#ifndef PLAYER_UI_PICTURES_H
#define PLAYER_UI_PICTURES_H

#include <stdbool.h>

#include "app.h"
#include "gallery.h"
#include "reader.h"

#define PICTURES_UNREADABLE "This picture cannot be read."
#define PICTURES_CLOSE "A: close"
#define PICTURES_STEP "  crank: next   A: close"

/* A picture loaded for the screen: its index in the gallery, and the bitmap or NULL where it could not be read. */
typedef struct pictures_slot {
  long index; /* -1 for an empty slot */
  LCDBitmap *bitmap;
} pictures_slot;

typedef struct player_pictures {
  player_reader *reader; /* lent */
  gallery gallery;
  pictures_slot slots[2]; /* the picture on screen and the one leaving */
} player_pictures;

extern const player_screen player_pictures_screen;

/*
 * Shows the pictures `g` holds over the reader, taking them (`g` is left empty), or the reader
 * itself where there are none. Where there is no memory for the screen the reader is shown and
 * told so.
 */
void player_pictures_show(player_app *app, player_reader *reader, gallery *g);

#endif
