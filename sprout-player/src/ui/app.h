/*
 * The C app: the session, the system font, the shelf (shelf.h), and the screen on show (screen.h). The system calls
 * `player_app_update` once a frame; the frame runs on the player's own stack (host/stack.h),
 * since a turn may run in it, and the file calls inside it hop back to the main stack as they
 * always do. A screen moves the app to another with `player_app_show`, which takes effect when
 * the frame's update is over, so a screen is never left while its update still runs.
 */
#ifndef PLAYER_UI_APP_H
#define PLAYER_UI_APP_H

#include "pd_api.h"
#include "pen.h"
#include "screen.h"
#include "session.h"

/* The screen's geometry, as the Lua app lays it out. */
#define PLAYER_SCREEN_WIDTH 400
#define PLAYER_SCREEN_HEIGHT 240
#define PLAYER_MARGIN 4

typedef struct player_shelf player_shelf;

struct player_app {
  PlaydateAPI *pd;
  player_session *session;
  player_pen pen;
  player_shelf *shelf;
  LCDFont *big_font, *small_font; /* the sentence builder's, loaded when it first opens; NULL where one cannot be */
  bool fonts_tried;
  const player_screen *screen;
  void *ctx;
  const player_screen *next; /* the screen `player_app_show` asked for, shown when the update is over */
  void *next_ctx;
};

/*
 * The app over `pd`, on the shelf; NULL, with the words in `*why`, when it cannot start. Called at
 * kEventInit, on the main stack, since it loads the font; the shelf is listed in the first frame.
 */
player_app *player_app_new(PlaydateAPI *pd, const char **why);

/* The screen on show is left, the visitor leaves and the save is written (on the own stack), and the app is freed. */
void player_app_free(player_app *app);

/* Moves the app to `screen` over `ctx` once the update under way is over; the screen on show is left then. */
void player_app_show(player_app *app, const player_screen *screen, void *ctx);

/* The update callback: reads the buttons and the crank and runs one frame on the player's own stack. */
int player_app_update(void *app);

/* One frame with `input`: the screen's update, a screen change, the frame cleared, the screen drawn. */
void player_app_frame(player_app *app, const player_input *input);

#endif
