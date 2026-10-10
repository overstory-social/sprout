/*
 * Tests for src/schedule.c: what is to be done with time, read from the committed state: the places that hold
 * a visitor, and the wakes that have fallen due, oldest first (the spec's Time > Ticks, Wakes, Absence).
 */
#include "schedule.h"
#include "turn_fixture.h"

static sprout_str id_of(const char *text) { return (sprout_str){text, strlen(text)}; }

static void a_place_is_occupied_only_while_a_visitor_stands_in_it(void) {
  turn_world w;
  sprout_outcome out;
  tw_open(&w, "turn-faults");
  CHECK(schedule_is_place(w.state, id_of("turn_faults.porch")));
  CHECK(schedule_is_place(w.state, id_of("turn_faults.cellar")));
  CHECK(!schedule_is_place(w.state, id_of("turn_faults.porch.fuse")));
  CHECK(!schedule_is_place(w.state, id_of("turn_faults")));
  CHECK(!schedule_is_place(w.state, id_of("turn_faults.nowhere")));
  CHECK(!schedule_occupied(w.state, id_of("turn_faults.porch")));
  tw_arrive(&w, "v-marta", "Marta", 1000, &out);
  sprout_outcome_free(&out);
  CHECK(schedule_occupied(w.state, id_of("turn_faults.porch")));
  CHECK(!schedule_occupied(w.state, id_of("turn_faults.cellar")));
  CHECK(schedule_live(w.state, id_of("turn_faults.porch.fuse")));
  CHECK(!schedule_live(w.state, id_of("turn_faults.nowhere")));
  tw_close(&w);
}

static void a_wake_is_pending_under_its_serial_and_due_wakes_come_oldest_first(void) {
  turn_world w;
  sprout_outcome out;
  sprout_due_wake pending, *due;
  size_t count;
  sprout_arena arena;
  uint64_t serial;
  tw_open(&w, "turn-faults");
  tw_arrive(&w, "v-marta", "Marta", 1000, &out);
  sprout_outcome_free(&out);
  tw_do(&w, "v-marta", "light", "porch.dud", 1000, &out);
  sprout_outcome_free(&out);
  tw_do(&w, "v-marta", "light", "porch.fuse", 1005, &out);
  sprout_outcome_free(&out);
  serial = tw_instance(&w, "turn_faults.porch.fuse")->wakes[0].serial;
  CHECK(schedule_pending(w.state, id_of("turn_faults.porch.fuse"), serial, &pending));
  CHECK_INT(pending.asked_at, 1005);
  CHECK_INT(pending.due_at, 1065);
  CHECK(!schedule_pending(w.state, id_of("turn_faults.porch.fuse"), serial + 100, &pending));
  CHECK(!schedule_pending(w.state, id_of("turn_faults.cellar"), serial, &pending));
  sprout_arena_init(&arena, &w.host);
  CHECK_INT(schedule_due(&arena, w.state, 1059, &due, &count), SPROUT_OK);
  CHECK_INT(count, 0);
  CHECK_INT(schedule_due(&arena, w.state, 1100, &due, &count), SPROUT_OK);
  CHECK_INT(count, 2);
  if (count == 2) {
    CHECK_BYTES(due[0].object.bytes, due[0].object.length, "turn_faults.porch.dud");
    CHECK_BYTES(due[1].object.bytes, due[1].object.length, "turn_faults.porch.fuse");
  }
  sprout_arena_reset(&arena);
  tw_close(&w);
}

int main(void) {
  RUN(a_place_is_occupied_only_while_a_visitor_stands_in_it);
  RUN(a_wake_is_pending_under_its_serial_and_due_wakes_come_oldest_first);
  return REPORT();
}
