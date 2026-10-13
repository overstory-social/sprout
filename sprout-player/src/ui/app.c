/* The C app; see app.h. */
#include "app.h"

#include <string.h>

#include "arrival.h"
#include "host/files.h"
#include "host/stack.h"

player_app *player_app_new(PlaydateAPI *pd, const char **why) {
  player_app *app = (player_app *)player_alloc(pd, sizeof *app);
  void *ctx;
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
  app->session = player_session_new(pd);
  ctx = app->session != NULL ? player_arrival_new(app) : NULL;
  if (ctx == NULL) {
    if (app->session != NULL) player_session_free(app->session);
    player_free(pd, app);
    *why = "the player ran out of memory starting";
    return NULL;
  }
  app->screen = &player_arrival_screen;
  app->ctx = ctx;
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
  player_on_own_stack(app->pd, close_thunk, app);
  player_session_free(app->session);
  player_free(app->pd, app);
}

void player_app_show(player_app *app, const player_screen *screen, void *ctx) {
  if (app->next != NULL) app->next->leave(app, app->next_ctx);
  app->next = screen;
  app->next_ctx = ctx;
}

void player_app_frame(player_app *app, const player_input *input) {
  app->screen->update(app, app->ctx, input);
  if (app->next != NULL) {
    app->screen->leave(app, app->ctx);
    app->screen = app->next;
    app->ctx = app->next_ctx;
    app->next = NULL;
    app->next_ctx = NULL;
  }
  app->pd->graphics->clear(kColorWhite);
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
