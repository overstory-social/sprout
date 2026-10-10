/*
 * Tests for src/stmt/speech.c (the spec's Prose; Other people > Who hears it;
 * The runtime > Effects): `say` and `tell` record what is said, unrendered,
 * as the passage `self`'s kind has under the name written or the words
 * quoted, beside every name in scope. A `say` is heard by whoever the body
 * speaks to, from the NPC speaking where one is; a `tell` is heard by the
 * people it reaches.
 */
#include "exec_fixture.h"

static void a_say_records_the_words_quoted_for_whoever_the_body_speaks_to(void) {
  exec_bench b;
  exec_case c;
  sprout_run run;
  exec_bench_open(&b);
  exec_case_open(&b, &c, exec_named(&b, "a say is heard by whoever the body speaks to"));
  run = exec_run(&c);
  CHECK_INT(stmt_say(&run, &c.frame, exec_first_statement(&c)), SPROUT_EVAL_OK);
  CHECK_INT(c.x.effect_count, 1);
  CHECK_INT(c.x.effects[0].kind, SPROUT_EFFECT_SAID);
  CHECK_INT(c.x.effects[0].to_count, 1);
  CHECK(sprout_str_same(c.x.effects[0].to[0], exec_str("exec_bench#1")));
  CHECK_INT(c.x.effects[0].said.kind, SPROUT_SPEECH_TEXT);
  CHECK_STR(c.x.effects[0].said.library, "exec_bench");
  /* The names in scope travel with it: `actor` and `here`. */
  CHECK_INT(c.x.effects[0].binding_count, 2);
  CHECK_STR(c.x.effects[0].bindings[0].name, "actor");
  CHECK_STR(c.x.effects[0].bindings[1].name, "here");
  exec_case_close(&c);
  exec_bench_close(&b);
}

static void a_say_may_name_a_passage_of_the_speakers_kind(void) {
  exec_bench b;
  exec_case c;
  sprout_speech said;
  exec_bench_open(&b);
  exec_case_open(&b, &c, exec_named(&b, "a say may name a passage"));
  stmt_speech_of(&c.frame, exec_first_statement(&c), &said);
  CHECK_INT(said.kind, SPROUT_SPEECH_PASSAGE);
  CHECK_STR(said.name, "named");
  CHECK_STR(said.origin, "exec_bench.Runner");
  exec_case_close(&c);
  exec_bench_close(&b);
}

static void a_passage_the_kind_lacks_is_absent_and_renders_nothing(void) {
  exec_bench b;
  exec_case c;
  sprout_speech said;
  exec_bench_open(&b);
  exec_case_open(&b, &c, exec_named(&b, "a say may name a passage"));
  /* The same statement, said by an object whose kind writes no passage of that name. */
  c.frame.self = exec_str("exec_bench.hall.lamp");
  stmt_speech_of(&c.frame, exec_first_statement(&c), &said);
  CHECK_INT(said.kind, SPROUT_SPEECH_ABSENT);
  CHECK_STR(said.name, "named");
  exec_case_close(&c);
  exec_bench_close(&b);
}

static void an_npcs_line_is_heard_from_it(void) {
  exec_bench b;
  exec_case c;
  sprout_run run;
  exec_bench_open(&b);
  exec_case_open(&b, &c, exec_named(&b, "an NPC’s line is heard from it"));
  run = exec_run(&c);
  CHECK_INT(stmt_say(&run, &c.frame, exec_first_statement(&c)), SPROUT_EVAL_OK);
  CHECK(c.x.effects[0].has_speaker);
  CHECK(sprout_str_same(c.x.effects[0].speaker, exec_str("exec_bench.hall.dog")));
  exec_case_close(&c);
  exec_bench_close(&b);
}

static void a_tell_is_heard_by_the_people_it_reaches(void) {
  exec_bench b;
  exec_case c;
  sprout_run run;
  exec_bench_open(&b);
  exec_case_open(&b, &c, exec_named(&b, "a tell reaches the people in the teller’s place"));
  run = exec_run(&c);
  CHECK_INT(stmt_tell(&run, &c.frame, exec_first_statement(&c)), SPROUT_EVAL_OK);
  CHECK_INT(c.x.effects[0].kind, SPROUT_EFFECT_TOLD);
  CHECK_INT(c.x.effects[0].to_count, 1);
  CHECK(sprout_str_same(c.x.effects[0].to[0], exec_str("exec_bench#1")));
  CHECK(!c.x.effects[0].has_speaker);
  exec_case_close(&c);
  exec_bench_close(&b);
}

static void a_tell_inside_and_outside_have_their_own_audiences(void) {
  exec_bench b;
  exec_case inside, outside;
  sprout_run run;
  exec_bench_open(&b);
  exec_case_open(&b, &inside, exec_named(&b, "a tell inside reaches only the teller’s own occupants"));
  run = exec_run(&inside);
  CHECK_INT(stmt_tell(&run, &inside.frame, exec_first_statement(&inside)), SPROUT_EVAL_OK);
  CHECK_INT(inside.x.effects[0].to_count, 1);
  CHECK(sprout_str_same(inside.x.effects[0].to[0], exec_str("exec_bench#6")));
  exec_case_open(&b, &outside, exec_named(&b, "a tell outside reaches only the place around the teller"));
  run = exec_run(&outside);
  CHECK_INT(stmt_tell(&run, &outside.frame, exec_first_statement(&outside)), SPROUT_EVAL_OK);
  CHECK_INT(outside.x.effects[0].to_count, 1);
  CHECK(sprout_str_same(outside.x.effects[0].to[0], exec_str("exec_bench#1")));
  exec_case_close(&outside);
  exec_case_close(&inside);
  exec_bench_close(&b);
}

static void a_say_in_a_body_that_decides_is_the_engines_defect(void) {
  exec_bench b;
  exec_case c;
  sprout_run run;
  exec_bench_open(&b);
  exec_case_open(&b, &c, exec_named(&b, "a say is heard by whoever the body speaks to"));
  run = exec_run(&c);
  run.mode = SPROUT_BODY_DECIDE;
  CHECK_INT(stmt_say(&run, &c.frame, exec_first_statement(&c)), SPROUT_EVAL_ENGINE);
  exec_case_close(&c);
  exec_bench_close(&b);
}

int main(void) {
  RUN(a_say_records_the_words_quoted_for_whoever_the_body_speaks_to);
  RUN(a_say_may_name_a_passage_of_the_speakers_kind);
  RUN(a_passage_the_kind_lacks_is_absent_and_renders_nothing);
  RUN(an_npcs_line_is_heard_from_it);
  RUN(a_tell_is_heard_by_the_people_it_reaches);
  RUN(a_tell_inside_and_outside_have_their_own_audiences);
  RUN(a_say_in_a_body_that_decides_is_the_engines_defect);
  return REPORT();
}
