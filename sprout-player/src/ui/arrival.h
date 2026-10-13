/*
 * The screen that opens a world and brings the visitor into it: the cartridge read a step a
 * frame behind a loading line, so a big world never holds up a frame; the save loaded; the
 * visitor admitted; and the reader shown with the arrival told and the status from the view,
 * behind the pictures the arrival and the place asked for (pictures.h).
 * What stops it is shown here in words. Until the shelf (#632) and the nickname screen (#633)
 * exist, the app opens the first shipped world, the first cartridge in `worlds/` by name, and
 * admits the visitor its save remembers or else the fixed nickname PLAYER_FIXED_NICKNAME.
 */
#ifndef PLAYER_UI_ARRIVAL_H
#define PLAYER_UI_ARRIVAL_H

#include <stdbool.h>
#include <stddef.h>

#include "app.h"
#include "wrap.h"

#define PLAYER_FIXED_NICKNAME "Wren"
#define PLAYER_WORLDS_FOLDER "worlds"
#define PLAYER_PATH_BYTES 256

typedef struct player_arrival {
  char path[PLAYER_PATH_BYTES]; /* the cartridge, or "" where none was found */
  char title[128];
  bool started;
  size_t read, counted; /* how far the cartridge has been read */
  wrapped words;        /* what stopped it, wrapped to the screen; NULL bytes while it goes on */
  bool words_held;      /* the words' block is the allocator's, to be freed */
} player_arrival;

extern const player_screen player_arrival_screen;

/* An arrival at the first shipped world; NULL when there is no memory for it. */
player_arrival *player_arrival_new(player_app *app);

/* The path of the first cartridge in `folder` by name, into `path`; false when there is none. */
bool player_first_world(PlaydateAPI *pd, const char *folder, char *path, size_t size);

/* A world's name as words, as the shelf titles it: `printers_shop` is `Printers Shop`. */
void player_world_title(const char *name, char *title, size_t size);

#endif
