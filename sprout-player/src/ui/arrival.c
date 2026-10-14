/* Opening a world and arriving in it; see arrival.h. */
#include "arrival.h"

#include <string.h>

#include "host/files.h"
#include "images.h"
#include "message.h"
#include "nickname.h"
#include "pictures.h"
#include "reader.h"
#include "text.h"

static const char NO_MEMORY[] = "The player ran out of memory bringing you into the world.";

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

/*
 * The reader with the arrival told: who the visitor is, what the save had to say, what the arrival
 * told, the status; and into `pictures`, what the arrival's lines and then the place's view asked to show.
 */
static player_reader *tell_arrival(player_app *app, const char *title, const char *nickname, const char *notice,
                                   const told_list *lines, gallery *pictures) {
  player_reader *reader = player_reader_new(app);
  const sprout_seen_view *view = NULL;
  char said[256];
  text_buffer you;
  if (reader == NULL) return NULL;
  text_begin(&you, said, sizeof said);
  text_add(&you, "You are in ");
  text_add(&you, title);
  text_add(&you, " as ");
  text_add(&you, nickname);
  text_add(&you, ".");
  if (transcript_push(&reader->lines, "client", said, strlen(said)) &&
      (notice == NULL || transcript_push(&reader->lines, "notice", notice, strlen(notice))) &&
      transcript_tell(&reader->lines, lines) && images_take_told(pictures, app->assets, lines) &&
      player_reader_look(app, reader, &view) && (view == NULL || images_take_view(pictures, app->assets, view)))
    return reader;
  player_reader_screen.leave(app, reader);
  return NULL;
}

bool player_arrival_tell(player_app *app, const char *title, const char *nickname, const char *notice,
                         const told_list *lines) {
  gallery pictures;
  player_reader *reader;
  gallery_init(&pictures, app->pd);
  if ((reader = tell_arrival(app, title, nickname, notice, lines, &pictures)) == NULL) {
    gallery_free(&pictures);
    return false;
  }
  player_pictures_show(app, reader, &pictures);
  return true;
}

void player_arrival_pick(player_app *app, const char *path, const char *title, const char *const *words,
                         size_t word_count, const char *remembered) {
  player_loaded loaded;
  sprout_str last;
  player_nickname *picker = player_nickname_new(app, title);
  if (picker == NULL) {
    stop(app, NO_MEMORY);
    return;
  }
  /* The words are the session's until its next call, so the pool is filtered by them before the load. */
  picker->count = nickname_without_words(picker->names, picker->count, words, word_count);
  loaded = player_load(app->session);
  if (!loaded.ok) {
    player_nickname_screen.leave(app, picker);
    stop(app, loaded.words);
    return;
  }
  picker->count = nickname_without_present(picker->names, picker->count, loaded.present, loaded.present_count);
  if (loaded.nickname != NULL) {
    last = *loaded.nickname;
  } else {
    last.bytes = remembered;
    last.length = remembered != NULL ? strlen(remembered) : 0;
  }
  picker->selected = nickname_preferred(picker->names, picker->count, last.bytes != NULL ? &last : NULL);
  if (loaded.words[0] != '\0') {
    /* What the load said is the session's until its next call, so it is kept before the save below. */
    size_t length = strlen(loaded.words);
    picker->notice = (char *)player_alloc(app->pd, length + 1);
    if (picker->notice == NULL) {
      player_nickname_screen.leave(app, picker);
      stop(app, NO_MEMORY);
      return;
    }
    memcpy(picker->notice, loaded.words, length + 1);
  }
  if (player_shelf_blocked(app->shelf, path) && !player_save(app->session).ok) {
    /* A world greyed for its save is played again only once a save of it is written. */
    player_nickname_screen.leave(app, picker);
    player_shelf_unsaved(app);
    return;
  }
  player_shelf_unblock(app->shelf, path);
  player_app_show(app, &player_nickname_screen, picker);
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
    if (!images_folder(arrival->path, app->assets, sizeof app->assets)) app->assets[0] = '\0';
    player_world_title(opening.name, arrival->title, sizeof arrival->title);
  }
  step = player_step(app->session);
  if (!step.ok) {
    refuse(app, arrival, step.reason);
    return;
  }
  arrival->read = step.read;
  arrival->counted = step.counted;
  if (step.done) player_arrival_pick(app, arrival->path, arrival->title, step.words, step.word_count, NULL);
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
