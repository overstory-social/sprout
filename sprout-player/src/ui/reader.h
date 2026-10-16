/*
 * The reader screen: the transcript (transcript.h) under the status, with the keys on one line
 * below. The status wraps to the column and the header is as tall as its lines, up to
 * READER_STATUS_MOST_LINES; the transcript's rows are fitted under it whenever the status is set,
 * so a place with more ways out costs rows, never anything told. The crank and the d-pad scroll
 * back through what was said, a line for every 12 degrees of crank and for each press of up; down
 * comes forward again, on the 400 by 240 screen. A opens the sentence builder (builder.h),
 * which the reader is lent to while it is up. While a reader is open the app's clock (clock.h)
 * runs, and when a tick is due the reader asks the session for one and tells what it told, behind
 * the pictures it asked for (pictures.h); a tick is asked for only while the reader itself is on
 * show, so one falling due under the builder or the pictures comes when they close.
 */
#ifndef PLAYER_UI_READER_H
#define PLAYER_UI_READER_H

#include "app.h"
#include "transcript.h"

/* Degrees of crank for a line scrolled. */
#define READER_DEGREES_PER_LINE 12.0f

/* The most lines the column shows, whatever the font. */
#define READER_MOST_ROWS 64

/* The most lines the status takes: a place whose ways out run past them has the rest clipped, so the transcript keeps its rows. */
#define READER_STATUS_MOST_LINES 3

typedef struct player_reader {
  transcript lines;
  float crank; /* degrees turned toward the next line one way, not yet a line */
  bool lent;   /* the sentence builder holds it: leaving the reader does not free it */
} player_reader;

extern const player_screen player_reader_screen;

/* A reader with nothing told yet, sized from the app's font, and the clock started; NULL when there is no memory for it. */
player_reader *player_reader_new(player_app *app);

/*
 * Polls the visitor's view and sets the status from it; a view that cannot be had is told as a
 * notice. `*seen`, where asked for, is the view or NULL, and lives until the next session call.
 */
bool player_reader_look(player_app *app, player_reader *reader, const sprout_seen_view **seen);

/* Sets the status from `view` and fits the transcript's rows under it; false when no memory could be had. */
bool player_reader_status(player_app *app, player_reader *reader, const sprout_seen_view *view);

/* How many transcript lines the column shows with a font `line_height` tall under a status of `status_lines` lines. */
size_t player_reader_rows(int line_height, size_t status_lines);

#endif
