/*
 * The reader's clock: when the reader asks the session for a tick (the
 * spec's The host contract › Time: the host chooses the interval and supplies `elapsed`
 * truthfully). A tick is owed only while a world is being read and the device is awake: the
 * reader's opening starts the count and its closing stops it, the device locking or going to
 * low-power sleep stops it, and unlocking starts it afresh, so the shelf and the time away never
 * owe a tick. A due tick waits for the hands to rest: none runs until no button has been down
 * and the crank has not turned for PLAYER_REST_MILLISECONDS, so the stall of a turn never lands
 * under a press, and the ticks that fall due while the visitor keeps cranking are one tick when
 * the hands rest, the time between carried by its `elapsed`. The device's seconds are clamped so
 * the schedule never reads a clock that went back; the session clamps the turn's own time the same
 * way (host/pd_host.h). The rest is measured on the device's millisecond counter, which no setting
 * of the clock moves.
 */
#ifndef PLAYER_UI_CLOCK_H
#define PLAYER_UI_CLOCK_H

#include <stdbool.h>
#include <stdint.h>

/* Seconds between ticks while a world is being read. */
#define PLAYER_TICK_SECONDS 10u

/* Milliseconds the hands must have rested, no button down and the crank still, before a due tick runs. */
#define PLAYER_REST_MILLISECONDS 1000u

typedef struct player_clock {
  uint64_t last;    /* the greatest device seconds seen */
  uint64_t ticked;  /* when the count last began */
  unsigned touched; /* the millisecond counter when input last arrived */
  bool reading;     /* a world is being read */
  bool awake;       /* the device is neither locked nor asleep */
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

/* A button is down or the crank turned, at `milliseconds` of the device's counter. */
void player_clock_touch(player_clock *clock, unsigned milliseconds);

/* Whether the hands have rested at `milliseconds` of the device's counter. */
bool player_clock_rested(const player_clock *clock, unsigned milliseconds);

/*
 * Whether a tick is due at `seconds` with the hands rested at `milliseconds`; when it is, the count
 * begins again from there. A tick that fell due under live input stays due until the hands rest.
 */
bool player_clock_due(player_clock *clock, uint64_t seconds, unsigned milliseconds);

#endif
