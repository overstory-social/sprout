/*
 * Tests for src/range.c: the walk outward from an asker (the spec's The world
 * model > Range) reaches itself, its own contents, and each container
 * outward with what it holds, nearest first, stopping at the first container
 * that refuses the question and reaching that one only as a surface. Every
 * walk the TypeScript runtime's goldens hold is made here and must reach the
 * same objects the same way, for the same steps.
 */
#include "exec_fixture.h"

static const char *via_name(sprout_via via) {
  switch (via) {
    case SPROUT_VIA_SELF:
      return "self";
    case SPROUT_VIA_HELD:
      return "held";
    case SPROUT_VIA_SURFACE:
      return "surface";
    case SPROUT_VIA_PASSED:
      return "passed";
  }
  return "";
}

/* The first case run in this state, whose turn a walk is made in. */
static const sprout_json *case_in(exec_bench *b, const char *state) {
  const sprout_json *cases = sprout_json_get(b->golden, "cases");
  size_t i;
  for (i = 0; i < cases->count; i++)
    if (strcmp(exec_text(cases->items[i], "state"), state) == 0) return cases->items[i];
  exit(2);
}

static void walk_golden(exec_bench *b, const sprout_json *golden) {
  exec_case c;
  const sprout_json *reached = sprout_json_get(golden, "reached"), *asking = sprout_json_get(golden, "asking");
  const sprout_reached *walked;
  size_t count, i;
  int before = check_failures;
  exec_case_open(b, &c, case_in(b, exec_text(golden, "state")));
  CHECK_INT(sprout_range_of(&c.frame, exec_str(exec_text(golden, "asker")),
                            asking->kind == SPROUT_JSON_STRING ? asking->bytes : NULL, &walked, &count),
            SPROUT_EVAL_OK);
  CHECK_INT(count, reached->count);
  for (i = 0; i < count && i < reached->count; i++) {
    CHECK(exec_same_str(walked[i].node, sprout_json_get(reached->items[i], "node")));
    CHECK_STR(via_name(walked[i].via), exec_text(reached->items[i], "via"));
  }
  CHECK_INT(c.meter.steps, exec_number(golden, "steps"));
  if (check_failures != before) fprintf(stderr, "  in the walk `%s`\n", exec_text(golden, "name"));
  exec_case_close(&c);
}

static void every_golden_walk_reaches_what_the_typescript_walk_did(void) {
  exec_bench b;
  const sprout_json *ranges;
  size_t i;
  exec_bench_open(&b);
  ranges = sprout_json_get(b.golden, "ranges");
  CHECK(ranges->count >= 8);
  for (i = 0; i < ranges->count; i++) walk_golden(&b, ranges->items[i]);
  exec_bench_close(&b);
  CHECK_INT(b.heap.pages, 0);
}

static void a_walk_is_charged_at_least_a_step_for_every_object_it_reaches(void) {
  exec_bench b;
  exec_case c;
  const sprout_reached *walked;
  size_t count;
  exec_bench_open(&b);
  exec_case_open(&b, &c, exec_named(&b, "set a string"));
  CHECK_INT(sprout_range_of(&c.frame, exec_str("exec_bench.hall.runner"), NULL, &walked, &count), SPROUT_EVAL_OK);
  CHECK(count > 5);
  /* The rules it asks are charged too. */
  CHECK(c.meter.steps >= count);
  exec_case_close(&c);
  exec_bench_close(&b);
}

static void a_walk_that_runs_out_of_steps_faults(void) {
  exec_bench b;
  exec_case c;
  const sprout_reached *walked;
  size_t count;
  sprout_budgets tight;
  exec_bench_open(&b);
  exec_case_open(&b, &c, exec_named(&b, "set a string"));
  memset(&tight, 0, sizeof tight);
  tight.steps = (sprout_limit){true, 3};
  c.meter.budgets = &tight;
  CHECK_INT(sprout_range_of(&c.frame, exec_str("exec_bench.hall.runner"), NULL, &walked, &count), SPROUT_EVAL_FAULT);
  CHECK_STR(c.fault.name, "BudgetExhausted");
  exec_case_close(&c);
  exec_bench_close(&b);
}

int main(void) {
  RUN(every_golden_walk_reaches_what_the_typescript_walk_did);
  RUN(a_walk_is_charged_at_least_a_step_for_every_object_it_reaches);
  RUN(a_walk_that_runs_out_of_steps_faults);
  return REPORT();
}
