/* The text size; see text_size.h. */
#include "text_size.h"

#include "host/files.h"

const char *const PLAYER_TEXT_SIZE_NAMES[PLAYER_TEXT_SIZES] = {"S", "M", "L"};
const char *const PLAYER_TEXT_SIZE_FONTS[PLAYER_TEXT_SIZES] = {"fonts/Newsleak-Serif-Bold.pft", "fonts/Roobert-11-Mono-Condensed.pft",
                                                               "fonts/Roobert-11-Medium.pft"};

player_text_size player_text_size_read(PlaydateAPI *pd) {
  size_t length = 0;
  char *letter = player_read_file(pd, PLAYER_TEXT_SIZE_FILE, &length);
  player_text_size size = PLAYER_TEXT_S;
  int i;
  if (letter == NULL) return size;
  for (i = 0; i < PLAYER_TEXT_SIZES; i++)
    if (length == 1 && letter[0] == PLAYER_TEXT_SIZE_NAMES[i][0]) size = (player_text_size)i;
  player_free(pd, letter);
  return size;
}

bool player_text_size_write(PlaydateAPI *pd, player_text_size size) {
  return player_write_file(pd, PLAYER_TEXT_SIZE_FILE, PLAYER_TEXT_SIZE_NAMES[size], 1);
}
