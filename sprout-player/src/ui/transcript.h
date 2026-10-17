/*
 * The reader's transcript, after the TUI's (tui/src/state.ts): paragraphs wrapped to the column, the newest at the bottom, with a status
 * of the place and its ways out, wrapped to the same column. A paragraph's kind leads it with a
 * mark, so the screen needs no colour to tell them apart. A reader who has scrolled back keeps
 * their place as more is told, and as the column is fitted to fewer or more rows; the oldest
 * paragraphs fall off past TRANSCRIPT_KEEP. The paragraphs are measured by `measure`, the body's,
 * and the status by `status_measure`, the frame's, over the one `measure_ctx`. Each block keeps its
 * words with its lines (wrap.h), so a font that changes wraps the paragraphs and the status again
 * with nothing told lost.
 */
#ifndef PLAYER_UI_TRANSCRIPT_H
#define PLAYER_UI_TRANSCRIPT_H

#include <stdbool.h>
#include <stddef.h>

#include "pd_api.h"
#include "sprout.h"
#include "told.h"
#include "wrap.h"

#define TRANSCRIPT_KEEP 200

typedef struct transcript {
  PlaydateAPI *pd;
  wrap_measure measure;
  wrap_measure status_measure;
  void *measure_ctx;
  int width;   /* the column in pixels */
  size_t rows; /* the lines the column shows */
  wrapped paragraphs[TRANSCRIPT_KEEP]; /* a ring: `first` is the oldest */
  size_t first, count;
  size_t line_count; /* lines in every kept paragraph */
  size_t offset;     /* lines scrolled back from the newest */
  wrapped status;    /* the status's lines, wrapped to the column; none before the first view */
} transcript;

void transcript_init(transcript *t, PlaydateAPI *pd, wrap_measure measure, wrap_measure status_measure, void *measure_ctx,
                     int width, size_t rows);
void transcript_free(transcript *t);

/* The mark a kind of line is led by: `typed`, `refused`, `notice` and `client` have one. */
const char *transcript_lead(const char *kind);

/* Adds a paragraph of `kind`; false when no memory could be had, and the transcript is as it was. */
bool transcript_push(transcript *t, const char *kind, const char *text, size_t length);

/* Adds every line a call told; false when one could not be kept. */
bool transcript_tell(transcript *t, const told_list *lines);

/* Fits the column to `rows` lines: everything kept stays, and a reader scrolled back stays within what there is. */
void transcript_fit(transcript *t, size_t rows);

/* Scrolls `lines` back (positive) or forward (negative), within what there is. */
void transcript_scroll(transcript *t, long lines);

/* How far back the transcript can be scrolled. */
size_t transcript_furthest(const transcript *t);

/* Whether newer lines than the ones shown wait below. */
bool transcript_behind(const transcript *t);

/*
 * A font has changed: every paragraph and the status are wrapped again, each by its measure. A
 * block that could not be wrapped again for want of memory keeps the lines it had, and the reader's
 * place is kept as near as the new lines allow; the rows are fitted after, by `transcript_fit`.
 */
void transcript_rewrap(transcript *t);

/* The lines shown, oldest first, into `lines` (room for `rows`); how many. */
size_t transcript_visible(const transcript *t, const char **lines);

/*
 * The status from a view, wrapped to the column: the place, then its ways out, each by its direction or
 * its label; false when no memory could be had, and the status is as it was.
 */
bool transcript_set_status(transcript *t, const sprout_seen_view *view);

#endif
