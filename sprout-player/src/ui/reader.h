/*
 * The reader screen: the transcript (transcript.h) under the status line, with the keys below.
 * The crank and the d-pad scroll back through what was said, a line for every 12 degrees of
 * crank and for each press of up; down comes forward again. The layout is the Lua app's
 * (Source/main.lua and Source/reader.lua) at 400 by 240. A opens the sentence builder (builder.h),
 * which the reader is lent to while it is up. The ticks and the clock come with #635.
 */
#ifndef PLAYER_UI_READER_H
#define PLAYER_UI_READER_H

#include "app.h"
#include "transcript.h"

/* Degrees of crank for a line scrolled. */
#define READER_DEGREES_PER_LINE 12.0f

/* The most lines the column shows, whatever the font. */
#define READER_MOST_ROWS 64

typedef struct player_reader {
  transcript lines;
  float crank; /* degrees turned toward the next line one way, not yet a line */
  bool lent;   /* the sentence builder holds it: leaving the reader does not free it */
} player_reader;

extern const player_screen player_reader_screen;

/* A reader with nothing told yet, sized from the app's font; NULL when there is no memory for it. */
player_reader *player_reader_new(player_app *app);

/* Polls the visitor's view and sets the status from it; a view that cannot be had is told as a notice. */
bool player_reader_look(player_app *app, player_reader *reader);

/* How many transcript lines the column shows with a font `line_height` tall. */
size_t player_reader_rows(int line_height);

#endif
