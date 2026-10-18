/*
 * A cartridge's assets section (the Playdate design's The cartridge): after
 * the compressed body, where the header (load.h) says, every file the world's
 * extensions name, each gzip-compressed on its own behind a directory, so a
 * host that draws reads one file when it shows it and never the body or the
 * others. Little-endian: the count of files and the directory's size as
 * 32-bit numbers, then for each file where it begins (from the section's
 * start) and its compressed size as 32-bit numbers, its path's length as a
 * 16-bit number and the path. Nothing here reads a file: the host reads the
 * section's prefix, then its directory, and hands each over.
 */
#ifndef SPROUT_ASSETS_H
#define SPROUT_ASSETS_H

#include <stdbool.h>
#include <stddef.h>

/* The bytes of the section before its directory: the count of files and the directory's size. */
#define SPROUT_ASSETS_PREFIX_BYTES 8u

/*
 * What a section of `section_bytes` says in its prefix: how many files, and
 * how many bytes of directory follow the prefix; false where the directory
 * does not fit in the section.
 */
bool sprout_assets_prefix(const unsigned char *prefix, size_t section_bytes, size_t *count, size_t *directory_bytes);

/*
 * Where the file at `path` lies, from the section's start, and how many bytes
 * it is compressed, by the `count` entries of `directory`; false where the
 * directory names no such file, or an entry before it does not fit the
 * directory or its file the section.
 */
bool sprout_assets_find(const unsigned char *directory, size_t directory_bytes, size_t count, size_t section_bytes,
                        const char *path, size_t path_length, size_t *at, size_t *bytes);

#endif
