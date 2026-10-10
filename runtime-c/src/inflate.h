/*
 * Gzip (RFC 1952) over deflate (RFC 1951), inflate only: a cartridge's body is
 * gzip-compressed JSON (the spec's The compiler > What compiling produces).
 * Reads stored, fixed and dynamic blocks, checks the trailer's CRC-32 and
 * length, and says in words what was wrong with a stream it refuses.
 */
#ifndef SPROUT_INFLATE_H
#define SPROUT_INFLATE_H

#include "arena.h"

/*
 * The bytes a gzip member holds, in the arena, with a NUL after them. Returns
 * SPROUT_BAD_INPUT with `why` set to a sentence for a damaged stream,
 * SPROUT_NO_MEMORY when the host refuses a page.
 */
sprout_status sprout_gunzip(sprout_arena *arena, const unsigned char *bytes, size_t length,
                            char **out, size_t *out_length, const char **why);

/* The CRC-32 (the gzip polynomial) of bytes, continuing from `crc` (0 to begin). */
uint32_t sprout_crc32(uint32_t crc, const unsigned char *bytes, size_t length);

#endif
