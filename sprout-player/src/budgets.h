/*
 * The figures this app ships for the spec's Limits: one runtime-budgets table, and the static
 * caps a cartridge is checked against when it is shelved. The spec's table figures are the
 * defaults a host starts from; where it gives none (people in a place, the effects an extension
 * records, the wall clock, the live instances stored) the app chooses for a device with 16 MB
 * of RAM and a 168 MHz core, and those choices are in the working notes' Holes in the spec.
 *
 * A cartridge that records a static cap larger than the app's is refused at shelve time, cap by
 * cap, in the words the TypeScript host uses; a cap the app leaves unset (places, objects, kinds,
 * files and source bytes) is never exceeded.
 */
#ifndef PLAYER_BUDGETS_H
#define PLAYER_BUDGETS_H

#include "sprout.h"

/* Fills every row of `budgets`; no row is left unset. */
void player_budgets(sprout_budgets *budgets);

/*
 * Whether the world, loaded, was checked against caps no larger than this app's. Fills `words`
 * (when `size` > 0) with a refusal naming each cap that is larger and returns false when it was not.
 */
bool player_caps_fit(const sprout_world *world, char *words, size_t size);

#endif
