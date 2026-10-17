/*
 * A screen of the C app: functions over the screen's own context. Each frame the app
 * (app.h) calls `update` with the buttons and the crank, clears the frame and calls `draw`;
 * `leave` runs once, when the app moves to another screen or ends, and frees the context;
 * `refit` runs when the pen's font has changed, before the frame's update, and wraps again
 * whatever the screen keeps wrapped, losing nothing of it. A screen that lays out every line
 * afresh each frame has no `refit`.
 */
#ifndef PLAYER_UI_SCREEN_H
#define PLAYER_UI_SCREEN_H

#include "pd_api.h"

typedef struct player_app player_app;

/* What the person did since the last frame. */
typedef struct player_input {
  PDButtons held;   /* the buttons down now */
  PDButtons pushed; /* the buttons pressed since the last frame */
  float crank;      /* degrees the crank turned since the last frame; 0 while it is docked */
} player_input;

typedef struct player_screen {
  void (*update)(player_app *app, void *ctx, const player_input *input);
  void (*draw)(player_app *app, void *ctx);
  void (*leave)(player_app *app, void *ctx);
  void (*refit)(player_app *app, void *ctx); /* NULL where nothing is kept wrapped */
} player_screen;

#endif
