/* The app's sounds; see sound.h. */
#include "sound.h"

#include <string.h>

const player_cue_note player_cue_notes[PLAYER_CUE_COUNT] = {
    [PLAYER_CUE_TICK] = {kWaveformNoise, 3000.0f, 0.2f, 0.015f, 0.0f, 0.015f, 0.0f, 0.01f},
    [PLAYER_CUE_CLACK] = {kWaveformSquare, 160.0f, 0.35f, 0.03f, 0.0f, 0.03f, 0.0f, 0.02f},
    [PLAYER_CUE_PICK] = {kWaveformTriangle, 660.0f, 0.4f, 0.07f, 0.0f, 0.05f, 0.3f, 0.05f},
    [PLAYER_CUE_BACK] = {kWaveformTriangle, 392.0f, 0.4f, 0.07f, 0.0f, 0.05f, 0.3f, 0.05f},
    [PLAYER_CUE_REFUSED] = {kWaveformSawtooth, 110.0f, 0.35f, 0.15f, 0.0f, 0.1f, 0.4f, 0.05f},
};

void player_sound_init(player_sound *sound, PlaydateAPI *pd) {
  const struct playdate_sound_synth *synth = pd->sound != NULL ? pd->sound->synth : NULL;
  int i;
  memset(sound, 0, sizeof *sound);
  sound->pd = pd;
  if (synth == NULL) return;
  for (i = 0; i < PLAYER_CUE_COUNT; i++) {
    const player_cue_note *note = &player_cue_notes[i];
    PDSynth *made = synth->newSynth();
    if (made == NULL) continue;
    synth->setWaveform(made, note->wave);
    synth->setAttackTime(made, note->attack);
    synth->setDecayTime(made, note->decay);
    synth->setSustainLevel(made, note->sustain);
    synth->setReleaseTime(made, note->release);
    sound->synths[i] = made;
  }
}

void player_sound_free(player_sound *sound) {
  int i;
  for (i = 0; i < PLAYER_CUE_COUNT; i++) {
    if (sound->synths[i] != NULL) sound->pd->sound->synth->freeSynth(sound->synths[i]);
    sound->synths[i] = NULL;
  }
}

bool player_sound_play(const player_sound *sound, player_cue_name name) {
  const player_cue_note *note;
  if ((unsigned)name >= (unsigned)PLAYER_CUE_COUNT || sound->synths[name] == NULL) return false;
  note = &player_cue_notes[name];
  sound->pd->sound->synth->playNote(sound->synths[name], note->pitch, note->volume, note->length, 0);
  return true;
}
