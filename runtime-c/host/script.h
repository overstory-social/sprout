/*
 * Playing a script's steps (steps.h) through the runtime's turn call: the desktop host's half of `sproutc play`.
 * It drives the world as the player drives an engine for the same script (player/src/play.ts): a visitor
 * admitted, and catch-up run first, by `@arrive`; a departure by `@leave`; a tick for each place that holds a
 * visitor by `@tick`; time moved on by `@advance`, each wake delivered live at the instant it falls due while
 * anyone stands in the world, and left for the next arrival's catch-up while nobody does; and each typed line read
 * by the runtime as the command turns it runs (sprout_line_begin), the first under the step's seed and each after
 * it the next. Each step ends with one line of the trace, if there is one: `{"step":N,"says":[...]}`, the lines
 * readers read, each `{"reader","kind","words"}`.
 */
#ifndef SPROUTC_SCRIPT_H
#define SPROUTC_SCRIPT_H

#include <stdio.h>

#include "host.h"
#include "steps.h"

/*
 * How a play is held to the view: with `offered`, the view is polled before each command turn and the
 * reading the runtime reads that turn as must be among what it offers, a set role one member at a time, as
 * the chip tree builds it; `poll_steps`, where set, is the poll's budget in place of the host's default.
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
int sproutc_play_script(sproutc_host *host, sprout_world *world, sprout_state *state, const sproutc_steps *steps,
                        const sproutc_play_options *options, FILE *out, FILE *err, FILE *trace);

#endif
