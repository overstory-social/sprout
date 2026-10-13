/*
 * A message screen: words that stopped something, wrapped to the screen, until A or B goes back
 * to the shelf. What could not be opened, what the save or the arrival refused, and running out
 * of memory are all told here.
 */
#ifndef PLAYER_UI_MESSAGE_H
#define PLAYER_UI_MESSAGE_H

#include "app.h"

/* The top of the words. */
#define MESSAGE_TOP 40

/* Shows `words` (a copy is kept) in place of the screen on show, once its update is over. */
void player_message_show(player_app *app, const char *words);

extern const player_screen player_message_screen;

#endif
