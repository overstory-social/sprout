/*
 * Whole files over the Playdate's filesystem. Reading looks in the Data folder first and then
 * the app (a cartridge is in either); writing always goes to `/Data/<bundleID>/`. A write is
 * made whole or not at all: the bytes go to `<path>.tmp` first and replace the file only once
 * written, and a read finds a `.tmp` left by a write that was cut short before the swap.
 */
#ifndef PLAYER_FILES_H
#define PLAYER_FILES_H

#include <stdbool.h>
#include <stddef.h>

#include "pd_api.h"

/*
 * The bytes of the file at `path`, in a block from the device's allocator with a NUL after them,
 * released with `player_free`; NULL when it cannot be read.
 */
char *player_read_file(PlaydateAPI *pd, const char *path, size_t *length);

/* Writes `bytes` as the file at `path`, whole; false when it could not be. */
bool player_write_file(PlaydateAPI *pd, const char *path, const char *bytes, size_t length);

/* A block from the device's allocator. */
void *player_alloc(PlaydateAPI *pd, size_t bytes);
void player_free(PlaydateAPI *pd, void *block);

#endif
