/*
 * The shelf: the cartridges the player can open (the design
 * doc's The shelf). It lists the `.sproutworld` files at the root of the app and its Data folder
 * and in each one's `worlds/` folder, and asks the session whether each can be shelved; one it
 * refuses is listed with the engine's reason and cannot be opened. A cartridge is inspected once
 * for as long as the app runs, and a world refused at its open keeps that reason on the shelf
 * afterwards. Each world is a word on a wheel (wheel.h), its title, greyed where it cannot be opened
 * as it stands, with the reason in the panel; the last word, "more worlds...", opens the download
 * screen (downloads.h), and when the list of worlds could not be had there, the panel under it says
 * why until it is tried again.
 *
 * The shelf outlives its screen: the app holds it, and leaving the screen keeps it and lets go of the
 * wheel's labels.
 */
#ifndef PLAYER_UI_SHELF_H
#define PLAYER_UI_SHELF_H

#include <stdbool.h>
#include <stddef.h>

#include "app.h"
#include "wheel.h"
#include "wrap.h"

#define PLAYER_PATH_BYTES 256
#define PLAYER_REASON_BYTES 512

typedef struct shelf_entry {
  char path[PLAYER_PATH_BYTES];
  char title[PLAYER_TITLE_BYTES];
  char hash[65]; /* the bundle hash, when it can be opened */
  bool ok;      /* it can be opened */
  bool blocked; /* greyed because its save could not be written; opening it tries the save again */
  char reason[PLAYER_REASON_BYTES]; /* why it cannot be opened, when it cannot */
} shelf_entry;

struct player_shelf {
  shelf_entry *entries; /* in path order */
  size_t count;
  size_t selected; /* an entry, or `count` for "more worlds..." */
  wheel wheel;     /* the worlds' titles and "more worlds..." */
  unsigned long words_made; /* counts the changes to what the wheel's words say */
  bool listed;     /* the entries have been listed: the first frame lists them, and each return to the shelf */
  wrapped panel;   /* the words under the rows, for `panel_for` */
  size_t panel_for;
  char opened[PLAYER_PATH_BYTES]; /* the world last chosen, which is the one open while a world is */
  char more_note[PLAYER_REASON_BYTES + 128]; /* why the list of worlds could not be had, or "" */
};

/* An empty shelf, listed in its first frame; NULL when there is no memory for it. */
player_shelf *player_shelf_new(player_app *app);
void player_shelf_free(player_app *app, player_shelf *shelf);

/* Moves the app to the shelf, listed afresh. */
void player_shelf_show(player_app *app);

/* Lists the shelf afresh where it stands, as a download that arrived needs. */
void player_shelf_list(player_app *app);

/* Whether a world with the bundle hash `hash` is on the shelf and can be opened. */
bool player_shelf_holds(const player_shelf *shelf, const char *hash);

/* What the download screen last could not do, said under "more worlds..."; NULL when it could. */
void player_shelf_note_more(player_shelf *shelf, const char *failure);

/* The world at `path` cannot be opened, for `reason`, from now on. */
void player_shelf_refuse(player_shelf *shelf, const char *path, const char *reason);

/* The world at `path` is greyed with `reason` until a save of it is written (`player_shelf_unblock`). */
void player_shelf_block(player_shelf *shelf, const char *path, const char *reason);
void player_shelf_unblock(player_shelf *shelf, const char *path);
bool player_shelf_blocked(const player_shelf *shelf, const char *path);

/*
 * The open world's save could not be written: play stops (a move that is not kept is not played),
 * the world is closed and greyed on the shelf, and the message screen says so.
 */
void player_shelf_unsaved(player_app *app);

/*
 * What a world is shown as (the spec's The manifest): its `title` where its manifest gives one (NULL
 * where not), and otherwise its name as words, `printers_shop` as `Printers Shop`; cut to `size`.
 */
void player_world_title(const char *name, const char *title, char *out, size_t size);

/* The bands of the shelf and the download screen, in a frame `frame_height` tall: the title over its rule, and the panel's three lines under theirs. */
int player_shelf_header(int frame_height);
int player_shelf_panel(int frame_height);

extern const player_screen player_shelf_screen;

#endif
