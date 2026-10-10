/*
 * Tests for src/expr/instances.c: a stored property is read under the type
 * its kind declares, as the turn stands; what `self` remembers about an actor
 * is what was written or else the declared default; and an instance that is
 * not there is the engine's defect, in words.
 */
#include "eval_fixture.h"
#include "expr/expr.h"

#define PROBE "eval_bench.hall.probe"
#define VISITOR "eval_bench#1"

static void a_property_is_read_under_its_declared_type(void) {
  bench b;
  bench_turn t;
  const sprout_stored_instance *probe;
  sprout_value value;
  bench_open(&b);
  bench_turn_for(&b, &t, "get reads the property");
  CHECK_INT(expr_instance_of(&t.frame, bench_id(PROBE), &probe), SPROUT_EVAL_OK);
  CHECK_INT(expr_get(&t.frame, probe, "fill", &value), SPROUT_EVAL_OK);
  CHECK(value.kind == SPROUT_NUMBER && value.as.number == 3);
  CHECK_INT(expr_get(&t.frame, probe, "glaze", &value), SPROUT_EVAL_OK);
  CHECK(value.kind == SPROUT_STRING);
  CHECK_BYTES(value.as.string.bytes, value.as.string.length, "shino");
  CHECK_INT(expr_get(&t.frame, probe, "lid", &value), SPROUT_EVAL_OK);
  CHECK(value.kind == SPROUT_BOOL && value.as.boolean);
  CHECK_INT(expr_get(&t.frame, probe, "wards", &value), SPROUT_EVAL_OK);
  CHECK(value.kind == SPROUT_LIST && value.as.list->count == 2);
  CHECK_BYTES(value.as.list->items[1].as.string.bytes, value.as.list->items[1].as.string.length, "tenmoku");
  bench_turn_close(&t);
  bench_close(&b);
  CHECK_INT(b.heap.pages, 0);
}

static void a_property_is_read_as_the_state_stands(void) {
  bench b;
  bench_turn t;
  const sprout_stored_instance *probe;
  sprout_value value;
  bench_open(&b);
  bench_turn_for(&b, &t, "get reads the state as the turn stands");
  CHECK_INT(expr_instance_of(&t.frame, bench_id(PROBE), &probe), SPROUT_EVAL_OK);
  CHECK_INT(expr_get(&t.frame, probe, "fill", &value), SPROUT_EVAL_OK);
  CHECK(value.as.number == 7);
  bench_turn_close(&t);
  bench_close(&b);
}

static void a_property_the_object_does_not_hold_is_the_engines_defect(void) {
  bench b;
  bench_turn t;
  const sprout_stored_instance *probe;
  sprout_value value;
  bench_open(&b);
  bench_turn_for(&b, &t, "get reads the property");
  CHECK_INT(expr_instance_of(&t.frame, bench_id(PROBE), &probe), SPROUT_EVAL_OK);
  CHECK_INT(expr_get(&t.frame, probe, "nothing", &value), SPROUT_EVAL_ENGINE);
  CHECK_STR(t.fault.text, "`:nothing`, which its object does not hold, reached the evaluator, which the checker refuses.");
  /* A remembered property is held per actor, not by the object. */
  CHECK_INT(expr_get(&t.frame, probe, "visits", &value), SPROUT_EVAL_ENGINE);
  bench_turn_close(&t);
  bench_close(&b);
}

static void an_instance_that_is_not_there_is_the_engines_defect(void) {
  bench b;
  bench_turn t;
  const sprout_stored_instance *none;
  bench_open(&b);
  bench_turn_for(&b, &t, "get reads the property");
  CHECK(expr_instance(&t.frame, bench_id("eval_bench.hall.nowhere")) == NULL);
  CHECK_INT(expr_instance_of(&t.frame, bench_id("eval_bench.hall.nowhere"), &none), SPROUT_EVAL_ENGINE);
  CHECK_STR(t.fault.text, "`eval_bench.hall.nowhere` is bound, and is not an instance.");
  bench_turn_close(&t);
  bench_close(&b);
}

static void matching_is_nominal_and_by_composition(void) {
  bench b;
  bench_turn t;
  const sprout_stored_instance *probe;
  bench_open(&b);
  bench_turn_for(&b, &t, "get reads the property");
  CHECK_INT(expr_instance_of(&t.frame, bench_id(PROBE), &probe), SPROUT_EVAL_OK);
  CHECK(expr_composes(probe->kind, "eval_bench.Probe"));
  CHECK(expr_composes(probe->kind, "eval_bench.Lidded"));
  CHECK(expr_composes(probe->kind, "eval_bench.Jar"));
  CHECK(!expr_composes(probe->kind, "eval_bench.Shelf"));
  bench_turn_close(&t);
  bench_close(&b);
}

static void what_self_remembers_is_what_was_written_or_the_default(void) {
  bench b;
  bench_turn t;
  sprout_value value;
  bench_open(&b);
  bench_turn_for(&b, &t, "recall reads the default");
  CHECK_INT(expr_recalled(&t.frame, bench_id(VISITOR), "visits", &value), SPROUT_EVAL_OK);
  CHECK(value.as.number == 2);
  CHECK_INT(expr_recalled(&t.frame, bench_id(VISITOR), "seen", &value), SPROUT_EVAL_OK);
  CHECK(value.kind == SPROUT_BOOL && !value.as.boolean);
  /* Memory is about an actor: what nobody wrote about this one reads as the default. */
  CHECK_INT(expr_recalled(&t.frame, bench_id("eval_bench.hall.shelf.jar"), "visits", &value), SPROUT_EVAL_OK);
  CHECK(value.as.number == 2);
  bench_turn_close(&t);
  bench_turn_for(&b, &t, "recall reads what was written");
  CHECK_INT(expr_recalled(&t.frame, bench_id(VISITOR), "visits", &value), SPROUT_EVAL_OK);
  CHECK(value.as.number == 5);
  CHECK_INT(expr_recalled(&t.frame, bench_id(VISITOR), "seen", &value), SPROUT_EVAL_OK);
  CHECK(!value.as.boolean);
  bench_turn_close(&t);
  bench_close(&b);
}

static void a_property_self_does_not_remember_is_the_engines_defect(void) {
  bench b;
  bench_turn t;
  sprout_value value;
  bench_open(&b);
  bench_turn_for(&b, &t, "recall reads the default");
  CHECK_INT(expr_recalled(&t.frame, bench_id(VISITOR), "fill", &value), SPROUT_EVAL_ENGINE);
  CHECK_STR(t.fault.text, "`:fill`, which `self` does not remember, reached the evaluator, which the checker refuses.");
  bench_turn_close(&t);
  bench_close(&b);
}

int main(void) {
  RUN(a_property_is_read_under_its_declared_type);
  RUN(a_property_is_read_as_the_state_stands);
  RUN(a_property_the_object_does_not_hold_is_the_engines_defect);
  RUN(an_instance_that_is_not_there_is_the_engines_defect);
  RUN(matching_is_nominal_and_by_composition);
  RUN(what_self_remembers_is_what_was_written_or_the_default);
  RUN(a_property_self_does_not_remember_is_the_engines_defect);
  return REPORT();
}
