/*
 * Tests for src/expr/spawn.c: a spawn makes an instance of a declared kind in
 * a container in range, at its defaults, with a copy of everything its kinds'
 * bodies hold, each after what holds it; it is charged one spawn for the
 * instance and one for each content before anything is written; and a spawn
 * that faults leaves the draft as it was.
 */
#include "eval_fixture.h"
#include "expr/expr.h"

static sprout_str str_of(const char *text) { return bench_id(text); }

static void a_spawn_makes_the_instance_and_what_its_kinds_hold(void) {
  bench b;
  bench_turn t;
  sprout_spawned made;
  size_t before;
  const sprout_stored_instance *crate, *lid, *tray, *seed;
  bench_open(&b);
  bench_turn_open(&b, &t, "fresh", "eval_bench.hall.probe", "eval_bench", -1, -1, -1);
  before = sprout_draft_held(&t.draft);
  CHECK_INT(sprout_spawn(&t.frame, "eval_bench.Crate", str_of("eval_bench.hall"), &made), SPROUT_EVAL_OK);
  CHECK_BYTES(made.id.bytes, made.id.length, "eval_bench#3");
  CHECK_INT(made.count, 3);
  CHECK_INT(sprout_draft_held(&t.draft), before + 4);
  crate = sprout_draft_instance(&t.draft, made.id);
  lid = sprout_draft_instance(&t.draft, made.contents[0]);
  tray = sprout_draft_instance(&t.draft, made.contents[1]);
  seed = sprout_draft_instance(&t.draft, made.contents[2]);
  CHECK(crate != NULL && lid != NULL && tray != NULL && seed != NULL);
  if (crate == NULL || lid == NULL || tray == NULL || seed == NULL) return;
  /* The spawned instance is in the container and carries the kind that made it. */
  CHECK_INT(crate->made, SPROUT_MADE_SPAWNED);
  CHECK_STR(crate->kind->qualified, "eval_bench.Crate");
  CHECK_BYTES(crate->container.bytes, crate->container.length, "eval_bench.hall");
  /* Each content is a copy of what the body wrote, named by the kind that wrote it and its path. */
  CHECK_INT(lid->made, SPROUT_MADE_GIVEN);
  CHECK_BYTES(lid->made_kind.bytes, lid->made_kind.length, "eval_bench.Crate");
  CHECK_INT(lid->path_count, 1);
  CHECK_BYTES(lid->path[0].bytes, lid->path[0].length, "lid");
  CHECK_INT(seed->path_count, 2);
  CHECK_BYTES(seed->path[1].bytes, seed->path[1].length, "seed");
  /* And each is inside what holds it. */
  CHECK_BYTES(lid->container.bytes, lid->container.length, "eval_bench#3");
  CHECK_BYTES(tray->container.bytes, tray->container.length, "eval_bench#3");
  CHECK_BYTES(seed->container.bytes, seed->container.length, tray->id.bytes);
  CHECK(lid->has_arrival && lid->arrival > crate->arrival);
  /* Four spawns were charged: the crate and its three contents. */
  CHECK_INT(t.meter.spawns, 4);
  bench_turn_close(&t);
  bench_close(&b);
  CHECK_INT(b.heap.pages, 0);
}

static void a_spawn_is_made_at_its_kinds_defaults(void) {
  bench b;
  bench_turn t;
  sprout_spawned made;
  const sprout_stored_instance *jar;
  sprout_value value;
  bench_open(&b);
  bench_turn_open(&b, &t, "fresh", "eval_bench.hall.probe", "eval_bench", -1, -1, -1);
  CHECK_INT(sprout_spawn(&t.frame, "eval_bench.Jar", str_of("eval_bench.hall"), &made), SPROUT_EVAL_OK);
  CHECK_INT(made.count, 0);
  jar = sprout_draft_instance(&t.draft, made.id);
  CHECK(jar != NULL);
  if (jar != NULL) {
    CHECK_INT(expr_get(&t.frame, jar, "fill", &value), SPROUT_EVAL_OK);
    CHECK(value.as.number == 3);
    CHECK_INT(expr_get(&t.frame, jar, "wards", &value), SPROUT_EVAL_OK);
    CHECK_INT(value.as.list->count, 2);
  }
  bench_turn_close(&t);
  bench_close(&b);
}

static void the_next_spawn_is_minted_after_the_last(void) {
  bench b;
  bench_turn t;
  sprout_spawned first, second;
  bench_open(&b);
  bench_turn_open(&b, &t, "fresh", "eval_bench.hall.probe", "eval_bench", -1, -1, -1);
  CHECK_INT(sprout_spawn(&t.frame, "eval_bench.Crate", str_of("eval_bench.hall"), &first), SPROUT_EVAL_OK);
  CHECK_INT(sprout_spawn(&t.frame, "eval_bench.Jar", str_of("eval_bench.hall"), &second), SPROUT_EVAL_OK);
  CHECK_BYTES(first.id.bytes, first.id.length, "eval_bench#3");
  CHECK_BYTES(second.id.bytes, second.id.length, "eval_bench#11");
  bench_turn_close(&t);
  bench_close(&b);
}

static void a_spawn_that_faults_writes_nothing_and_says_why(void) {
  bench b;
  bench_turn t;
  sprout_spawned made;
  size_t before;
  bench_open(&b);
  bench_turn_open(&b, &t, "fresh", "eval_bench.hall.probe", "eval_bench", -1, 3, -1);
  before = sprout_draft_held(&t.draft);
  /* The host allows 3 spawns, and a crate with its contents is 4. */
  CHECK_INT(sprout_spawn(&t.frame, "eval_bench.Crate", str_of("eval_bench.hall"), &made), SPROUT_EVAL_FAULT);
  CHECK_STR(t.fault.name, "BudgetExhausted");
  CHECK_STR(t.meter.fault.budget, "spawns");
  CHECK_INT(sprout_draft_held(&t.draft), before);
  bench_turn_close(&t);
  bench_turn_open(&b, &t, "fresh", "eval_bench.hall.probe", "eval_bench", -1, -1, -1);
  CHECK_INT(sprout_spawn(&t.frame, "eval_bench.Jar", str_of("eval_bench.hall.shelf.jar"), &made), SPROUT_EVAL_FAULT);
  CHECK_STR(t.fault.name, "LifecycleFault");
  CHECK_STR(t.fault.text, "`eval_bench.hall.shelf.jar` holds nothing, so `Jar` could not be spawned in it.");
  CHECK_INT(sprout_spawn(&t.frame, "eval_bench.Person", str_of("eval_bench.hall"), &made), SPROUT_EVAL_FAULT);
  CHECK_STR(t.fault.text, "`Person` is absent, so it could not be spawned.");
  CHECK_INT(sprout_draft_held(&t.draft), before);
  CHECK_INT(t.meter.spawns, 0);
  bench_turn_close(&t);
  bench_close(&b);
}

int main(void) {
  RUN(a_spawn_makes_the_instance_and_what_its_kinds_hold);
  RUN(a_spawn_is_made_at_its_kinds_defaults);
  RUN(the_next_spawn_is_minted_after_the_last);
  RUN(a_spawn_that_faults_writes_nothing_and_says_why);
  return REPORT();
}
