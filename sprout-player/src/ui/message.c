/* The message screen; see message.h. */
#include "message.h"

#include <string.h>

#include "host/files.h"
#include "shelf.h"
#include "wrap.h"

static const char GO_ON[] = "A to go on";

typedef struct player_message {
  wrapped words;
} player_message;

/* Shown when there is no memory for the message itself; its leave frees nothing. */
static char out_of_memory_line[] = "The player ran out of memory.";
static player_message out_of_memory = {{out_of_memory_line, 1, out_of_memory_line, sizeof out_of_memory_line - 1}};

void player_message_show(player_app *app, const char *words) {
  player_message *message = (player_message *)player_alloc(app->pd, sizeof *message);
  if (words == NULL || words[0] == '\0') words = "The world could not be opened.";
  if (message == NULL || !wrap_lines(app->pd, words, strlen(words), PLAYER_SCREEN_WIDTH - 2 * PLAYER_MARGIN,
                                     player_pen_width, &app->pen, &message->words)) {
    player_free(app->pd, message);
    message = &out_of_memory;
  }
  player_app_show(app, &player_message_screen, message);
}

static void update(player_app *app, void *ctx, const player_input *input) {
  (void)ctx;
  if (input->pushed & (kButtonA | kButtonB)) player_shelf_show(app);
}

static void draw(player_app *app, void *ctx) {
  player_message *message = (player_message *)ctx;
  const player_pen *pen = &app->pen;
  const char *line = message->words.bytes;
  size_t i;
  int y = MESSAGE_TOP;
  for (i = 0; i < message->words.line_count; i++, line = wrap_next(line), y += pen->line_height)
    player_pen_say(pen, line, PLAYER_MARGIN, y);
  player_pen_frame_say(pen, GO_ON, PLAYER_MARGIN, PLAYER_SCREEN_HEIGHT - pen->frame_height - 2);
}

static void leave(player_app *app, void *ctx) {
  player_message *message = (player_message *)ctx;
  if (message == &out_of_memory) return;
  wrap_free(app->pd, &message->words);
  player_free(app->pd, message);
}

static void refit(player_app *app, void *ctx) {
  player_message *message = (player_message *)ctx;
  if (message != &out_of_memory)
    wrap_again(app->pd, &message->words, PLAYER_SCREEN_WIDTH - 2 * PLAYER_MARGIN, player_pen_width, &app->pen);
}

const player_screen player_message_screen = {update, draw, leave, refit};
