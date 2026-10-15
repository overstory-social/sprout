/* The fake's sound: synths that keep what they were set to, and each note played; see fake_playdate.h. */
#include "fake.h"

#include <stdlib.h>
#include <string.h>

static int synth_of(PDSynth *synth) {
  int index = (int)((fake_synth *)synth - fake_current->synths);
  if (index < 0 || index >= fake_current->synth_count || !fake_current->synths[index].live) abort();
  return index;
}

static PDSynth *fake_new_synth(void) {
  fake_synth *synth;
  if (fake_current->synth_count == FAKE_SYNTHS) return NULL;
  synth = &fake_current->synths[fake_current->synth_count++];
  memset(synth, 0, sizeof *synth);
  synth->live = 1;
  return (PDSynth *)synth;
}

static void fake_free_synth(PDSynth *synth) { fake_current->synths[synth_of(synth)].live = 0; }
static void fake_set_waveform(PDSynth *synth, SoundWaveform wave) { fake_current->synths[synth_of(synth)].wave = wave; }
static void fake_set_attack(PDSynth *synth, float time) { fake_current->synths[synth_of(synth)].attack = time; }
static void fake_set_decay(PDSynth *synth, float time) { fake_current->synths[synth_of(synth)].decay = time; }
static void fake_set_sustain(PDSynth *synth, float level) { fake_current->synths[synth_of(synth)].sustain = level; }
static void fake_set_release(PDSynth *synth, float time) { fake_current->synths[synth_of(synth)].release = time; }

static void fake_play_note(PDSynth *synth, float pitch, float volume, float length, uint32_t when) {
  int index = synth_of(synth);
  fake_note *note;
  if (when != 0) abort(); /* a cue sounds now */
  if (fake_current->note_count == FAKE_NOTES) return;
  note = &fake_current->notes[fake_current->note_count++];
  note->synth = index;
  note->wave = fake_current->synths[index].wave;
  note->pitch = pitch;
  note->volume = volume;
  note->length = length;
}

void fake_install_sound(fake_playdate *fake) {
  fake->synth.newSynth = fake_new_synth;
  fake->synth.freeSynth = fake_free_synth;
  fake->synth.setWaveform = fake_set_waveform;
  fake->synth.setAttackTime = fake_set_attack;
  fake->synth.setDecayTime = fake_set_decay;
  fake->synth.setSustainLevel = fake_set_sustain;
  fake->synth.setReleaseTime = fake_set_release;
  fake->synth.playNote = fake_play_note;
  fake->sound.synth = &fake->synth;
}
