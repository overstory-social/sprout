/*
 * Tests for src/range.c: the walk outward from an asker (the spec's The world
 * model > Range) reaches itself, its own contents, and each container
 * outward with what it holds, nearest first, stopping at the first container
 * that refuses the question and reaching that one only as a surface, and
 * what is shut in it with the asker where no place stands between; the walk
 * a visitor sees passes over what is unseen (Range > Unseen). Every
 * walk the golden holds is made here and must reach the
 * same objects the same way, for the same steps.
 */
#include "exec_fixture.h"
#include "expr/expr.h"
#include "unseen_fixture.h"

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
    case SPROUT_VIA_BESIDE:
      return "beside";
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

/* Whether the walk reached `id`. */
static bool walked_to(const sprout_reached *walked, size_t count, const char *id) {
  size_t i;
  for (i = 0; i < count; i++)
    if (sprout_str_same(walked[i].node, unseen_str(id))) return true;
  return false;
}

/* How the walk reached `id`: empty where it did not. */
static const char *exec_via(const sprout_reached *walked, size_t count, const char *id) {
  size_t i;
  for (i = 0; i < count; i++)
    if (sprout_str_same(walked[i].node, exec_str(id))) return via_name(walked[i].via);
  return "";
}

static void what_shares_a_shut_container_is_reached_and_a_shut_container_inside_it_is_a_wall(void) {
  exec_bench b;
  exec_case c;
  const sprout_reached *walked;
  size_t count;
  bool reached;
  const sprout_str chest = exec_str("exec_bench.hall.chest");
  exec_bench_open(&b);
  exec_case_open(&b, &c, case_in(&b, "fresh"));
  /* The runner is shut in the chest with the coin, the bin and the glass case, which passes only `:ping`. */
  CHECK_INT(sprout_draft_place(&c.draft, exec_str("exec_bench.hall.runner"), &chest), SPROUT_DRAFT_OK);
  CHECK_INT(sprout_draft_place(&c.draft, exec_str("exec_bench.hall.glass"), &chest), SPROUT_DRAFT_OK);
  CHECK_INT(sprout_range_of(&c.frame, exec_str("exec_bench.hall.runner"), NULL, &walked, &count), SPROUT_EVAL_OK);
  CHECK_STR(exec_via(walked, count, "exec_bench.hall.chest"), "surface");
  CHECK_STR(exec_via(walked, count, "exec_bench.hall.chest.coin"), "beside");
  CHECK_STR(exec_via(walked, count, "exec_bench.hall.glass"), "beside");
  CHECK_STR(exec_via(walked, count, "exec_bench.hall.glass.moth"), "");
  CHECK_STR(exec_via(walked, count, "exec_bench.hall"), "");
  CHECK_STR(exec_via(walked, count, "exec_bench.hall.lamp"), "");
  /* Asked `:ping`, the glass case passes it, and the chest is still a wall to the hall. */
  CHECK_INT(sprout_range_of(&c.frame, exec_str("exec_bench.hall.runner"), "exec_bench.ping", &walked, &count), SPROUT_EVAL_OK);
  CHECK_STR(exec_via(walked, count, "exec_bench.hall.glass.moth"), "passed");
  CHECK_STR(exec_via(walked, count, "exec_bench.hall"), "");
  /* The path a `get` or a `send` asks agrees with the walk. */
  CHECK_INT(expr_reaches(&c.frame, exec_str("exec_bench.hall.runner"), exec_str("exec_bench.hall.chest.coin"), NULL,
                         &reached),
            SPROUT_EVAL_OK);
  CHECK(reached);
  CHECK_INT(expr_reaches(&c.frame, exec_str("exec_bench.hall.chest.coin"), exec_str("exec_bench.hall.runner"), NULL,
                         &reached),
            SPROUT_EVAL_OK);
  CHECK(reached);
  CHECK_INT(expr_reaches(&c.frame, exec_str("exec_bench.hall.runner"), exec_str("exec_bench.hall.glass.moth"), NULL,
                         &reached),
            SPROUT_EVAL_OK);
  CHECK(!reached);
  CHECK_INT(expr_reaches(&c.frame, exec_str("exec_bench.hall.runner"), exec_str("exec_bench.hall.lamp"), NULL,
                         &reached),
            SPROUT_EVAL_OK);
  CHECK(!reached);
  /* A place is in the world, and the world is still a wall between places. */
  CHECK_INT(sprout_range_of(&c.frame, exec_str("exec_bench.hall"), NULL, &walked, &count), SPROUT_EVAL_OK);
  CHECK_STR(exec_via(walked, count, "exec_bench"), "surface");
  CHECK_INT(walked[count - 1].via, SPROUT_VIA_SURFACE);
  exec_case_close(&c);
  exec_bench_close(&b);
}

static void what_is_shut_in_together_reaches_both_ways_through_what_passes_between(void) {
  exec_bench b;
  exec_case c;
  const sprout_reached *walked;
  size_t count;
  bool reached;
  const sprout_str chest = exec_str("exec_bench.hall.chest"), basket = exec_str("exec_bench.hall.basket");
  exec_bench_open(&b);
  exec_case_open(&b, &c, case_in(&b, "fresh"));
  /* The runner stands in the open basket, and the basket is shut in the chest with the coin. */
  CHECK_INT(sprout_draft_place(&c.draft, basket, &chest), SPROUT_DRAFT_OK);
  CHECK_INT(sprout_draft_place(&c.draft, exec_str("exec_bench.hall.runner"), &basket), SPROUT_DRAFT_OK);
  CHECK_INT(sprout_range_of(&c.frame, exec_str("exec_bench.hall.runner"), NULL, &walked, &count), SPROUT_EVAL_OK);
  CHECK_STR(exec_via(walked, count, "exec_bench.hall.basket"), "passed");
  CHECK_STR(exec_via(walked, count, "exec_bench.hall.chest"), "surface");
  CHECK_STR(exec_via(walked, count, "exec_bench.hall.chest.coin"), "beside");
  CHECK_STR(exec_via(walked, count, "exec_bench.hall.lamp"), "");
  CHECK_INT(sprout_range_of(&c.frame, exec_str("exec_bench.hall.chest.coin"), NULL, &walked, &count), SPROUT_EVAL_OK);
  CHECK_STR(exec_via(walked, count, "exec_bench.hall.runner"), "passed");
  CHECK_INT(expr_reaches(&c.frame, exec_str("exec_bench.hall.runner"), exec_str("exec_bench.hall.chest.coin"), NULL,
                         &reached),
            SPROUT_EVAL_OK);
  CHECK(reached);
  CHECK_INT(expr_reaches(&c.frame, exec_str("exec_bench.hall.chest.coin"), exec_str("exec_bench.hall.runner"), NULL,
                         &reached),
            SPROUT_EVAL_OK);
  CHECK(reached);
  exec_case_close(&c);
  exec_bench_close(&b);
}

static void places_inside_a_container_that_refuses_stay_out_of_range_of_one_another(void) {
  exec_bench b;
  exec_case c;
  const sprout_reached *walked;
  size_t count;
  bool reached;
  const sprout_str wardrobe = exec_str("exec_bench.hall.wardrobe"), tent = exec_str("exec_bench.hall.tent");
  exec_bench_open(&b);
  exec_case_open(&b, &c, case_in(&b, "fresh"));
  /* The shut wardrobe holds two places, and the runner stands in one of them. */
  CHECK_INT(sprout_draft_place(&c.draft, tent, &wardrobe), SPROUT_DRAFT_OK);
  CHECK_INT(sprout_draft_place(&c.draft, exec_str("exec_bench.hall.lodge"), &wardrobe), SPROUT_DRAFT_OK);
  CHECK_INT(sprout_draft_place(&c.draft, exec_str("exec_bench.hall.runner"), &tent), SPROUT_DRAFT_OK);
  CHECK_INT(sprout_range_of(&c.frame, exec_str("exec_bench.hall.runner"), NULL, &walked, &count), SPROUT_EVAL_OK);
  CHECK_STR(exec_via(walked, count, "exec_bench.hall.tent"), "passed");
  CHECK_STR(exec_via(walked, count, "exec_bench.hall.wardrobe"), "surface");
  CHECK_STR(exec_via(walked, count, "exec_bench.hall.lodge"), "");
  CHECK_INT(expr_reaches(&c.frame, exec_str("exec_bench.hall.runner"), exec_str("exec_bench.hall.lodge"), NULL,
                         &reached),
            SPROUT_EVAL_OK);
  CHECK(!reached);
  /* Nor does one of those places reach the other. */
  CHECK_INT(sprout_range_of(&c.frame, tent, NULL, &walked, &count), SPROUT_EVAL_OK);
  CHECK_STR(exec_via(walked, count, "exec_bench.hall.lodge"), "");
  exec_case_close(&c);
  exec_bench_close(&b);
}

static void the_walk_a_visitor_sees_passes_over_what_is_unseen_and_what_it_holds(void) {
  unseen_bench b;
  const sprout_reached *walked;
  size_t count;
  unseen_open(&b);
  CHECK_INT(sprout_range_of(&b.frame, b.marta, NULL, &walked, &count), SPROUT_EVAL_OK);
  CHECK(walked_to(walked, count, "unseen.hall.thief"));
  CHECK(walked_to(walked, count, "unseen.hall.niche.coin"));
  CHECK_INT(sprout_range_seen(&b.frame, b.marta, &walked, &count), SPROUT_EVAL_OK);
  CHECK(walked_to(walked, count, "unseen.hall.bell"));
  CHECK(!walked_to(walked, count, "unseen.hall.thief"));
  CHECK(!walked_to(walked, count, "unseen.hall.niche"));
  CHECK(!walked_to(walked, count, "unseen.hall.niche.coin"));
  /* The unseen thing sees itself, and its place, as anything does. */
  CHECK_INT(sprout_range_seen(&b.frame, unseen_str("unseen.hall.niche"), &walked, &count), SPROUT_EVAL_OK);
  CHECK(walked_to(walked, count, "unseen.hall.niche") && walked_to(walked, count, "unseen.hall.niche.coin"));
  CHECK(walked_to(walked, count, "unseen.hall"));
  unseen_close(&b);
}

int main(void) {
  RUN(every_golden_walk_reaches_what_the_typescript_walk_did);
  RUN(a_walk_is_charged_at_least_a_step_for_every_object_it_reaches);
  RUN(a_walk_that_runs_out_of_steps_faults);
  RUN(the_walk_a_visitor_sees_passes_over_what_is_unseen_and_what_it_holds);
  RUN(what_shares_a_shut_container_is_reached_and_a_shut_container_inside_it_is_a_wall);
  RUN(what_is_shut_in_together_reaches_both_ways_through_what_passes_between);
  RUN(places_inside_a_container_that_refuses_stay_out_of_range_of_one_another);
  return REPORT();
}
