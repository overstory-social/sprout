/*
 * Playing a script's readings through the runtime's turn call (see readings.h): the desktop host's half of
 * `sproutc play`, and the C side of the differential replay. It drives the world as the player drives the
 * TypeScript runtime for the same script, so the two are compared like with like: a visitor admitted, and
 * catch-up run first, by `@arrive`; a departure by `@leave`; a tick for each place that holds a visitor by
 * `@tick`; time moved on by `@advance`, each wake delivered live at the instant it falls due while anyone
 * stands in the world, and left for the next arrival's catch-up while nobody does; and each typed line read by
 * the runtime as the command turns it runs (sprout_line_begin), the first under the step's seed and each after
 * it the next. Each step ends with one line of the trace, if there is one:
 * `{"step":N,"says":[...],"turns":[...],"world":{...}}`, the lines readers read, the log's entry for each
 * turn that ran, and the stored world as the store would hold it.
 */
#ifndef SPROUTC_SCRIPT_H
#define SPROUTC_SCRIPT_H

#include <stdio.h>

#include "host.h"
#include "readings.h"

/*
 * How a play is held to the view: with `offered`, the view is polled before each command turn and the
 * reading the TypeScript runtime ran on that turn must be among what it offers, a set role one member at
 * a time, as the chip tree builds it; `poll_steps`, where set, is the poll's budget, over any the readings file names.
 */
typedef struct sproutc_play_options {
  bool offered;
  bool has_poll_steps;
  uint64_t poll_steps;
  FILE *profile; /* where each step's bytes are written, one JSON line a step, or NULL */
} sproutc_play_options;

/*
 * Plays every step; 0 when each ran, or an exit code for the first that could not. With `offered`
 * the last line of `out` says how many readings were checked and the widest poll's steps.
 */
int sproutc_play_script(sproutc_host *host, sprout_world *world, sprout_state *state, sproutc_readings *readings,
                        const sproutc_play_options *options, FILE *out, FILE *err, FILE *trace);

#endif
