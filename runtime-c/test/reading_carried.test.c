/*
 * Tests for src/reading/carried.c (the spec's Verbs > Carried roles): before
 * any `permit` a carried role holding what the actor does not carry is
 * refused in the world's `not_carrying`, for a person and an NPC alike; a
 * thing carried in an open pouch passes it, and what the thing's own guard
 * then says is the thing's. Carrying is holding, or holding what holds, every
 * container strictly between letting it through, one step for each climbed and what its rule costs.
 */
#include "reading_fixture.h"

static bool carried_by(exec_bench *b, const char *state, const char *asker, const char *thing, uint64_t *steps) {
  exec_case c;
  bool carried = false;
  reading_case_in(b, &c, state);
  CHECK_INT(sprout_carries(&c.frame, exec_str(asker), exec_str(thing), &carried), SPROUT_EVAL_OK);
  *steps = c.meter.steps;
  exec_case_close(&c);
  return carried;
}

static void a_thing_is_carried_in_the_hand_or_in_an_open_pouch_and_not_on_the_floor(void) {
  exec_bench b;
  uint64_t steps;
  reading_bench_open(&b);
  CHECK(!carried_by(&b, "fresh", "bench#1", "bench.shop.brass_key", &steps));
  CHECK_INT(steps, 2);
  CHECK(carried_by(&b, "key-held", "bench#1", "bench.shop.brass_key", &steps));
  CHECK_INT(steps, 1);
  CHECK(carried_by(&b, "pouch", "bench#1", "bench.shop.brass_key", &steps));
  CHECK(steps > 2);
  CHECK(!carried_by(&b, "cat-key", "bench#1", "bench.shop.brass_key", &steps));
  CHECK(carried_by(&b, "cat-key", "bench.shop.cat", "bench.shop.brass_key", &steps));
  exec_bench_close(&b);
}

static void a_thing_behind_a_shut_container_is_not_carried(void) {
  exec_bench b;
  exec_case c;
  sprout_str pouch = exec_str("bench.shop.pouch");
  const sprout_stored_instance *held;
  sprout_stored_instance next;
  bool carried = true;
  reading_bench_open(&b);
  reading_case_in(&b, &c, "pouch");
  held = sprout_draft_instance(&c.draft, pouch);
  CHECK(held != NULL);
  CHECK_INT(sprout_stored_instance_copy(&c.turn, held, &next), SPROUT_OK);
  {
    size_t i;
    for (i = 0; i < next.property_count; i++)
      if (sprout_str_is(next.properties[i].name, "open")) next.properties[i].value.boolean = false;
  }
  CHECK_INT(sprout_draft_write(&c.draft, &next), SPROUT_DRAFT_OK);
  CHECK_INT(sprout_carries(&c.frame, exec_str("bench#1"), exec_str("bench.shop.brass_key"), &carried), SPROUT_EVAL_OK);
  CHECK(!carried);
  exec_case_close(&c);
  exec_bench_close(&b);
}

static void the_world_refuses_a_carried_role_the_actor_does_not_carry_with_the_thing_named(void) {
  exec_bench b;
  exec_case c;
  sprout_resolved reading;
  sprout_permit_refusal refusal;
  bool refused = false;
  reading_bench_open(&b);
  reading_case_open(&b, &c, reading_named(&b, "a carried tool the actor does not carry is refused in the world’s not_carrying, before any permit"));
  reading = reading_of(&c, sprout_json_get(c.golden, "reading"));
  CHECK_INT(sprout_uncarried(&c.x, &c.frame, &reading, &refused, &refusal), SPROUT_EVAL_OK);
  CHECK(refused);
  CHECK_STR(refusal.role, "tool");
  CHECK(sprout_str_same(refusal.refusal.by, exec_str("bench")));
  CHECK(refusal.refusal.origin == NULL);
  CHECK_INT(refusal.refusal.said.kind, SPROUT_SPEECH_PASSAGE);
  CHECK_STR(refusal.refusal.said.name, "not_carrying");
  CHECK_INT(refusal.refusal.binding_count, 3);
  CHECK_STR(refusal.refusal.bindings[2].name, "thing");
  CHECK(sprout_str_same(refusal.refusal.bindings[2].bound.id, exec_str("bench.shop.brass_key")));
  exec_case_close(&c);
  exec_bench_close(&b);
}

static void a_role_that_is_not_carried_and_a_thing_in_the_hand_refuse_nothing(void) {
  exec_bench b;
  exec_case c;
  sprout_resolved reading;
  sprout_permit_refusal refusal;
  bool refused = true;
  reading_bench_open(&b);
  reading_case_open(&b, &c, reading_named(&b, "a carried tool in the hand goes through to the participants’ permits"));
  reading = reading_of(&c, sprout_json_get(c.golden, "reading"));
  CHECK_INT(sprout_uncarried(&c.x, &c.frame, &reading, &refused, &refusal), SPROUT_EVAL_OK);
  CHECK(!refused);
  exec_case_close(&c);
  reading_case_open(&b, &c, reading_named(&b, "a role that is not carried is not asked: the pouch on the floor takes the book"));
  reading = reading_of(&c, sprout_json_get(c.golden, "reading"));
  refused = true;
  CHECK_INT(sprout_uncarried(&c.x, &c.frame, &reading, &refused, &refusal), SPROUT_EVAL_OK);
  CHECK(!refused);
  exec_case_close(&c);
  exec_bench_close(&b);
}

static void the_golden_carried_readings_end_as_the_typescript_runtime_did(void) {
  exec_bench b;
  reading_bench_open(&b);
  CHECK(reading_replay_area(&b, "carried") >= 7);
  exec_bench_close(&b);
  CHECK_INT(b.heap.pages, 0);
}

int main(void) {
  RUN(a_thing_is_carried_in_the_hand_or_in_an_open_pouch_and_not_on_the_floor);
  RUN(a_thing_behind_a_shut_container_is_not_carried);
  RUN(the_world_refuses_a_carried_role_the_actor_does_not_carry_with_the_thing_named);
  RUN(a_role_that_is_not_carried_and_a_thing_in_the_hand_refuse_nothing);
  RUN(the_golden_carried_readings_end_as_the_typescript_runtime_did);
  return REPORT();
}
