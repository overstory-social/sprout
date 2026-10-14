/*
 * Tests for src/parse/planned.c: a reading an earlier turn of a line planned, as its own turn runs it (the spec's
 * Parsing > Sequences, again and all), in the corpus world `grammar` (the study),
 * with the ways out of `exit-labels`' forest, and through `sprout_parse` handed the reading: as planned where what
 * it binds is still in reach, and `not_here` where it is not.
 */
#include "parse_fixture.h"

/* `take` of `target` by the bench's actor, as the parser holds a reading. */
static parse_reading take(bench *b, sprout_stored_bound *bound, size_t *role, const char *target) {
  parse_reading reading;
  memset(&reading, 0, sizeof reading);
  memset(bound, 0, sizeof *bound);
  bound->kind = SPROUT_BOUND_OBJECT;
  bound->object = bench_str(target);
  *role = 0;
  reading.verb = bench_verb(b, "sprout", "take");
  reading.actor = b->actor;
  reading.count = 1;
  reading.roles = role;
  reading.bounds = bound;
  return reading;
}

static bool in_reach(bench *b, const parse_reading *reading) {
  parse_candidate *candidates;
  size_t count;
  CHECK_INT(parse_reach_of(&b->frame, b->actor, &candidates, &count), SPROUT_EVAL_OK);
  return parse_in_reach(reading, candidates, count, NULL, 0);
}

static void a_planned_reading_is_in_reach_until_its_thing_is_shut_away_or_gone(void) {
  bench b;
  sprout_stored_bound bound;
  size_t role;
  parse_reading reading;
  const sprout_str chest = bench_str("study.hall.chest");
  const sprout_str *removed;
  size_t removed_count;
  bench_open(&b, "grammar", "Marta");
  reading = take(&b, &bound, &role, "study.hall.lamp");
  CHECK(in_reach(&b, &reading));
  CHECK_INT(sprout_draft_place(&b.run.draft, bench_str("study.hall.lamp"), &chest), SPROUT_DRAFT_OK);
  CHECK(!in_reach(&b, &reading));
  bench_close(&b);
  bench_open(&b, "grammar", "Marta");
  reading = take(&b, &bound, &role, "study.hall.lamp");
  CHECK_INT(sprout_draft_remove(&b.run.draft, bench_str("study.hall.lamp"), &removed, &removed_count), SPROUT_DRAFT_OK);
  CHECK(!in_reach(&b, &reading));
  bench_close(&b);
}

static void a_way_out_is_in_reach_where_one_that_leads_has_its_direction_label_and_place(void) {
  bench b;
  const sprout_way *ways;
  size_t count, role = 0;
  sprout_stored_bound bound;
  parse_reading reading;
  bench_open(&b, "exit-labels", "Marta");
  CHECK_INT(sprout_ways_from(&b.frame, bench_str("exit_labels.forest"), &ways, &count), SPROUT_EVAL_OK);
  CHECK(count > 0);
  memset(&bound, 0, sizeof bound);
  bound.kind = SPROUT_BOUND_EXIT;
  bound.has_direction = true;
  bound.direction = bench_str(ways[0].direction);
  bound.label = bench_str(ways[0].label);
  bound.to = ways[0].to;
  memset(&reading, 0, sizeof reading);
  reading.verb = bench_verb(&b, "sprout", "go");
  reading.actor = b.actor;
  reading.count = 1;
  reading.roles = &role;
  reading.bounds = &bound;
  CHECK(parse_in_reach(&reading, NULL, 0, ways, count));
  bound.label = bench_str("somewhere else");
  CHECK(!parse_in_reach(&reading, NULL, 0, ways, count));
  bound.label = bench_str(ways[0].label);
  bound.has_direction = false;
  CHECK(!parse_in_reach(&reading, NULL, 0, ways, count));
  bound.has_direction = true;
  bound.to = bench_str("exit_labels.nowhere");
  CHECK(!parse_in_reach(&reading, NULL, 0, ways, count));
  bench_close(&b);
}

static void a_handed_reading_is_held_in_its_order_and_one_the_world_cannot_take_is_refused(void) {
  bench b;
  sprout_filling fillings[3];
  sprout_reading handed;
  parse_reading held;
  bench_open(&b, "grammar", "Marta");
  memset(fillings, 0, sizeof fillings);
  memset(&handed, 0, sizeof handed);
  fillings[0].role = "tool";
  fillings[0].binds = SPROUT_FILL_OBJECT;
  fillings[0].id = "study.hall.iron_key";
  fillings[1].role = "target";
  fillings[1].binds = SPROUT_FILL_OBJECT;
  fillings[1].id = "study.hall.door";
  handed.verb = "study.unlock";
  handed.actor = b.actor.bytes;
  handed.fillings = fillings;
  handed.filling_count = 2;
  CHECK_INT(parse_handed_reading(b.w.world, b.frame.turn, &handed, &held), SPROUT_OK);
  CHECK(held.verb == bench_verb(&b, "study", "unlock"));
  CHECK_INT(held.count, 2);
  CHECK_INT(held.roles[0], 1);
  CHECK_INT(held.roles[1], 0);
  CHECK_BYTES(held.bounds[0].object.bytes, held.bounds[0].object.length, "study.hall.iron_key");
  /* A role it leaves unbound binds nothing. */
  fillings[1].binds = SPROUT_FILL_UNBOUND;
  CHECK_INT(parse_handed_reading(b.w.world, b.frame.turn, &handed, &held), SPROUT_OK);
  CHECK_INT(held.count, 1);
  fillings[1].role = "lid";
  CHECK_INT(parse_handed_reading(b.w.world, b.frame.turn, &handed, &held), SPROUT_BAD_INPUT);
  handed.verb = "study.whistle";
  CHECK_INT(parse_handed_reading(b.w.world, b.frame.turn, &handed, &held), SPROUT_BAD_INPUT);
  bench_close(&b);
}

static void a_turn_handed_its_reading_runs_it_as_planned_or_answers_not_here(void) {
  bench b;
  sprout_arena keep;
  sprout_filling filling;
  sprout_reading planned;
  sprout_handed handed;
  sprout_parsed out;
  bench_open(&b, "grammar", "Marta");
  sprout_arena_init(&keep, &b.w.host);
  planned = tw_reading("sprout.take", b.actor.bytes, &filling, "target", "study.hall.lamp");
  handed.planned = &planned;
  handed.reread = NULL;
  CHECK_INT(bench_parse(&b, &keep, "take all", 7, &handed, &out), SPROUT_OK);
  CHECK_INT(out.end, SPROUT_PARSED_READING);
  CHECK_STR(out.reading.verb, "sprout.take");
  CHECK_INT(out.reading.filling_count, 1);
  CHECK_STR(out.reading.fillings[0].id, "study.hall.lamp");
  CHECK_INT(out.rest_count, 0);
  CHECK_INT(out.draw_count, 0);
  /* What the actor can reach is walked, a step for each thing. */
  CHECK(out.steps > 0);
  /* The coin lies in the shut chest. */
  planned = tw_reading("sprout.take", b.actor.bytes, &filling, "target", "study.hall.chest.coin");
  CHECK_INT(bench_parse(&b, &keep, "take all", 7, &handed, &out), SPROUT_OK);
  CHECK_INT(out.end, SPROUT_PARSED_ANSWERED);
  CHECK_STR(out.answer, "not_here");
  planned.verb = "study.whistle";
  CHECK_INT(bench_parse(&b, &keep, "take all", 7, &handed, &out), SPROUT_BAD_INPUT);
  CHECK(strstr(out.fault.text, "study.whistle") != NULL);
  sprout_arena_reset(&keep);
  bench_close(&b);
}

int main(void) {
  RUN(a_planned_reading_is_in_reach_until_its_thing_is_shut_away_or_gone);
  RUN(a_way_out_is_in_reach_where_one_that_leads_has_its_direction_label_and_place);
  RUN(a_handed_reading_is_held_in_its_order_and_one_the_world_cannot_take_is_refused);
  RUN(a_turn_handed_its_reading_runs_it_as_planned_or_answers_not_here);
  return REPORT();
}
