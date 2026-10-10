/*
 * Tests for src/prose/output.c: output is counted per recipient; the actor's own past the host's
 * figure faults the turn, and anyone else's cuts them short at the first whole line that would
 * take them past it, after which they are told nothing more and the host is told who.
 */
#include "prose_fixture.h"

static void output_cases_render_as_the_oracle_did(void) {
  prose_bench b;
  prose_bench_open(&b);
  CHECK(prose_replay_area(&b, "output") >= 6);
  prose_bench_close(&b);
  CHECK_INT(b.heap.pages, 0);
}

/* A meter over a host whose output figure is `figure` (or unset), and an output counting for `actor`. */
typedef struct charged {
  test_heap heap;
  sprout_host host;
  sprout_arena turn;
  sprout_meter meter;
  sprout_eval_fault fault;
  prose_output output;
} charged;

static void charged_open(charged *c, bool set, uint64_t figure, const char *actor) {
  memset(c, 0, sizeof *c);
  c->host = test_host(&c->heap);
  c->host.budgets.output.set = set;
  c->host.budgets.output.value = figure;
  sprout_arena_init(&c->turn, &c->host);
  sprout_meter_begin(&c->meter, &c->host, SPROUT_TURN_COMMAND);
  c->output.turn = &c->turn;
  c->output.meter = &c->meter;
  c->output.fault = &c->fault;
  c->output.has_actor = actor != NULL;
  if (actor != NULL) c->output.actor = (sprout_str){actor, strlen(actor)};
}

static void charged_close(charged *c) {
  sprout_arena_reset(&c->turn);
  CHECK_INT(c->heap.pages, 0);
}

static void a_host_that_sets_no_figure_tells_everyone_everything(void) {
  charged c;
  bool told;
  charged_open(&c, false, 0, "marta");
  CHECK_INT(prose_charge(&c.output, (sprout_str){"ines", 4}, 1000000, &told), SPROUT_EVAL_OK);
  CHECK(told);
  CHECK_INT(prose_charge(&c.output, (sprout_str){"marta", 5}, 1000000, &told), SPROUT_EVAL_OK);
  CHECK(told);
  CHECK_INT(c.output.cut_count, 0);
  charged_close(&c);
}

static void output_exactly_at_the_figure_fits_and_one_more_does_not(void) {
  charged c;
  bool told;
  charged_open(&c, true, 10, "marta");
  CHECK_INT(prose_charge(&c.output, (sprout_str){"ines", 4}, 10, &told), SPROUT_EVAL_OK);
  CHECK(told);
  CHECK_INT(prose_charge(&c.output, (sprout_str){"ines", 4}, 1, &told), SPROUT_EVAL_OK);
  CHECK(!told);
  CHECK_INT(c.output.cut_count, 1);
  charged_close(&c);
}

static void each_recipient_is_counted_apart(void) {
  charged c;
  bool told;
  charged_open(&c, true, 10, "marta");
  CHECK_INT(prose_charge(&c.output, (sprout_str){"ines", 4}, 8, &told), SPROUT_EVAL_OK);
  CHECK(told);
  CHECK_INT(prose_charge(&c.output, (sprout_str){"pat", 3}, 8, &told), SPROUT_EVAL_OK);
  CHECK(told);
  CHECK_INT(prose_charge(&c.output, (sprout_str){"ines", 4}, 3, &told), SPROUT_EVAL_OK);
  CHECK(!told);
  CHECK_INT(prose_charge(&c.output, (sprout_str){"pat", 3}, 2, &told), SPROUT_EVAL_OK);
  CHECK(told);
  CHECK_INT(c.output.cut_count, 1);
  CHECK(sprout_str_same(c.output.cut[0], (sprout_str){"ines", 4}));
  charged_close(&c);
}

static void a_reader_cut_short_stays_cut_and_is_named_once(void) {
  charged c;
  bool told;
  charged_open(&c, true, 10, NULL);
  CHECK_INT(prose_charge(&c.output, (sprout_str){"ines", 4}, 11, &told), SPROUT_EVAL_OK);
  CHECK(!told);
  /* A line that would have fitted is not told to someone already cut. */
  CHECK_INT(prose_charge(&c.output, (sprout_str){"ines", 4}, 1, &told), SPROUT_EVAL_OK);
  CHECK(!told);
  CHECK_INT(prose_charge(&c.output, (sprout_str){"ines", 4}, 0, &told), SPROUT_EVAL_OK);
  CHECK(!told);
  CHECK_INT(c.output.cut_count, 1);
  charged_close(&c);
}

static void the_actors_own_output_past_the_figure_faults_the_turn(void) {
  charged c;
  bool told;
  charged_open(&c, true, 10, "marta");
  CHECK_INT(prose_charge(&c.output, (sprout_str){"marta", 5}, 10, &told), SPROUT_EVAL_OK);
  CHECK(told);
  CHECK_INT(prose_charge(&c.output, (sprout_str){"marta", 5}, 1, &told), SPROUT_EVAL_FAULT);
  CHECK(!told);
  CHECK_STR(c.fault.name, "BudgetExhausted");
  CHECK_STR(c.meter.fault.budget, "output");
  CHECK_STR(c.fault.text, "output: one turn may say 10 characters to any one person.");
  CHECK_INT(c.output.cut_count, 0);
  charged_close(&c);
}

static void a_turn_nobody_acted_in_cuts_everyone_and_faults_no_one(void) {
  charged c;
  bool told;
  charged_open(&c, true, 5, NULL);
  CHECK_INT(prose_charge(&c.output, (sprout_str){"marta", 5}, 6, &told), SPROUT_EVAL_OK);
  CHECK(!told);
  CHECK_INT(c.output.cut_count, 1);
  charged_close(&c);
}

int main(void) {
  RUN(output_cases_render_as_the_oracle_did);
  RUN(a_host_that_sets_no_figure_tells_everyone_everything);
  RUN(output_exactly_at_the_figure_fits_and_one_more_does_not);
  RUN(each_recipient_is_counted_apart);
  RUN(a_reader_cut_short_stays_cut_and_is_named_once);
  RUN(the_actors_own_output_past_the_figure_faults_the_turn);
  RUN(a_turn_nobody_acted_in_cuts_everyone_and_faults_no_one);
  return REPORT();
}
