/*
 * Tests for src/stmt/write.c (the spec's Properties > What the compiler
 * checks, Lists, Per-actor memory; The world model: only `self` writes
 * `self`): `set`, `adjust`, `add` and `remove` on `self`, and `remember` and
 * `adjust` on what `self` remembers about an actor. A value the property
 * cannot hold faults, `adjust` clamps, adding a new element to a full list
 * faults, and a write that changes a watched property queues its hook with
 * the value it replaced. A write through another object is the engine's
 * defect.
 */
#include "exec_fixture.h"

static sprout_value read_property(exec_case *c, const char *id, const char *name) {
  sprout_value value;
  const sprout_stored_instance *instance = sprout_draft_instance(&c->draft, exec_str(id));
  CHECK_INT(expr_get(&c->frame, instance, name, &value), SPROUT_EVAL_OK);
  return value;
}

/* The write inside the `if` a memory case is written in. */
static const sprout_node *written_in_the_branch(const exec_case *c) {
  const sprout_node *branch = sprout_node_get(exec_first_statement(c), "then");
  return sprout_node_get(branch, "statements")->items[0];
}

static void set_writes_a_value_the_property_holds(void) {
  exec_bench b;
  exec_case c;
  sprout_run run;
  sprout_value value;
  exec_bench_open(&b);
  exec_case_open(&b, &c, exec_named(&b, "set a string"));
  run = exec_run(&c);
  CHECK_INT(stmt_write(&run, &c.frame, exec_first_statement(&c)), SPROUT_EVAL_OK);
  value = read_property(&c, "exec_bench.hall.runner", "label");
  CHECK_BYTES(value.as.string.bytes, value.as.string.length, "sugar");
  exec_case_close(&c);
  exec_bench_close(&b);
}

static void adjust_clamps_to_the_range_the_property_declares(void) {
  exec_bench b;
  exec_case top, bottom;
  sprout_run run;
  exec_bench_open(&b);
  exec_case_open(&b, &top, exec_named(&b, "adjust clamps at the top"));
  run = exec_run(&top);
  CHECK_INT(stmt_write(&run, &top.frame, exec_first_statement(&top)), SPROUT_EVAL_OK);
  CHECK_INT(exec_property(&top, "exec_bench.hall.runner", "count"), 9);
  exec_case_open(&b, &bottom, exec_named(&b, "adjust clamps at the bottom"));
  run = exec_run(&bottom);
  CHECK_INT(stmt_write(&run, &bottom.frame, exec_first_statement(&bottom)), SPROUT_EVAL_OK);
  CHECK_INT(exec_property(&bottom, "exec_bench.hall.runner", "count"), 0);
  exec_case_close(&bottom);
  exec_case_close(&top);
  exec_bench_close(&b);
}

static void a_value_the_property_cannot_hold_faults_in_the_words_of_the_rule(void) {
  exec_bench b;
  exec_case c;
  sprout_run run;
  exec_bench_open(&b);
  exec_case_open(&b, &c, exec_named(&b, "a value the property cannot hold faults"));
  run = exec_run(&c);
  CHECK_INT(stmt_write(&run, &c.frame, exec_first_statement(&c)), SPROUT_EVAL_FAULT);
  CHECK_STR(c.fault.name, "ValueOutOfRange");
  CHECK_STR(c.fault.text, "`exec_bench.hall.runner` cannot hold 16 in `:count`.");
  CHECK_INT(exec_property(&c, "exec_bench.hall.runner", "count"), 4);
  exec_case_close(&c);
  exec_bench_close(&b);
}

static void add_and_remove_change_a_list_and_a_full_list_faults(void) {
  exec_bench b;
  exec_case add, same, remove, full;
  sprout_run run;
  exec_bench_open(&b);
  exec_case_open(&b, &add, exec_named(&b, "add an element to a list"));
  run = exec_run(&add);
  CHECK_INT(stmt_write(&run, &add.frame, exec_first_statement(&add)), SPROUT_EVAL_OK);
  CHECK_INT(read_property(&add, "exec_bench.hall.runner", "wards").as.list->count, 2);
  exec_case_open(&b, &same, exec_named(&b, "add an element the list holds"));
  run = exec_run(&same);
  CHECK_INT(stmt_write(&run, &same.frame, exec_first_statement(&same)), SPROUT_EVAL_OK);
  CHECK_INT(read_property(&same, "exec_bench.hall.runner", "wards").as.list->count, 1);
  exec_case_open(&b, &remove, exec_named(&b, "remove an element from a list"));
  run = exec_run(&remove);
  CHECK_INT(stmt_write(&run, &remove.frame, exec_first_statement(&remove)), SPROUT_EVAL_OK);
  CHECK_INT(read_property(&remove, "exec_bench.hall.runner", "wards").as.list->count, 0);
  exec_case_open(&b, &full, exec_named(&b, "a new element in a full list faults"));
  run = exec_run(&full);
  CHECK_INT(stmt_write(&run, &full.frame, exec_first_statement(&full)), SPROUT_EVAL_FAULT);
  CHECK_STR(full.fault.name, "ListFull");
  CHECK_STR(full.fault.text, "a list of Glaze already holds 1");
  exec_case_close(&full);
  exec_case_close(&remove);
  exec_case_close(&same);
  exec_case_close(&add);
  exec_bench_close(&b);
}

static void a_change_to_a_watched_property_queues_its_hook_with_the_value_it_replaced(void) {
  exec_bench b;
  exec_case changed, unchanged;
  sprout_run run;
  exec_bench_open(&b);
  exec_case_open(&b, &changed, exec_named(&b, "a write that changes a watched property queues its hook"));
  run = exec_run(&changed);
  CHECK_INT(stmt_write(&run, &changed.frame, exec_first_statement(&changed)), SPROUT_EVAL_OK);
  CHECK_INT(changed.x.queued_count, 1);
  CHECK_INT(changed.x.queued[0].message, SPROUT_MSG_CHANGED);
  CHECK_STR(changed.x.queued[0].property, "count");
  CHECK(changed.x.queued[0].was.kind == SPROUT_NUMBER && changed.x.queued[0].was.as.number == 4);
  exec_case_open(&b, &unchanged, exec_named(&b, "a write that changes nothing queues no hook"));
  run = exec_run(&unchanged);
  CHECK_INT(stmt_write(&run, &unchanged.frame, exec_first_statement(&unchanged)), SPROUT_EVAL_OK);
  CHECK_INT(unchanged.x.queued_count, 0);
  exec_case_close(&unchanged);
  exec_case_close(&changed);
  exec_bench_close(&b);
}

static void memory_is_written_about_an_actor_and_adjusted_from_what_was_written(void) {
  exec_bench b;
  exec_case c;
  sprout_run run;
  sprout_value value;
  exec_bench_open(&b);
  exec_case_open(&b, &c, exec_named(&b, "adjust on memory steps from what was written"));
  run = exec_run(&c);
  CHECK_INT(stmt_write(&run, &c.frame, written_in_the_branch(&c)), SPROUT_EVAL_OK);
  CHECK_INT(expr_recalled(&c.frame, exec_str("exec_bench#1"), "visits", &value), SPROUT_EVAL_OK);
  /* The worn runner remembered 5 visits of the visitor; 3 more is 8. */
  CHECK_INT(value.as.number, 8);
  exec_case_close(&c);
  exec_bench_close(&b);
}

static void only_self_writes_self(void) {
  exec_bench b;
  exec_case c;
  sprout_run run;
  exec_bench_open(&b);
  exec_case_open(&b, &c, exec_named(&b, "only self writes self"));
  run = exec_run(&c);
  CHECK_INT(stmt_write(&run, &c.frame, exec_first_statement(&c)), SPROUT_EVAL_ENGINE);
  CHECK_STR(c.fault.text, "`set` on another object reached the runtime; only `self` writes `self`.");
  exec_case_close(&c);
  exec_bench_close(&b);
}

static void the_golden_write_and_if_cases_end_as_the_typescript_runtime_did(void) {
  exec_bench b;
  exec_bench_open(&b);
  CHECK(exec_replay_area(&b, "write") >= 18);
  CHECK(exec_replay_area(&b, "if") >= 5);
  exec_bench_close(&b);
  CHECK_INT(b.heap.pages, 0);
}

int main(void) {
  RUN(set_writes_a_value_the_property_holds);
  RUN(adjust_clamps_to_the_range_the_property_declares);
  RUN(a_value_the_property_cannot_hold_faults_in_the_words_of_the_rule);
  RUN(add_and_remove_change_a_list_and_a_full_list_faults);
  RUN(a_change_to_a_watched_property_queues_its_hook_with_the_value_it_replaced);
  RUN(memory_is_written_about_an_actor_and_adjusted_from_what_was_written);
  RUN(only_self_writes_self);
  RUN(the_golden_write_and_if_cases_end_as_the_typescript_runtime_did);
  return REPORT();
}
