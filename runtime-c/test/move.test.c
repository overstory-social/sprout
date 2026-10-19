/*
 * Tests for src/move.c (the spec's Movement and consent; The world model >
 * Places): a move faults, writing nothing, where the thing is out of range of
 * the mover, the destination is, or holds nothing; is refused by the engine
 * before any guard where a thing would go inside itself, an actor into what
 * holds no actors, or a person into a place the host says is full; is asked
 * of the thing's `depart`, then the source's `release`, then the
 * destination's `accept`, the first refusal deciding; is refused with
 * `too_heavy` where the destination holds by measure and would be past its
 * most; and otherwise makes the
 * one write and queues what the engine tells the world where something
 * answers it, the move's notices walked as `:arrived` and `:departed` are
 * routed.
 */
#include "exec_fixture.h"
#include "expr/expr.h"
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
  /*
   * The engine tells `:left` to the old container, `:entered` to the new one and `:moved` to the thing, and
   * only what has a handler for it is queued: the shelf answers `:left` and the jar `:moved`; the basket answers
   * nothing, so its `:entered` is never queued.
   */
  CHECK_INT(c.x.queue_count, 2);
  CHECK_INT(c.x.queue[0].message, SPROUT_MSG_LEFT);
  CHECK_BYTES(c.x.queue[0].recipient.bytes, c.x.queue[0].recipient.length, "exec_bench.hall.shelf");
  CHECK_INT(c.x.queue[1].message, SPROUT_MSG_MOVED);
  CHECK_BYTES(c.x.queue[1].recipient.bytes, c.x.queue[1].recipient.length, "exec_bench.hall.shelf.jar");
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
  CHECK_INT(c.x.queue_count, 0);
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

/* The state of `notices-through-gate` as its transcript left it before Marta leaps, with the world's gate open. */
static char *before_the_leap(char **file) {
  static const char key[] = "{\"world\":\"notices-through-gate\",\"transcript\":\"gate.json\",\"step\":6,\"stored\":";
  static const char head[] = "\"instances\":[";
  static const char opened[] = "{\"id\":\"notices_through_gate\",\"properties\":{\"gate\":true}},";
  static char edited[8192];
  size_t length;
  char *stored, *end, *at;
  *file = test_golden("stored-worlds.json", &length);
  stored = strstr(*file, key);
  CHECK(stored != NULL);
  stored += sizeof key - 1;
  end = strchr(stored, '\n');
  CHECK(end != NULL);
  /* The line ends with the entry's own `}` and a comma: the stored world is what is inside. */
  while (end > stored && end[-1] != '}') end--;
  end[-1] = '\0';
  /* The gate is shut at this step, so nothing of the world is stored; a record opens it. */
  at = strstr(stored, head);
  CHECK(at != NULL && strstr(stored, "\"gate\"") == NULL && strlen(stored) + sizeof opened < sizeof edited);
  at += sizeof head - 1;
  memcpy(edited, stored, (size_t)(at - stored));
  memcpy(edited + (at - stored), opened, sizeof opened - 1);
  strcpy(edited + (at - stored) + sizeof opened - 1, at);
  return edited;
}

static void a_moves_notices_walk_the_place_as_arrived_and_departed_are_routed(void) {
  static const char *const hall = "notices_through_gate.hall", *const garden = "notices_through_gate.garden",
                           *const tower = "notices_through_gate.tower";
  static const char *const ottilie = "notices_through_gate#1", *const ines = "notices_through_gate#7",
                           *const marta = "notices_through_gate#9";
  test_heap heap;
  sprout_host host = corpus_host(&heap);
  size_t length, count, i, before;
  char *cartridge = corpus_cartridge("notices-through-gate", &length), *file;
  const char *stored = before_the_leap(&file);
  sprout_world *world;
  sprout_state *state;
  sprout_refusal refusal;
  sprout_arena turn;
  sprout_draft draft;
  sprout_meter meter;
  sprout_draws draws;
  sprout_eval_fault fault;
  sprout_exec x;
  sprout_frame frame;
  const sprout_reached *walked;
  bool garden_in_range = false, garden_hears = false, open = false;
  CHECK(sprout_load(&host, cartridge, length, &world) == SPROUT_OK);
  CHECK(sprout_state_read(&host, stored, strlen(stored), &state, &refusal) == SPROUT_OK);
  CHECK(sprout_state_open(state, world, &refusal) == SPROUT_OK);
  sprout_arena_init(&turn, &host);
  sprout_draft_open(&draft, &turn, world, state);
  sprout_meter_begin(&meter, &host, SPROUT_TURN_COMMAND);
  sprout_draws_begin(&draws, 1);
  sprout_exec_begin(&x, world, &draft, &turn, &meter, &draws, &fault, 0);
  frame = sprout_exec_frame(&x, exec_str("notices_through_gate"), "notices_through_gate", NULL);
  /* The gate is open: under `any`, the hall reaches the garden across the world. */
  CHECK_INT(sprout_range_of(&frame, exec_str(hall), NULL, &walked, &count), SPROUT_EVAL_OK);
  for (i = 0; i < count; i++)
    if (sprout_str_same(walked[i].node, exec_str(garden))) garden_in_range = true;
  CHECK(garden_in_range);
  /* The world answers a move's notices only with a rule written for them, so its open `pass any` does not. */
  CHECK_INT(expr_passes(&frame, exec_str("notices_through_gate"), NULL, &open), SPROUT_EVAL_OK);
  CHECK(open);
  CHECK_INT(expr_passes(&frame, exec_str("notices_through_gate"), "departed", &open), SPROUT_EVAL_OK);
  CHECK(!open);
  CHECK_INT(expr_passes(&frame, exec_str("notices_through_gate"), "arrived", &open), SPROUT_EVAL_OK);
  CHECK(!open);
  CHECK_INT(sprout_range_of(&frame, exec_str(hall), "departed", &walked, &count), SPROUT_EVAL_OK);
  for (i = 0; i < count; i++)
    if (sprout_str_same(walked[i].node, exec_str(garden))) garden_hears = true;
  CHECK(!garden_hears);
  /* Marta leaves the hall: the world's `pass any` does not answer for `:departed`, so only Ines beside her reads it. */
  CHECK_INT(sprout_move_spoken(&x, &frame, true, exec_str(hall), exec_str(marta), exec_str(tower), NULL), SPROUT_EVAL_OK);
  CHECK_INT(x.effect_count, 1);
  CHECK_INT(x.effects[0].to_count, 1);
  CHECK(sprout_str_same(x.effects[0].to[0], exec_str(ines)));
  /* Nothing in reach has a handler for it, so nothing is queued: the hall is told, and runs nothing. */
  CHECK_INT(x.queue_count, 0);
  /* She arrives in the tower: likewise, only Ottilie there reads it, and nothing is queued. */
  before = x.queue_count;
  CHECK_INT(sprout_move_spoken(&x, &frame, false, exec_str(tower), exec_str(marta), exec_str(hall), NULL), SPROUT_EVAL_OK);
  CHECK_INT(x.effect_count, 2);
  CHECK_INT(x.effects[1].to_count, 1);
  CHECK(sprout_str_same(x.effects[1].to[0], exec_str(ottilie)));
  CHECK_INT(x.queue_count, before);
  sprout_arena_reset(&turn);
  sprout_state_free(state);
  sprout_world_free(world);
  free(cartridge);
  free(file);
}

/* A sack that holds 40 by `:size`, a brick of 35 in it, is moved into by the crypt: the result, and its refusal's line. */
static void into_the_sack(const char *item, sprout_move_end *end, const char **line, size_t *bindings, bool *placed) {
  static char said[64];
  static const char *const crypt = "capacity_by_measure.crypt", *const sack = "capacity_by_measure.crypt.sack";
  test_heap heap;
  sprout_host host = corpus_host(&heap);
  size_t length;
  char *cartridge = corpus_cartridge("capacity-by-measure", &length);
  sprout_world *world;
  sprout_state *state;
  sprout_arena turn;
  sprout_draft draft;
  sprout_meter meter;
  sprout_draws draws;
  sprout_eval_fault fault;
  sprout_exec x;
  sprout_frame frame;
  sprout_move_refusal refusal;
  const sprout_stored_instance *moved;
  CHECK(sprout_load(&host, cartridge, length, &world) == SPROUT_OK);
  CHECK(sprout_state_empty(&host, "capacity_by_measure", &state) == SPROUT_OK);
  CHECK(sprout_state_open(state, world, NULL) == SPROUT_OK);
  sprout_arena_init(&turn, &host);
  sprout_draft_open(&draft, &turn, world, state);
  sprout_meter_begin(&meter, &host, SPROUT_TURN_COMMAND);
  sprout_draws_begin(&draws, 1);
  sprout_exec_begin(&x, world, &draft, &turn, &meter, &draws, &fault, 0);
  frame = sprout_exec_frame(&x, exec_str(crypt), "capacity_by_measure", NULL);
  CHECK_INT(sprout_move_instance(&x, &frame, exec_str(crypt), exec_str(item), exec_str(sack), SPROUT_REACH_RANGE, NULL,
                                 end, &refusal),
            SPROUT_EVAL_OK);
  snprintf(said, sizeof said, "%s", *end == SPROUT_MOVE_REFUSED_BY_ENGINE ? refusal.said.name : "");
  *line = said;
    *bindings = refusal.binding_count;
  moved = sprout_draft_instance(&draft, exec_str(item));
  *placed = moved != NULL && sprout_str_same(moved->container, exec_str(sack));
    CHECK(*end != SPROUT_MOVE_REFUSED_BY_GUARD);
  sprout_arena_reset(&turn);
  sprout_state_free(state);
  sprout_world_free(world);
  free(cartridge);
}

static void a_container_that_holds_by_measure_refuses_what_would_take_it_past_its_most(void) {
  sprout_move_end end;
  const char *line;
  size_t bindings;
  bool placed;
  /* The brick's 35 and the lamp's 15 come to 50, past the sack's 40: `too_heavy`, given the item and where. */
  into_the_sack("capacity_by_measure.crypt.lamp", &end, &line, &bindings, &placed);
  CHECK_INT(end, SPROUT_MOVE_REFUSED_BY_ENGINE);
  CHECK_STR(line, "too_heavy");
  CHECK_INT(bindings, 2);
  CHECK(!placed);
  /* The leaflet's kind declares no `:size`, so it measures nothing and goes in. */
  into_the_sack("capacity_by_measure.crypt.leaflet", &end, &line, &bindings, &placed);
  CHECK_INT(end, SPROUT_MOVE_DONE);
  CHECK(placed);
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
  RUN(a_moves_notices_walk_the_place_as_arrived_and_departed_are_routed);
  RUN(a_container_that_holds_by_measure_refuses_what_would_take_it_past_its_most);
  RUN(the_golden_move_cases_end_as_the_typescript_runtime_did);
  return REPORT();
}
