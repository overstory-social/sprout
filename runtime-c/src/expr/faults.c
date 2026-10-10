/*
 * The words a fault is told in (the spec's The runtime > Faults), and the
 * engine errors that are not faults: something the checker refuses reached
 * the evaluator. Text is written into the frame's fault and stops at its end.
 */
#include "expr.h"

expr_text expr_text_begin(const sprout_frame *frame) {
  expr_text text;
  text.at = frame->fault->text;
  text.end = frame->fault->text + sizeof frame->fault->text;
  *text.at = '\0';
  return text;
}

void expr_put(expr_text *text, const char *words) {
  while (*words != '\0' && text->at + 1 < text->end) *text->at++ = *words++;
  *text->at = '\0';
}

void expr_put_str(expr_text *text, sprout_str str) {
  size_t i;
  for (i = 0; i < str.length && text->at + 1 < text->end; i++) *text->at++ = str.bytes[i];
  *text->at = '\0';
}

void expr_put_number(expr_text *text, double number) {
  char digits[32];
  size_t count;
  if (sprout_number_text(number, digits, sizeof digits, &count)) expr_put(text, digits);
}

sprout_eval_status expr_fail(const sprout_frame *frame, const char *name) {
  frame->fault->name = name;
  return SPROUT_EVAL_FAULT;
}

sprout_eval_status expr_engine(const sprout_frame *frame, const char *words) {
  expr_text text = expr_text_begin(frame);
  expr_put(&text, words);
  frame->fault->name = "Error";
  return SPROUT_EVAL_ENGINE;
}

sprout_eval_status expr_unchecked(const sprout_frame *frame, const char *what) {
  expr_text text = expr_text_begin(frame);
  expr_put(&text, what);
  expr_put(&text, " reached the evaluator, which the checker refuses.");
  frame->fault->name = "Error";
  return SPROUT_EVAL_ENGINE;
}

sprout_eval_status expr_budget_fault(const sprout_frame *frame) {
  expr_text text = expr_text_begin(frame);
  expr_put(&text, frame->meter->fault.text);
  frame->fault->name = "BudgetExhausted";
  return SPROUT_EVAL_FAULT;
}

sprout_eval_status expr_spend(const sprout_frame *frame) {
  if (sprout_meter_steps(frame->meter, 1)) return SPROUT_EVAL_OK;
  return expr_budget_fault(frame);
}
