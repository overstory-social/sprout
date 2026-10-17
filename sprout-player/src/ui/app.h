/*
 * The app: the session, the pen in the display font at the size remembered (text_size.h), the sounds, the reader's clock (clock.h), the shelf
 * (shelf.h), and the screen on show (screen.h). The system calls `player_app_update` once a frame; the frame runs on the player's own stack (host/stack.h),
 * since a turn may run in it, and the file calls inside it hop back to the main stack as they
 * always do. A screen moves the app to another with `player_app_show`, which takes effect when
 * the frame's update is over, so a screen is never left while its update still runs.
 */
#ifndef PLAYER_UI_APP_H
#define PLAYER_UI_APP_H

#include "clock.h"
#include "pd_api.h"
#include "pen.h"
#include "screen.h"
#include "session.h"
#include "sound.h"
#include "wrap.h"

/* The screen's geometry: the Playdate's display. */
#define PLAYER_SCREEN_WIDTH 400
#define PLAYER_SCREEN_HEIGHT 240
#define PLAYER_MARGIN 4
#define PLAYER_ASSETS_BYTES 256

typedef struct player_shelf player_shelf;

struct player_app {
  PlaydateAPI *pd;
  player_session *session;
  player_pen pen;
  player_shelf *shelf;
  LCDFont *big_font, *small_font; /* the sentence builder's, loaded when it first opens; NULL where one cannot be */
  bool fonts_tried;
  player_sound sound;
  player_clock clock;
  char assets[PLAYER_ASSETS_BYTES]; /* the open world's assets folder, `<cartridge>.assets/` (images.h), or "" */
  const player_screen *screen;
  void *ctx;
  const player_screen *next; /* the screen `player_app_show` asked for, shown when the update is over */
  void *next_ctx;
  bool reading;           /* a reader is open: the visitor is in the world */
  bool leave_asked;       /* the system menu's "leave world" was chosen since the last frame */
  PDMenuItem *leave_item; /* that item, or NULL where the system could not add it */
  bool restart_asked;     /* the system menu's "start over" was chosen since the last frame */
  bool restart_question;  /* the question whether to start over is on screen, over the screen on show */
  PDMenuItem *restart_item;
  bool text_asked;        /* the system menu's "text" was set since the last frame */
  PDMenuItem *text_item;  /* that item, S / M / L, or NULL where the system could not add it */
  wrapped notice;         /* words over the screen on show until A or B: a text size that could not be had or kept; no lines when none */
};

/* The question "start over" asks, the words under it, and its keys. */
#define PLAYER_RESTART_QUESTION "Start this world over?"
#define PLAYER_RESTART_WARNING "All you did here will be forgotten."
#define PLAYER_RESTART_KEYS "A: start over   B: go back"

/* The system menu's text size item, and what is said when the font of a size cannot be read, and when the size cannot be remembered. */
#define PLAYER_TEXT_ITEM "text"
#define PLAYER_TEXT_KEPT "The text stays the size it was."
#define PLAYER_TEXT_UNKEPT "The text is this size now, but it could not be remembered for next time."
#define PLAYER_NOTICE_KEYS "A: go on"

/*
 * The app over `pd`, on the shelf, with "leave world", "start over" and "text" in the system menu; NULL, with the words in
 * `*why`, when it cannot start. Called at kEventInit, on the main stack, since it loads the font:
 * the one of the size remembered, else S, with a notice over the first frame when the remembered
 * one could not be read; the shelf is listed in the first frame.
 */
player_app *player_app_new(PlaydateAPI *pd, const char **why);

/*
 * The screen on show is left, the visitor leaves and the save is written (on the own stack), and
 * the app is freed: what the system's terminate event does.
 */
void player_app_free(player_app *app);

/* Moves the app to `screen` over `ctx` once the update under way is over; the screen on show is left then. */
void player_app_show(player_app *app, const player_screen *screen, void *ctx);

/* Sounds the cue `name` (sound.h); every screen's cues come through here. */
void player_cue(player_app *app, player_cue_name name);

/* The device's seconds since 2000-01-01, as the system gives them. */
uint64_t player_app_seconds(const player_app *app);

/* The device's millisecond counter, which no setting of the clock moves. */
unsigned player_app_milliseconds(const player_app *app);

/*
 * The device locks or sleeps for a low battery (kEventLock, kEventLowPower): the save owed is
 * written whole, and no tick is owed until it unlocks.
 */
void player_app_sleep(player_app *app);

/* The system menu opens (kEventPause): the save owed is written whole, since the person may end the app from there. */
void player_app_pause(player_app *app);

/* The device unlocks (kEventUnlock): ticks are owed again from now, while a world is being read. */
void player_app_wake(player_app *app);

/* The update callback: reads the buttons and the crank and runs one frame on the player's own stack. */
int player_app_update(void *app);

/*
 * One frame with `input`: the text size, where the system menu set it, applied (the pen's font
 * changes, the choice is remembered, and the screen on show refits; a font that cannot be read is
 * told over the screen until A or B, the pen and the menu as they were, and so is a choice that
 * could not be written); a step of the save owed (`player_save_step`, PLAYER_SAVE_SLICE bytes),
 * the screen's update, a screen change, the frame cleared, the screen drawn. A step that could
 * not write stops play as a turn's failed save does, in place of the update. While a notice is
 * over the screen, A or B takes it down in place of the update, and the menu's "leave world" and
 * "start over" still take effect under it.
 * Where "leave world" was chosen while a reader is open, the visitor leaves in place of the update
 * and the app goes back to the shelf (or says the save could not be written). Where "start over"
 * was chosen while a reader is open, its question is put over the screen on show, which is neither
 * updated nor drawn while it is up: A starts the world over (`player_start_over`) and goes to the
 * nickname screen for a fresh arrival, B goes back to the screen as it was. Chosen elsewhere,
 * either item does nothing.
 */
void player_app_frame(player_app *app, const player_input *input);

#endif
