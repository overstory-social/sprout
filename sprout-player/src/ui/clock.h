/*
 * The reader's clock, Source/clock.lua in C: when the reader asks the session for a tick (the
 * spec's The host contract › Time: the host chooses the interval and supplies `elapsed`
 * truthfully). A tick is owed only while a world is being read and the device is awake: the
 * reader's opening starts the count and its closing stops it, the device locking or going to
 * low-power sleep stops it, and unlocking starts it afresh, so the shelf and the time away never
 * owe a tick. The device's seconds are clamped so the schedule never reads a clock that went
 * back; the session clamps the turn's own time the same way (host/pd_host.h).
 */
#ifndef PLAYER_UI_CLOCK_H
#define PLAYER_UI_CLOCK_H

#include <stdbool.h>
#include <stdint.h>

/* Seconds between ticks while a world is being read, as the Lua app asks for them. */
#define PLAYER_TICK_SECONDS 10u

typedef struct player_clock {
  uint64_t last;   /* the greatest device seconds seen */
  uint64_t ticked; /* when the count last began */
  bool reading;    /* a world is being read */
  bool awake;      /* the device is neither locked nor asleep */
} player_clock;

/* A clock with no world being read, on a device that is awake. */
void player_clock_init(player_clock *clock);

/* The device's `seconds`, clamped against the greatest seen, which they then become. */
uint64_t player_clock_read(player_clock *clock, uint64_t seconds);

/* A world is being read from `seconds` on, or no longer is. */
void player_clock_start(player_clock *clock, uint64_t seconds);
void player_clock_stop(player_clock *clock);

/* The device locks or goes to sleep; it unlocks at `seconds`, and the count begins again from there. */
void player_clock_sleep(player_clock *clock);
void player_clock_wake(player_clock *clock, uint64_t seconds);

/* Whether a tick is due at `seconds`; when it is, the count begins again from there. */
bool player_clock_due(player_clock *clock, uint64_t seconds);

#endif
