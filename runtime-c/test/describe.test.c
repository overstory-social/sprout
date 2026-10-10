/*
 * Tests for src/describe.c (the spec's Prose; Verbs > Engine verbs; Range > Sight): a thing's `describe` runs
 * with `self` the thing, `actor` whoever looks, `here` their place and `seen` what it is read for, and gives
 * its words with `text`, each one line, carried unrendered with the names in scope; a place that is not lit
 * is described by the world's `dark`, and a thing that gives no words by the engine's `unremarkable`, with
 * `thing` the thing.
 */
#include "describe.h"
#include "expr/expr.h"
#include "view_fixture.h"

typedef struct describe_case {
  view_bench b;
  view_case c;
  view_poll p;
} describe_case;

static void describe_open(describe_case *k, const char *needle) {
  view_bench_open(&k->b);
  view_bench_case_open(&k->b, &k->c, view_case_named(&k->b, needle));
  view_poll_open(&k->b, &k->c, &k->p);
}

static void describe_close(describe_case *k) {
  view_poll_close(&k->p);
  view_case_close(&k->c);
  view_bench_close(&k->b);
  CHECK_INT(k->b.heap.pages, 0);
}

static sprout_eval_status describe_place(describe_case *k, sprout_description *out) {
  return sprout_describe(&k->p.frame, k->p.place, k->p.actor, "poll", out);
}

static void each_text_a_describe_runs_is_one_line_said_by_the_thing(void) {
  describe_case k;
  sprout_description d;
  describe_open(&k, "gate that stands open");
  CHECK_INT(describe_place(&k, &d), SPROUT_EVAL_OK);
  CHECK_INT(d.line_count, 2);
  CHECK(sprout_str_same(d.of, view_str("viewbench.yard")) && sprout_str_same(d.to, k.p.actor));
  CHECK_INT(d.lines[0].said.kind, SPROUT_SPEECH_TEXT);
  CHECK(sprout_str_same(d.lines[1].by, view_str("viewbench.yard")));
  /* A statement is a step, and so is each node of the condition that guards one. */
  CHECK(k.p.meter.steps >= 4);
  describe_close(&k);
}

static void a_condition_that_does_not_hold_leaves_its_text_out(void) {
  describe_case k;
  sprout_description d;
  describe_open(&k, "a visitor in the yard is offered");
  CHECK_INT(describe_place(&k, &d), SPROUT_EVAL_OK);
  CHECK_INT(d.line_count, 1);
  describe_close(&k);
}

static void the_names_in_scope_are_actor_here_and_seen(void) {
  describe_case k;
  sprout_description d;
  const sprout_binding *bound;
  describe_open(&k, "a visitor in the yard is offered");
  CHECK_INT(describe_place(&k, &d), SPROUT_EVAL_OK);
  bound = expr_binding(&k.p.frame, "actor");
  CHECK(bound == NULL);
  for (bound = d.lines[0].bindings; bound != NULL; bound = bound->next) {
    if (strcmp(bound->name, "actor") == 0) CHECK(sprout_str_same(bound->bound.id, k.p.actor));
    if (strcmp(bound->name, "here") == 0) CHECK(sprout_str_same(bound->bound.id, view_str("viewbench.yard")));
    if (strcmp(bound->name, "seen") == 0) {
      CHECK_INT(bound->bound.binds, SPROUT_BINDS_VALUE);
      CHECK_BYTES(bound->bound.value.as.string.bytes, bound->bound.value.as.string.length, "poll");
    }
  }
  describe_close(&k);
}

static void a_place_with_no_describe_gives_no_lines_and_the_engines_unremarkable(void) {
  describe_case k;
  sprout_description d;
  describe_open(&k, "set role is offered");
  CHECK_INT(describe_place(&k, &d), SPROUT_EVAL_OK);
  CHECK_INT(d.line_count, 0);
  CHECK_INT(d.unremarkable.said.kind, SPROUT_SPEECH_PASSAGE);
  CHECK_STR(d.unremarkable.said.name, "unremarkable");
  CHECK_STR(d.unremarkable.bindings->name, "thing");
  CHECK(sprout_str_same(d.unremarkable.bindings->bound.id, view_str("viewbench.gallery")));
  describe_close(&k);
}

static void a_place_that_is_not_lit_is_described_by_the_worlds_dark(void) {
  describe_case k;
  sprout_description d;
  describe_open(&k, "the cellar is dark");
  CHECK_INT(describe_place(&k, &d), SPROUT_EVAL_OK);
  CHECK_INT(d.line_count, 1);
  CHECK_INT(d.lines[0].said.kind, SPROUT_SPEECH_PASSAGE);
  CHECK_STR(d.lines[0].said.name, "dark");
  CHECK_STR(d.lines[0].bindings->name, "here");
  describe_close(&k);
}

static void a_place_that_is_lit_again_is_described_by_its_own_words(void) {
  describe_case k;
  sprout_description d;
  describe_open(&k, "a lit lamp carried");
  CHECK_INT(describe_place(&k, &d), SPROUT_EVAL_OK);
  CHECK_INT(d.line_count, 1);
  CHECK_INT(d.lines[0].said.kind, SPROUT_SPEECH_TEXT);
  describe_close(&k);
}

static void looking_at_a_thing_that_is_not_the_place_asks_nothing_of_the_light(void) {
  describe_case k;
  sprout_description d;
  describe_open(&k, "the cellar is dark");
  CHECK_INT(sprout_describe(&k.p.frame, view_str("viewbench.cellar.coal"), k.p.actor, "look", &d), SPROUT_EVAL_OK);
  CHECK_INT(d.line_count, 0);
  describe_close(&k);
}

static void a_budget_spent_describing_faults_as_any_work_does(void) {
  describe_case k;
  sprout_description d;
  describe_open(&k, "gate that stands open");
  k.c.host.budgets.poll_steps = (sprout_limit){true, 2};
  CHECK_INT(describe_place(&k, &d), SPROUT_EVAL_FAULT);
  CHECK(k.p.meter.faulted);
  describe_close(&k);
}

static void an_instance_that_is_not_there_is_the_engines_defect(void) {
  describe_case k;
  sprout_description d;
  describe_open(&k, "the cellar is dark");
  CHECK_INT(sprout_describe(&k.p.frame, view_str("viewbench.nowhere"), k.p.actor, "look", &d), SPROUT_EVAL_ENGINE);
  CHECK_INT(sprout_describe(&k.p.frame, k.p.place, view_str("viewbench#99"), "look", &d), SPROUT_EVAL_ENGINE);
  describe_close(&k);
}

int main(void) {
  RUN(each_text_a_describe_runs_is_one_line_said_by_the_thing);
  RUN(a_condition_that_does_not_hold_leaves_its_text_out);
  RUN(the_names_in_scope_are_actor_here_and_seen);
  RUN(a_place_with_no_describe_gives_no_lines_and_the_engines_unremarkable);
  RUN(a_place_that_is_not_lit_is_described_by_the_worlds_dark);
  RUN(a_place_that_is_lit_again_is_described_by_its_own_words);
  RUN(looking_at_a_thing_that_is_not_the_place_asks_nothing_of_the_light);
  RUN(a_budget_spent_describing_faults_as_any_work_does);
  RUN(an_instance_that_is_not_there_is_the_engines_defect);
  return REPORT();
}
