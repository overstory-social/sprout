/*
 * The shelf: the cartridges the player can open, as Source/shelf.lua lists them (the design
 * doc's The shelf). It lists the `.sproutworld` files at the root of the app and its Data folder
 * and in each one's `worlds/` folder, and asks the session whether each can be shelved; one it
 * refuses is listed with the engine's reason and cannot be opened. A cartridge is inspected once
 * for as long as the app runs, and a world refused at its open keeps that reason on the shelf
 * afterwards. The last row, "more worlds...", is the download screen's, which comes with #635.
 *
 * The shelf outlives its screen: the app holds it, and leaving the screen keeps it.
 */
#ifndef PLAYER_UI_SHELF_H
#define PLAYER_UI_SHELF_H

#include <stdbool.h>
#include <stddef.h>

#include "app.h"
#include "wrap.h"

#define PLAYER_PATH_BYTES 256
#define PLAYER_REASON_BYTES 512

/* Degrees of crank for a row moved. */
#define SHELF_DEGREES_PER_ROW 24.0f

typedef struct shelf_entry {
  char path[PLAYER_PATH_BYTES];
  char title[128];
  bool ok;      /* it can be opened */
  bool blocked; /* greyed because its save could not be written; opening it tries the save again */
  char reason[PLAYER_REASON_BYTES]; /* why it cannot be opened, when it cannot */
} shelf_entry;

struct player_shelf {
  shelf_entry *entries; /* in path order */
  size_t count;
  size_t selected; /* an entry, or `count` for "more worlds..." */
  float crank;     /* degrees turned toward the next row, not yet a row */
  bool listed;     /* the entries have been listed: the first frame lists them, and each return to the shelf */
  wrapped panel;   /* the words under the rows, for `panel_for` */
  size_t panel_for;
};

/* An empty shelf, listed in its first frame; NULL when there is no memory for it. */
player_shelf *player_shelf_new(player_app *app);
void player_shelf_free(player_app *app, player_shelf *shelf);

/* Moves the app to the shelf, listed afresh. */
void player_shelf_show(player_app *app);

/* The world at `path` cannot be opened, for `reason`, from now on. */
void player_shelf_refuse(player_shelf *shelf, const char *path, const char *reason);

/* The world at `path` is greyed with `reason` until a save of it is written (`player_shelf_unblock`). */
void player_shelf_block(player_shelf *shelf, const char *path, const char *reason);
void player_shelf_unblock(player_shelf *shelf, const char *path);
bool player_shelf_blocked(const player_shelf *shelf, const char *path);

/* A world's name as words, as the shelf titles it: `printers_shop` is `Printers Shop`. */
void player_world_title(const char *name, char *title, size_t size);

/* How many rows the shelf shows with a font `line_height` tall. */
size_t player_shelf_rows(int line_height);

extern const player_screen player_shelf_screen;

#endif
