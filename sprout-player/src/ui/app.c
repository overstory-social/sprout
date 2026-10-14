/* The app; see app.h. */
#include "app.h"

#include <string.h>

#include "arrival.h"
#include "message.h"
#include "shelf.h"
#include "host/files.h"
#include "host/stack.h"

/* The system menu's callback, outside any frame: the leaving waits for the next one, which runs on the own stack. */
static void leave_world_chosen(void *userdata) { ((player_app *)userdata)->leave_asked = true; }
static void start_over_chosen(void *userdata) { ((player_app *)userdata)->restart_asked = true; }

player_app *player_app_new(PlaydateAPI *pd, const char **why) {
  player_app *app = (player_app *)player_alloc(pd, sizeof *app);
  if (app == NULL) {
    *why = "the player ran out of memory starting";
    return NULL;
  }
  memset(app, 0, sizeof *app);
  app->pd = pd;
  if (!player_pen_init(&app->pen, pd, why)) {
    player_free(pd, app);
    return NULL;
  }
  player_sound_init(&app->sound, pd);
  player_clock_init(&app->clock);
  app->session = player_session_new(pd);
  app->shelf = app->session != NULL ? player_shelf_new(app) : NULL;
  if (app->shelf == NULL) {
    if (app->session != NULL) player_session_free(app->session);
    player_sound_free(&app->sound);
    player_free(pd, app);
    *why = "the player ran out of memory starting";
    return NULL;
  }
  app->screen = &player_shelf_screen;
  app->ctx = app->shelf;
  app->leave_item = pd->system->addMenuItem("leave world", leave_world_chosen, app);
  app->restart_item = pd->system->addMenuItem("start over", start_over_chosen, app);
  return app;
}

/* The screens are left and the visitor leaves; the departure is a turn, so it runs on the own stack. */
static void *close_thunk(void *ctx) {
  player_app *app = (player_app *)ctx;
  if (app->next != NULL) app->next->leave(app, app->next_ctx);
  app->screen->leave(app, app->ctx);
  player_close(app->session);
  return NULL;
}

void player_app_free(player_app *app) {
  if (app == NULL) return;
  if (app->leave_item != NULL) app->pd->system->removeMenuItem(app->leave_item);
  if (app->restart_item != NULL) app->pd->system->removeMenuItem(app->restart_item);
  player_on_own_stack(app->pd, close_thunk, app);
  player_shelf_free(app, app->shelf);
  player_session_free(app->session);
  player_sound_free(&app->sound);
  player_free(app->pd, app);
}

uint64_t player_app_seconds(const player_app *app) { return app->pd->system->getSecondsSinceEpoch(NULL); }

void player_app_sleep(player_app *app) { player_clock_sleep(&app->clock); }

void player_app_wake(player_app *app) { player_clock_wake(&app->clock, player_app_seconds(app)); }

void player_cue(player_app *app, player_cue_name name) { player_sound_play(&app->sound, name); }

void player_app_show(player_app *app, const player_screen *screen, void *ctx) {
  if (app->next != NULL) app->next->leave(app, app->next_ctx);
  app->next = screen;
  app->next_ctx = ctx;
}

/* The visitor leaves the world for the shelf, as B on the nickname screen does. */
static void leave_world(player_app *app) {
  player_cue(app, PLAYER_CUE_BACK);
  if (player_close(app->session).saved)
    player_shelf_show(app);
  else
    player_shelf_unsaved(app);
}

/*
 * The world begun again: its save is gone and the nickname screen asks who the visitor is, the name
 * they had offered first. The world stays read, so no loading line comes between.
 */
static void start_over(player_app *app) {
  char title[128], remembered[64];
  player_restart restart = player_start_over(app->session);
  size_t length;
  if (!restart.ok) {
    player_message_show(app, restart.reason);
    player_close(app->session);
    return;
  }
  player_cue(app, PLAYER_CUE_PICK);
  player_world_title(restart.name, title, sizeof title);
  /* The name is the session's until its next call, which the load below is. */
  length = restart.nickname == NULL ? 0 : restart.nickname->length;
  if (length >= sizeof remembered) length = sizeof remembered - 1;
  if (length > 0) memcpy(remembered, restart.nickname->bytes, length);
  remembered[length] = '\0';
  player_arrival_pick(app, app->shelf->opened, title, restart.words, restart.word_count,
                      restart.nickname != NULL ? remembered : NULL);
}

/* The question whether to start over: A does, B goes back to the screen on show. */
static void ask_restart(player_app *app, const player_input *input) {
  if (input->pushed & kButtonA) {
    app->restart_question = false;
    start_over(app);
  } else if (input->pushed & kButtonB) {
    app->restart_question = false;
    player_cue(app, PLAYER_CUE_BACK);
  }
}

static void draw_restart_question(player_app *app) {
  const player_pen *pen = &app->pen;
  player_pen_say(pen, PLAYER_RESTART_QUESTION, PLAYER_MARGIN, MESSAGE_TOP);
  player_pen_say(pen, PLAYER_RESTART_WARNING, PLAYER_MARGIN, MESSAGE_TOP + pen->line_height);
  player_pen_say(pen, PLAYER_RESTART_KEYS, PLAYER_MARGIN, PLAYER_SCREEN_HEIGHT - pen->line_height - 2);
}

void player_app_frame(player_app *app, const player_input *input) {
  if (app->leave_asked && app->reading) {
    app->restart_question = false;
    leave_world(app);
  } else if (app->restart_question) {
    ask_restart(app, input);
  } else if (app->restart_asked && app->reading) {
    app->restart_question = true;
  } else {
    app->screen->update(app, app->ctx, input);
  }
  app->leave_asked = false;
  app->restart_asked = false;
  if (app->next != NULL) {
    app->screen->leave(app, app->ctx);
    app->screen = app->next;
    app->ctx = app->next_ctx;
    app->next = NULL;
    app->next_ctx = NULL;
  }
  app->pd->graphics->clear(kColorWhite);
  if (app->restart_question)
    draw_restart_question(app);
  else
    app->screen->draw(app, app->ctx);
}

typedef struct frame_call {
  player_app *app;
  const player_input *input;
} frame_call;

static void *frame_thunk(void *ctx) {
  frame_call *call = (frame_call *)ctx;
  player_app_frame(call->app, call->input);
  return NULL;
}

int player_app_update(void *userdata) {
  player_app *app = (player_app *)userdata;
  player_input input;
  PDButtons released;
  frame_call call;
  memset(&input, 0, sizeof input);
  app->pd->system->getButtonState(&input.held, &input.pushed, &released);
  input.crank = app->pd->system->isCrankDocked() ? 0.0f : app->pd->system->getCrankChange();
  call.app = app;
  call.input = &input;
  player_on_own_stack(app->pd, frame_thunk, &call);
  return 1;
}
