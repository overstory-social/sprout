/*
 * The desktop host: the sprout_host record over malloc, a fake clock a
 * script advances, a seed a script sets, one file of stored bytes, and an
 * emit that prints. It fills every budget with the spec's defaults (Limits >
 * Runtime budgets), as a host adapter does; the runtime holds none.
 *
 * The clock is a counter, never the machine's: `now` is the milliseconds
 * elapsed since sproutc_host_begin_turn, and each read of it moves the
 * counter on by `step_ms`, so a frozen clock (0) and a ticking one are both
 * deterministic. `seconds` is the script's own time, which a turn's
 * `elapsed` is made from (Time > Determinism); it moves only when the
 * script says.
 */
#ifndef SPROUTC_HOST_H
#define SPROUTC_HOST_H

#include <stdint.h>
#include <stdio.h>

#include "sprout.h"

typedef struct sproutc_host {
  sprout_host record; /* what the runtime is handed; record.ctx points back here */
  FILE *out;          /* where emit prints */
  const char *state;  /* the stored world's file, or NULL for storage that holds nothing */
  uint64_t step_ms;   /* how far each read of now moves the clock */
  uint64_t clock_ms;  /* the counter */
  uint64_t turn_started_ms;
  uint64_t turn_seed;
  uint64_t seconds;   /* the script's time, in seconds from the start of the play */
  char *held;         /* the bytes last read, valid until the next read */
  long pages;         /* pages out, so a leak shows */
} sproutc_host;

/* Fills a host: default budgets, a frozen clock, seed 0, and `out` for emitted lines. */
void sproutc_host_init(sproutc_host *host, FILE *out, const char *state);

/* Releases what the host holds. */
void sproutc_host_close(sproutc_host *host);

/* The script says what time it is, in seconds, and what the next turn is drawn under. */
void sproutc_host_set_time(sproutc_host *host, uint64_t seconds);
void sproutc_host_set_seed(sproutc_host *host, uint64_t seed);

/* A turn begins: `now` counts from here. */
void sproutc_host_begin_turn(sproutc_host *host);

#endif
