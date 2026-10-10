/*
 * Tests for src/stmt/lifecycle.c (the spec's The world model > Spawning,
 * Destroying): a `spawn` makes an instance of a declared kind in a container
 * in range, with what its kinds give it, and queues `:entered` to the
 * container and `:spawned` to the new instance. `destroy self` takes effect
 * where the body ends and removes everything the object held; `finally
 * destroy self` waits for the queue; the world and a person are never
 * destroyed.
 */
#include "exec_fixture.h"

static void a_spawn_makes_an_instance_in_the_container_and_tells_the_world(void) {
  exec_bench b;
  exec_case c;
  sprout_run run;
  sprout_str id;
  const sprout_stored_instance *made;
  exec_bench_open(&b);
  exec_case_open(&b, &c, exec_named(&b, "a spawn makes an instance in a container"));
  run = exec_run(&c);
  CHECK_INT(stmt_spawn(&run, &c.frame, exec_first_statement(&c), &id), SPROUT_EVAL_OK);
  made = sprout_draft_instance(&c.draft, id);
  CHECK(made != NULL);
  CHECK_STR(made->kind->qualified, "exec_bench.Jar");
  CHECK_BYTES(made->container.bytes, made->container.length, "exec_bench.hall");
  CHECK_INT(c.x.queued_count, 2);
  CHECK_INT(c.x.queued[0].message, SPROUT_MSG_ENTERED);
  CHECK_BYTES(c.x.queued[0].recipient.bytes, c.x.queued[0].recipient.length, "exec_bench.hall");
  CHECK_INT(c.x.queued[1].message, SPROUT_MSG_SPAWNED);
  CHECK(sprout_str_same(c.x.queued[1].recipient, id));
  CHECK_INT(c.meter.spawns, 1);
  exec_case_close(&c);
  exec_bench_close(&b);
}

static void a_spawn_is_given_what_its_kind_holds_and_charged_for_each(void) {
  exec_bench b;
  exec_case c;
  sprout_run run;
  sprout_str id;
  exec_bench_open(&b);
  exec_case_open(&b, &c, exec_named(&b, "a spawn is given what its kind holds"));
  run = exec_run(&c);
  CHECK_INT(stmt_spawn(&run, &c.frame, exec_first_statement(&c), &id), SPROUT_EVAL_OK);
  CHECK_INT(c.meter.spawns, 2);
  exec_case_close(&c);
  exec_bench_close(&b);
}

static void a_spawn_out_of_range_or_into_what_holds_nothing_faults(void) {
  exec_bench b;
  exec_case far, nothing;
  sprout_run run;
  sprout_str id;
  exec_bench_open(&b);
  exec_case_open(&b, &far, exec_named(&b, "a spawn out of range faults"));
  run = exec_run(&far);
  CHECK_INT(stmt_spawn(&run, &far.frame, exec_first_statement(&far), &id), SPROUT_EVAL_FAULT);
  CHECK_STR(far.fault.name, "LifecycleFault");
  exec_case_open(&b, &nothing, exec_named(&b, "a spawn into what holds nothing faults"));
  run = exec_run(&nothing);
  CHECK_INT(stmt_spawn(&run, &nothing.frame, exec_first_statement(&nothing), &id), SPROUT_EVAL_FAULT);
  CHECK_STR(nothing.fault.text, "`exec_bench.hall.shelf.cup` holds nothing, so `Jar` could not be spawned in it.");
  exec_case_close(&nothing);
  exec_case_close(&far);
  exec_bench_close(&b);
}

static void destroy_takes_effect_where_the_body_ends_and_removes_what_the_object_held(void) {
  exec_bench b;
  exec_case c;
  sprout_run run;
  exec_bench_open(&b);
  exec_case_open(&b, &c, exec_named(&b, "a destroyed container takes what it held"));
  run = exec_run(&c);
  CHECK_INT(stmt_destroy(&run, &c.frame, sprout_node_get(exec_body_of(&c), "statements")->items[1]), SPROUT_EVAL_OK);
  CHECK(run.destroying);
  CHECK(!run.finally);
  /* Nothing is removed until the body ends. */
  CHECK(sprout_draft_instance(&c.draft, c.frame.self) != NULL);
  CHECK_INT(stmt_remove(&c.x, &c.frame, c.frame.self), SPROUT_EVAL_OK);
  CHECK(sprout_draft_instance(&c.draft, c.frame.self) == NULL);
  /* The crate and the lid it gave. */
  CHECK_INT(c.x.destroyed_count, 2);
  exec_case_close(&c);
  exec_bench_close(&b);
}

static void finally_destroy_marks_the_object_for_the_end_of_the_queue(void) {
  exec_bench b;
  exec_case c;
  sprout_run run;
  exec_bench_open(&b);
  exec_case_open(&b, &c, exec_named(&b, "finally destroy waits until the queue is empty"));
  run = exec_run(&c);
  CHECK_INT(stmt_destroy(&run, &c.frame, sprout_node_get(exec_body_of(&c), "statements")->items[1]), SPROUT_EVAL_OK);
  CHECK(run.finally);
  CHECK(!run.destroying);
  exec_case_close(&c);
  exec_bench_close(&b);
}

static void the_world_and_a_person_are_never_destroyed(void) {
  exec_bench b;
  exec_case c;
  exec_bench_open(&b);
  exec_case_open(&b, &c, exec_named(&b, "destroy takes effect where the body ends"));
  CHECK_INT(stmt_remove(&c.x, &c.frame, exec_str("exec_bench")), SPROUT_EVAL_FAULT);
  CHECK_STR(c.fault.name, "LifecycleFault");
  CHECK_STR(c.fault.text, "the world cannot be destroyed.");
  CHECK_INT(stmt_remove(&c.x, &c.frame, exec_str("exec_bench#1")), SPROUT_EVAL_FAULT);
  CHECK_STR(c.fault.text, "`exec_bench#1` is a visitor, and a person is never destroyed.");
  exec_case_close(&c);
  exec_bench_close(&b);
}

static void the_golden_lifecycle_cases_end_as_the_typescript_runtime_did(void) {
  exec_bench b;
  exec_bench_open(&b);
  CHECK(exec_replay_area(&b, "spawn") >= 6);
  CHECK(exec_replay_area(&b, "destroy") >= 4);
  exec_bench_close(&b);
  CHECK_INT(b.heap.pages, 0);
}

int main(void) {
  RUN(a_spawn_makes_an_instance_in_the_container_and_tells_the_world);
  RUN(a_spawn_is_given_what_its_kind_holds_and_charged_for_each);
  RUN(a_spawn_out_of_range_or_into_what_holds_nothing_faults);
  RUN(destroy_takes_effect_where_the_body_ends_and_removes_what_the_object_held);
  RUN(finally_destroy_marks_the_object_for_the_end_of_the_queue);
  RUN(the_world_and_a_person_are_never_destroyed);
  RUN(the_golden_lifecycle_cases_end_as_the_typescript_runtime_did);
  return REPORT();
}
