/*
 * Tests for src/stmt/paths.c (the spec's Identifiers and scope; Verbs >
 * Moving something, Acting): an object a statement names is a binding, or an
 * identifier or dotted path the name table resolved. A thing, a container and
 * a role are read through in range of `self`; a `move`'s destination is read
 * under the move's own rule; a `send`'s target is read whatever its range,
 * since the send itself asks.
 */
#include "exec_fixture.h"

/* The path a statement names under `key`. */
static const sprout_node *path_in(const exec_case *c, const char *key) {
  return sprout_node_get(exec_first_statement(c), key);
}

static void a_lone_binding_is_read_as_the_object_it_is_bound_to(void) {
  exec_bench b;
  exec_case c;
  sprout_str thing;
  exec_bench_open(&b);
  exec_case_open(&b, &c, exec_named(&b, "a move of what is out of range faults"));
  /* `move who to shelf`: `who` is bound, so it is read without the range a name must be in. */
  CHECK_INT(stmt_object_at(&c.frame, path_in(&c, "thing"), &thing), SPROUT_EVAL_OK);
  CHECK_BYTES(thing.bytes, thing.length, "exec_bench.hall.chest.bin");
  CHECK_INT(c.meter.steps, 1);
  exec_case_close(&c);
  exec_bench_close(&b);
}

static void a_dotted_path_is_read_through_in_range(void) {
  exec_bench b;
  exec_case c;
  sprout_str destination, thing;
  exec_bench_open(&b);
  exec_case_open(&b, &c, exec_named(&b, "a move that every party allows"));
  CHECK_INT(stmt_object_at(&c.frame, path_in(&c, "thing"), &thing), SPROUT_EVAL_OK);
  CHECK_BYTES(thing.bytes, thing.length, "exec_bench.hall.shelf.jar");
  CHECK_INT(stmt_destination_at(&c.frame, path_in(&c, "destination"), &destination), SPROUT_EVAL_OK);
  CHECK_BYTES(destination.bytes, destination.length, "exec_bench.hall.basket");
  exec_case_close(&c);
  exec_bench_close(&b);
}

static void a_name_behind_a_shut_chest_is_out_of_range_when_read_through(void) {
  exec_bench b;
  exec_case c;
  sprout_str target;
  bool found = false;
  exec_bench_open(&b);
  exec_case_open(&b, &c, exec_named(&b, "a send to what is out of range goes nowhere"));
  CHECK_INT(stmt_object_at(&c.frame, path_in(&c, "target"), &target), SPROUT_EVAL_FAULT);
  CHECK_STR(c.fault.name, "NameOutOfRange");
  /* A send's target is read whatever its range: the send asks. */
  CHECK_INT(stmt_target_at(&c.frame, path_in(&c, "target"), &target, &found), SPROUT_EVAL_OK);
  CHECK(found);
  CHECK_BYTES(target.bytes, target.length, "exec_bench.hall.chest.coin");
  exec_case_close(&c);
  exec_bench_close(&b);
}

static void a_path_is_written_as_it_was_typed(void) {
  exec_bench b;
  exec_case c;
  const char *written;
  exec_bench_open(&b);
  exec_case_open(&b, &c, exec_named(&b, "a move that every party allows"));
  CHECK_INT(stmt_written(&c.frame, path_in(&c, "thing"), &written), SPROUT_EVAL_OK);
  CHECK_STR(written, "exec_bench.hall.shelf.jar");
  CHECK_INT(stmt_written(&c.frame, path_in(&c, "destination"), &written), SPROUT_EVAL_OK);
  CHECK_STR(written, "exec_bench.hall.basket");
  exec_case_close(&c);
  exec_bench_close(&b);
}

static void self_is_a_path_that_names_the_running_object(void) {
  exec_bench b;
  exec_case c;
  sprout_evaluated evaluated;
  exec_bench_open(&b);
  exec_case_open(&b, &c, exec_named(&b, "an actor moved between places is told, and the places tell their people"));
  CHECK_INT(stmt_evaluated_at(&c.frame, path_in(&c, "thing"), &evaluated), SPROUT_EVAL_OK);
  CHECK_INT(evaluated.binds, SPROUT_BINDS_OBJECT);
  CHECK(sprout_str_same(evaluated.id, exec_str("exec_bench.hall.dog")));
  exec_case_close(&c);
  exec_bench_close(&b);
}

int main(void) {
  RUN(a_lone_binding_is_read_as_the_object_it_is_bound_to);
  RUN(a_dotted_path_is_read_through_in_range);
  RUN(a_name_behind_a_shut_chest_is_out_of_range_when_read_through);
  RUN(a_path_is_written_as_it_was_typed);
  RUN(self_is_a_path_that_names_the_running_object);
  return REPORT();
}
