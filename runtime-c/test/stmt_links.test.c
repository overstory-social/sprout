/*
 * Tests for src/stmt/links.c (the spec's Verbs > Links, for space that does
 * not exist yet): `connect` writes `self`'s link of that name to the place a
 * binding holds, replacing where it led; a destination that holds no actors
 * faults, and so does one that is not in the world.
 */
#include "exec_fixture.h"

/* Spawns the place the body's first `let` makes and binds it as `name`. */
static sprout_str spawned_as(exec_case *c, sprout_run *run, const char *name) {
  sprout_str id;
  const sprout_node *spawn = sprout_node_get(sprout_node_get(exec_body_of(c), "statements")->items[0], "value");
  if (stmt_spawn(run, &c->frame, spawn, &id) != SPROUT_EVAL_OK) exit(2);
  c->frame.bindings = sprout_bind(&c->frame, name, sprout_evaluated_object(id));
  return id;
}

static void connect_leads_a_link_of_self_to_a_place(void) {
  exec_bench b;
  exec_case c;
  sprout_run run;
  sprout_str place;
  const sprout_stored_instance *cell;
  exec_bench_open(&b);
  exec_case_open(&b, &c, exec_named(&b, "connect leads a link to a place"));
  run = exec_run(&c);
  place = spawned_as(&c, &run, "c");
  CHECK_INT(stmt_connect(&run, &c.frame, sprout_node_get(exec_body_of(&c), "statements")->items[1]), SPROUT_EVAL_OK);
  cell = sprout_draft_instance(&c.draft, c.frame.self);
  CHECK_INT(cell->link_count, 1);
  CHECK_BYTES(cell->links[0].name.bytes, cell->links[0].name.length, "onward");
  CHECK(sprout_str_same(cell->links[0].to, place));
  exec_case_close(&c);
  exec_bench_close(&b);
}

static void connecting_a_link_again_replaces_where_it_leads(void) {
  exec_bench b;
  exec_case c;
  sprout_run run;
  sprout_str first, second;
  const sprout_node *statements;
  exec_bench_open(&b);
  exec_case_open(&b, &c, exec_named(&b, "connecting a link again replaces where it leads"));
  run = exec_run(&c);
  statements = sprout_node_get(exec_body_of(&c), "statements");
  first = spawned_as(&c, &run, "c");
  CHECK_INT(stmt_connect(&run, &c.frame, statements->items[1]), SPROUT_EVAL_OK);
  CHECK_INT(stmt_spawn(&run, &c.frame, sprout_node_get(statements->items[2], "value"), &second), SPROUT_EVAL_OK);
  c.frame.bindings = sprout_bind(&c.frame, "d", sprout_evaluated_object(second));
  CHECK_INT(stmt_connect(&run, &c.frame, statements->items[3]), SPROUT_EVAL_OK);
  CHECK_INT(sprout_draft_instance(&c.draft, c.frame.self)->link_count, 1);
  CHECK(sprout_str_same(sprout_draft_instance(&c.draft, c.frame.self)->links[0].to, second));
  CHECK(!sprout_str_same(first, second));
  exec_case_close(&c);
  exec_bench_close(&b);
}

static void a_link_cannot_lead_to_what_holds_no_actors(void) {
  exec_bench b;
  exec_case c;
  sprout_run run;
  sprout_ended ended = {0};
  exec_bench_open(&b);
  exec_case_open(&b, &c, exec_named(&b, "a link cannot lead to what holds no actors"));
  run = exec_run(&c);
  CHECK_INT(stmt_each(&run, &c.frame, exec_first_statement(&c), &ended), SPROUT_EVAL_FAULT);
  CHECK_STR(c.fault.name, "ConnectFault");
  CHECK_STR(c.fault.text, "`exec_bench.hall.shelf.jar` holds no actors, so `exec_bench.hall.cell`'s link onward could not lead there.");
  exec_case_close(&c);
  exec_bench_close(&b);
}

static void the_golden_connect_cases_end_as_the_typescript_runtime_did(void) {
  exec_bench b;
  exec_bench_open(&b);
  CHECK(exec_replay_area(&b, "connect") >= 3);
  exec_bench_close(&b);
  CHECK_INT(b.heap.pages, 0);
}

int main(void) {
  RUN(connect_leads_a_link_of_self_to_a_place);
  RUN(connecting_a_link_again_replaces_where_it_leads);
  RUN(a_link_cannot_lead_to_what_holds_no_actors);
  RUN(the_golden_connect_cases_end_as_the_typescript_runtime_did);
  return REPORT();
}
