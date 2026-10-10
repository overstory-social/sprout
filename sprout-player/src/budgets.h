/*
 * The figures this app ships for the spec's Limits: one runtime-budgets table, and the static
 * caps a cartridge is checked against when it is shelved. The spec's table figures are the
 * defaults a host starts from; where it gives none (the effects an extension records, the wall clock, the live
 * instances stored) the app chooses for a device with 16 MB
 * of RAM and a 168 MHz core, and those choices are in the working notes' Holes in the spec.
 *
 * A cartridge that records a static cap larger than the app's is refused at shelve time, cap by
 * cap, in the words the TypeScript host uses; a cap the app leaves unset (places, objects, kinds,
 * files and source bytes) is never exceeded.
 */
#ifndef PLAYER_BUDGETS_H
#define PLAYER_BUDGETS_H

#include "sprout.h"

/*
 * The poll's step budget, the one figure the app raises above the spec's default of 10,000: a poll
 * lists every reading a visitor could make, so it grows with the verbs a world declares and the
 * things in range, and the studio's `underground_caverns` spends 344,254 steps in its fullest room
 * (the living room with every treasure in the case). The build plays each graduated world's listed
 * plays under this figure (scripts/playdate-player.mjs), so a world that outgrows it fails the build
 * rather than greying its rooms.
 */
#define PLAYER_POLL_STEPS 500000

/* Fills the rows of `budgets`: every row the spec gives a figure, and the host's own for the rest but people in a place, which the spec leaves unbounded. */
void player_budgets(sprout_budgets *budgets);

/*
 * Whether the world, loaded, was checked against caps no larger than this app's. Fills `words`
 * (when `size` > 0) with a refusal naming each cap that is larger and returns false when it was not.
 */
bool player_caps_fit(const sprout_world *world, char *words, size_t size);

#endif
