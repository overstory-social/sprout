/* Tests for src/budget.c: every budget faults at the host's number, and none has a number of its own. */
#include "budget.h"
#include "check.h"

static sprout_host host_with(test_heap *heap) { return test_host(heap); }

static sprout_limit limit(uint64_t n) {
  sprout_limit one = {true, n};
  return one;
}

static void the_step_budget_faults_on_the_step_past_the_hosts_figure(void) {
  test_heap heap;
  sprout_host host = host_with(&heap);
  sprout_meter meter;
  for (uint64_t figure = 1; figure <= 7; figure += 3) {
    host.budgets.steps = limit(figure);
    sprout_meter_begin(&meter, &host, SPROUT_TURN_COMMAND);
    for (uint64_t i = 0; i < figure; i++) CHECK(sprout_meter_steps(&meter, 1));
    CHECK(!meter.faulted);
    CHECK(!sprout_meter_steps(&meter, 1));
    CHECK(meter.faulted);
    CHECK_INT(meter.fault.limit, figure);
  }
}

static void a_charge_of_many_steps_is_all_or_nothing(void) {
  test_heap heap;
  sprout_host host = host_with(&heap);
  sprout_meter meter;
  host.budgets.steps = limit(10);
  sprout_meter_begin(&meter, &host, SPROUT_TURN_COMMAND);
  CHECK(sprout_meter_steps(&meter, 10));
  sprout_meter_begin(&meter, &host, SPROUT_TURN_COMMAND);
  CHECK(!sprout_meter_steps(&meter, 11));
  CHECK_INT(meter.steps, 0);
}

static void a_budget_the_host_leaves_unset_is_unbounded(void) {
  test_heap heap;
  sprout_host host = host_with(&heap);
  sprout_meter meter;
  uint64_t held = 0;
  sprout_meter_begin(&meter, &host, SPROUT_TURN_COMMAND);
  CHECK(sprout_meter_steps(&meter, 1000000000ull));
  CHECK(sprout_meter_steps(&meter, 1000000000ull));
  for (int i = 0; i < 1000; i++) {
    CHECK(sprout_meter_event(&meter));
    CHECK(sprout_meter_spawn(&meter));
    CHECK(sprout_meter_effect(&meter));
    CHECK(sprout_meter_enter_cascade(&meter));
    CHECK(sprout_meter_enter_passage(&meter));
  }
  CHECK(sprout_meter_set_role(&meter, 1000000));
  CHECK(sprout_meter_pending_wakes(&meter, 1000000));
  CHECK(sprout_meter_clock(&meter));
  CHECK_INT(sprout_meter_output(&meter, &held, 1000000, true), SPROUT_OUTPUT_FITS);
  CHECK_INT(sprout_wake_seconds(&host.budgets, 0), 0);
  CHECK(sprout_people_allowed(&host.budgets, 1000000));
  CHECK(sprout_nickname_allowed(&host.budgets, 1000000));
  CHECK(!meter.faulted);
  CHECK(sprout_meter_steps(&meter, UINT64_MAX - 2000000000ull));
  CHECK(!sprout_meter_steps(&meter, UINT64_MAX));
}

static void a_poll_is_charged_to_the_poll_budget_and_a_command_to_the_turn_budget(void) {
  test_heap heap;
  sprout_host host = host_with(&heap);
  sprout_meter meter;
  host.budgets.steps = limit(100);
  host.budgets.poll_steps = limit(3);
  sprout_meter_begin(&meter, &host, SPROUT_TURN_POLL);
  CHECK(sprout_meter_steps(&meter, 3));
  CHECK(!sprout_meter_steps(&meter, 1));
  CHECK_INT(meter.fault.limit, 3);
  sprout_meter_begin(&meter, &host, SPROUT_TURN_COMMAND);
  CHECK(sprout_meter_steps(&meter, 100));
  sprout_meter_begin(&meter, &host, SPROUT_TURN_WAKE);
  CHECK(!sprout_meter_steps(&meter, 101));
  CHECK_INT(meter.fault.limit, 100);
}

static void a_fault_names_the_message_the_budget_and_the_figure_in_words(void) {
  test_heap heap;
  sprout_host host = host_with(&heap);
  sprout_meter meter;
  host.budgets.steps = limit(5);
  sprout_meter_begin(&meter, &host, SPROUT_TURN_COMMAND);
  sprout_meter_message(&meter, 3);
  CHECK(sprout_meter_steps(&meter, 5));
  sprout_meter_message(&meter, 12);
  CHECK(!sprout_meter_steps(&meter, 1));
  CHECK_INT(meter.fault.message, 12);
  CHECK_STR(meter.fault.budget, "steps");
  CHECK_STR(meter.fault.text,
            "This turn used more steps than the host allows (5) while running message 12, so it was "
            "stopped and nothing it did was kept.");
}

static void once_faulted_every_later_charge_refuses(void) {
  test_heap heap;
  sprout_host host = host_with(&heap);
  sprout_meter meter;
  uint64_t held = 0;
  host.budgets.events = limit(1);
  sprout_meter_begin(&meter, &host, SPROUT_TURN_COMMAND);
  CHECK(sprout_meter_event(&meter));
  CHECK(!sprout_meter_event(&meter));
  CHECK(!sprout_meter_steps(&meter, 1));
  CHECK(!sprout_meter_spawn(&meter));
  CHECK_INT(sprout_meter_output(&meter, &held, 1, true), SPROUT_OUTPUT_FAULT);
  CHECK_STR(meter.fault.budget, "events");
}

static void each_counted_budget_faults_at_its_own_figure(void) {
  test_heap heap;
  sprout_host host = host_with(&heap);
  sprout_meter meter;
  host.budgets.events = limit(2);
  host.budgets.spawns = limit(3);
  host.budgets.extension_effects = limit(4);
  host.budgets.cascade_depth = limit(5);
  host.budgets.passage_depth = limit(6);
  sprout_meter_begin(&meter, &host, SPROUT_TURN_COMMAND);
  for (int i = 0; i < 2; i++) CHECK(sprout_meter_event(&meter));
  CHECK(!sprout_meter_event(&meter));
  CHECK_INT(meter.fault.limit, 2);
  sprout_meter_begin(&meter, &host, SPROUT_TURN_COMMAND);
  for (int i = 0; i < 3; i++) CHECK(sprout_meter_spawn(&meter));
  CHECK(!sprout_meter_spawn(&meter));
  CHECK_INT(meter.fault.limit, 3);
  sprout_meter_begin(&meter, &host, SPROUT_TURN_COMMAND);
  for (int i = 0; i < 4; i++) CHECK(sprout_meter_effect(&meter));
  CHECK(!sprout_meter_effect(&meter));
  CHECK_INT(meter.fault.limit, 4);
  sprout_meter_begin(&meter, &host, SPROUT_TURN_COMMAND);
  for (int i = 0; i < 5; i++) CHECK(sprout_meter_enter_cascade(&meter));
  CHECK(!sprout_meter_enter_cascade(&meter));
  CHECK_INT(meter.fault.limit, 5);
  sprout_meter_begin(&meter, &host, SPROUT_TURN_COMMAND);
  for (int i = 0; i < 6; i++) CHECK(sprout_meter_enter_passage(&meter));
  CHECK(!sprout_meter_enter_passage(&meter));
  CHECK_INT(meter.fault.limit, 6);
}

static void depth_is_given_back_on_leaving_so_only_nesting_counts(void) {
  test_heap heap;
  sprout_host host = host_with(&heap);
  sprout_meter meter;
  host.budgets.passage_depth = limit(2);
  host.budgets.cascade_depth = limit(1);
  sprout_meter_begin(&meter, &host, SPROUT_TURN_COMMAND);
  for (int i = 0; i < 20; i++) {
    CHECK(sprout_meter_enter_passage(&meter));
    CHECK(sprout_meter_enter_passage(&meter));
    sprout_meter_leave_passage(&meter);
    sprout_meter_leave_passage(&meter);
    CHECK(sprout_meter_enter_cascade(&meter));
    sprout_meter_leave_cascade(&meter);
  }
  sprout_meter_leave_passage(&meter);
  CHECK_INT(meter.passage_depth, 0);
  CHECK(!meter.faulted);
}

static void a_set_role_and_pending_wakes_fault_past_the_hosts_figure(void) {
  test_heap heap;
  sprout_host host = host_with(&heap);
  sprout_meter meter;
  host.budgets.set_role_objects = limit(8);
  host.budgets.pending_wakes = limit(1);
  sprout_meter_begin(&meter, &host, SPROUT_TURN_COMMAND);
  CHECK(sprout_meter_set_role(&meter, 8));
  CHECK(!sprout_meter_set_role(&meter, 9));
  CHECK_INT(meter.fault.limit, 8);
  sprout_meter_begin(&meter, &host, SPROUT_TURN_COMMAND);
  CHECK(sprout_meter_pending_wakes(&meter, 1));
  CHECK(!sprout_meter_pending_wakes(&meter, 2));
  CHECK_INT(meter.fault.limit, 1);
}

static void output_faults_the_actor_and_cuts_off_anyone_else_at_the_whole_line(void) {
  test_heap heap;
  sprout_host host = host_with(&heap);
  sprout_meter meter;
  uint64_t actor = 0, other = 0;
  host.budgets.output = limit(10);
  sprout_meter_begin(&meter, &host, SPROUT_TURN_COMMAND);
  CHECK_INT(sprout_meter_output(&meter, &other, 6, false), SPROUT_OUTPUT_FITS);
  CHECK_INT(sprout_meter_output(&meter, &other, 5, false), SPROUT_OUTPUT_CUT);
  CHECK_INT(other, 6);
  CHECK_INT(sprout_meter_output(&meter, &other, 4, false), SPROUT_OUTPUT_FITS);
  CHECK_INT(other, 10);
  CHECK(!meter.faulted);
  CHECK_INT(sprout_meter_output(&meter, &actor, 10, true), SPROUT_OUTPUT_FITS);
  CHECK(!meter.faulted);
  CHECK_INT(sprout_meter_output(&meter, &actor, 1, true), SPROUT_OUTPUT_FAULT);
  CHECK(meter.faulted);
  CHECK_INT(meter.fault.limit, 10);
}

static uint64_t fake_now;
static uint64_t read_now(void *ctx) {
  (void)ctx;
  return fake_now;
}

static void the_wall_clock_backstop_reads_the_hosts_clock_at_the_hosts_figure(void) {
  test_heap heap;
  sprout_host host = host_with(&heap);
  sprout_meter meter;
  host.now = read_now;
  host.budgets.wall_clock_ms = limit(500);
  sprout_meter_begin(&meter, &host, SPROUT_TURN_COMMAND);
  fake_now = 500;
  CHECK(sprout_meter_clock(&meter));
  fake_now = 501;
  CHECK(!sprout_meter_clock(&meter));
  CHECK_STR(meter.fault.budget, "wall clock");
  CHECK_INT(meter.fault.limit, 500);
  host.budgets.wall_clock_ms.set = false;
  sprout_meter_begin(&meter, &host, SPROUT_TURN_COMMAND);
  fake_now = 1000000;
  CHECK(sprout_meter_clock(&meter));
}

static void the_wake_floor_nickname_and_crowd_follow_the_hosts_figures(void) {
  test_heap heap;
  sprout_host host = host_with(&heap);
  host.budgets.shortest_wake_seconds = limit(60);
  host.budgets.nickname_characters = limit(24);
  host.budgets.people_per_place = limit(3);
  CHECK_INT(sprout_wake_seconds(&host.budgets, 10), 60);
  CHECK_INT(sprout_wake_seconds(&host.budgets, 60), 60);
  CHECK_INT(sprout_wake_seconds(&host.budgets, 3600), 3600);
  host.budgets.shortest_wake_seconds = limit(5);
  CHECK_INT(sprout_wake_seconds(&host.budgets, 10), 10);
  CHECK_INT(sprout_wake_seconds(&host.budgets, 2), 5);
  CHECK(sprout_nickname_allowed(&host.budgets, 24));
  CHECK(!sprout_nickname_allowed(&host.budgets, 25));
  CHECK(sprout_people_allowed(&host.budgets, 3));
  CHECK(!sprout_people_allowed(&host.budgets, 4));
}

static void check_complete(const sprout_meter *meter, const char *budget) {
  size_t length = strlen(meter->fault.text);
  CHECK(meter->faulted);
  CHECK_STR(meter->fault.budget, budget);
  CHECK(strncmp(meter->fault.text, "This turn used more ", 20) == 0);
  CHECK(length >= 48 && strcmp(meter->fault.text + length - 48,
                               ", so it was stopped and nothing it did was kept.") == 0);
  CHECK(strstr(meter->fault.text, "(18446744073709551614) while running message 18446744073709551615") != NULL);
  CHECK(length + 1 < sizeof meter->fault.text);
}

static void every_budgets_fault_text_is_complete_at_the_widest_numbers(void) {
  test_heap heap;
  sprout_host host = host_with(&heap);
  sprout_meter meter;
  uint64_t held = 0;
  sprout_limit widest = {true, UINT64_MAX - 1};
  host.now = read_now;
  host.budgets.steps = host.budgets.poll_steps = host.budgets.output = host.budgets.events = widest;
  host.budgets.cascade_depth = host.budgets.passage_depth = host.budgets.set_role_objects = widest;
  host.budgets.spawns = host.budgets.pending_wakes = host.budgets.extension_effects = widest;
  host.budgets.wall_clock_ms = widest;

#define FRESH(kind)                                  \
  sprout_meter_begin(&meter, &host, kind);           \
  sprout_meter_message(&meter, UINT64_MAX)
  FRESH(SPROUT_TURN_COMMAND);
  CHECK(!sprout_meter_steps(&meter, UINT64_MAX));
  check_complete(&meter, "steps");
  FRESH(SPROUT_TURN_POLL);
  CHECK(!sprout_meter_steps(&meter, UINT64_MAX));
  check_complete(&meter, "steps per poll");
  FRESH(SPROUT_TURN_COMMAND);
  meter.events = UINT64_MAX - 1;
  CHECK(!sprout_meter_event(&meter));
  check_complete(&meter, "events");
  FRESH(SPROUT_TURN_COMMAND);
  meter.spawns = UINT64_MAX - 1;
  CHECK(!sprout_meter_spawn(&meter));
  check_complete(&meter, "spawns");
  FRESH(SPROUT_TURN_COMMAND);
  meter.effects = UINT64_MAX - 1;
  CHECK(!sprout_meter_effect(&meter));
  check_complete(&meter, "effects");
  FRESH(SPROUT_TURN_COMMAND);
  meter.cascade_depth = UINT64_MAX - 1;
  CHECK(!sprout_meter_enter_cascade(&meter));
  check_complete(&meter, "cascade depth");
  FRESH(SPROUT_TURN_COMMAND);
  meter.passage_depth = UINT64_MAX - 1;
  CHECK(!sprout_meter_enter_passage(&meter));
  check_complete(&meter, "passage depth");
  FRESH(SPROUT_TURN_COMMAND);
  CHECK(!sprout_meter_set_role(&meter, UINT64_MAX));
  check_complete(&meter, "objects bound by one set role");
  FRESH(SPROUT_TURN_COMMAND);
  CHECK(!sprout_meter_pending_wakes(&meter, UINT64_MAX));
  check_complete(&meter, "pending wakes");
  FRESH(SPROUT_TURN_COMMAND);
  CHECK_INT(sprout_meter_output(&meter, &held, UINT64_MAX, true), SPROUT_OUTPUT_FAULT);
  check_complete(&meter, "output");
  FRESH(SPROUT_TURN_COMMAND);
  fake_now = UINT64_MAX;
  CHECK(!sprout_meter_clock(&meter));
  check_complete(&meter, "wall clock");
#undef FRESH
}

int main(void) {
  RUN(the_step_budget_faults_on_the_step_past_the_hosts_figure);
  RUN(a_charge_of_many_steps_is_all_or_nothing);
  RUN(a_budget_the_host_leaves_unset_is_unbounded);
  RUN(a_poll_is_charged_to_the_poll_budget_and_a_command_to_the_turn_budget);
  RUN(a_fault_names_the_message_the_budget_and_the_figure_in_words);
  RUN(once_faulted_every_later_charge_refuses);
  RUN(each_counted_budget_faults_at_its_own_figure);
  RUN(depth_is_given_back_on_leaving_so_only_nesting_counts);
  RUN(a_set_role_and_pending_wakes_fault_past_the_hosts_figure);
  RUN(output_faults_the_actor_and_cuts_off_anyone_else_at_the_whole_line);
  RUN(the_wall_clock_backstop_reads_the_hosts_clock_at_the_hosts_figure);
  RUN(every_budgets_fault_text_is_complete_at_the_widest_numbers);
  RUN(the_wake_floor_nickname_and_crowd_follow_the_hosts_figures);
  return REPORT();
}
