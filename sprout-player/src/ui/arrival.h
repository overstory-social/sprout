/*
 * The screen that opens a world from the shelf and brings the visitor into it: the cartridge
 * read a step a frame behind a loading line (the design doc's Opening a world), so a big world
 * never holds up a frame; the save loaded; and the nickname screen (nickname.h) shown, offering
 * the names the world's words and the others present leave free. Once the visitor is admitted,
 * the reader is shown with the arrival told and the status from the view, behind the pictures the
 * arrival and the place asked for (pictures.h). What stops it is told on the message screen,
 * which goes back to the shelf, and the world closed. A world refused at its open or a step is
 * refused on the shelf from then on; one whose save could not be written is greyed there until it can be.
 */
#ifndef PLAYER_UI_ARRIVAL_H
#define PLAYER_UI_ARRIVAL_H

#include <stdbool.h>
#include <stddef.h>

#include "app.h"
#include "shelf.h"

typedef struct player_arrival {
  char path[PLAYER_PATH_BYTES]; /* the cartridge */
  char title[128];
  bool started;
  size_t read, counted; /* how far the cartridge has been read */
} player_arrival;

extern const player_screen player_arrival_screen;

/* An arrival at the world at `path`, titled `title` until its header names it; NULL when there is no memory for it. */
player_arrival *player_arrival_new(player_app *app, const char *path, const char *title);

/*
 * The visitor was admitted as `nickname` into the world titled `title`, and the admission told
 * `lines`: the reader is shown with the arrival and `notice` (NULL or what the save had to say)
 * told, behind its pictures. False, with nothing shown, when there is no memory for it.
 */
bool player_arrival_tell(player_app *app, const char *title, const char *nickname, const char *notice,
                         const told_list *lines);

#endif
