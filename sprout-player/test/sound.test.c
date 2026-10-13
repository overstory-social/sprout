/*
 * The app's sounds (ui/sound.c) and the builder's cues through them, over the fake's synths. The
 * rules: each cue is a synth of its own, set to Source/sound.lua's waveform and envelope, and a
 * cue played is one note of its pitch, volume and length, now; with no sound API every cue is
 * silent; a world picked on the shelf picks; and the builder's drum ticks as a slat passes and clacks as it settles, and a pick and a
 * step back each sound their cue, one note each.
 */
#include <stdlib.h>

#include "support.h"
#include "ui/app.h"
#include "ui/reader.h"
#include "ui/sound.h"

static const fake_note *last_note(void) { return fake->note_count > 0 ? &fake->notes[fake->note_count - 1] : NULL; }

static bool sounded(SoundWaveform wave, float pitch) {
  const fake_note *note = last_note();
  return note != NULL && note->wave == wave && note->pitch == pitch;
}

static void each_cue_is_a_note_on_its_own_synth(void) {
  player_sound sound;
  const fake_synth *tick, *refused;
  const fake_note *note;
  begin("cues");
  player_sound_init(&sound, &fake->api);
  CHECK(fake->synth_count == PLAYER_CUE_COUNT, "a synth for each cue: %d", fake->synth_count);
  tick = (const fake_synth *)sound.synths[PLAYER_CUE_TICK];
  refused = (const fake_synth *)sound.synths[PLAYER_CUE_REFUSED];
  CHECK(tick->wave == kWaveformNoise && tick->attack == 0.0f && tick->decay == 0.015f && tick->sustain == 0.0f &&
            tick->release == 0.01f,
        "the tick is a short burst of noise");
  CHECK(refused->wave == kWaveformSawtooth && refused->decay == 0.1f && refused->sustain == 0.4f, "the refusal a sawtooth");
  CHECK(player_sound_play(&sound, PLAYER_CUE_CLACK), "the clack plays");
  note = last_note();
  CHECK(fake->note_count == 1 && note->wave == kWaveformSquare && note->pitch == 160.0f && note->volume == 0.35f &&
            note->length == 0.03f,
        "one low square note, short");
  CHECK(player_sound_play(&sound, PLAYER_CUE_PICK) && sounded(kWaveformTriangle, 660.0f), "a pick is a triangle at 660");
  CHECK(player_sound_play(&sound, PLAYER_CUE_BACK) && sounded(kWaveformTriangle, 392.0f), "a step back lower");
  CHECK(!player_sound_play(&sound, PLAYER_CUE_COUNT), "no such cue");
  player_sound_free(&sound);
  CHECK(!fake->synths[0].live && !fake->synths[PLAYER_CUE_COUNT - 1].live, "the synths are freed");
  end();
}

static void with_no_sound_every_cue_is_silent(void) {
  player_sound sound;
  begin("silent");
  fake->api.sound = NULL;
  player_sound_init(&sound, &fake->api);
  CHECK(!player_sound_play(&sound, PLAYER_CUE_TICK) && fake->note_count == 0, "nothing plays");
  player_sound_free(&sound);
  end();
}

static void the_shelfs_and_the_builders_cues_sound(void) {
  static const char *const shipped[] = {"chip-tree.sproutworld"};
  const char *why = NULL;
  player_app *app;
  int n;
  begin("builder");
  app_folder("app");
  ship(shipped, 1);
  app = player_app_new(&fake->api, &why);
  CHECK(app != NULL, "%s", why);
  fake->api.system->setUpdateCallback(player_app_update, app);
  fake_frame(fake, 0, 0);
  CHECK(fake->note_count == 0, "the shelf is quiet");
  fake_frame(fake, kButtonA, 0);
  CHECK(fake->note_count == 1 && sounded(kWaveformTriangle, 660.0f), "a world picked on the shelf");
  fake->note_count = 0;
  for (n = 0; n < 10000 && app->screen != &player_reader_screen; n++) fake_frame(fake, 0, 0);
  CHECK(fake->note_count == 0, "arriving is quiet");
  fake_frame(fake, kButtonA, 0);
  CHECK(fake->note_count == 0, "opening the builder is quiet");
  fake_frame(fake, 0, 30.0f);
  CHECK(fake->note_count == 1 && sounded(kWaveformNoise, 3000.0f), "a slat past the window ticks");
  for (n = 0; n < 60 && fake->note_count == 1; n++) fake_frame(fake, 0, 0);
  CHECK(fake->note_count == 2 && sounded(kWaveformSquare, 160.0f), "the drum settles on a slat with a clack");
  fake_frame(fake, kButtonA, 0);
  CHECK(fake->note_count == 3 && sounded(kWaveformTriangle, 660.0f), "a verb picked");
  fake_frame(fake, kButtonB, 0);
  CHECK(fake->note_count == 4 && sounded(kWaveformTriangle, 392.0f), "and a step back");
  player_app_free(app);
  end();
}

int main(void) {
  test_program("sound");
  each_cue_is_a_note_on_its_own_synth();
  with_no_sound_every_cue_is_silent();
  the_shelfs_and_the_builders_cues_sound();
  return finish();
}
