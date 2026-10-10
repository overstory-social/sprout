/*
 * Tests for src/prose.c: every case the TypeScript prose layer's goldens hold
 * (corpus/goldens/prose.json) is replayed here against the same cartridge and stored worlds, and
 * must render as the oracle did: the same words for each reader of each line, in the order said,
 * the same readers cut short or the same fault, and the same steps.
 */
#include "prose_fixture.h"

static void every_golden_case_renders_as_the_typescript_prose_layer_did(void) {
  prose_bench b;
  size_t replayed;
  prose_bench_open(&b);
  replayed = prose_replay_area(&b, NULL);
  CHECK(replayed >= 73);
  prose_bench_close(&b);
  CHECK_INT(b.heap.pages, 0);
}

static void a_line_is_drawn_once_however_many_read_it(void) {
  prose_bench b;
  prose_case c;
  sprout_rendered rendered;
  sprout_str actor;
  prose_bench_open(&b);
  prose_case_open(&b, &c, prose_named(&b, "a one of draws from the turn’s stream, once for every reader of the line"));
  actor = prose_str(sprout_json_get(c.golden, "actor"));
  CHECK_INT(sprout_render_effects(&c.x, &actor, &rendered), SPROUT_EVAL_OK);
  /* Two readers read the line and the turn's stream moved once, as one reading's draws. */
  CHECK_INT(rendered.told_count, 2);
  CHECK_INT(c.draws.made, 1);
  prose_case_close(&c);
  prose_bench_close(&b);
}

static void the_host_is_given_a_line_to_a_paragraph_by_visit_and_whom_it_cut(void) {
  prose_bench b;
  prose_case c;
  sprout_rendered rendered;
  sprout_outcome outcome;
  sprout_str actor;
  prose_bench_open(&b);
  prose_case_open(&b, &c, prose_named(&b, "a reader is cut short at the first whole line that would take them past the figure, and read nothing after"));
  actor = prose_str(sprout_json_get(c.golden, "actor"));
  CHECK_INT(sprout_render_effects(&c.x, &actor, &rendered), SPROUT_EVAL_OK);
  memset(&outcome, 0, sizeof outcome);
  CHECK_INT(sprout_rendered_outcome(&c.turn, &c.draft, &rendered, &outcome), SPROUT_OK);
  CHECK_INT(outcome.line_count, 3);
  CHECK_BYTES(outcome.lines[0].recipient, outcome.lines[0].recipient_length, "visit-1");
  CHECK_BYTES(outcome.lines[0].text, outcome.lines[0].text_length, "You hear an echo.");
  CHECK_BYTES(outcome.lines[1].recipient, outcome.lines[1].recipient_length, "visit-2");
  CHECK_BYTES(outcome.lines[2].recipient, outcome.lines[2].recipient_length, "visit-1");
  CHECK_INT(outcome.cut_count, 1);
  CHECK_BYTES(outcome.cuts[0].recipient, outcome.cuts[0].recipient_length, "visit-2");
  prose_case_close(&c);
  prose_bench_close(&b);
}

static void nobody_reading_a_line_leaves_the_turn_with_nothing_to_hand_the_host(void) {
  prose_bench b;
  prose_case c;
  sprout_rendered rendered;
  sprout_outcome outcome;
  prose_bench_open(&b);
  prose_case_open(&b, &c, prose_named(&b, "an NPC’s line that renders nothing is not heard"));
  CHECK_INT(sprout_render_effects(&c.x, NULL, &rendered), SPROUT_EVAL_OK);
  CHECK_INT(rendered.told_count, 0);
  memset(&outcome, 0, sizeof outcome);
  CHECK_INT(sprout_rendered_outcome(&c.turn, &c.draft, &rendered, &outcome), SPROUT_OK);
  CHECK_INT(outcome.line_count, 0);
  CHECK_INT(outcome.cut_count, 0);
  prose_case_close(&c);
  prose_bench_close(&b);
}

int main(void) {
  RUN(every_golden_case_renders_as_the_typescript_prose_layer_did);
  RUN(a_line_is_drawn_once_however_many_read_it);
  RUN(the_host_is_given_a_line_to_a_paragraph_by_visit_and_whom_it_cut);
  RUN(nobody_reading_a_line_leaves_the_turn_with_nothing_to_hand_the_host);
  return REPORT();
}
