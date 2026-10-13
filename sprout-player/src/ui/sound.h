/*
 * The app's sounds: each cue one short note, as Source/sound.lua plays them. Every screen plays
 * its cues through `player_sound`, which plays nothing until the sounds come with #634.
 */
#ifndef PLAYER_UI_SOUND_H
#define PLAYER_UI_SOUND_H

#include "app.h"

typedef enum player_cue {
  PLAYER_CUE_TICK,    /* a slat of the wheel passing the window */
  PLAYER_CUE_CLACK,   /* the drum settling on a slat */
  PLAYER_CUE_PICK,    /* a word or a world picked */
  PLAYER_CUE_BACK,    /* a step back */
  PLAYER_CUE_REFUSED, /* something that cannot be done */
} player_cue;

/* Plays `cue`. */
void player_sound(player_app *app, player_cue cue);

#endif
