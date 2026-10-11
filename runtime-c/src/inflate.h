/*
 * Gzip (RFC 1952) over deflate (RFC 1951), inflate only: a cartridge's body is
 * gzip-compressed JSON (the spec's The compiler > What compiling produces).
 * Reads stored, fixed and dynamic blocks, checks the trailer's CRC-32 and
 * length, and says in words what was wrong with a stream it refuses. The
 * decoder is resumable: it gives its output a buffer at a time, keeping the
 * last 32 KB in a window of its own, so a body is never whole in memory
 * unless the caller wants it so.
 */
#ifndef SPROUT_INFLATE_H
#define SPROUT_INFLATE_H

#include "arena.h"

/* How far back a deflate stream may refer: the window the decoder keeps. */
#define SPROUT_INFLATE_WINDOW 32768u

typedef struct sprout_huffman {
  unsigned short count[16];
  unsigned short symbol[288];
} sprout_huffman;

/* An inflate in progress over a gzip member held whole in memory. The fields are the decoder's own. */
typedef struct sprout_inflater {
  const unsigned char *in;
  size_t in_length, in_at;
  unsigned long bit_buffer;
  int bit_count;
  int state;
  bool last;
  size_t stored_left;
  size_t copy_left, copy_distance;
  sprout_huffman lit, dist;
  unsigned char window[SPROUT_INFLATE_WINDOW];
  size_t total;
  uint32_t crc, crc_said, size_said;
  uint32_t crc_table[256];
  const char *why;
} sprout_inflater;

/*
 * Begins reading the gzip member `bytes` holds: SPROUT_BAD_INPUT with `why`
 * set to a sentence for a header or trailer that is not gzip's.
 */
sprout_status sprout_inflate_begin(sprout_inflater *s, const unsigned char *bytes, size_t length,
                                   const char **why);

/*
 * The next bytes of the member, up to `cap` of them, into `out`; `*got` is how
 * many, and 0 once the member has ended and its trailer been checked.
 * SPROUT_BAD_INPUT with `why` set for a damaged stream.
 */
sprout_status sprout_inflate_next(sprout_inflater *s, unsigned char *out, size_t cap, size_t *got,
                                  const char **why);

/* Whether the member has ended and its trailer been checked. */
bool sprout_inflate_done(const sprout_inflater *s);

/*
 * The bytes a gzip member holds, whole, in the arena, with a NUL after them.
 * Returns SPROUT_BAD_INPUT with `why` set to a sentence for a damaged stream,
 * SPROUT_NO_MEMORY when the host refuses a page.
 */
sprout_status sprout_gunzip(sprout_arena *arena, const unsigned char *bytes, size_t length,
                            char **out, size_t *out_length, const char **why);

/* The CRC-32 (the gzip polynomial) of bytes, continuing from `crc` (0 to begin). */
uint32_t sprout_crc32(uint32_t crc, const unsigned char *bytes, size_t length);

#endif
