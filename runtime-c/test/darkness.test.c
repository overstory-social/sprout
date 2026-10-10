/*
 * Tests for src/darkness.c (the spec's Range > Sight; Places): a place that writes no `lit` is lit, one that
 * writes it is lit while its condition holds, and whoever stands in a place that is not lit stands in the dark.
 * Asking costs the steps of the condition.
 */
#include "describe.h"
#include "view_fixture.h"

typedef struct dark_case {
  view_bench b;
  view_case c;
  view_poll p;
} dark_case;

static void dark_open(dark_case *k, const char *needle) {
  view_bench_open(&k->b);
  view_bench_case_open(&k->b, &k->c, view_case_named(&k->b, needle));
  view_poll_open(&k->b, &k->c, &k->p);
}

static void dark_close(dark_case *k) {
  view_poll_close(&k->p);
  view_case_close(&k->c);
  view_bench_close(&k->b);
  CHECK_INT(k->b.heap.pages, 0);
}

static void a_place_that_writes_no_lit_is_lit_and_costs_nothing_to_ask(void) {
  dark_case k;
  bool lit = false;
  dark_open(&k, "gate that stands open");
  CHECK_INT(sprout_is_lit(&k.p.frame, view_str("viewbench.yard"), &lit), SPROUT_EVAL_OK);
  CHECK(lit);
  CHECK_INT(k.p.meter.steps, 0);
  dark_close(&k);
}

static void a_cellar_is_dark_while_it_sees_no_lit_light_source(void) {
  dark_case k;
  bool lit = true, dark = false;
  dark_open(&k, "the cellar is dark");
  CHECK_INT(sprout_is_lit(&k.p.frame, view_str("viewbench.cellar"), &lit), SPROUT_EVAL_OK);
  CHECK(!lit);
  CHECK(k.p.meter.steps > 0);
  CHECK_INT(sprout_in_the_dark(&k.p.frame, k.p.actor, &dark), SPROUT_EVAL_OK);
  CHECK(dark);
  dark_close(&k);
}

static void a_lit_lamp_in_someones_hands_lights_the_place_they_stand_in(void) {
  dark_case k;
  bool lit = false, dark = true;
  dark_open(&k, "a lit lamp carried");
  CHECK_INT(sprout_in_the_dark(&k.p.frame, k.p.actor, &dark), SPROUT_EVAL_OK);
  CHECK(!dark);
  CHECK_INT(sprout_is_lit(&k.p.frame, view_str("viewbench.cellar"), &lit), SPROUT_EVAL_OK);
  CHECK(lit);
  dark_close(&k);
}

static void a_visitor_who_is_in_a_lit_place_is_not_in_the_dark(void) {
  dark_case k;
  bool dark = true;
  dark_open(&k, "gate that stands open");
  CHECK_INT(sprout_in_the_dark(&k.p.frame, k.p.actor, &dark), SPROUT_EVAL_OK);
  CHECK(!dark);
  dark_close(&k);
}

static void an_instance_that_is_not_there_stands_in_no_dark(void) {
  dark_case k;
  bool dark = true;
  dark_open(&k, "the cellar is dark");
  CHECK_INT(sprout_in_the_dark(&k.p.frame, view_str("viewbench#99"), &dark), SPROUT_EVAL_OK);
  CHECK(!dark);
  dark_close(&k);
}

static void asking_past_the_budget_faults_as_any_work_does(void) {
  dark_case k;
  bool lit;
  dark_open(&k, "the cellar is dark");
  k.c.host.budgets.poll_steps = (sprout_limit){true, 1};
  CHECK_INT(sprout_is_lit(&k.p.frame, view_str("viewbench.cellar"), &lit), SPROUT_EVAL_FAULT);
  CHECK(k.p.meter.faulted);
  dark_close(&k);
}

int main(void) {
  RUN(a_place_that_writes_no_lit_is_lit_and_costs_nothing_to_ask);
  RUN(a_cellar_is_dark_while_it_sees_no_lit_light_source);
  RUN(a_lit_lamp_in_someones_hands_lights_the_place_they_stand_in);
  RUN(a_visitor_who_is_in_a_lit_place_is_not_in_the_dark);
  RUN(an_instance_that_is_not_there_stands_in_no_dark);
  RUN(asking_past_the_budget_faults_as_any_work_does);
  return REPORT();
}
