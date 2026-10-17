/*
 * ui/text_size.c: the text size remembered in the Data folder. With no file the size is S; a size
 * written reads back; a file saying anything else, a letter the app does not offer among it, is S; a write that cannot be made says so and
 * leaves what was remembered; and each size's font is one the pdx ships.
 */
#include <stdlib.h>

#include "support.h"
#include "ui/pen.h"
#include "ui/text_size.h"

static void the_size_round_trips_through_the_data_folder(void) {
  char *text;
  begin("roundtrip");
  CHECK(player_text_size_read(&fake->api) == PLAYER_TEXT_S, "no file is S");
  CHECK(player_text_size_write(&fake->api, PLAYER_TEXT_L), "writing L");
  CHECK(player_text_size_read(&fake->api) == PLAYER_TEXT_L, "L reads back");
  text = file_text(PLAYER_TEXT_SIZE_FILE);
  CHECK(text != NULL && strcmp(text, "L") == 0, "the file is the one letter: %s", text != NULL ? text : "(none)");
  free(text);
  CHECK(player_text_size_write(&fake->api, PLAYER_TEXT_S), "writing S");
  CHECK(player_text_size_read(&fake->api) == PLAYER_TEXT_S, "S reads back");
  end();
}

static void a_file_that_says_anything_else_is_s(void) {
  begin("other");
  write_text(PLAYER_TEXT_SIZE_FILE, "XL");
  CHECK(player_text_size_read(&fake->api) == PLAYER_TEXT_S, "two letters");
  write_text(PLAYER_TEXT_SIZE_FILE, "");
  CHECK(player_text_size_read(&fake->api) == PLAYER_TEXT_S, "nothing");
  write_text(PLAYER_TEXT_SIZE_FILE, "l");
  CHECK(player_text_size_read(&fake->api) == PLAYER_TEXT_S, "the wrong case");
  write_text(PLAYER_TEXT_SIZE_FILE, "M");
  CHECK(player_text_size_read(&fake->api) == PLAYER_TEXT_S, "a letter the app does not offer");
  end();
}

static void a_write_that_cannot_be_made_leaves_the_size_remembered(void) {
  begin("full");
  CHECK(player_text_size_write(&fake->api, PLAYER_TEXT_L), "writing L");
  fake->fail_writes = 1;
  CHECK(!player_text_size_write(&fake->api, PLAYER_TEXT_S), "a full disk");
  fake->fail_writes = 0;
  CHECK(player_text_size_read(&fake->api) == PLAYER_TEXT_L, "L is still remembered");
  end();
}

static void each_size_has_a_font_the_pdx_ships(void) {
  int i;
  begin("shipped");
  CHECK(PLAYER_TEXT_SIZES == 2 && strcmp(PLAYER_TEXT_SIZE_NAMES[PLAYER_TEXT_S], "S") == 0 && strcmp(PLAYER_TEXT_SIZE_NAMES[PLAYER_TEXT_L], "L") == 0,
        "the sizes are S and L");
  for (i = 0; i < PLAYER_TEXT_SIZES; i++)
    CHECK(shipped_font(PLAYER_TEXT_SIZE_FONTS[i]), "%s's font is under Source/fonts: %s", PLAYER_TEXT_SIZE_NAMES[i], PLAYER_TEXT_SIZE_FONTS[i]);
  CHECK(strcmp(PLAYER_TEXT_SIZE_FONTS[PLAYER_TEXT_S], PLAYER_FRAME_FONT) == 0, "S's font is the frame's");
  end();
}

int main(void) {
  test_program("text_size");
  each_size_has_a_font_the_pdx_ships();
  the_size_round_trips_through_the_data_folder();
  a_file_that_says_anything_else_is_s();
  a_write_that_cannot_be_made_leaves_the_size_remembered();
  return finish();
}
