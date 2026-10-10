/*
 * Tests for src/guards.c (the spec's Movement and consent > The three roles,
 * Guards are read-only): a guard ends in `allow`, in `refuse`, or by reaching
 * its end, which allows. Inside it `self` is the party asked, `mover`
 * whatever proposed the move, and the parameters the objects the move names,
 * positionally. A refusal carries the passage it names, looked up on the
 * refusing instance's kind, or the words it quoted, and the names they render
 * with.
 */
#include "exec_fixture.h"

/* The first guard of this name a kind writes. */
static const sprout_node *guard_of(const exec_case *c, const char *kind, const char *guard) {
  const sprout_kind_def *def = sprout_world_kind(c->world, kind);
  return sprout_node_get(sprout_node_get(def->node, "guards"), guard)->items[0];
}

static void a_guard_that_reaches_its_refuse_refuses_in_its_passage(void) {
  exec_bench b;
  exec_case c;
  sprout_str params[2] = {{"exec_bench.hall.lamp", 20}, {"exec_bench.hall", 15}};
  sprout_move_refusal refusal;
  bool allowed = true;
  exec_bench_open(&b);
  exec_case_open(&b, &c, exec_named(&b, "a move into a full place is refused by its accept, in its passage"));
  CHECK_INT(sprout_guard_run(&c.x, guard_of(&c, "exec_bench.Shelf", "accept"), exec_str("exec_bench.hall.shelf"),
                             exec_str("exec_bench.hall.runner"), params, 2, &allowed, &refusal),
            SPROUT_EVAL_OK);
  CHECK(!allowed);
  CHECK_STR(refusal.guard, "accept");
  CHECK_STR(refusal.origin, "exec_bench.Shelf");
  CHECK_STR(refusal.said.name, "full");
  CHECK_INT(refusal.said.kind, SPROUT_SPEECH_PASSAGE);
  CHECK(sprout_str_same(refusal.by, exec_str("exec_bench.hall.shelf")));
  /* `mover` first, then the parameters the guard names. */
  CHECK_INT(refusal.binding_count, 3);
  CHECK_STR(refusal.bindings[0].name, "mover");
  CHECK_STR(refusal.bindings[1].name, "item");
  CHECK_STR(refusal.bindings[2].name, "from");
  exec_case_close(&c);
  exec_bench_close(&b);
}

static void a_guard_that_writes_an_allow_allows(void) {
  exec_bench b;
  exec_case c;
  sprout_str params[2] = {{"exec_bench.hall.shelf.jar", 25}, {"exec_bench.hall.shelf", 21}};
  sprout_move_refusal refusal;
  bool allowed = false;
  exec_bench_open(&b);
  exec_case_open(&b, &c, exec_named(&b, "an allow ends the guard that wrote it"));
  CHECK_INT(sprout_guard_run(&c.x, guard_of(&c, "exec_bench.Gate", "accept"), exec_str("exec_bench.hall.gate"),
                             exec_str("exec_bench.hall.runner"), params, 2, &allowed, &refusal),
            SPROUT_EVAL_OK);
  CHECK(allowed);
  exec_case_close(&c);
  exec_bench_close(&b);
}

static void a_quoted_refusal_carries_its_words_and_its_library(void) {
  exec_bench b;
  exec_case c;
  sprout_str params[2] = {{"exec_bench.hall.lamp", 20}, {"exec_bench.hall", 15}};
  sprout_move_refusal refusal;
  bool allowed = true;
  exec_bench_open(&b);
  exec_case_open(&b, &c, exec_named(&b, "a guard that reaches its refuse refuses"));
  CHECK_INT(sprout_guard_run(&c.x, guard_of(&c, "exec_bench.Gate", "accept"), exec_str("exec_bench.hall.gate"),
                             exec_str("exec_bench.hall.runner"), params, 2, &allowed, &refusal),
            SPROUT_EVAL_OK);
  CHECK(!allowed);
  CHECK_INT(refusal.said.kind, SPROUT_SPEECH_TEXT);
  CHECK_STR(refusal.said.library, "exec_bench");
  CHECK_BYTES(sprout_node_get(refusal.said.node, "value")->text, sprout_node_get(refusal.said.node, "value")->length,
              "Jars only.");
  exec_case_close(&c);
  exec_bench_close(&b);
}

static void a_guard_asked_the_wrong_number_of_objects_is_the_engines_defect(void) {
  exec_bench b;
  exec_case c;
  sprout_str params[1] = {{"exec_bench.hall.lamp", 20}};
  sprout_move_refusal refusal;
  bool allowed = true;
  exec_bench_open(&b);
  exec_case_open(&b, &c, exec_named(&b, "a guard that reaches its refuse refuses"));
  CHECK_INT(sprout_guard_run(&c.x, guard_of(&c, "exec_bench.Gate", "accept"), exec_str("exec_bench.hall.gate"),
                             exec_str("exec_bench.hall.runner"), params, 1, &allowed, &refusal),
            SPROUT_EVAL_ENGINE);
  CHECK_STR(c.fault.text, "`accept` takes 2 parameters and was given 1.");
  exec_case_close(&c);
  exec_bench_close(&b);
}

static void a_guard_is_charged_to_the_turns_steps(void) {
  exec_bench b;
  exec_case c;
  sprout_str params[2] = {{"exec_bench.hall.lamp", 20}, {"exec_bench.hall", 15}};
  sprout_move_refusal refusal;
  bool allowed = true;
  exec_bench_open(&b);
  exec_case_open(&b, &c, exec_named(&b, "a guard that reaches its refuse refuses"));
  CHECK_INT(sprout_guard_run(&c.x, guard_of(&c, "exec_bench.Gate", "accept"), exec_str("exec_bench.hall.gate"),
                             exec_str("exec_bench.hall.runner"), params, 2, &allowed, &refusal),
            SPROUT_EVAL_OK);
  CHECK(c.meter.steps > 0);
  exec_case_close(&c);
  exec_bench_close(&b);
}

int main(void) {
  RUN(a_guard_that_reaches_its_refuse_refuses_in_its_passage);
  RUN(a_guard_that_writes_an_allow_allows);
  RUN(a_quoted_refusal_carries_its_words_and_its_library);
  RUN(a_guard_asked_the_wrong_number_of_objects_is_the_engines_defect);
  RUN(a_guard_is_charged_to_the_turns_steps);
  return REPORT();
}
