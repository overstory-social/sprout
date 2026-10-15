/*
 * What the fake's modules share behind fake_playdate.h: the fake the PlaydateAPI's calls act on
 * (the SDK's callbacks take no context, so each call reads `fake_current`, which fake_init and
 * fake_frame set), the screen's drawing and the files' opening for the bitmaps, and each module's
 * install, which puts its functions into the API's tables.
 */
#ifndef FAKE_PLAYDATE_FAKE_H
#define FAKE_PLAYDATE_FAKE_H

#include "fake_playdate.h"

extern fake_playdate *fake_current;

/* The made bitmap drawn into now, or -1 for the screen. */
int fake_context(void);
/* Sets a pixel of the context: on the screen inside the clip rect, or in a made bitmap. */
void fake_set_pixel(int x, int y, int black);
/* Fills a rect of the context with a solid colour. */
void fake_fill(int x, int y, int width, int height, LCDColor color);

/* The file calls, for the bitmaps loaded from files. */
SDFile *fake_open(const char *path, FileOptions mode);
int fake_read(SDFile *file, void *buffer, unsigned length);
int fake_close(SDFile *file);

void fake_install_files(fake_playdate *fake);
void fake_install_screen(fake_playdate *fake);
void fake_install_bitmaps(fake_playdate *fake);
void fake_install_sound(fake_playdate *fake);
void fake_install_network(fake_playdate *fake);

#endif
