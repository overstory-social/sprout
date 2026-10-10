/*
 * Tests for src/expr/draws.c: `chance(n)` is true one time in n and
 * `random(n)` is from 0 to n - 1, both from the turn's stream; a body with no
 * stream to draw from is the engine's defect.
 */
#include "eval_fixture.h"
#include "expr/expr.h"

static void chance_and_random_draw_from_the_turns_seed(void) {
  bench b;
  bench_turn t;
  sprout_evaluated out;
  bench_open(&b);
  /* mulberry32 from 5 gives 0 below 3; from 1, 1. */
  bench_turn_for(&b, &t, "chance draws true from the seed");
  CHECK_INT(expr_drawn(&t.frame, bench_expr(&b, "chance draws true from the seed"), &out), SPROUT_EVAL_OK);
  CHECK(out.value.kind == SPROUT_BOOL && out.value.as.boolean);
  CHECK_INT(t.draws.made, 1);
  bench_turn_close(&t);
  bench_turn_for(&b, &t, "chance draws false from another seed");
  CHECK_INT(expr_drawn(&t.frame, bench_expr(&b, "chance draws false from another seed"), &out), SPROUT_EVAL_OK);
  CHECK(out.value.kind == SPROUT_BOOL && !out.value.as.boolean);
  bench_turn_close(&t);
  bench_turn_for(&b, &t, "random draws from the seed");
  CHECK_INT(expr_drawn(&t.frame, bench_expr(&b, "random draws from the seed"), &out), SPROUT_EVAL_OK);
  CHECK(out.value.kind == SPROUT_NUMBER && out.value.as.number == 5);
  bench_turn_close(&t);
  bench_turn_for(&b, &t, "random draws below one");
  CHECK_INT(expr_drawn(&t.frame, bench_expr(&b, "random draws below one"), &out), SPROUT_EVAL_OK);
  CHECK(out.value.as.number == 0);
  bench_turn_close(&t);
  bench_close(&b);
}

static void a_body_with_no_stream_cannot_draw(void) {
  bench b;
  bench_turn t;
  sprout_evaluated out;
  bench_open(&b);
  bench_turn_for(&b, &t, "get reads the property");
  CHECK(t.frame.draws == NULL);
  CHECK_INT(expr_drawn(&t.frame, bench_expr(&b, "random draws from the seed"), &out), SPROUT_EVAL_ENGINE);
  CHECK_STR(t.fault.text, "a draw where nothing draws reached the evaluator, which the checker refuses.");
  bench_turn_close(&t);
  bench_close(&b);
}

static void a_draw_is_only_given_a_number_written_out(void) {
  bench b;
  bench_turn t;
  sprout_evaluated out;
  bench_open(&b);
  bench_turn_for(&b, &t, "random draws from the seed");
  CHECK_INT(expr_drawn(&t.frame, bench_expr(&b, "get reads the property"), &out), SPROUT_EVAL_ENGINE);
  bench_turn_close(&t);
  bench_close(&b);
}

int main(void) {
  RUN(chance_and_random_draw_from_the_turns_seed);
  RUN(a_body_with_no_stream_cannot_draw);
  RUN(a_draw_is_only_given_a_number_written_out);
  return REPORT();
}
