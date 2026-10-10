/*
 * Playing a script's readings through the runtime's turn call (see readings.h): the desktop host's half of
 * `sproutc play`, and the C side of the differential replay. It drives the world as the player drives the
 * TypeScript runtime for the same script, so the two are compared like with like: a visitor admitted, and
 * catch-up run first, by `@arrive`; a departure by `@leave`; a tick for each place that holds a visitor by
 * `@tick`; time moved on by `@advance`, each wake delivered live at the instant it falls due while anyone
 * stands in the world, and left for the next arrival's catch-up while nobody does; and each typed line's
 * turns, the reading the TypeScript parser made of each, run as command turns.
 *
 * A turn the parser answered rather than read is not the runtime's to run: its lines and its entry are
 * echoed as the readings file holds them. Each step ends with one line of the trace, if there is one:
 * `{"step":N,"says":[...],"turns":[...],"world":{...}}`, the lines readers read, the log's entry for each
 * turn that ran, and the stored world as the store would hold it.
 */
#ifndef SPROUTC_SCRIPT_H
#define SPROUTC_SCRIPT_H

#include <stdio.h>

#include "host.h"
#include "readings.h"

/* Plays every step; 0 when each ran, or an exit code for the first that could not. */
int sproutc_play_script(sproutc_host *host, sprout_world *world, sprout_state *state, sproutc_readings *readings,
                        FILE *out, FILE *err, FILE *trace);

#endif
