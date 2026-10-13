/* The reader's clock; see clock.h. */
#include "clock.h"

#include "host/pd_host.h"

void player_clock_init(player_clock *clock) {
  clock->last = 0;
  clock->ticked = 0;
  clock->reading = false;
  clock->awake = true;
}

uint64_t player_clock_read(player_clock *clock, uint64_t seconds) {
  clock->last = player_clamp(seconds, clock->last);
  return clock->last;
}

void player_clock_start(player_clock *clock, uint64_t seconds) {
  clock->reading = true;
  clock->ticked = player_clock_read(clock, seconds);
}

void player_clock_stop(player_clock *clock) { clock->reading = false; }

void player_clock_sleep(player_clock *clock) { clock->awake = false; }

void player_clock_wake(player_clock *clock, uint64_t seconds) {
  clock->awake = true;
  clock->ticked = player_clock_read(clock, seconds);
}

bool player_clock_due(player_clock *clock, uint64_t seconds) {
  uint64_t now = player_clock_read(clock, seconds);
  if (!clock->reading || !clock->awake || now - clock->ticked < PLAYER_TICK_SECONDS) return false;
  clock->ticked = now;
  return true;
}
