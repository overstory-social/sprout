/*
 * The text size: S, M or L, the display font each one is, and the size remembered between
 * launches. S is the smallest, the system's own Asheville Sans 14 Light; M and L are two of its
 * larger fonts, loaded by path from `/System/Fonts/` as S is. The choice is kept in the Data
 * folder, beside the saves, as the one letter in `text-size.txt`; no file, or one that says
 * anything else, is S.
 */
#ifndef PLAYER_UI_TEXT_SIZE_H
#define PLAYER_UI_TEXT_SIZE_H

#include <stdbool.h>

#include "pd_api.h"

typedef enum player_text_size { PLAYER_TEXT_S, PLAYER_TEXT_M, PLAYER_TEXT_L } player_text_size;

#define PLAYER_TEXT_SIZES 3
#define PLAYER_TEXT_SIZE_FILE "text-size.txt"

/* The sizes' names, the system menu's options, and the font each one loads. */
extern const char *const PLAYER_TEXT_SIZE_NAMES[PLAYER_TEXT_SIZES];
extern const char *const PLAYER_TEXT_SIZE_FONTS[PLAYER_TEXT_SIZES];

/* The size remembered, S where none is. */
player_text_size player_text_size_read(PlaydateAPI *pd);

/* Remembers `size`; false when the file could not be written. */
bool player_text_size_write(PlaydateAPI *pd, player_text_size size);

#endif
