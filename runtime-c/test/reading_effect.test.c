/*
 * Tests for src/reading/effect.c (the spec's Verbs > The two passes, Acting;
 * The runtime > Effects): the effect pass runs every `do` of every
 * participant in the consent pass's order; what a `do` says reaches the
 * actor, or, where the actor is an NPC, whoever would hear its `tell`, from
 * it; a person's command nothing answers is answered with the world's
 * `nothing_happens`, and an NPC's, or one an `act` performs, is not; and
 * what the exec held of who hears is as it was when the pass ends.
 */
#include "reading_fixture.h"

typedef struct effect_case {
  exec_bench b;
  exec_case c;
  sprout_resolved reading;
} effect_case;

static void effect_open(effect_case *k, const char *name) {
  reading_bench_open(&k->b);
  reading_case_open(&k->b, &k->c, reading_named(&k->b, name));
  k->reading = reading_of(&k->c, sprout_json_get(k->c.golden, "reading"));
}

static void effect_close(effect_case *k) {
  exec_case_close(&k->c);
  exec_bench_close(&k->b);
}

static void what_a_do_says_reaches_the_person_who_acted(void) {
  effect_case k;
  effect_open(&k, "take a book from the floor");
  CHECK_INT(sprout_effect_pass(&k.c.x, &k.c.frame, &k.reading), SPROUT_EVAL_OK);
  CHECK_INT(k.c.x.effect_count, 2);
  CHECK_INT(k.c.x.effects[0].kind, SPROUT_EFFECT_SAID);
  CHECK_INT(k.c.x.effects[0].to_count, 1);
  CHECK(sprout_str_same(k.c.x.effects[0].to[0], exec_str("bench#1")));
  CHECK(!k.c.x.effects[0].has_speaker);
  CHECK_INT(k.c.x.effects[1].kind, SPROUT_EFFECT_TOLD);
  CHECK_INT(k.c.x.effects[1].to_count, 0);
  effect_close(&k);
}

static void what_an_npcs_do_says_is_heard_from_it_by_whoever_would_hear_its_tell(void) {
  effect_case k;
  effect_open(&k, "an NPC acts a reading, heard from it by whoever would hear its tell");
  CHECK_INT(sprout_effect_pass(&k.c.x, &k.c.frame, &k.reading), SPROUT_EVAL_OK);
  CHECK_INT(k.c.x.effect_count, 2);
  CHECK_INT(k.c.x.effects[0].kind, SPROUT_EFFECT_SAID);
  CHECK_INT(k.c.x.effects[0].to_count, 1);
  CHECK(sprout_str_same(k.c.x.effects[0].to[0], exec_str("bench#1")));
  CHECK(k.c.x.effects[0].has_speaker);
  CHECK(sprout_str_same(k.c.x.effects[0].speaker, exec_str("bench.shop.butler")));
  effect_close(&k);
}

static void a_command_no_participant_answers_is_answered_by_the_world(void) {
  effect_case k;
  effect_open(&k, "a command no participant answers is answered by the world");
  CHECK_INT(sprout_effect_pass(&k.c.x, &k.c.frame, &k.reading), SPROUT_EVAL_OK);
  CHECK_INT(k.c.x.effect_count, 1);
  CHECK_STR(k.c.x.effects[0].said.name, "nothing_happens");
  CHECK(sprout_str_same(k.c.x.effects[0].by, exec_str("bench")));
  CHECK(sprout_str_same(k.c.x.effects[0].to[0], exec_str("bench#1")));
  effect_close(&k);
}

static void a_reading_performed_by_an_act_is_not_answered(void) {
  effect_case k;
  effect_open(&k, "a command no participant answers is answered by the world");
  k.c.x.acting = 1;
  CHECK_INT(sprout_effect_pass(&k.c.x, &k.c.frame, &k.reading), SPROUT_EVAL_OK);
  CHECK_INT(k.c.x.effect_count, 0);
  effect_close(&k);
}

static void an_npcs_reading_nobody_answers_is_not_answered(void) {
  effect_case k;
  effect_open(&k, "an NPC whose command nobody answers is not answered");
  CHECK_INT(sprout_effect_pass(&k.c.x, &k.c.frame, &k.reading), SPROUT_EVAL_OK);
  CHECK_INT(k.c.x.effect_count, 0);
  effect_close(&k);
}

static void a_reading_the_engine_answers_is_not_answered_with_nothing_happens(void) {
  effect_case k;
  effect_open(&k, "look, which the engine answers");
  CHECK_INT(sprout_effect_pass(&k.c.x, &k.c.frame, &k.reading), SPROUT_EVAL_OK);
  CHECK_INT(k.c.x.effect_count, 0);
  effect_close(&k);
}

static void a_place_noticing_someone_moved_is_no_answer(void) {
  effect_case k;
  effect_open(&k, "go through an exit from a shop where another visitor stands, who reads the leaving");
  CHECK_INT(sprout_effect_pass(&k.c.x, &k.c.frame, &k.reading), SPROUT_EVAL_OK);
  CHECK_INT(k.c.x.effect_count, 1);
  CHECK_INT(k.c.x.effects[0].kind, SPROUT_EFFECT_NOTICE);
  CHECK(sprout_str_same(k.c.x.effects[0].to[0], exec_str("bench#3")));
  CHECK_INT(k.c.x.owed_count, 1);
  effect_close(&k);
}

static void the_pass_leaves_who_hears_as_it_found_it(void) {
  effect_case k;
  sprout_str heard = exec_str("bench#2"), left = exec_str("bench.shop.cat");
  effect_open(&k, "an NPC acts a reading, heard from it by whoever would hear its tell");
  k.c.x.heard_by = &heard;
  k.c.x.heard_count = 1;
  k.c.x.left_out = &left;
  k.c.x.left_out_count = 1;
  k.c.x.records_as_said = false;
  CHECK_INT(sprout_effect_pass(&k.c.x, &k.c.frame, &k.reading), SPROUT_EVAL_OK);
  CHECK(k.c.x.heard_by == &heard);
  CHECK_INT(k.c.x.heard_count, 1);
  CHECK(k.c.x.left_out == &left);
  CHECK_INT(k.c.x.left_out_count, 1);
  CHECK(!k.c.x.records_as_said);
  CHECK(!k.c.x.has_speaker);
  CHECK(!k.c.x.hears_live);
  effect_close(&k);
}

static void a_participant_destroyed_by_an_earlier_do_does_nothing_more(void) {
  effect_case k;
  effect_open(&k, "an actor that destroys itself in its own do is gone");
  CHECK_INT(sprout_effect_pass(&k.c.x, &k.c.frame, &k.reading), SPROUT_EVAL_OK);
  CHECK(sprout_draft_instance(&k.c.draft, exec_str("bench#2")) == NULL);
  CHECK_INT(k.c.x.effect_count, 1);
  CHECK_INT(k.c.x.effects[0].said.kind, SPROUT_SPEECH_TEXT);
  effect_close(&k);
}

static void the_golden_engine_and_acting_readings_end_as_the_typescript_runtime_did(void) {
  exec_bench b;
  reading_bench_open(&b);
  CHECK(reading_replay_area(&b, "engine") >= 15);
  CHECK(reading_replay_area(&b, "acting") >= 3);
  exec_bench_close(&b);
  CHECK_INT(b.heap.pages, 0);
}

int main(void) {
  RUN(what_a_do_says_reaches_the_person_who_acted);
  RUN(what_an_npcs_do_says_is_heard_from_it_by_whoever_would_hear_its_tell);
  RUN(a_command_no_participant_answers_is_answered_by_the_world);
  RUN(a_reading_performed_by_an_act_is_not_answered);
  RUN(an_npcs_reading_nobody_answers_is_not_answered);
  RUN(a_reading_the_engine_answers_is_not_answered_with_nothing_happens);
  RUN(a_place_noticing_someone_moved_is_no_answer);
  RUN(the_pass_leaves_who_hears_as_it_found_it);
  RUN(a_participant_destroyed_by_an_earlier_do_does_nothing_more);
  RUN(the_golden_engine_and_acting_readings_end_as_the_typescript_runtime_did);
  return REPORT();
}
