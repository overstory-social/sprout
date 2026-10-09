/*
 * A turn's draws (the spec's Chance > The seed): mulberry32 over a 32-bit
 * state begun as the seed, and a draw below n by rejection so every result
 * is equally likely.
 */
#ifndef SPROUT_DRAWS_H
#define SPROUT_DRAWS_H

#include "sprout.h"

typedef struct sprout_draws {
  uint32_t state;
  uint64_t made; /* how many draws below n have been made */
} sprout_draws;

/* Begins a stream; SPROUT_BAD_SEED for a seed past 2^32 - 1. */
sprout_status sprout_draws_begin(sprout_draws *draws, uint64_t seed);

/* The next 32 bits of the stream. */
uint32_t sprout_draws_next(sprout_draws *draws);

/* A draw below n, which must be from 1 to 2^32; false for any other n (the checker refuses it). */
bool sprout_draws_below(sprout_draws *draws, uint64_t n, uint32_t *result);

#endif
