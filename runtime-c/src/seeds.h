/*
 * The seed of a tick's or a wake's turn (the spec's Chance > The seed, Time > Determinism). A host
 * draws one seed for a step of time; a tick or a wake takes its own from that, by what the turn is
 * for and never by how many turns came before it, so adding a clock to a world leaves every other
 * object's draws as they were: the first 32 bits of the SHA-256 of `<seed> <path> <nth>`, read as a
 * whole number.
 */
#ifndef SPROUT_SEEDS_H
#define SPROUT_SEEDS_H

#include <stddef.h>
#include <stdint.h>

/* A SHA-256 in progress: the state, the bytes of the block not yet folded in, and the total length. */
typedef struct sprout_sha256_context {
  uint32_t state[8];
  unsigned char block[64];
  size_t held;
  uint64_t length;
} sprout_sha256_context;

/* SHA-256 of a stream: begin, feed the bytes in any chunks, end into `digest`. */
void sprout_sha256_begin(sprout_sha256_context *hash);
void sprout_sha256_feed(sprout_sha256_context *hash, const char *bytes, size_t length);
void sprout_sha256_end(sprout_sha256_context *hash, unsigned char digest[32]);

/* SHA-256 of `length` bytes into `digest`. */
void sprout_sha256(const char *bytes, size_t length, unsigned char digest[32]);

/*
 * The seed of the `nth` turn (from 0) a step runs for the thing at `path`, as a host writes the path
 * in the world's body, under the step's `seed`.
 */
uint32_t sprout_turn_seed(uint64_t seed, const char *path, size_t path_length, uint64_t nth);

#endif
