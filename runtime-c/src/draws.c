/*
 * The generator exactly as the spec's Chance > The seed writes it: all
 * arithmetic on 32 bits, as JavaScript's Math.imul, >>> and ^ take them.
 */
#include "draws.h"

#define RANGE ((uint64_t)1 << 32)

sprout_status sprout_draws_begin(sprout_draws *draws, uint64_t seed) {
  draws->state = 0;
  draws->made = 0;
  if (seed >= RANGE) return SPROUT_BAD_SEED;
  draws->state = (uint32_t)seed;
  return SPROUT_OK;
}

uint32_t sprout_draws_next(sprout_draws *draws) {
  uint32_t t;
  draws->state += 0x6D2B79F5u;
  t = draws->state;
  t = (t ^ (t >> 15)) * (t | 1u);
  t ^= t + (t ^ (t >> 7)) * (t | 61u);
  return t ^ (t >> 14);
}

bool sprout_draws_below(sprout_draws *draws, uint64_t n, uint32_t *result) {
  uint64_t limit;
  if (n < 1 || n > RANGE) return false;
  draws->made++;
  limit = RANGE - (RANGE % n);
  for (;;) {
    uint32_t value = sprout_draws_next(draws);
    if (value < limit) {
      *result = (uint32_t)(value % n);
      return true;
    }
  }
}
