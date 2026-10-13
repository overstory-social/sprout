/*
 * Tests for src/parse/vocabulary.c: what reading the world's words costs (the spec's Parsing > When nothing matches),
 * in the study (the corpus world `grammar`) with Marta arrived in its hall.
 */
#include "parse_fixture.h"

static void every_instance_the_worlds_tree_holds_is_a_step_in_reach_or_not(void) {
  bench b;
  uint64_t before;
  const sprout_str *removed;
  size_t count;
  bench_open(&b, "grammar", "Marta");
  before = b.run.meter->steps;
  CHECK_INT(parse_world_visits(&b.frame), SPROUT_EVAL_OK);
  /* The world; the hall, its eleven things, the coin shut in the chest and Marta; the cellar and its two. */
  CHECK_INT(b.run.meter->steps - before, 1 + 1 + 11 + 1 + 1 + 1 + 2);
  /* A thing gone from the tree is no step. */
  CHECK_INT(sprout_draft_remove(&b.run.draft, bench_str("study.cellar.barrel"), &removed, &count), SPROUT_DRAFT_OK);
  before = b.run.meter->steps;
  CHECK_INT(parse_world_visits(&b.frame), SPROUT_EVAL_OK);
  CHECK_INT(b.run.meter->steps - before, 17);
  bench_close(&b);
}

static void a_walk_past_the_budget_faults_the_turn(void) {
  bench b;
  bench_open(&b, "grammar", "Marta");
  b.w.host.budgets.steps = (sprout_limit){true, b.run.meter->steps + 5};
  CHECK_INT(parse_world_visits(&b.frame), SPROUT_EVAL_FAULT);
  CHECK(b.run.meter->faulted);
  bench_close(&b);
}

int main(void) {
  RUN(every_instance_the_worlds_tree_holds_is_a_step_in_reach_or_not);
  RUN(a_walk_past_the_budget_faults_the_turn);
  return REPORT();
}
