/*
 * Tests for src/expr/operators.c: the operators over operands already
 * evaluated, with no truthiness and no coercion (reading an operand as what
 * it is not is the engine's defect), `||` leaving its right unevaluated when
 * its left decides, and `+` or `-` that leave the integer range faulting.
 */
#include "eval_fixture.h"
#include "expr/expr.h"
#include "lists.h"

static sprout_evaluated number(double n) { return sprout_evaluated_value(sprout_number(n)); }
static sprout_evaluated boolean(bool b) { return sprout_evaluated_value(sprout_bool(b)); }

static bool is_true(const sprout_evaluated *evaluated) {
  return evaluated->binds == SPROUT_BINDS_VALUE && evaluated->value.kind == SPROUT_BOOL && evaluated->value.as.boolean;
}

static void an_operand_is_read_only_as_what_the_checker_typed_it(void) {
  bench b;
  bench_turn t;
  bool truth;
  double n;
  sprout_str id;
  const sprout_list *list;
  sprout_value value;
  sprout_evaluated object = sprout_evaluated_object(bench_id("shop#1"));
  bench_open(&b);
  bench_turn_for(&b, &t, "get reads the property");
  CHECK_INT(expr_as_boolean(&t.frame, &object, &truth), SPROUT_EVAL_ENGINE);
  CHECK_STR(t.fault.text, "an object read as a value reached the evaluator, which the checker refuses.");
  CHECK_INT(expr_as_boolean(&t.frame, &(sprout_evaluated){SPROUT_BINDS_VALUE, sprout_number(1), {0}, 0, NULL}, &truth),
            SPROUT_EVAL_ENGINE);
  CHECK_STR(t.fault.text, "a value read as true or false reached the evaluator, which the checker refuses.");
  CHECK_INT(expr_as_integer(&t.frame, &(sprout_evaluated){SPROUT_BINDS_VALUE, sprout_bool(true), {0}, 0, NULL}, &n),
            SPROUT_EVAL_ENGINE);
  CHECK_INT(expr_as_object(&t.frame, &(sprout_evaluated){SPROUT_BINDS_VALUE, sprout_bool(true), {0}, 0, NULL}, &id),
            SPROUT_EVAL_ENGINE);
  CHECK_INT(expr_as_list(&t.frame, &(sprout_evaluated){SPROUT_BINDS_VALUE, sprout_bool(true), {0}, 0, NULL}, &list),
            SPROUT_EVAL_ENGINE);
  CHECK_INT(expr_as_value(&t.frame, &object, &value), SPROUT_EVAL_ENGINE);
  CHECK_INT(expr_as_object(&t.frame, &object, &id), SPROUT_EVAL_OK);
  CHECK_BYTES(id.bytes, id.length, "shop#1");
  bench_turn_close(&t);
  bench_close(&b);
}

static void not_and_minus_act_on_what_they_are_written_on(void) {
  bench b;
  bench_turn t;
  sprout_evaluated out;
  const sprout_node *not_false;
  bench_open(&b);
  bench_turn_for(&b, &t, "binds ! over < over && over ||");
  /* `1 + 2 < 4 && !false || 1 < 0`: the `!false` is the right of the `&&` on the left of the `||`. */
  not_false = sprout_node_get(sprout_node_get(bench_expr(&b, "binds ! over < over && over ||"), "left"), "right");
  CHECK_INT(expr_unary(&t.frame, not_false, &(sprout_evaluated){SPROUT_BINDS_VALUE, sprout_bool(false), {0}, 0, NULL}, &out), SPROUT_EVAL_OK);
  CHECK(is_true(&out));
  CHECK_INT(expr_unary(&t.frame, bench_expr(&b, "negates a property"), &(sprout_evaluated){SPROUT_BINDS_VALUE, sprout_number(3), {0}, 0, NULL}, &out), SPROUT_EVAL_OK);
  CHECK(out.value.as.number == -3);
  /* Negating zero is zero. */
  CHECK_INT(expr_unary(&t.frame, bench_expr(&b, "negates a property"), &(sprout_evaluated){SPROUT_BINDS_VALUE, sprout_number(0), {0}, 0, NULL}, &out), SPROUT_EVAL_OK);
  CHECK(out.value.as.number == 0);
  bench_turn_close(&t);
  bench_close(&b);
}

static void numbers_are_compared_at_each_edge(void) {
  bench b;
  bench_turn t;
  sprout_evaluated out, three = number(3), two = number(2);
  bench_open(&b);
  bench_turn_for(&b, &t, "compares below");
  CHECK_INT(expr_binary(&t.frame, bench_expr(&b, "compares below"), &two, &out), SPROUT_EVAL_OK);
  CHECK(is_true(&out));
  CHECK_INT(expr_binary(&t.frame, bench_expr(&b, "compares at most"), &three, &out), SPROUT_EVAL_OK);
  CHECK(is_true(&out));
  CHECK_INT(expr_binary(&t.frame, bench_expr(&b, "compares above"), &three, &out), SPROUT_EVAL_OK);
  CHECK(!is_true(&out));
  CHECK_INT(expr_binary(&t.frame, bench_expr(&b, "compares at least"), &two, &out), SPROUT_EVAL_OK);
  CHECK(!is_true(&out));
  /* Each right operand is a node, and costs a step. */
  CHECK_INT(t.meter.steps, 4);
  bench_turn_close(&t);
  bench_close(&b);
}

static void a_sum_or_difference_past_the_integer_range_faults(void) {
  bench b;
  bench_turn t;
  sprout_evaluated out, largest = number(2147483647), smallest = number(-2147483647);
  bench_open(&b);
  bench_turn_for(&b, &t, "+ past the largest integer");
  CHECK_INT(expr_binary(&t.frame, bench_expr(&b, "+ past the largest integer"), &largest, &out), SPROUT_EVAL_FAULT);
  CHECK_STR(t.fault.name, "IntegerOverflow");
  CHECK_STR(t.fault.text, "2147483648 is outside the integer range, -2147483648 to 2147483647.");
  bench_turn_close(&t);
  bench_turn_for(&b, &t, "- past the smallest integer");
  /* `-2147483647 - 2`: the left, once negated, is -2147483647. */
  CHECK_INT(expr_binary(&t.frame, bench_expr(&b, "- past the smallest integer"), &smallest, &out), SPROUT_EVAL_FAULT);
  CHECK_STR(t.fault.text, "-2147483649 is outside the integer range, -2147483648 to 2147483647.");
  bench_turn_close(&t);
  bench_close(&b);
}

static void an_or_decided_by_its_left_leaves_its_right_unevaluated(void) {
  bench b;
  bench_turn t;
  sprout_evaluated out, yes = boolean(true), no = boolean(false);
  bench_open(&b);
  bench_turn_for(&b, &t, "|| leaves its right unevaluated");
  CHECK_INT(expr_binary(&t.frame, bench_expr(&b, "|| leaves its right unevaluated"), &yes, &out), SPROUT_EVAL_OK);
  CHECK(is_true(&out));
  CHECK_INT(t.meter.steps, 0);
  /* Undecided, it is its right: `self.get(:fill) > 5`, which is false of a fill of 3. */
  CHECK_INT(expr_binary(&t.frame, bench_expr(&b, "|| leaves its right unevaluated"), &no, &out), SPROUT_EVAL_OK);
  CHECK(!is_true(&out));
  CHECK(t.meter.steps > 0);
  bench_turn_close(&t);
  bench_close(&b);
}

static void an_and_above_another_expression_is_the_engines_defect(void) {
  bench b;
  bench_turn t;
  sprout_evaluated out, yes = boolean(true);
  bench_open(&b);
  bench_turn_for(&b, &t, "a name placed nearest");
  CHECK_INT(expr_binary(&t.frame, bench_expr(&b, "a name placed nearest"), &yes, &out), SPROUT_EVAL_ENGINE);
  CHECK_STR(t.fault.text, "`&&` above another expression reached the evaluator, which the checker refuses.");
  bench_turn_close(&t);
  bench_close(&b);
}

static void objects_are_equal_by_identity_and_values_by_content(void) {
  bench b;
  bench_turn t;
  sprout_evaluated out, jar = sprout_evaluated_object(bench_id("eval_bench.hall.shelf.jar"));
  sprout_evaluated cup = sprout_evaluated_object(bench_id("eval_bench.hall.shelf.cup")), salt;
  sprout_value label;
  bench_open(&b);
  bench_turn_for(&b, &t, "compares two objects by identity");
  CHECK_INT(expr_binary(&t.frame, bench_expr(&b, "compares two objects by identity"), &jar, &out), SPROUT_EVAL_OK);
  CHECK(is_true(&out));
  CHECK_INT(expr_binary(&t.frame, bench_expr(&b, "compares two objects by identity"), &cup, &out), SPROUT_EVAL_OK);
  CHECK(!is_true(&out));
  bench_turn_close(&t);
  bench_turn_for(&b, &t, "compares strings");
  CHECK(sprout_string(&t.turn, "salt", 4, &label));
  salt = sprout_evaluated_value(label);
  CHECK_INT(expr_binary(&t.frame, bench_expr(&b, "compares strings"), &salt, &out), SPROUT_EVAL_OK);
  CHECK(is_true(&out));
  CHECK_INT(expr_binary(&t.frame, bench_expr(&b, "compares unequal strings"), &salt, &out), SPROUT_EVAL_OK);
  CHECK(is_true(&out));
  /* An object is never equal to a value: the checker does not let one be asked. */
  CHECK_INT(expr_binary(&t.frame, bench_expr(&b, "compares strings"), &jar, &out), SPROUT_EVAL_ENGINE);
  bench_turn_close(&t);
  bench_close(&b);
}

static void two_lists_are_never_compared(void) {
  bench b;
  bench_turn t;
  sprout_evaluated out, left;
  const sprout_list *list;
  sprout_value one;
  bench_open(&b);
  bench_turn_for(&b, &t, "compares strings");
  CHECK(sprout_string(&t.turn, "a", 1, &one));
  CHECK_INT(sprout_list_make(&t.turn, &(sprout_type){SPROUT_STRING, NULL}, &one, 1, (sprout_limit){true, 16}, &list), SPROUT_LIST_OK);
  left = sprout_evaluated_value((sprout_value){SPROUT_LIST, {0}});
  left.value.as.list = list;
  /* The right of `self.get(:label) == "salt"` is a string, so it is the left that is wrong here. */
  CHECK_INT(expr_binary(&t.frame, bench_expr(&b, "compares strings"), &left, &out), SPROUT_EVAL_ENGINE);
  bench_turn_close(&t);
  bench_close(&b);
}

int main(void) {
  RUN(an_operand_is_read_only_as_what_the_checker_typed_it);
  RUN(not_and_minus_act_on_what_they_are_written_on);
  RUN(numbers_are_compared_at_each_edge);
  RUN(a_sum_or_difference_past_the_integer_range_faults);
  RUN(an_or_decided_by_its_left_leaves_its_right_unevaluated);
  RUN(an_and_above_another_expression_is_the_engines_defect);
  RUN(objects_are_equal_by_identity_and_values_by_content);
  RUN(two_lists_are_never_compared);
  return REPORT();
}
