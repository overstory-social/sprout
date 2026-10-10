/*
 * The Playdate's side of the host contract (the spec's The host contract; Limits > Runtime
 * budgets): the sprout_host record over the device's allocator, its clock, a seed drawn from
 * that clock at the start of each step, and every budget filled from the figures this app ships
 * (see budgets.h). The runtime holds no figure of its own, so a row left unset here would be
 * unbounded on a device with 16 MB.
 *
 * Time is host seconds: the device's seconds, clamped so they never go below the greatest the
 * host has seen or the save recorded, which keeps a turn's `elapsed` from being negative when
 * the clock is set back.
 */
#ifndef PLAYER_PD_HOST_H
#define PLAYER_PD_HOST_H

#include "pd_api.h"
#include "sprout.h"

typedef struct player_host {
  PlaydateAPI *pd;
  sprout_host record; /* what the runtime is handed; record.ctx points back here */
  uint64_t last_seconds;     /* the greatest host seconds seen, the save's included */
  uint64_t step_seed;        /* the seed drawn for the step now running */
  uint64_t drawn;            /* how many step seeds have been drawn, so two in one millisecond differ */
  unsigned turn_started_ms;  /* the device's millisecond counter when the turn began */
  long pages;                /* pages out, so a leak shows */
} player_host;

/* A host over `pd` with the app's budgets and no time seen yet. */
void player_host_init(player_host *host, PlaydateAPI *pd);

/* `seconds`, or `last` where that is greater: time never runs back. */
uint64_t player_clamp(uint64_t seconds, uint64_t last);

/* The device's seconds since 2000-01-01, clamped against the greatest seen, which it then becomes. */
uint64_t player_host_seconds(player_host *host);

/* A step begins: draws its seed from the clock and starts the turn's elapsed-time counter. */
void player_host_begin_step(player_host *host);

#endif
