/* The reader screen; see reader.h. */
#include "reader.h"

#include <string.h>

#include "builder.h"
#include "host/files.h"

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
  return reader;
}

bool player_reader_look(player_app *app, player_reader *reader) {
  const char *words = NULL;
  const sprout_seen_view *view = player_view(app->session, &words);
  if (view == NULL) {
    const char *why = words != NULL ? words : "The place cannot be seen.";
    return transcript_push(&reader->lines, "notice", why, strlen(why));
  }
  return transcript_set_status(&reader->lines, view);
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
  if (input->pushed & kButtonA) player_builder_open(app, reader);
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
  transcript_free(&reader->lines);
  player_free(app->pd, reader);
}

const player_screen player_reader_screen = {update, draw, leave};
