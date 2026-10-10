/*
 * Tests for src/prose/slots.c: every case the goldens hold of a slot of each kind, of `{if}`,
 * `{for}` and `{one of}`, and of passages nested to the host's depth and the step budget, renders
 * as the oracle rendered it; and what rendering refuses is the engine's defect, never a fault an
 * author can cause.
 */
#include "prose_fixture.h"

static void slots_of_each_kind_render_as_the_oracle_did(void) {
  prose_bench b;
  prose_bench_open(&b);
  CHECK(prose_replay_area(&b, "slots") >= 8);
  prose_bench_close(&b);
  CHECK_INT(b.heap.pages, 0);
}

static void conditions_loops_and_choices_render_as_the_oracle_did(void) {
  prose_bench b;
  prose_bench_open(&b);
  CHECK(prose_replay_area(&b, "flow") >= 8);
  prose_bench_close(&b);
}

static void passages_nest_to_the_hosts_depth_and_no_further(void) {
  prose_bench b;
  prose_bench_open(&b);
  CHECK(prose_replay_area(&b, "bounds") >= 5);
  prose_bench_close(&b);
}

/* Renders `by`'s passage `name` for the reader the case's actor is, with or without a stream of draws. */
static sprout_eval_status render_passage(prose_case *c, const char *name, bool draws, prose_pieces *out) {
  const sprout_json *actor = sprout_json_get(c->golden, "actor");
  prose_reading reading = prose_reading_of(c, actor->bytes);
  sprout_frame frame = prose_frame(&reading, draws ? &c->draws : NULL, (sprout_str){"bench.yard.echo", 15}, "bench", NULL);
  memset(out, 0, sizeof *out);
  frame.bindings = sprout_bind(&frame, "actor", sprout_evaluated_object(reading.reader));
  return prose_render(&reading, prose_passage_of(c, "bench.yard.echo", name), &frame, out);
}

static void a_choice_where_nothing_draws_is_the_engines_defect(void) {
  prose_bench b;
  prose_case c;
  prose_pieces out;
  prose_bench_open(&b);
  prose_case_open(&b, &c, prose_named(&b, "a one of with a single choice still draws"));
  CHECK_INT(render_passage(&c, "hum", false, &out), SPROUT_EVAL_ENGINE);
  CHECK_STR(c.fault.text, "a `{one of}` was rendered where nothing draws, which the checker refuses.");
  prose_case_close(&c);
  prose_bench_close(&b);
}

static void a_choice_is_a_step_and_a_draw_and_an_if_is_a_step_for_each_condition(void) {
  prose_bench b;
  prose_case c;
  prose_pieces out;
  uint64_t before;
  prose_bench_open(&b);
  prose_case_open(&b, &c, prose_named(&b, "a one of with a single choice still draws"));
  before = c.meter.steps;
  CHECK_INT(render_passage(&c, "hum", true, &out), SPROUT_EVAL_OK);
  /* The choice, then the one binding `actor` names. */
  CHECK_INT(c.meter.steps - before, 2);
  CHECK_INT(c.draws.made, 1);
  prose_case_close(&c);
  prose_bench_close(&b);
}

static void a_passage_renders_nothing_when_it_is_empty_of_words(void) {
  prose_bench b;
  prose_case c;
  prose_pieces out;
  prose_paragraphs paragraphs;
  prose_bench_open(&b);
  prose_case_open(&b, &c, prose_named(&b, "a paragraph that renders nothing is no paragraph"));
  CHECK_INT(render_passage(&c, "aside", true, &out), SPROUT_EVAL_OK);
  CHECK(prose_reflow(&c.turn, &out, &paragraphs));
  CHECK_INT(paragraphs.count, 0);
  prose_case_close(&c);
  prose_bench_close(&b);
}

int main(void) {
  RUN(slots_of_each_kind_render_as_the_oracle_did);
  RUN(conditions_loops_and_choices_render_as_the_oracle_did);
  RUN(passages_nest_to_the_hosts_depth_and_no_further);
  RUN(a_choice_where_nothing_draws_is_the_engines_defect);
  RUN(a_choice_is_a_step_and_a_draw_and_an_if_is_a_step_for_each_condition);
  RUN(a_passage_renders_nothing_when_it_is_empty_of_words);
  return REPORT();
}
