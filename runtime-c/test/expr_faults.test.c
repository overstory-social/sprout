/*
 * Tests for src/expr/faults.c: a fault's words are written into the frame's
 * fault and stop at its end rather than overrun; an engine error is not a
 * fault; and a step past the host's figure is a budget fault in the meter's
 * words.
 */
#include "expr/expr.h"
#include "check.h"

typedef struct held {
  sprout_host host;
  sprout_meter meter;
  sprout_eval_fault fault;
  sprout_frame frame;
} held;

static void begin(held *h, long steps) {
  memset(h, 0, sizeof *h);
  if (steps >= 0) h->host.budgets.steps = (sprout_limit){true, (uint64_t)steps};
  sprout_meter_begin(&h->meter, &h->host, SPROUT_TURN_COMMAND);
  h->frame.meter = &h->meter;
  h->frame.fault = &h->fault;
}

static void words_and_numbers_are_put_one_after_another(void) {
  held h;
  expr_text text;
  begin(&h, -1);
  text = expr_text_begin(&h.frame);
  expr_put(&text, "`");
  expr_put_str(&text, (sprout_str){"shop#12", 7});
  expr_put(&text, "` holds ");
  expr_put_number(&text, -4);
  expr_put(&text, ".");
  CHECK_STR(h.fault.text, "`shop#12` holds -4.");
}

static void a_message_longer_than_the_text_is_cut_and_still_ends(void) {
  held h;
  expr_text text;
  size_t i;
  begin(&h, -1);
  text = expr_text_begin(&h.frame);
  for (i = 0; i < 100; i++) expr_put(&text, "0123456789");
  CHECK_INT(strlen(h.fault.text), sizeof h.fault.text - 1);
  expr_put_str(&text, (sprout_str){"more", 4});
  CHECK_INT(strlen(h.fault.text), sizeof h.fault.text - 1);
}

static void a_fault_names_the_rule_it_broke(void) {
  held h;
  expr_text text;
  begin(&h, -1);
  text = expr_text_begin(&h.frame);
  expr_put(&text, "nothing here");
  CHECK_INT(expr_fail(&h.frame, "NameOutOfRange"), SPROUT_EVAL_FAULT);
  CHECK_STR(h.fault.name, "NameOutOfRange");
  CHECK_STR(h.fault.text, "nothing here");
}

static void something_the_checker_refuses_is_an_engine_error_not_a_fault(void) {
  held h;
  begin(&h, -1);
  CHECK_INT(expr_unchecked(&h.frame, "two lists compared with `==`"), SPROUT_EVAL_ENGINE);
  CHECK_STR(h.fault.name, "Error");
  CHECK_STR(h.fault.text, "two lists compared with `==` reached the evaluator, which the checker refuses.");
  CHECK_INT(expr_engine(&h.frame, "`x` is bound, and is not an instance."), SPROUT_EVAL_ENGINE);
  CHECK_STR(h.fault.text, "`x` is bound, and is not an instance.");
}

static void a_step_past_the_hosts_figure_faults_in_the_meters_words(void) {
  held h;
  begin(&h, 2);
  CHECK_INT(expr_spend(&h.frame), SPROUT_EVAL_OK);
  CHECK_INT(expr_spend(&h.frame), SPROUT_EVAL_OK);
  CHECK_INT(expr_spend(&h.frame), SPROUT_EVAL_FAULT);
  CHECK_STR(h.fault.name, "BudgetExhausted");
  CHECK_STR(h.fault.text,
            "This turn used more steps than the host allows (2) while running message 0, so it was stopped and "
            "nothing it did was kept.");
  CHECK_INT(h.meter.steps, 3);
}

static void with_no_figure_a_step_is_never_refused(void) {
  held h;
  size_t i;
  begin(&h, -1);
  for (i = 0; i < 1000; i++) CHECK_INT(expr_spend(&h.frame), SPROUT_EVAL_OK);
  CHECK_INT(h.meter.steps, 1000);
}

int main(void) {
  RUN(words_and_numbers_are_put_one_after_another);
  RUN(a_message_longer_than_the_text_is_cut_and_still_ends);
  RUN(a_fault_names_the_rule_it_broke);
  RUN(something_the_checker_refuses_is_an_engine_error_not_a_fault);
  RUN(a_step_past_the_hosts_figure_faults_in_the_meters_words);
  RUN(with_no_figure_a_step_is_never_refused);
  return REPORT();
}
