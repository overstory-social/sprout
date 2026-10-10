/*
 * Tests for src/move.c (the spec's Movement and consent; The world model >
 * Places): a move faults, writing nothing, where the thing is out of range of
 * the mover, the destination is, or holds nothing; is refused by the engine
 * before any guard where a thing would go inside itself, an actor into what
 * holds no actors, or a person into a place the host says is full; is asked
 * of the thing's `depart`, then the source's `release`, then the
 * destination's `accept`, the first refusal deciding; and otherwise makes the
 * one write and queues what the engine tells the world.
 */
#include "exec_fixture.h"
#include "stmt/stmt.h"

static sprout_eval_status move(exec_case *c, const char *mover, const char *item, const char *to, sprout_move_end *end,
                               sprout_move_refusal *refusal) {
  return sprout_move_instance(&c->x, &c->frame, exec_str(mover), exec_str(item), exec_str(to), SPROUT_REACH_RANGE, NULL, end, refusal);
}

static const char *container_of(exec_case *c, const char *id) {
  static char text[128];
  const sprout_stored_instance *instance = sprout_draft_instance(&c->draft, exec_str(id));
  snprintf(text, sizeof text, "%.*s", (int)instance->container.length, instance->container.bytes);
  return text;
}

static void a_move_every_party_allows_makes_the_one_write_and_queues_what_the_engine_tells(void) {
  exec_bench b;
  exec_case c;
  sprout_move_end end;
  sprout_move_refusal refusal;
  exec_bench_open(&b);
  exec_case_open(&b, &c, exec_named(&b, "a move that every party allows"));
  CHECK_INT(move(&c, "exec_bench.hall.runner", "exec_bench.hall.shelf.jar", "exec_bench.hall.basket", &end, &refusal),
            SPROUT_EVAL_OK);
  CHECK_INT(end, SPROUT_MOVE_DONE);
  CHECK_STR(container_of(&c, "exec_bench.hall.shelf.jar"), "exec_bench.hall.basket");
  /* `:left` to the old container, `:entered` to the new one, `:moved` to the thing. */
  CHECK_INT(c.x.queued_count, 3);
  CHECK_INT(c.x.queued[0].message, SPROUT_MSG_LEFT);
  CHECK_BYTES(c.x.queued[0].recipient.bytes, c.x.queued[0].recipient.length, "exec_bench.hall.shelf");
  CHECK_INT(c.x.queued[1].message, SPROUT_MSG_ENTERED);
  CHECK_BYTES(c.x.queued[1].recipient.bytes, c.x.queued[1].recipient.length, "exec_bench.hall.basket");
  CHECK_INT(c.x.queued[2].message, SPROUT_MSG_MOVED);
  CHECK_BYTES(c.x.queued[2].recipient.bytes, c.x.queued[2].recipient.length, "exec_bench.hall.shelf.jar");
  exec_case_close(&c);
  exec_bench_close(&b);
}

static void the_first_refusal_decides_and_nothing_is_written(void) {
  exec_bench b;
  exec_case c;
  sprout_move_end end;
  sprout_move_refusal refusal;
  exec_bench_open(&b);
  exec_case_open(&b, &c, exec_named(&b, "depart is asked before accept"));
  /* The stubborn thing departs before the full shelf is asked to accept it. */
  CHECK_INT(move(&c, "exec_bench.hall.runner", "exec_bench.hall.stubborn", "exec_bench.hall.shelf", &end, &refusal),
            SPROUT_EVAL_OK);
  CHECK_INT(end, SPROUT_MOVE_REFUSED_BY_GUARD);
  CHECK_STR(refusal.guard, "depart");
  CHECK_STR(refusal.origin, "exec_bench.Stubborn");
  /* The keeper releases before the shelf accepts. */
  CHECK_INT(move(&c, "exec_bench.hall.runner", "exec_bench.hall.keeper.kept", "exec_bench.hall.shelf", &end, &refusal),
            SPROUT_EVAL_OK);
  CHECK_STR(refusal.guard, "release");
  /* The shelf accepts last. */
  CHECK_INT(move(&c, "exec_bench.hall.runner", "exec_bench.hall.lamp", "exec_bench.hall.shelf", &end, &refusal),
            SPROUT_EVAL_OK);
  CHECK_STR(refusal.guard, "accept");
  CHECK_STR(container_of(&c, "exec_bench.hall.lamp"), "exec_bench.hall");
  CHECK_INT(c.x.queued_count, 0);
  exec_case_close(&c);
  exec_bench_close(&b);
}

static void nothing_goes_inside_itself_and_the_engine_says_so_before_any_guard(void) {
  exec_bench b;
  exec_case c;
  sprout_move_end end;
  sprout_move_refusal refusal;
  exec_bench_open(&b);
  exec_case_open(&b, &c, exec_named(&b, "nothing goes inside itself"));
  CHECK_INT(move(&c, "exec_bench.hall.runner", "exec_bench.hall.box", "exec_bench.hall.box.inner", &end, &refusal),
            SPROUT_EVAL_OK);
  CHECK_INT(end, SPROUT_MOVE_REFUSED_BY_ENGINE);
  CHECK_STR(refusal.said.name, "inside_itself");
  CHECK_INT(refusal.binding_count, 1);
  CHECK_STR(refusal.bindings[0].name, "item");
  exec_case_close(&c);
  exec_bench_close(&b);
}

static void an_actor_is_not_put_in_what_holds_no_actors(void) {
  exec_bench b;
  exec_case c;
  sprout_move_end end;
  sprout_move_refusal refusal;
  exec_bench_open(&b);
  exec_case_open(&b, &c, exec_named(&b, "an actor is not put in what holds no actors"));
  CHECK_INT(move(&c, "exec_bench.hall.dog", "exec_bench.hall.dog", "exec_bench.hall.chest", &end, &refusal),
            SPROUT_EVAL_OK);
  CHECK_INT(end, SPROUT_MOVE_REFUSED_BY_ENGINE);
  CHECK_INT(refusal.said.kind, SPROUT_SPEECH_ENGINE);
  CHECK_STR(refusal.said.name, "not_a_place");
  CHECK(sprout_str_same(refusal.by, c.draft.base->world));
  CHECK_INT(refusal.binding_count, 2);
  exec_case_close(&c);
  exec_bench_close(&b);
}

static void a_person_into_a_full_place_meets_crowded_before_any_guard(void) {
  exec_bench b;
  exec_case c;
  sprout_move_end end;
  sprout_move_refusal refusal;
  exec_bench_open(&b);
  exec_case_open(&b, &c, exec_named(&b, "a move into a full place meets crowded before any guard"));
  CHECK_INT(move(&c, "exec_bench.hall.dog", "exec_bench#1", "exec_bench.hall.lodge", &end, &refusal), SPROUT_EVAL_OK);
  CHECK_INT(end, SPROUT_MOVE_REFUSED_BY_ENGINE);
  CHECK_STR(refusal.said.name, "crowded");
  CHECK(refusal.guard == NULL);
  exec_case_close(&c);
  exec_bench_close(&b);
}

static void a_move_out_of_range_or_into_what_holds_nothing_faults(void) {
  exec_bench b;
  exec_case c;
  sprout_move_end end;
  sprout_move_refusal refusal;
  exec_bench_open(&b);
  exec_case_open(&b, &c, exec_named(&b, "a move of what is out of range faults"));
  CHECK_INT(move(&c, "exec_bench.hall.runner", "exec_bench.hall.chest.bin", "exec_bench.hall.shelf", &end, &refusal),
            SPROUT_EVAL_FAULT);
  CHECK_STR(c.fault.name, "MoveFault");
  CHECK_STR(c.fault.text,
            "`exec_bench.hall.chest.bin` is out of range of `exec_bench.hall.runner`, so it could not be moved.");
  CHECK_INT(move(&c, "exec_bench.hall.runner", "exec_bench.hall.lamp", "exec_bench.hall.shelf.cup", &end, &refusal),
            SPROUT_EVAL_FAULT);
  CHECK_STR(c.fault.text,
            "`exec_bench.hall.shelf.cup` holds nothing, so `exec_bench.hall.lamp` could not be moved into it.");
  CHECK_INT(move(&c, "exec_bench.hall.runner", "exec_bench", "exec_bench.hall.shelf", &end, &refusal), SPROUT_EVAL_FAULT);
  CHECK_STR(c.fault.text, "the world is the root of the tree, and goes nowhere.");
  exec_case_close(&c);
  exec_bench_close(&b);
}

static void an_actor_moved_between_places_is_spoken_of_and_a_description_is_owed(void) {
  exec_bench b;
  exec_case c;
  sprout_move_end end;
  sprout_move_refusal refusal;
  exec_bench_open(&b);
  exec_case_open(&b, &c, exec_named(&b, "an actor moved between places is told, and the places tell their people"));
  CHECK_INT(move(&c, "exec_bench.hall.dog", "exec_bench.hall.dog", "exec_bench.hall.tent", &end, &refusal), SPROUT_EVAL_OK);
  CHECK_INT(end, SPROUT_MOVE_DONE);
  /* The old place's `leaves`, then the new place's `arrives`, to the visitors in range. */
  CHECK_INT(c.x.effect_count, 2);
  CHECK_INT(c.x.effects[0].kind, SPROUT_EFFECT_NOTICE);
  CHECK_STR(c.x.effects[0].said.name, "leaves");
  CHECK_STR(c.x.effects[1].said.name, "arrives");
  CHECK_INT(c.x.owed_count, 1);
  CHECK(sprout_str_same(c.x.owed[0].mover, exec_str("exec_bench.hall.dog")));
  CHECK(sprout_str_same(c.x.owed[0].place, exec_str("exec_bench.hall.tent")));
  exec_case_close(&c);
  exec_bench_close(&b);
}

static void the_golden_move_cases_end_as_the_typescript_runtime_did(void) {
  exec_bench b;
  exec_bench_open(&b);
  CHECK(exec_replay_area(&b, "move") >= 14);
  exec_bench_close(&b);
  CHECK_INT(b.heap.pages, 0);
}

int main(void) {
  RUN(a_move_every_party_allows_makes_the_one_write_and_queues_what_the_engine_tells);
  RUN(the_first_refusal_decides_and_nothing_is_written);
  RUN(nothing_goes_inside_itself_and_the_engine_says_so_before_any_guard);
  RUN(an_actor_is_not_put_in_what_holds_no_actors);
  RUN(a_person_into_a_full_place_meets_crowded_before_any_guard);
  RUN(a_move_out_of_range_or_into_what_holds_nothing_faults);
  RUN(an_actor_moved_between_places_is_spoken_of_and_a_description_is_owed);
  RUN(the_golden_move_cases_end_as_the_typescript_runtime_did);
  return REPORT();
}
