/* The reader screen; see reader.h. */
#include "reader.h"

#include <string.h>

#include "builder.h"
#include "host/files.h"
#include "images.h"
#include "pictures.h"
#include "shelf.h"

/* The keys under the transcript: what the screen offers today. */
static const char KEYS[] = "A: build a sentence   crank: scroll back";

static int header_height(int line_height) { return line_height + 4; }
static int panel_height(int line_height) { return line_height * 3 + 8; }

size_t player_reader_rows(int line_height) {
  int room = PLAYER_SCREEN_HEIGHT - header_height(line_height) - panel_height(line_height);
  size_t rows = room > 0 && line_height > 0 ? (size_t)(room / line_height) : 0;
  return rows < READER_MOST_ROWS ? rows : READER_MOST_ROWS;
}

player_reader *player_reader_new(player_app *app) {
  player_reader *reader = (player_reader *)player_alloc(app->pd, sizeof *reader);
  if (reader == NULL) return NULL;
  memset(reader, 0, sizeof *reader);
  transcript_init(&reader->lines, app->pd, player_pen_width, &app->pen, PLAYER_SCREEN_WIDTH - 2 * PLAYER_MARGIN,
                  player_reader_rows(app->pen.line_height));
  player_clock_start(&app->clock, player_app_seconds(app));
  return reader;
}

bool player_reader_look(player_app *app, player_reader *reader, const sprout_seen_view **seen) {
  const char *words = NULL;
  const sprout_seen_view *view = player_view(app->session, &words);
  if (seen != NULL) *seen = view;
  if (view == NULL) {
    const char *why = words != NULL ? words : "The place cannot be seen.";
    return transcript_push(&reader->lines, "notice", why, strlen(why));
  }
  return transcript_set_status(&reader->lines, view);
}

static const char TICK_NO_MEMORY[] = "The player ran out of memory telling what happened.";

/*
 * A tick: what it told is added to the transcript and the status looked at again, and the pictures
 * it asked for are shown. A tick whose save could not be written stops play; one the session
 * refused says why, once, and the clock stops.
 */
static void tick(player_app *app, player_reader *reader) {
  player_told told = player_tick(app->session);
  gallery pictures;
  bool kept;
  if (told.ok && !told.saved) {
    player_shelf_unsaved(app);
    return;
  }
  if (!told.ok) {
    player_clock_stop(&app->clock);
    transcript_push(&reader->lines, "notice", told.words, strlen(told.words));
    return;
  }
  if (told.lines.count == 0) return;
  gallery_init(&pictures, app->pd);
  kept = transcript_tell(&reader->lines, &told.lines) && images_take_told(&pictures, app->assets, &told.lines);
  kept = player_reader_look(app, reader, NULL) && kept;
  if (!kept) transcript_push(&reader->lines, "notice", TICK_NO_MEMORY, strlen(TICK_NO_MEMORY));
  if (pictures.count > 0)
    player_pictures_show(app, reader, &pictures);
  else
    gallery_free(&pictures);
}

static void update(player_app *app, void *ctx, const player_input *input) {
  player_reader *reader = (player_reader *)ctx;
  long lines;
  /* Turning the other way starts afresh: what was left toward a line the other way is dropped. */
  if ((reader->crank > 0 && input->crank < 0) || (reader->crank < 0 && input->crank > 0)) reader->crank = 0;
  reader->crank += input->crank;
  lines = (long)(reader->crank / READER_DEGREES_PER_LINE);
  reader->crank -= (float)lines * READER_DEGREES_PER_LINE;
  if (lines != 0) transcript_scroll(&reader->lines, lines);
  if (input->pushed & kButtonUp) transcript_scroll(&reader->lines, 1);
  if (input->pushed & kButtonDown) transcript_scroll(&reader->lines, -1);
  if (input->pushed & kButtonA) {
    player_builder_open(app, reader);
    return;
  }
  if (player_clock_due(&app->clock, player_app_seconds(app))) tick(app, reader);
}

static void draw(player_app *app, void *ctx) {
  player_reader *reader = (player_reader *)ctx;
  const player_pen *pen = &app->pen;
  int line_height = pen->line_height, y = line_height + 2, panel = PLAYER_SCREEN_HEIGHT - panel_height(line_height);
  const char *shown[READER_MOST_ROWS];
  size_t count, i;
  player_pen_say(pen, reader->lines.status != NULL ? reader->lines.status : "", 2, 0);
  app->pd->graphics->drawLine(0, y - 1, PLAYER_SCREEN_WIDTH, y - 1, 1, kColorBlack);
  count = transcript_visible(&reader->lines, shown);
  for (i = 0; i < count; i++, y += line_height) player_pen_say(pen, shown[i], 2, y);
  if (transcript_behind(&reader->lines)) player_pen_say(pen, "v", 390, PLAYER_SCREEN_HEIGHT - line_height);
  app->pd->graphics->drawLine(0, panel, PLAYER_SCREEN_WIDTH, panel, 1, kColorBlack);
  player_pen_say(pen, KEYS, PLAYER_MARGIN, panel + 2);
}

static void leave(player_app *app, void *ctx) {
  player_reader *reader = (player_reader *)ctx;
  if (reader->lent) return;
  player_clock_stop(&app->clock);
  transcript_free(&reader->lines);
  player_free(app->pd, reader);
}

const player_screen player_reader_screen = {update, draw, leave};
