/*
 * The time a visitor's command asks to pass (the spec's Time > Passing time;
 * Limits > Runtime budgets). A `pass` run in a command turn adds what it
 * counts to the turn's ask; in any other turn it asks for nothing. A count
 * worked out below nothing, or past the largest integer in seconds, faults.
 * The host grants the ask lowered to its longest pass once the turn commits,
 * and moves its own clock: nothing here reads one.
 */
#include <string.h>

#include "stmt/stmt.h"

sprout_eval_status sprout_pass_in(sprout_exec *x, const sprout_frame *frame, double count, const char *unit) {
  double seconds = count * (strcmp(unit, "hours") == 0 ? 3600 : strcmp(unit, "minutes") == 0 ? 60 : 1);
  expr_text text;
  if (seconds >= 0 && seconds <= INTEGER_MAX) {
    if (x->passes_time) x->passed += (uint64_t)seconds;
    return SPROUT_EVAL_OK;
  }
  text = expr_text_begin(frame);
  expr_put(&text, "`");
  expr_put_str(&text, frame->self);
  expr_put(&text, "` asked for ");
  expr_put_number(&text, count);
  expr_put(&text, " ");
  expr_put(&text, unit);
  expr_put(&text, " to pass, ");
  expr_put(&text, seconds < 0 ? "which is less than no time at all." : "more than a pass can ask: 2147483647 seconds at most.");
  return expr_fail_on(frame, "PassFault", frame->self);
}

uint64_t sprout_pass_granted(const sprout_budgets *budgets, uint64_t asked) {
  if (budgets->longest_pass_seconds.set && asked > budgets->longest_pass_seconds.value)
    return budgets->longest_pass_seconds.value;
  return asked;
}
