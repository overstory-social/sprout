/*
 * ui/clock.c: the reader's clock. The rules: no tick is owed until a world is being read, and
 * then one each PLAYER_TICK_SECONDS, counted from the last; none once reading stops; none while
 * the device is locked or asleep, and none owed for that time once it wakes, the count beginning
 * afresh; and a clock set back never brings a tick sooner, nor runs the count backwards.
 */
#include "support.h"
#include "ui/clock.h"

#define T PLAYER_TICK_SECONDS

static void a_tick_is_owed_only_while_a_world_is_read(void) {
  player_clock clock;
  player_clock_init(&clock);
  CHECK(!player_clock_due(&clock, 500), "nothing is read, so nothing is owed");
  player_clock_start(&clock, 1000);
  CHECK(!player_clock_due(&clock, 1000 + T - 1), "one second short of the interval");
  CHECK(player_clock_due(&clock, 1000 + T), "the interval is up");
  CHECK(!player_clock_due(&clock, 1000 + T), "and the count begins again from there");
  CHECK(!player_clock_due(&clock, 1000 + 2 * T - 1), "one second short of the next");
  CHECK(player_clock_due(&clock, 1000 + 5 * T), "a long frame owes one tick, not several");
  CHECK(!player_clock_due(&clock, 1000 + 5 * T + 1), "and only one");
  player_clock_stop(&clock);
  CHECK(!player_clock_due(&clock, 1000 + 50 * T), "the reader closed: nothing is owed");
  player_clock_start(&clock, 1000 + 50 * T);
  CHECK(!player_clock_due(&clock, 1000 + 50 * T + 1), "opened again, the count begins afresh");
}

static void locking_and_sleep_stop_the_count_and_waking_begins_it_afresh(void) {
  player_clock clock;
  player_clock_init(&clock);
  player_clock_start(&clock, 1000);
  player_clock_sleep(&clock);
  CHECK(!player_clock_due(&clock, 1000 + 100 * T), "nothing is owed while the device sleeps");
  player_clock_wake(&clock, 1000 + 100 * T);
  CHECK(!player_clock_due(&clock, 1000 + 100 * T), "nothing is owed for the time away");
  CHECK(!player_clock_due(&clock, 1000 + 101 * T - 1), "the count began at the wake");
  CHECK(player_clock_due(&clock, 1000 + 101 * T), "an interval after the wake, a tick");
  player_clock_stop(&clock);
  player_clock_sleep(&clock);
  player_clock_wake(&clock, 1000 + 200 * T);
  CHECK(!player_clock_due(&clock, 1000 + 300 * T), "waking does not start a reader that was closed");
}

static void a_clock_set_back_brings_no_tick_sooner(void) {
  player_clock clock;
  player_clock_init(&clock);
  player_clock_start(&clock, 1000);
  CHECK(player_clock_read(&clock, 400) == 1000, "time read back is the greatest seen");
  CHECK(!player_clock_due(&clock, 400), "the clock went back: nothing is owed");
  CHECK(!player_clock_due(&clock, 1000 + T - 1), "the count still runs from when it began");
  CHECK(player_clock_due(&clock, 1000 + T), "and is owed when the interval is up");
  CHECK(player_clock_read(&clock, 1000 + 3 * T) == 1000 + 3 * T, "time forward is read as it is");
}

int main(void) {
  test_program("clock");
  a_tick_is_owed_only_while_a_world_is_read();
  locking_and_sleep_stop_the_count_and_waking_begins_it_afresh();
  a_clock_set_back_brings_no_tick_sooner();
  return finish();
}
