/*
 * Tests for src/bus.c (the spec's Events, messages and the bus; Limits >
 * Runtime budgets): a message is queued, never called; the queue drains
 * breadth-first, in insertion order; each delivery that runs a handler or a
 * hook is one event, one deeper than what sent it against the cascade depth;
 * a delivery to something with no handler costs nothing; a destroyed object's
 * sends and what is queued to it are dropped; and what `finally destroy self`
 * marked goes once the queue is empty.
 */
#include "exec_fixture.h"
#include "stmt/stmt.h"

static const sprout_message *message_named(const exec_case *c, const char *name) {
  size_t i;
  for (i = 0; i < c->world->message_count; i++)
    if (strcmp(c->world->messages[i].name, name) == 0) return &c->world->messages[i];
  exit(2);
}

static sprout_send authored(const exec_case *c, const char *message, const char *from, const char *to) {
  sprout_send send;
  memset(&send, 0, sizeof send);
  send.message = SPROUT_MSG_AUTHORED;
  send.declared = message_named(c, message);
  send.recipient = exec_str(to);
  send.has_from = true;
  send.from = exec_str(from);
  return send;
}

static void a_queued_message_carries_the_depth_of_the_body_that_queued_it(void) {
  exec_bench b;
  exec_case c;
  sprout_send send = {0};
  exec_bench_open(&b);
  exec_case_open(&b, &c, exec_named(&b, "a send is delivered once the body has ended, and answered"));
  send = authored(&c, "ping", "exec_bench.hall.runner", "exec_bench.hall.bell");
  CHECK_INT(sprout_exec_queue(&c.x, &send), SPROUT_EVAL_OK);
  c.x.depth = 3;
  CHECK_INT(sprout_exec_queue(&c.x, &send), SPROUT_EVAL_OK);
  CHECK_INT(c.x.queued_count, 2);
  CHECK_INT(c.x.queued[0].depth, 1);
  CHECK_INT(c.x.queued[1].depth, 3);
  exec_case_close(&c);
  exec_bench_close(&b);
}

static void the_queue_drains_breadth_first_and_a_handlers_sends_wait_behind_it(void) {
  exec_bench b;
  exec_case c;
  sprout_send send;
  exec_bench_open(&b);
  exec_case_open(&b, &c, exec_named(&b, "sends are delivered in the order queued, breadth-first"));
  send = authored(&c, "ping", "exec_bench.hall.runner", "exec_bench.hall.bell");
  CHECK_INT(sprout_exec_queue(&c.x, &send), SPROUT_EVAL_OK);
  send = authored(&c, "ping", "exec_bench.hall.runner", "exec_bench.hall.lamp");
  CHECK_INT(sprout_exec_queue(&c.x, &send), SPROUT_EVAL_OK);
  CHECK_INT(sprout_exec_drain(&c.x), SPROUT_EVAL_OK);
  /* The bell, the lamp, and then the bell's answer to the runner, which the bell sent while it ran. */
  CHECK_INT(c.x.ran_count, 3);
  CHECK_STR(c.x.ran[0].origin, "exec_bench.Bell");
  CHECK_STR(c.x.ran[1].origin, "exec_bench.Lamp");
  CHECK_STR(c.x.ran[2].origin, "exec_bench.Runner");
  CHECK_STR(c.x.ran[2].on, "exec_bench.pong");
  CHECK_INT(c.x.events, 3);
  CHECK_INT(c.x.queue_head, c.x.queue_count);
  exec_case_close(&c);
  exec_bench_close(&b);
}

static void a_delivery_to_something_with_no_handler_costs_nothing(void) {
  exec_bench b;
  exec_case c;
  sprout_send send;
  exec_bench_open(&b);
  exec_case_open(&b, &c, exec_named(&b, "a send is delivered once the body has ended, and answered"));
  send = authored(&c, "ping", "exec_bench.hall.runner", "exec_bench.hall.shelf");
  CHECK_INT(sprout_exec_queue(&c.x, &send), SPROUT_EVAL_OK);
  CHECK_INT(sprout_exec_drain(&c.x), SPROUT_EVAL_OK);
  CHECK_INT(c.x.events, 0);
  CHECK_INT(c.meter.events, 0);
  exec_case_close(&c);
  exec_bench_close(&b);
}

static void a_destroyed_objects_sends_and_deliveries_are_dropped(void) {
  exec_bench b;
  exec_case c;
  sprout_send send;
  sprout_str *gone;
  exec_bench_open(&b);
  exec_case_open(&b, &c, exec_named(&b, "a send is delivered once the body has ended, and answered"));
  /* Sent by the runner, who is destroyed: the bell never hears it. */
  send = authored(&c, "ping", "exec_bench.hall.runner", "exec_bench.hall.bell");
  CHECK_INT(sprout_exec_queue(&c.x, &send), SPROUT_EVAL_OK);
  /* Sent to the lamp, which is destroyed with it. */
  send = authored(&c, "ping", "exec_bench.hall.bell", "exec_bench.hall.lamp");
  CHECK_INT(sprout_exec_queue(&c.x, &send), SPROUT_EVAL_OK);
  gone = (sprout_str *)sprout_exec_grow(&c.turn, (void **)&c.x.destroyed, &c.x.destroyed_count, &c.x.destroyed_capacity,
                                        sizeof *c.x.destroyed);
  *gone = exec_str("exec_bench.hall.runner");
  gone = (sprout_str *)sprout_exec_grow(&c.turn, (void **)&c.x.destroyed, &c.x.destroyed_count, &c.x.destroyed_capacity,
                                        sizeof *c.x.destroyed);
  *gone = exec_str("exec_bench.hall.lamp");
  CHECK_INT(sprout_exec_drain(&c.x), SPROUT_EVAL_OK);
  CHECK_INT(c.x.events, 0);
  CHECK_INT(c.x.gone_count, 2);
  exec_case_close(&c);
  exec_bench_close(&b);
}

static void a_cascade_past_the_depth_budget_faults_at_the_hosts_figure(void) {
  exec_bench b;
  exec_case c;
  sprout_send send;
  exec_bench_open(&b);
  exec_case_open(&b, &c, exec_named(&b, "a cascade within a smaller depth budget faults at it"));
  send = authored(&c, "chain", "exec_bench.hall.runner", "exec_bench.hall.bell");
  send.has_value = true;
  send.value = sprout_number(2);
  CHECK_INT(sprout_exec_queue(&c.x, &send), SPROUT_EVAL_OK);
  CHECK_INT(sprout_exec_drain(&c.x), SPROUT_EVAL_FAULT);
  CHECK_STR(c.fault.name, "BudgetExhausted");
  CHECK_STR(c.meter.fault.budget, "cascade depth");
  CHECK_INT(c.meter.fault.limit, 5);
  exec_case_close(&c);
  exec_bench_close(&b);
}

static void events_past_the_budget_fault_at_the_hosts_figure(void) {
  exec_bench b;
  exec_case c;
  sprout_send send;
  exec_bench_open(&b);
  exec_case_open(&b, &c, exec_named(&b, "events past the budget fault"));
  send = authored(&c, "chain", "exec_bench.hall.runner", "exec_bench.hall.bell");
  send.has_value = true;
  send.value = sprout_number(3);
  CHECK_INT(sprout_exec_queue(&c.x, &send), SPROUT_EVAL_OK);
  CHECK_INT(sprout_exec_drain(&c.x), SPROUT_EVAL_FAULT);
  CHECK_STR(c.meter.fault.budget, "events");
  CHECK_INT(c.meter.fault.limit, 4);
  exec_case_close(&c);
  exec_bench_close(&b);
}

static void the_golden_bus_cases_end_as_the_typescript_runtime_did(void) {
  exec_bench b;
  exec_bench_open(&b);
  CHECK(exec_replay_area(&b, "bus") >= 4);
  CHECK(exec_replay_area(&b, "destroy") >= 4);
  exec_bench_close(&b);
  CHECK_INT(b.heap.pages, 0);
}

int main(void) {
  RUN(a_queued_message_carries_the_depth_of_the_body_that_queued_it);
  RUN(the_queue_drains_breadth_first_and_a_handlers_sends_wait_behind_it);
  RUN(a_delivery_to_something_with_no_handler_costs_nothing);
  RUN(a_destroyed_objects_sends_and_deliveries_are_dropped);
  RUN(a_cascade_past_the_depth_budget_faults_at_the_hosts_figure);
  RUN(events_past_the_budget_fault_at_the_hosts_figure);
  RUN(the_golden_bus_cases_end_as_the_typescript_runtime_did);
  return REPORT();
}
