/*
 * ui/pen.c: the frame's font and the body's. The pen holds the frame's font from the start and the
 * body's of the size chosen, and reports each one's height; a font file is loaded once however
 * many uses hold it, so S, whose font is the frame's, holds one file and M two; a size whose font
 * cannot be read leaves the pen as it was; a font held for the disc stays held through a change of
 * size; a body line is measured and drawn in the body and a frame line in the frame; and freeing
 * the pen lets every font go. The frame's font and the disc's are files the pdx ships.
 */
#include "support.h"
#include "ui/wheel.h"
#include "ui/pen.h"

static void the_frame_is_held_from_the_start_and_the_body_follows_the_size(void) {
  player_pen pen;
  const char *why = NULL;
  begin("faces");
  CHECK(player_pen_init(&pen, &fake->api, PLAYER_TEXT_S, &why), "%s", why);
  CHECK(fake_fonts_held(fake) == 1 && pen.body == pen.frame, "S is the frame's font: one file held");
  CHECK(pen.frame_height == FAKE_SERIF_LINE && pen.line_height == FAKE_SERIF_LINE, "both heights the serif's: %d, %d", pen.frame_height,
        pen.line_height);
  CHECK(player_pen_resize(&pen, PLAYER_TEXT_M, &why), "%s", why);
  CHECK(fake_fonts_held(fake) == 2 && pen.body != pen.frame && pen.size == PLAYER_TEXT_M, "M beside the frame: two files held");
  CHECK(pen.line_height == FAKE_MONO_LINE && pen.frame_height == FAKE_SERIF_LINE, "the body's height is M's, the frame's unchanged: %d, %d",
        pen.line_height, pen.frame_height);
  CHECK(player_pen_resize(&pen, PLAYER_TEXT_L, &why), "%s", why);
  CHECK(fake_fonts_held(fake) == 2 && pen.line_height == FAKE_SANS_LINE, "L in M's place: %d", pen.line_height);
  CHECK(player_pen_resize(&pen, PLAYER_TEXT_S, &why), "%s", why);
  CHECK(fake_fonts_held(fake) == 1 && pen.body == pen.frame && pen.line_height == FAKE_SERIF_LINE, "back to S, L let go");
  player_pen_free(&pen);
  CHECK(fake_fonts_held(fake) == 0 && pen.body == NULL && pen.frame == NULL && pen.line_height == 0 && pen.frame_height == 0,
        "freed, the pen holds nothing");
  end();
}

static void a_font_that_cannot_be_read_leaves_the_pen_as_it_was(void) {
  player_pen pen;
  const char *why = NULL;
  begin("missing");
  snprintf(fake->missing_font, sizeof fake->missing_font, "%s", PLAYER_TEXT_SIZE_FONTS[PLAYER_TEXT_L]);
  CHECK(player_pen_init(&pen, &fake->api, PLAYER_TEXT_M, &why), "%s", why);
  CHECK(!player_pen_resize(&pen, PLAYER_TEXT_L, &why) && why != NULL && HAS(why, "no such font"), "L cannot be read: %s", why);
  CHECK(pen.size == PLAYER_TEXT_M && pen.line_height == FAKE_MONO_LINE && fake_fonts_held(fake) == 2, "the pen stays at M");
  player_pen_free(&pen);
  CHECK(!player_pen_init(&pen, &fake->api, PLAYER_TEXT_L, &why) && fake_fonts_held(fake) == 0, "a pen cannot begin at L: %s", why);
  snprintf(fake->missing_font, sizeof fake->missing_font, "%s", PLAYER_FRAME_FONT);
  CHECK(!player_pen_init(&pen, &fake->api, PLAYER_TEXT_M, &why) && fake_fonts_held(fake) == 0, "nor without the frame's font: %s", why);
  end();
}

static void a_font_held_for_the_disc_is_the_one_file_and_outlives_a_change_of_size(void) {
  player_pen pen;
  LCDFont *disc;
  const char *why = NULL;
  begin("hold");
  CHECK(player_pen_init(&pen, &fake->api, PLAYER_TEXT_L, &why), "%s", why);
  disc = player_pen_hold(&pen, WHEEL_FONT, &why);
  CHECK(disc != NULL && disc == pen.body && fake_fonts_held(fake) == 2, "the disc's font is L's: the file loaded once");
  CHECK(player_pen_resize(&pen, PLAYER_TEXT_S, &why), "%s", why);
  CHECK(fake_fonts_held(fake) == 2 && fake->api.graphics->getFontHeight(disc) == FAKE_SANS_LINE, "S lets go of L's use; the disc's keeps the file");
  CHECK(player_pen_resize(&pen, PLAYER_TEXT_M, &why) && fake_fonts_held(fake) == 3, "the frame's, M's and the disc's: three files");
  player_pen_free(&pen);
  CHECK(fake_fonts_held(fake) == 0, "freed, every font is let go");
  end();
}

static void a_body_line_is_measured_and_drawn_in_the_body_and_a_frame_line_in_the_frame(void) {
  player_pen pen;
  const char *why = NULL;
  const fake_run *run;
  begin("draw");
  CHECK(player_pen_init(&pen, &fake->api, PLAYER_TEXT_M, &why), "%s", why);
  CHECK(player_pen_width(&pen, "ab\xc3\xa9", 4) == 3 * FAKE_MONO_GLYPH, "three characters wide in M");
  CHECK(player_pen_frame_width(&pen, "ab\xc3\xa9", 4) == 3 * FAKE_SERIF_GLYPH, "and in the frame");
  player_pen_say(&pen, "body", 10, 20);
  player_pen_frame_say(&pen, "frame", 30, 40);
  player_pen_text(&pen, "part of it", 4, 50, 60);
  run = fake_run_at(fake, 10, 20);
  CHECK(run != NULL && run->font == FAKE_FONT_MONO && strcmp(run->text, "body") == 0, "a body line in M");
  run = fake_run_at(fake, 30, 40);
  CHECK(run != NULL && run->font == FAKE_FONT_SERIF && strcmp(run->text, "frame") == 0, "a frame line in the serif");
  run = fake_run_at(fake, 50, 60);
  CHECK(run != NULL && run->font == FAKE_FONT_MONO && strcmp(run->text, "part") == 0, "the bytes given, in M: %s", run != NULL ? run->text : "");
  player_pen_free(&pen);
  end();
}

static void the_frames_font_and_the_discs_are_shipped(void) {
  begin("shipped");
  CHECK(shipped_font(PLAYER_FRAME_FONT), "the frame's: %s", PLAYER_FRAME_FONT);
  CHECK(shipped_font(WHEEL_FONT), "the disc's: %s", WHEEL_FONT);
  end();
}

int main(void) {
  test_program("pen");
  the_frames_font_and_the_discs_are_shipped();
  the_frame_is_held_from_the_start_and_the_body_follows_the_size();
  a_font_that_cannot_be_read_leaves_the_pen_as_it_was();
  a_font_held_for_the_disc_is_the_one_file_and_outlives_a_change_of_size();
  a_body_line_is_measured_and_drawn_in_the_body_and_a_frame_line_in_the_frame();
  return finish();
}
