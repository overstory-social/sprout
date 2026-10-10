/*
 * Tests for src/reading/wildcards.c (the spec's Verbs > Roles compose): `as
 * target for any` and `as tool for any` play every verb at once by the
 * category of the role the participant fills, the target being a verb's
 * first role and a tool any other, and run before the participant's plays
 * for the verb; the actor's own part has none. The order across participants
 * is unchanged, so the target still refuses before its tool.
 */
#include "reading_fixture.h"

typedef struct plays_case {
  exec_bench b;
  exec_case c;
  sprout_resolved reading;
} plays_case;

static void plays_open(plays_case *p, const char *name) {
  reading_bench_open(&p->b);
  reading_case_open(&p->b, &p->c, reading_named(&p->b, name));
  p->reading = reading_of(&p->c, sprout_json_get(p->c.golden, "reading"));
}

static void plays_close(plays_case *p) {
  exec_case_close(&p->c);
  exec_bench_close(&p->b);
}

/* What `id`, filling the role at `role` (or the actor's own part for -1), runs in the reading. */
static void plays_of(plays_case *p, const char *id, int role, sprout_plays *out) {
  sprout_participant who;
  const sprout_stored_instance *instance = sprout_draft_instance(&p->c.draft, exec_str(id));
  who.id = exec_str(id);
  who.role = role < 0 ? NULL : &p->reading.verb->roles[role];
  CHECK(instance != NULL);
  sprout_plays_for(&p->reading, &who, instance->kind, out);
}

static void a_tool_runs_its_wildcard_before_its_plays_for_the_verb(void) {
  plays_case p;
  sprout_plays plays;
  plays_open(&p, "a participant’s wildcard permit runs before its permit for the verb");
  plays_of(&p, "bench.shop.gauge", 1, &plays);
  CHECK_INT(plays.count, 2);
  CHECK_STR(plays.groups[0]->key, "as tool for any");
  CHECK_STR(plays.groups[1]->key, "as tool for bench.prop");
  plays_close(&p);
}

static void a_target_runs_the_wildcard_for_the_first_role_whatever_the_verb_calls_it(void) {
  plays_case p;
  sprout_plays plays;
  plays_open(&p, "a participant’s wildcard permit runs before its permit for the verb");
  plays_of(&p, "bench.shop.shelf", 0, &plays);
  CHECK_INT(plays.count, 2);
  CHECK_STR(plays.groups[0]->key, "as target for any");
  CHECK_STR(plays.groups[1]->key, "as target for bench.prop");
  plays_close(&p);
  plays_open(&p, "a wildcard for the target plays the first role whatever the verb calls it");
  plays_of(&p, "bench.shop.shelf", 0, &plays);
  CHECK_INT(plays.count, 1);
  CHECK_STR(plays.groups[0]->key, "as target for any");
  plays_close(&p);
}

static void a_wildcard_for_a_tool_is_not_run_for_a_target(void) {
  plays_case p;
  sprout_plays plays;
  plays_open(&p, "a wildcard for a tool is never played for a target: dropping the stuck gauge is untouched");
  plays_of(&p, "bench.shop.gauge", 0, &plays);
  CHECK_INT(plays.count, 0);
  plays_close(&p);
}

static void the_actors_own_part_has_no_wildcard(void) {
  plays_case p;
  sprout_plays plays;
  plays_open(&p, "take a book from the floor");
  plays_of(&p, "bench#1", -1, &plays);
  CHECK_INT(plays.count, 1);
  CHECK_STR(plays.groups[0]->key, "as actor for sprout.take");
  plays_close(&p);
}

static void a_participant_whose_kind_plays_nothing_runs_nothing(void) {
  plays_case p;
  sprout_plays plays;
  plays_open(&p, "take a book from the floor");
  plays_of(&p, "bench.shop.book", 0, &plays);
  CHECK_INT(plays.count, 0);
  plays_close(&p);
}

static void the_golden_wildcard_readings_end_as_the_typescript_runtime_did(void) {
  exec_bench b;
  reading_bench_open(&b);
  CHECK(reading_replay_area(&b, "wildcards") >= 7);
  exec_bench_close(&b);
  CHECK_INT(b.heap.pages, 0);
}

int main(void) {
  RUN(a_tool_runs_its_wildcard_before_its_plays_for_the_verb);
  RUN(a_target_runs_the_wildcard_for_the_first_role_whatever_the_verb_calls_it);
  RUN(a_wildcard_for_a_tool_is_not_run_for_a_target);
  RUN(the_actors_own_part_has_no_wildcard);
  RUN(a_participant_whose_kind_plays_nothing_runs_nothing);
  RUN(the_golden_wildcard_readings_end_as_the_typescript_runtime_did);
  return REPORT();
}
