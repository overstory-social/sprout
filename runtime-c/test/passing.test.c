/*
 * Tests for src/passing.c (the spec's Time > Passing time; Limits > Runtime
 * budgets): a `pass` in a command turn adds the seconds it counts to what the
 * turn asks, and in any other turn asks for nothing; a count below nothing, or
 * past the largest integer in seconds, faults against the object; what the
 * host grants is the ask lowered to its longest pass, or all of it where the
 * host leaves that unset.
 */
#include "exec_fixture.h"
#include "stmt/stmt.h"

static void a_pass_in_a_command_turn_adds_what_it_counts_in_seconds(void) {
  exec_bench b;
  exec_case c;
  exec_bench_open(&b);
  exec_case_open(&b, &c, exec_named(&b, "a wake asked for longer is kept"));
  c.x.passes_time = true;
  CHECK_INT(sprout_pass_in(&c.x, &c.frame, 90, "seconds"), SPROUT_EVAL_OK);
  CHECK_INT(c.x.passed, 90);
  CHECK_INT(sprout_pass_in(&c.x, &c.frame, 2, "minutes"), SPROUT_EVAL_OK);
  CHECK_INT(sprout_pass_in(&c.x, &c.frame, 1, "hours"), SPROUT_EVAL_OK);
  CHECK_INT(sprout_pass_in(&c.x, &c.frame, 0, "hours"), SPROUT_EVAL_OK);
  CHECK_INT(c.x.passed, 90 + 120 + 3600);
  exec_case_close(&c);
  exec_bench_close(&b);
}

static void a_pass_in_any_other_turn_asks_for_nothing(void) {
  exec_bench b;
  exec_case c;
  exec_bench_open(&b);
  exec_case_open(&b, &c, exec_named(&b, "a wake asked for longer is kept"));
  CHECK(!c.x.passes_time);
  CHECK_INT(sprout_pass_in(&c.x, &c.frame, 10, "minutes"), SPROUT_EVAL_OK);
  CHECK_INT(c.x.passed, 0);
  exec_case_close(&c);
  exec_bench_close(&b);
}

static void a_count_below_nothing_or_past_the_largest_integer_faults(void) {
  exec_bench b;
  exec_case c;
  exec_bench_open(&b);
  exec_case_open(&b, &c, exec_named(&b, "a wake asked for longer is kept"));
  c.x.passes_time = true;
  CHECK_INT(sprout_pass_in(&c.x, &c.frame, -1, "minutes"), SPROUT_EVAL_FAULT);
  CHECK_STR(c.fault.name, "PassFault");
  CHECK(c.fault.has_object);
  CHECK_STR(c.fault.text, "`exec_bench.hall.runner` asked for -1 minutes to pass, which is less than no time at all.");
  CHECK_INT(c.x.passed, 0);
  exec_case_close(&c);
  exec_case_open(&b, &c, exec_named(&b, "a wake asked for longer is kept"));
  c.x.passes_time = true;
  CHECK_INT(sprout_pass_in(&c.x, &c.frame, 596524, "hours"), SPROUT_EVAL_FAULT);
  CHECK_STR(c.fault.text,
            "`exec_bench.hall.runner` asked for 596524 hours to pass, more than a pass can ask: 2147483647 seconds at most.");
  CHECK_INT(sprout_pass_in(&c.x, &c.frame, 2147483647, "seconds"), SPROUT_EVAL_OK);
  CHECK_INT(c.x.passed, 2147483647);
  exec_case_close(&c);
  exec_bench_close(&b);
}

static void the_host_grants_the_ask_lowered_to_its_longest_pass(void) {
  sprout_budgets budgets;
  memset(&budgets, 0, sizeof budgets);
  CHECK_INT(sprout_pass_granted(&budgets, 7200), 7200);
  budgets.longest_pass_seconds = (sprout_limit){true, 3600};
  CHECK_INT(sprout_pass_granted(&budgets, 7200), 3600);
  CHECK_INT(sprout_pass_granted(&budgets, 3600), 3600);
  CHECK_INT(sprout_pass_granted(&budgets, 90), 90);
  CHECK_INT(sprout_pass_granted(&budgets, 0), 0);
}

int main(void) {
  RUN(a_pass_in_a_command_turn_adds_what_it_counts_in_seconds);
  RUN(a_pass_in_any_other_turn_asks_for_nothing);
  RUN(a_count_below_nothing_or_past_the_largest_integer_faults);
  RUN(the_host_grants_the_ask_lowered_to_its_longest_pass);
  return REPORT();
}
