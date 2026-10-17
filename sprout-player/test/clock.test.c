/*
 * ui/clock.c: the reader's clock. The rules: no tick is owed until a world is being read, and
 * then one each PLAYER_TICK_SECONDS, counted from the last; none once reading stops; none while
 * the device is locked or asleep, and none owed for that time once it wakes, the count beginning
 * afresh; a clock set back never brings a tick sooner, nor runs the count backwards; and a due
 * tick waits until the hands have rested PLAYER_REST_MILLISECONDS, the ticks that fell due under
 * live input being one when they do.
 */
#include "support.h"
#include "ui/clock.h"

#define T PLAYER_TICK_SECONDS
#define R PLAYER_REST_MILLISECONDS

/* The hands rested long since: a due tick runs at `seconds`. */
static bool due(player_clock *clock, uint64_t seconds) { return player_clock_due(clock, seconds, 100000u); }

static void a_tick_is_owed_only_while_a_world_is_read(void) {
  player_clock clock;
  player_clock_init(&clock);
  CHECK(!due(&clock, 500), "nothing is read, so nothing is owed");
  player_clock_start(&clock, 1000);
  CHECK(!due(&clock, 1000 + T - 1), "one second short of the interval");
  CHECK(due(&clock, 1000 + T), "the interval is up");
  CHECK(!due(&clock, 1000 + T), "and the count begins again from there");
  CHECK(!due(&clock, 1000 + 2 * T - 1), "one second short of the next");
  CHECK(due(&clock, 1000 + 5 * T), "a long frame owes one tick, not several");
  CHECK(!due(&clock, 1000 + 5 * T + 1), "and only one");
  player_clock_stop(&clock);
  CHECK(!due(&clock, 1000 + 50 * T), "the reader closed: nothing is owed");
  player_clock_start(&clock, 1000 + 50 * T);
  CHECK(!due(&clock, 1000 + 50 * T + 1), "opened again, the count begins afresh");
}

static void locking_and_sleep_stop_the_count_and_waking_begins_it_afresh(void) {
  player_clock clock;
  player_clock_init(&clock);
  player_clock_start(&clock, 1000);
  player_clock_sleep(&clock);
  CHECK(!due(&clock, 1000 + 100 * T), "nothing is owed while the device sleeps");
  player_clock_wake(&clock, 1000 + 100 * T);
  CHECK(!due(&clock, 1000 + 100 * T), "nothing is owed for the time away");
  CHECK(!due(&clock, 1000 + 101 * T - 1), "the count began at the wake");
  CHECK(due(&clock, 1000 + 101 * T), "an interval after the wake, a tick");
  player_clock_stop(&clock);
  player_clock_sleep(&clock);
  player_clock_wake(&clock, 1000 + 200 * T);
  CHECK(!due(&clock, 1000 + 300 * T), "waking does not start a reader that was closed");
}

static void a_clock_set_back_brings_no_tick_sooner(void) {
  player_clock clock;
  player_clock_init(&clock);
  player_clock_start(&clock, 1000);
  CHECK(player_clock_read(&clock, 400) == 1000, "time read back is the greatest seen");
  CHECK(!due(&clock, 400), "the clock went back: nothing is owed");
  CHECK(!due(&clock, 1000 + T - 1), "the count still runs from when it began");
  CHECK(due(&clock, 1000 + T), "and is owed when the interval is up");
  CHECK(player_clock_read(&clock, 1000 + 3 * T) == 1000 + 3 * T, "time forward is read as it is");
}

static void a_due_tick_waits_for_the_hands_to_rest(void) {
  player_clock clock;
  player_clock_init(&clock);
  player_clock_start(&clock, 1000);
  player_clock_touch(&clock, 5000);
  CHECK(!player_clock_rested(&clock, 5000 + R - 1), "a millisecond short of the rest, the hands have not rested");
  CHECK(player_clock_rested(&clock, 5000 + R), "at the rest, they have");
  CHECK(!player_clock_due(&clock, 1000 + T, 5000 + R - 1), "the interval is up, but the hands are at work: no tick");
  CHECK(!player_clock_due(&clock, 1000 + 3 * T, 5000 + R - 1), "and none however long they stay at it");
  CHECK(player_clock_due(&clock, 1000 + 3 * T, 5000 + R), "rested, the tick that waited runs");
  CHECK(!player_clock_due(&clock, 1000 + 3 * T, 5000 + 2 * R), "once, for every interval that passed under the hands");
  CHECK(!player_clock_due(&clock, 1000 + 4 * T - 1, 5000 + 2 * R), "and the count began again when it ran");
  CHECK(player_clock_due(&clock, 1000 + 4 * T, 5000 + 2 * R), "an interval later, the next");
  player_clock_touch(&clock, 4294967000u);
  CHECK(!player_clock_rested(&clock, 4294967000u + R - 1), "the rest is measured across the counter's wrap");
  CHECK(player_clock_rested(&clock, 4294967000u + R), "and is up when it would be");
}

int main(void) {
  test_program("clock");
  a_tick_is_owed_only_while_a_world_is_read();
  locking_and_sleep_stop_the_count_and_waking_begins_it_afresh();
  a_clock_set_back_brings_no_tick_sooner();
  a_due_tick_waits_for_the_hands_to_rest();
  return finish();
}
