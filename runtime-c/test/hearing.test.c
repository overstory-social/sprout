/*
 * Tests for src/hearing.c (the spec's Verbs > Acting; Other people > Who
 * hears it): a person's reading is answered to the person; an NPC's is heard
 * from it by whoever would hear its `tell`, found where the NPC stands when
 * the line is said. A refused move is recorded as the refusal it is, to
 * whoever the body speaks to.
 */
#include "reading_fixture.h"

static void open_case(exec_bench *b, exec_case *c, const char *state) {
  reading_bench_open(b);
  reading_case_in(b, c, state);
}

static void a_fixed_audience_is_what_the_exec_holds(void) {
  exec_bench b;
  exec_case c;
  sprout_str heard = exec_str("bench#1");
  const sprout_str *to;
  size_t count;
  open_case(&b, &c, "fresh");
  c.x.heard_by = &heard;
  c.x.heard_count = 1;
  CHECK_INT(sprout_exec_hearers(&c.x, &c.frame, &to, &count), SPROUT_EVAL_OK);
  CHECK(to == &heard);
  CHECK_INT(count, 1);
  exec_case_close(&c);
  exec_bench_close(&b);
}

static void an_npcs_audience_is_whoever_would_hear_its_tell_where_it_stands_now(void) {
  exec_bench b;
  exec_case c;
  sprout_str cat = exec_str("bench.shop.cat"), marta = exec_str("bench#1");
  const sprout_str *to;
  size_t count;
  open_case(&b, &c, "fresh");
  c.x.hears_live = true;
  c.x.has_speaker = true;
  c.x.speaker = cat;
  CHECK_INT(sprout_exec_hearers(&c.x, &c.frame, &to, &count), SPROUT_EVAL_OK);
  CHECK_INT(count, 1);
  CHECK(sprout_str_same(to[0], marta));
  /* Someone a reading already addresses is left out. */
  c.x.left_out = &marta;
  c.x.left_out_count = 1;
  CHECK_INT(sprout_exec_hearers(&c.x, &c.frame, &to, &count), SPROUT_EVAL_OK);
  CHECK_INT(count, 0);
  /* And where the NPC has moved to, it is those there who hear. */
  c.x.left_out_count = 0;
  CHECK_INT(sprout_draft_place(&c.draft, cat, &(sprout_str){"bench.yard", 10}), SPROUT_DRAFT_OK);
  CHECK_INT(sprout_exec_hearers(&c.x, &c.frame, &to, &count), SPROUT_EVAL_OK);
  CHECK_INT(count, 0);
  exec_case_close(&c);
  exec_bench_close(&b);
}

static void a_reading_by_a_person_is_heard_by_the_person_and_the_old_hearing_comes_back(void) {
  exec_bench b;
  exec_case c;
  sprout_hearing saved;
  sprout_str actor = exec_str("bench#1"), others[2] = {{"bench#1", 7}, {"bench.shop.book", 15}};
  sprout_str before = exec_str("bench.shop.cat");
  open_case(&b, &c, "fresh");
  c.x.heard_by = &before;
  c.x.heard_count = 1;
  CHECK_INT(sprout_hear_reading(&c.x, &c.frame, actor, others, 2, &saved), SPROUT_EVAL_OK);
  CHECK_INT(c.x.heard_count, 1);
  CHECK(sprout_str_same(c.x.heard_by[0], actor));
  CHECK(!c.x.has_speaker);
  CHECK(!c.x.hears_live);
  CHECK(c.x.records_as_said);
  CHECK(c.x.left_out == others);
  CHECK_INT(c.x.left_out_count, 2);
  sprout_hearing_restore(&c.x, &saved);
  CHECK(c.x.heard_by == &before);
  CHECK(!c.x.records_as_said);
  CHECK_INT(c.x.left_out_count, 0);
  exec_case_close(&c);
  exec_bench_close(&b);
}

static void a_reading_by_an_npc_is_heard_from_it(void) {
  exec_bench b;
  exec_case c;
  sprout_hearing saved;
  sprout_str actor = exec_str("bench.shop.cat");
  open_case(&b, &c, "fresh");
  CHECK_INT(sprout_hear_reading(&c.x, &c.frame, actor, &actor, 1, &saved), SPROUT_EVAL_OK);
  CHECK(c.x.has_speaker);
  CHECK(sprout_str_same(c.x.speaker, actor));
  CHECK(c.x.hears_live);
  sprout_hearing_restore(&c.x, &saved);
  CHECK(!c.x.has_speaker);
  CHECK(!c.x.hears_live);
  exec_case_close(&c);
  exec_bench_close(&b);
}

static void a_refused_move_is_recorded_to_the_audience_with_the_speaker(void) {
  exec_bench b;
  exec_case c;
  sprout_move_refusal refusal;
  sprout_str heard = exec_str("bench#1");
  open_case(&b, &c, "fresh");
  memset(&refusal, 0, sizeof refusal);
  refusal.by = exec_str("bench.vault");
  refusal.said.kind = SPROUT_SPEECH_ENGINE;
  refusal.said.name = "crowded";
  c.x.heard_by = &heard;
  c.x.heard_count = 1;
  c.x.has_speaker = true;
  c.x.speaker = exec_str("bench.shop.cat");
  CHECK_INT(sprout_record_refusal(&c.x, &c.frame, &refusal), SPROUT_EVAL_OK);
  CHECK_INT(c.x.effect_count, 1);
  CHECK_INT(c.x.effects[0].kind, SPROUT_EFFECT_REFUSED);
  CHECK(sprout_str_same(c.x.effects[0].by, exec_str("bench.vault")));
  CHECK_INT(c.x.effects[0].to_count, 1);
  CHECK(c.x.effects[0].has_speaker);
  CHECK_STR(c.x.effects[0].said.name, "crowded");
  exec_case_close(&c);
  exec_bench_close(&b);
}

int main(void) {
  RUN(a_fixed_audience_is_what_the_exec_holds);
  RUN(an_npcs_audience_is_whoever_would_hear_its_tell_where_it_stands_now);
  RUN(a_reading_by_a_person_is_heard_by_the_person_and_the_old_hearing_comes_back);
  RUN(a_reading_by_an_npc_is_heard_from_it);
  RUN(a_refused_move_is_recorded_to_the_audience_with_the_speaker);
  return REPORT();
}
