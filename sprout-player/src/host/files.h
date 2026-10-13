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

/*
 * The SHA-256 of the file at `path` and its size, read a chunk at a time so that the file is never
 * held in memory; false when it cannot be read. Looks where `player_read_file` looks.
 */
bool player_hash_file(PlaydateAPI *pd, const char *path, unsigned char digest[32], size_t *length);

/* Writes `bytes` as the file at `path`, whole; false when it could not be. */
bool player_write_file(PlaydateAPI *pd, const char *path, const char *bytes, size_t length);

/*
 * Calls `found(name, ctx)` for each entry of the folder at `path`, in the app and its Data folder
 * both, a folder's name ending in `/`; false when the folder cannot be listed.
 */
bool player_list_files(PlaydateAPI *pd, const char *path, void (*found)(const char *name, void *ctx), void *ctx);

/*
 * A file written a piece at a time, for what arrives over the network: `player_file_create` makes
 * the folders `path` is in and opens it in the Data folder from its start, or gives NULL;
 * `player_file_append` is false when not every byte was written, and `player_file_close` false
 * when the file did not close cleanly. Nothing here is whole until the caller moves it into place.
 */
SDFile *player_file_create(PlaydateAPI *pd, const char *path);
bool player_file_append(PlaydateAPI *pd, SDFile *file, const void *bytes, size_t length);
bool player_file_close(PlaydateAPI *pd, SDFile *file);

/* Moves the file at `from` to `to` in the Data folder, replacing what was there; false when it could not. */
bool player_file_move(PlaydateAPI *pd, const char *from, const char *to);

/* Removes the file at `path` in the Data folder, or the folder and everything in it. */
void player_file_remove(PlaydateAPI *pd, const char *path);

/* Whether there is a file at `path`, where `player_read_file` looks. */
bool player_file_exists(PlaydateAPI *pd, const char *path);

/* The image at `path` (a compiled image is named without its `.pdi`), loaded on the main stack; NULL where it cannot be. */
LCDBitmap *player_load_bitmap(PlaydateAPI *pd, const char *path);

/* A block from the device's allocator. */
void *player_alloc(PlaydateAPI *pd, size_t bytes);
void player_free(PlaydateAPI *pd, void *block);

#endif
