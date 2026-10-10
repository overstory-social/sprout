/*
 * Tests for src/stmt/extension.c (the spec's Extensions > The rule,
 * Activation and absence): an extension's statement records an effect and
 * never performs one. Its arguments are evaluated and kept with the
 * extension and the statement; the recording is a step beyond the
 * statement's own and one of the host's capped effects, and goes to the
 * people in the recorder's place as a plain `tell` reaches them; a statement
 * of an extension the world does not pin records nothing.
 */
#include "exec_fixture.h"

static void a_pinned_extensions_statement_is_recorded_with_what_it_was_given(void) {
  exec_bench b;
  exec_case c;
  sprout_run run;
  exec_bench_open(&b);
  exec_case_open(&b, &c, exec_named(&b, "an extension’s statement records an effect for the people in the place"));
  run = exec_run(&c);
  CHECK_INT(stmt_extension(&run, &c.frame, exec_first_statement(&c)), SPROUT_EVAL_OK);
  CHECK_INT(c.x.effect_count, 1);
  CHECK_INT(c.x.effects[0].kind, SPROUT_EFFECT_EXTENSION);
  CHECK_INT(c.x.effects[0].said.kind, SPROUT_SPEECH_RECORDED);
  CHECK_STR(c.x.effects[0].said.extension, "media");
  CHECK_STR(c.x.effects[0].said.statement, "show");
  CHECK_INT(c.x.effects[0].said.argument_count, 2);
  CHECK_BYTES(c.x.effects[0].said.arguments[0].as.string.bytes, c.x.effects[0].said.arguments[0].as.string.length,
              "purr.png");
  /* The runtime holds `media` at major 1: it records the payload and the words a text client reads. */
  CHECK_BYTES(c.x.effects[0].said.payload.bytes, c.x.effects[0].said.payload.length,
              "{\"image\":\"purr.png\",\"caption\":\"a purr\"}");
  CHECK_BYTES(c.x.effects[0].said.transcript.bytes, c.x.effects[0].said.transcript.length, "a purr");
  /* Recorded in a handler, it reaches the people in the recorder's place. */
  CHECK_INT(c.x.effects[0].to_count, 1);
  /* The argument's step, the recording's, and the climb to the people who are told. */
  CHECK_INT(c.meter.steps, 4);
  CHECK_INT(c.meter.effects, 1);
  exec_case_close(&c);
  exec_bench_close(&b);
}

static void the_hosts_cap_on_recorded_effects_faults_the_turn(void) {
  exec_bench b;
  exec_case c;
  sprout_run run;
  exec_bench_open(&b);
  exec_case_open(&b, &c, exec_named(&b, "recording past the host’s cap faults"));
  run = exec_run(&c);
  CHECK_INT(stmt_extension(&run, &c.frame, exec_first_statement(&c)), SPROUT_EVAL_FAULT);
  CHECK_STR(c.fault.name, "BudgetExhausted");
  CHECK_STR(c.meter.fault.budget, "effects");
  exec_case_close(&c);
  exec_bench_close(&b);
}

static void an_extension_the_world_does_not_pin_records_nothing(void) {
  exec_bench b;
  exec_case c;
  sprout_run run;
  exec_bench_open(&b);
  exec_case_open(&b, &c, exec_named(&b, "an extension’s statement records an effect for the people in the place"));
  run = exec_run(&c);
  /* A world that pins no extension. */
  c.world->extension_count = 0;
  CHECK_INT(stmt_extension(&run, &c.frame, exec_first_statement(&c)), SPROUT_EVAL_OK);
  CHECK_INT(c.x.effect_count, 0);
  CHECK_INT(c.meter.effects, 0);
  exec_case_close(&c);
  exec_bench_close(&b);
}

static void an_extension_the_runtime_holds_no_code_for_records_nothing(void) {
  exec_bench b;
  exec_case c;
  sprout_run run;
  exec_bench_open(&b);
  exec_case_open(&b, &c, exec_named(&b, "an extension the host does not install records nothing"));
  run = exec_run(&c);
  CHECK_INT(stmt_extension(&run, &c.frame, exec_first_statement(&c)), SPROUT_EVAL_OK);
  CHECK_INT(c.x.effect_count, 0);
  CHECK_INT(c.meter.effects, 0);
  exec_case_close(&c);
  exec_bench_close(&b);
}

static void the_major_this_runtime_does_not_hold_records_nothing(void) {
  exec_bench b;
  exec_case c;
  sprout_run run;
  exec_bench_open(&b);
  exec_case_open(&b, &c, exec_named(&b, "an extension’s statement records an effect for the people in the place"));
  run = exec_run(&c);
  c.world->extensions[0].major = 2;
  CHECK_INT(stmt_extension(&run, &c.frame, exec_first_statement(&c)), SPROUT_EVAL_OK);
  CHECK_INT(c.x.effect_count, 0);
  exec_case_close(&c);
  exec_bench_close(&b);
}

static void a_deciding_body_cannot_record_an_extension(void) {
  exec_bench b;
  exec_case c;
  sprout_run run;
  exec_bench_open(&b);
  exec_case_open(&b, &c, exec_named(&b, "an extension’s statement records an effect for the people in the place"));
  run = exec_run(&c);
  run.mode = SPROUT_BODY_DECIDE;
  CHECK_INT(stmt_extension(&run, &c.frame, exec_first_statement(&c)), SPROUT_EVAL_ENGINE);
  exec_case_close(&c);
  exec_bench_close(&b);
}

int main(void) {
  RUN(a_pinned_extensions_statement_is_recorded_with_what_it_was_given);
  RUN(the_hosts_cap_on_recorded_effects_faults_the_turn);
  RUN(an_extension_the_world_does_not_pin_records_nothing);
  RUN(an_extension_the_runtime_holds_no_code_for_records_nothing);
  RUN(the_major_this_runtime_does_not_hold_records_nothing);
  RUN(a_deciding_body_cannot_record_an_extension);
  return REPORT();
}
