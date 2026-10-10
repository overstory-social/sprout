/*
 * Tests for src/expr/members.c: `x.count` on a container, a set and a list,
 * and each reading on a receiver already evaluated, with the steps naming a
 * property or a kind costs.
 */
#include "eval_fixture.h"
#include "expr/expr.h"
#include "lists.h"

static sprout_evaluated object(const char *id) { return sprout_evaluated_object(bench_id(id)); }

static double number_of(const sprout_evaluated *evaluated) {
  return evaluated->binds == SPROUT_BINDS_VALUE && evaluated->value.kind == SPROUT_NUMBER ? evaluated->value.as.number : -1;
}

static bool is_true(const sprout_evaluated *evaluated) {
  return evaluated->binds == SPROUT_BINDS_VALUE && evaluated->value.kind == SPROUT_BOOL && evaluated->value.as.boolean;
}

/* A list of the strings, in the turn arena. */
static sprout_evaluated list_of(bench_turn *t, const char *first, const char *second) {
  sprout_value items[2];
  const sprout_list *list;
  sprout_evaluated evaluated;
  CHECK(sprout_string(&t->turn, first, strlen(first), &items[0]));
  CHECK(sprout_string(&t->turn, second, strlen(second), &items[1]));
  CHECK_INT(sprout_list_make(&t->turn, &(sprout_type){SPROUT_STRING, NULL}, items, 2, (sprout_limit){true, 16}, &list),
            SPROUT_LIST_OK);
  evaluated = sprout_evaluated_value(sprout_number(0));
  evaluated.value.kind = SPROUT_LIST;
  evaluated.value.as.list = list;
  return evaluated;
}

static void count_is_what_a_container_holds_in_range_a_sets_members_or_a_lists_elements(void) {
  bench b;
  bench_turn t;
  sprout_evaluated out, set;
  sprout_str ids[3] = {{"a", 1}, {"b", 1}, {"c", 1}};
  bench_open(&b);
  bench_turn_for(&b, &t, "a list counts its elements");
  CHECK_INT(expr_member(&t.frame, bench_expr(&b, "a list counts its elements"), &(sprout_evaluated){SPROUT_BINDS_OBJECT, {0}, bench_id("eval_bench.hall.shelf"), 0, NULL}, &out), SPROUT_EVAL_OK);
  CHECK(number_of(&out) == 2);
  out = object("eval_bench.hall");
  CHECK_INT(expr_member(&t.frame, bench_expr(&b, "a list counts its elements"), &out, &out), SPROUT_EVAL_OK);
  CHECK(number_of(&out) == 4);
  memset(&set, 0, sizeof set);
  set.binds = SPROUT_BINDS_SET;
  set.count = 3;
  set.items = ids;
  CHECK_INT(expr_member(&t.frame, bench_expr(&b, "a list counts its elements"), &set, &out), SPROUT_EVAL_OK);
  CHECK(number_of(&out) == 3);
  set = list_of(&t, "x", "y");
  CHECK_INT(expr_member(&t.frame, bench_expr(&b, "a list counts its elements"), &set, &out), SPROUT_EVAL_OK);
  CHECK(number_of(&out) == 2);
  set.binds = SPROUT_BINDS_READINGS;
  CHECK_INT(expr_member(&t.frame, bench_expr(&b, "a list counts its elements"), &set, &out), SPROUT_EVAL_ENGINE);
  CHECK_STR(t.fault.text, "`.count` on `readings`, which only `{for ... of}` may walk reached the evaluator, which the checker refuses.");
  bench_turn_close(&t);
  bench_close(&b);
}

static void get_reads_a_property_and_naming_it_costs_a_step(void) {
  bench b;
  bench_turn t;
  sprout_evaluated out, probe = object("eval_bench.hall.probe");
  bench_open(&b);
  bench_turn_for(&b, &t, "get reads the property");
  CHECK_INT(expr_reading(&t.frame, bench_expr(&b, "get reads the property"), &probe, &out), SPROUT_EVAL_OK);
  CHECK(number_of(&out) == 3);
  CHECK_INT(t.meter.steps, 1);
  bench_turn_close(&t);
  bench_close(&b);
}

static void recall_reads_what_self_remembers_about_the_actor(void) {
  bench b;
  bench_turn t;
  sprout_evaluated out, actor = object("eval_bench#1");
  bench_open(&b);
  bench_turn_for(&b, &t, "recall reads what was written");
  CHECK_INT(expr_reading(&t.frame, sprout_node_get(bench_expr(&b, "recall reads what was written"), "left"), &actor, &out), SPROUT_EVAL_OK);
  CHECK(number_of(&out) == 5);
  bench_turn_close(&t);
  bench_close(&b);
}

static void count_of_a_kind_takes_those_composing_it(void) {
  bench b;
  bench_turn t;
  sprout_evaluated out, shelf = object("eval_bench.hall.shelf");
  bench_open(&b);
  bench_turn_for(&b, &t, "count(K) is those of a kind");
  CHECK_INT(expr_reading(&t.frame, bench_expr(&b, "count(K) is those of a kind"), &shelf, &out), SPROUT_EVAL_OK);
  CHECK(number_of(&out) == 1);
  CHECK_INT(expr_reading(&t.frame, bench_expr(&b, "count(K) takes those composing the kind"), &shelf, &out), SPROUT_EVAL_OK);
  CHECK(number_of(&out) == 2);
  bench_turn_close(&t);
  bench_close(&b);
}

static void is_asks_whether_an_instance_composes_a_kind(void) {
  bench b;
  bench_turn t;
  sprout_evaluated out, cup = object("eval_bench.hall.shelf.cup");
  bench_open(&b);
  bench_turn_for(&b, &t, "is asks whether an instance composes a kind");
  CHECK_INT(expr_reading(&t.frame, bench_expr(&b, "is asks whether an instance composes a kind"), &cup, &out), SPROUT_EVAL_OK);
  CHECK(is_true(&out));
  out = object("eval_bench.hall.shelf.jar");
  CHECK_INT(expr_reading(&t.frame, bench_expr(&b, "is asks a kind it does not compose"), &out, &out), SPROUT_EVAL_OK);
  CHECK(!is_true(&out));
  bench_turn_close(&t);
  bench_close(&b);
}

static void holds_asks_the_container_of_a_thing_in_range(void) {
  bench b;
  bench_turn t;
  sprout_evaluated out, shelf = object("eval_bench.hall.shelf"), hall = object("eval_bench.hall");
  bench_open(&b);
  bench_turn_for(&b, &t, "holds asks whether a container holds a thing");
  CHECK_INT(expr_reading(&t.frame, bench_expr(&b, "holds asks whether a container holds a thing"), &shelf, &out), SPROUT_EVAL_OK);
  CHECK(is_true(&out));
  CHECK_INT(expr_reading(&t.frame, bench_expr(&b, "holds asks of a thing held elsewhere"), &hall, &out), SPROUT_EVAL_OK);
  CHECK(!is_true(&out));
  bench_turn_close(&t);
  bench_close(&b);
}

static void includes_looks_for_an_element_in_a_list_or_a_set(void) {
  bench b;
  bench_turn t;
  sprout_evaluated out, wards;
  bench_open(&b);
  bench_turn_for(&b, &t, "a list includes an element");
  wards = list_of(&t, "shino", "tenmoku");
  CHECK_INT(expr_reading(&t.frame, bench_expr(&b, "a list includes an element"), &wards, &out), SPROUT_EVAL_OK);
  CHECK(is_true(&out));
  CHECK_INT(expr_reading(&t.frame, bench_expr(&b, "a list does not include another"), &wards, &out), SPROUT_EVAL_OK);
  CHECK(!is_true(&out));
  bench_turn_close(&t);
  bench_close(&b);
}

static void sees_asks_what_a_thing_sees_for_a_kind_with_a_property_true(void) {
  bench b;
  bench_turn t;
  sprout_evaluated out, dim = object("eval_bench.dim");
  bench_open(&b);
  bench_turn_for(&b, &t, "sees finds no lit light");
  CHECK_INT(expr_reading(&t.frame, bench_expr(&b, "sees finds no lit light"), &dim, &out), SPROUT_EVAL_OK);
  CHECK(!is_true(&out));
  bench_turn_close(&t);
  bench_turn_for(&b, &t, "sees finds a lit light");
  CHECK_INT(expr_reading(&t.frame, bench_expr(&b, "sees finds a lit light"), &dim, &out), SPROUT_EVAL_OK);
  CHECK(is_true(&out));
  bench_turn_close(&t);
  bench_close(&b);
}

int main(void) {
  RUN(count_is_what_a_container_holds_in_range_a_sets_members_or_a_lists_elements);
  RUN(get_reads_a_property_and_naming_it_costs_a_step);
  RUN(recall_reads_what_self_remembers_about_the_actor);
  RUN(count_of_a_kind_takes_those_composing_it);
  RUN(is_asks_whether_an_instance_composes_a_kind);
  RUN(holds_asks_the_container_of_a_thing_in_range);
  RUN(includes_looks_for_an_element_in_a_list_or_a_set);
  RUN(sees_asks_what_a_thing_sees_for_a_kind_with_a_property_true);
  return REPORT();
}
