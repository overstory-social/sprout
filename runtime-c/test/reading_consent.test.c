/*
 * Tests for src/reading/consent.c (the spec's Verbs > The two passes, Playing
 * a role, Roles compose, Set roles, Optional tools, Value roles, A
 * role-player narrows its own options): the participants are the actor and
 * then each role's players in the verb's order, a set role's in the order
 * typed and none for a tool left out; the first `permit` to refuse is the
 * reading's whole outcome, a play of the target before one of its tool; and
 * the frame a play runs in binds `actor`, `here` and each other role as that
 * play sees it, a set role always, a value only among the options the play
 * hears.
 */
#include "reading_fixture.h"

typedef struct consent_case {
  exec_bench b;
  exec_case c;
  sprout_resolved reading;
} consent_case;

static void consent_open(consent_case *k, const char *name) {
  reading_bench_open(&k->b);
  reading_case_open(&k->b, &k->c, reading_named(&k->b, name));
  k->reading = reading_of(&k->c, sprout_json_get(k->c.golden, "reading"));
}

static void consent_close(consent_case *k) {
  exec_case_close(&k->c);
  exec_bench_close(&k->b);
}

static void the_participants_are_the_actor_then_each_roles_players_in_the_verbs_order(void) {
  consent_case k;
  const sprout_participant *participants;
  size_t count;
  consent_open(&k, "every part plays: the target’s composed kinds, its tool, then the weights of a set role");
  CHECK_INT(sprout_participants(&k.c.x, &k.reading, &participants, &count), SPROUT_EVAL_OK);
  CHECK_INT(count, 5);
  CHECK(participants[0].role == NULL && sprout_str_same(participants[0].id, exec_str("bench#1")));
  CHECK_STR(participants[1].role->name, "target");
  CHECK(sprout_str_same(participants[1].id, exec_str("bench.shop.both")));
  CHECK_STR(participants[2].role->name, "tool");
  CHECK_STR(participants[3].role->name, "weights");
  CHECK(sprout_str_same(participants[3].id, exec_str("bench.shop.w1")));
  CHECK(sprout_str_same(participants[4].id, exec_str("bench.shop.w2")));
  consent_close(&k);
}

static void a_tool_left_out_and_a_set_left_empty_are_not_participants(void) {
  consent_case k;
  const sprout_participant *participants;
  size_t count;
  consent_open(&k, "a tool and a set left out are not participants, and the set is the empty set");
  CHECK_INT(sprout_participants(&k.c.x, &k.reading, &participants, &count), SPROUT_EVAL_OK);
  CHECK_INT(count, 2);
  consent_close(&k);
}

static void a_value_and_an_exit_are_named_by_the_visitor_and_play_no_part(void) {
  consent_case k;
  const sprout_participant *participants;
  size_t count;
  consent_open(&k, "a symbol the role-player’s list property holds is bound");
  CHECK_INT(sprout_participants(&k.c.x, &k.reading, &participants, &count), SPROUT_EVAL_OK);
  CHECK_INT(count, 2);
  consent_close(&k);
  consent_open(&k, "go through an exit");
  CHECK_INT(sprout_participants(&k.c.x, &k.reading, &participants, &count), SPROUT_EVAL_OK);
  CHECK_INT(count, 1);
  consent_close(&k);
}

static void the_actors_place_is_its_container_which_holds_actors(void) {
  consent_case k;
  sprout_str place;
  consent_open(&k, "take a book from the floor");
  CHECK_INT(sprout_place_of(&k.c.frame, exec_str("bench#1"), &place), SPROUT_EVAL_OK);
  CHECK(sprout_str_same(place, exec_str("bench.shop")));
  consent_close(&k);
}

static void an_actor_that_is_away_or_stands_where_none_stand_is_the_engines_defect(void) {
  consent_case k;
  sprout_str place, chest = exec_str("bench.shop.chest");
  consent_open(&k, "take a book from the floor");
  CHECK_INT(sprout_draft_place(&k.c.draft, exec_str("bench#1"), &chest), SPROUT_DRAFT_OK);
  CHECK_INT(sprout_place_of(&k.c.frame, exec_str("bench#1"), &place), SPROUT_EVAL_ENGINE);
  CHECK_STR(k.c.fault.text, "`bench#1` is in `bench.shop.chest`, which holds no actors.");
  CHECK_INT(sprout_draft_place(&k.c.draft, exec_str("bench#1"), NULL), SPROUT_DRAFT_OK);
  CHECK_INT(sprout_place_of(&k.c.frame, exec_str("bench#1"), &place), SPROUT_EVAL_ENGINE);
  CHECK_STR(k.c.fault.text, "`bench#1` is away, and an away visitor reads nothing.");
  consent_close(&k);
}

static void the_first_permit_to_refuse_is_the_readings_whole_outcome(void) {
  consent_case k;
  bool refused = false;
  sprout_permit_refusal refusal;
  consent_open(&k, "the composer’s own permit refuses after those it composes");
  CHECK_INT(sprout_consent_pass(&k.c.x, &k.c.frame, &k.reading, &refused, &refusal), SPROUT_EVAL_OK);
  CHECK(refused);
  CHECK(sprout_str_same(refusal.refusal.by, exec_str("bench.shop.both")));
  CHECK_STR(refusal.role, "target");
  CHECK_STR(refusal.refusal.origin, "bench.Both");
  CHECK_INT(k.c.x.effect_count, 0);
  consent_close(&k);
}

static void a_reading_every_participant_consents_to_is_not_refused(void) {
  consent_case k;
  bool refused = true;
  sprout_permit_refusal refusal;
  consent_open(&k, "every part plays: the target’s composed kinds, its tool, then the weights of a set role");
  CHECK_INT(sprout_consent_pass(&k.c.x, &k.c.frame, &k.reading, &refused, &refusal), SPROUT_EVAL_OK);
  CHECK(!refused);
  consent_close(&k);
}

/* The names a play of participant `index` runs under, oldest first, comma separated. */
static const char *frame_names(consent_case *k, size_t index, bool *has_topic) {
  static char names[256];
  const sprout_participant *participants;
  size_t count, i, used = 0;
  sprout_frame inside;
  const sprout_effect_binding *bindings;
  sprout_plays plays;
  const sprout_stored_instance *self;
  size_t bound;
  CHECK_INT(sprout_participants(&k->c.x, &k->reading, &participants, &count), SPROUT_EVAL_OK);
  self = sprout_draft_instance(&k->c.draft, participants[index].id);
  sprout_plays_for(&k->reading, &participants[index], self->kind, &plays);
  CHECK(plays.count > 0);
  CHECK_INT(sprout_play_frame(&k->c.x, &k->reading, &participants[index], &plays.groups[plays.count - 1]->plays[0], false, &inside), SPROUT_EVAL_OK);
  CHECK_INT(sprout_effect_names(&inside, &bindings, &bound), SPROUT_EVAL_OK);
  names[0] = '\0';
  *has_topic = false;
  for (i = 0; i < bound; i++) {
    used += (size_t)snprintf(names + used, sizeof names - used, "%s%s", i > 0 ? "," : "", bindings[i].name);
    if (strcmp(bindings[i].name, "topic") == 0 || strcmp(bindings[i].name, "number") == 0) *has_topic = true;
  }
  return names;
}

static void a_plays_frame_binds_actor_here_and_each_other_role(void) {
  consent_case k;
  bool value;
  consent_open(&k, "every part plays: the target’s composed kinds, its tool, then the weights of a set role");
  /* The target sees the tool and the set, and not itself; a set role is bound even for its own players. */
  CHECK_STR(frame_names(&k, 1, &value), "actor,here,tool,weights");
  CHECK_STR(frame_names(&k, 2, &value), "actor,here,target,weights");
  CHECK_STR(frame_names(&k, 3, &value), "actor,here,target,tool,weights");
  consent_close(&k);
}

static void a_value_is_bound_only_among_the_options_the_play_hears(void) {
  consent_case k;
  bool value;
  consent_open(&k, "a symbol the role-player’s list property holds is bound");
  CHECK_STR(frame_names(&k, 1, &value), "actor,here,topic");
  CHECK(value);
  consent_close(&k);
  consent_open(&k, "a symbol the list property does not hold is not bound");
  CHECK_STR(frame_names(&k, 1, &value), "actor,here");
  CHECK(!value);
  consent_close(&k);
  consent_open(&k, "a number inside the range a play writes out is bound");
  frame_names(&k, 1, &value);
  CHECK(value);
  consent_close(&k);
  consent_open(&k, "a number outside the range a play writes out is not bound");
  frame_names(&k, 1, &value);
  CHECK(!value);
  consent_close(&k);
  consent_open(&k, "a number inside the range of the integer property a play names is bound");
  frame_names(&k, 1, &value);
  CHECK(value);
  consent_close(&k);
}

static void a_permit_is_given_no_draws_and_a_do_is(void) {
  consent_case k;
  const sprout_participant *participants;
  size_t count;
  sprout_frame inside;
  sprout_plays plays;
  const sprout_stored_instance *self;
  consent_open(&k, "every part plays: the target’s composed kinds, its tool, then the weights of a set role");
  CHECK_INT(sprout_participants(&k.c.x, &k.reading, &participants, &count), SPROUT_EVAL_OK);
  self = sprout_draft_instance(&k.c.draft, participants[1].id);
  sprout_plays_for(&k.reading, &participants[1], self->kind, &plays);
  CHECK_INT(sprout_play_frame(&k.c.x, &k.reading, &participants[1], &plays.groups[0]->plays[0], false, &inside), SPROUT_EVAL_OK);
  CHECK(inside.draws == NULL);
  CHECK_INT(sprout_play_frame(&k.c.x, &k.reading, &participants[1], &plays.groups[0]->plays[0], true, &inside), SPROUT_EVAL_OK);
  CHECK(inside.draws == &k.c.draws);
  CHECK_STR(inside.library, "bench");
  CHECK(sprout_str_same(inside.self, exec_str("bench.shop.both")));
  consent_close(&k);
}

static void the_golden_composition_and_value_readings_end_as_the_typescript_runtime_did(void) {
  exec_bench b;
  reading_bench_open(&b);
  CHECK(reading_replay_area(&b, "composition") >= 5);
  CHECK(reading_replay_area(&b, "values") >= 5);
  exec_bench_close(&b);
  CHECK_INT(b.heap.pages, 0);
}

int main(void) {
  RUN(the_participants_are_the_actor_then_each_roles_players_in_the_verbs_order);
  RUN(a_tool_left_out_and_a_set_left_empty_are_not_participants);
  RUN(a_value_and_an_exit_are_named_by_the_visitor_and_play_no_part);
  RUN(the_actors_place_is_its_container_which_holds_actors);
  RUN(an_actor_that_is_away_or_stands_where_none_stand_is_the_engines_defect);
  RUN(the_first_permit_to_refuse_is_the_readings_whole_outcome);
  RUN(a_reading_every_participant_consents_to_is_not_refused);
  RUN(a_plays_frame_binds_actor_here_and_each_other_role);
  RUN(a_value_is_bound_only_among_the_options_the_play_hears);
  RUN(a_permit_is_given_no_draws_and_a_do_is);
  RUN(the_golden_composition_and_value_readings_end_as_the_typescript_runtime_did);
  return REPORT();
}
