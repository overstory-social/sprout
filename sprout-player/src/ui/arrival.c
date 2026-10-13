/* Opening a world and arriving in it; see arrival.h. */
#include "arrival.h"

#include <string.h>

#include "host/files.h"
#include "message.h"
#include "reader.h"
#include "text.h"

static const char NO_MEMORY[] = "The player ran out of memory bringing you into the world.";
static const char SAVE_FAILED[] =
    "The save could not be written, so play has stopped. Free some room on the console. "
    "This world stays greyed until its save can be written.";

static void copy_text(char *out, size_t size, const char *text) {
  text_buffer buffer;
  text_begin(&buffer, out, size);
  text_add(&buffer, text);
}

player_arrival *player_arrival_new(player_app *app, const char *path, const char *title) {
  player_arrival *arrival = (player_arrival *)player_alloc(app->pd, sizeof *arrival);
  if (arrival == NULL) return NULL;
  memset(arrival, 0, sizeof *arrival);
  copy_text(arrival->path, sizeof arrival->path, path);
  copy_text(arrival->title, sizeof arrival->title, title);
  return arrival;
}

/*
 * Stops with `words` on the message screen; the world, if any of it is open, is closed. The words
 * may be the session's, which last only until its next call, so the message copies them first.
 */
static void stop(player_app *app, const char *words) {
  player_message_show(app, words);
  player_close(app->session);
}

/* The world itself refused to open: the shelf keeps the reason. */
static void refuse(player_app *app, player_arrival *arrival, const char *reason) {
  player_shelf_refuse(app->shelf, arrival->path, reason != NULL && reason[0] != '\0' ? reason : "The world could not be opened.");
  stop(app, reason);
}

/* The save could not be written: the world is greyed on the shelf until it can be. */
static void unsaved(player_app *app, player_arrival *arrival) {
  player_close(app->session);
  player_shelf_block(app->shelf, arrival->path, SAVE_FAILED);
  player_message_show(app, SAVE_FAILED);
}

/* A copy of `text` from the device's allocator, or NULL. */
static char *copy_of(PlaydateAPI *pd, const char *text, size_t length) {
  char *copy = (char *)player_alloc(pd, length + 1);
  if (copy == NULL) return NULL;
  memcpy(copy, text, length);
  copy[length] = '\0';
  return copy;
}

/* The reader with the arrival told: who the visitor is, what the save had to say, what the arrival told, the status. */
static player_reader *tell_arrival(player_app *app, const player_arrival *arrival, const char *nickname, const char *notice,
                                   const told_list *lines) {
  player_reader *reader = player_reader_new(app);
  char said[256];
  text_buffer you;
  if (reader == NULL) return NULL;
  text_begin(&you, said, sizeof said);
  text_add(&you, "You are in ");
  text_add(&you, arrival->title);
  text_add(&you, " as ");
  text_add(&you, nickname);
  text_add(&you, ".");
  if (transcript_push(&reader->lines, "client", said, strlen(said)) &&
      (notice == NULL || transcript_push(&reader->lines, "notice", notice, strlen(notice))) &&
      transcript_tell(&reader->lines, lines) && player_reader_look(app, reader))
    return reader;
  player_reader_screen.leave(app, reader);
  return NULL;
}

/* The world is read: its save is loaded and the visitor admitted, and the reader takes over. */
static void arrive(player_app *app, player_arrival *arrival) {
  player_loaded loaded = player_load(app->session);
  player_told admitted;
  player_reader *reader;
  char *nickname, *notice = NULL;
  if (!loaded.ok) {
    stop(app, loaded.words);
    return;
  }
  nickname = loaded.nickname != NULL ? copy_of(app->pd, loaded.nickname->bytes, loaded.nickname->length)
                                     : copy_of(app->pd, PLAYER_FIXED_NICKNAME, strlen(PLAYER_FIXED_NICKNAME));
  if (loaded.words[0] != '\0') notice = copy_of(app->pd, loaded.words, strlen(loaded.words));
  /* What the load said is the session's until its next call, so it is copied before the save below. */
  if (nickname == NULL || (loaded.words[0] != '\0' && notice == NULL)) {
    stop(app, NO_MEMORY);
  } else if (player_shelf_blocked(app->shelf, arrival->path) && !player_save(app->session).ok) {
    /* A world greyed for its save is played again only once a save of it is written. */
    unsaved(app, arrival);
  } else {
    player_shelf_unblock(app->shelf, arrival->path);
    admitted = player_admit(app->session, nickname);
    if (!admitted.ok)
      stop(app, admitted.words);
    else if (!admitted.saved)
      unsaved(app, arrival);
    else if (!admitted.admitted)
      stop(app, admitted.words);
    else if ((reader = tell_arrival(app, arrival, nickname, notice, &admitted.lines)) == NULL)
      stop(app, NO_MEMORY);
    else
      player_app_show(app, &player_reader_screen, reader);
  }
  player_free(app->pd, nickname);
  player_free(app->pd, notice);
}

static void update(player_app *app, void *ctx, const player_input *input) {
  player_arrival *arrival = (player_arrival *)ctx;
  player_opening step;
  (void)input;
  if (!arrival->started) {
    player_opening opening = player_open(app->session, arrival->path);
    arrival->started = true;
    if (!opening.ok) {
      refuse(app, arrival, opening.reason);
      return;
    }
    player_world_title(opening.name, arrival->title, sizeof arrival->title);
  }
  step = player_step(app->session);
  if (!step.ok) {
    refuse(app, arrival, step.reason);
    return;
  }
  arrival->read = step.read;
  arrival->counted = step.counted;
  if (step.done) arrive(app, arrival);
}

static void draw(player_app *app, void *ctx) {
  player_arrival *arrival = (player_arrival *)ctx;
  const player_pen *pen = &app->pen;
  char said[200];
  text_buffer loading;
  uint64_t share = arrival->counted > 0 ? (uint64_t)arrival->read * 100u / arrival->counted : 0;
  int width = PLAYER_SCREEN_WIDTH - 2 * PLAYER_MARGIN;
  text_begin(&loading, said, sizeof said);
  text_add(&loading, "Loading ");
  text_add(&loading, arrival->title);
  text_add(&loading, "... ");
  text_add_number(&loading, share);
  text_add(&loading, "%");
  player_pen_say(pen, said, PLAYER_MARGIN, 0);
  app->pd->graphics->drawLine(PLAYER_MARGIN, pen->line_height + 4, PLAYER_MARGIN + (int)(width * (int)share / 100),
                              pen->line_height + 4, 1, kColorBlack);
}

static void leave(player_app *app, void *ctx) { player_free(app->pd, ctx); }

const player_screen player_arrival_screen = {update, draw, leave};
