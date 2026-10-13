/*
 * The app's sounds: each cue a short note on a synth of the SDK's
 * (`pd->sound->synth`), made once when the app starts and freed when it ends. Every screen sounds
 * its cues through `player_cue`; where the synths could not be made, a cue is silent.
 */
#ifndef PLAYER_UI_SOUND_H
#define PLAYER_UI_SOUND_H

#include <stdbool.h>

#include "pd_api.h"

typedef enum player_cue_name {
  PLAYER_CUE_TICK,    /* a slat of the wheel passing the window, a picture stepped */
  PLAYER_CUE_CLACK,   /* the drum settling on a slat, a picture landing */
  PLAYER_CUE_PICK,    /* a word picked */
  PLAYER_CUE_BACK,    /* a step back */
  PLAYER_CUE_REFUSED, /* a reading that cannot be confirmed */
  PLAYER_CUE_COUNT
} player_cue_name;

/* A cue's note: the synth's waveform, its pitch in hertz, volume, length in seconds and envelope. */
typedef struct player_cue_note {
  SoundWaveform wave;
  float pitch, volume, length;
  float attack, decay, sustain, release;
} player_cue_note;

/* The notes of the cues, by name. */
extern const player_cue_note player_cue_notes[PLAYER_CUE_COUNT];

typedef struct player_sound {
  PlaydateAPI *pd;
  PDSynth *synths[PLAYER_CUE_COUNT]; /* NULL where the synth could not be made */
} player_sound;

/* Makes a synth for each cue; one that cannot be made leaves its cue silent. */
void player_sound_init(player_sound *sound, PlaydateAPI *pd);

/* Frees the synths. */
void player_sound_free(player_sound *sound);

/* Plays the cue `name`; false where it is silent. */
bool player_sound_play(const player_sound *sound, player_cue_name name);

#endif
