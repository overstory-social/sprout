/*
 * Tests for src/offers.c (the spec's Verbs > Engine verbs: `help`; The runtime > The view): every verb a visitor
 * may type is offered once for each way its roles fill from what is in range, in the order the parser tries the
 * verbs, each typed by the verb's first phrase that fits and each a step; a set role is offered one member at a
 * time, `go` by each exit and link, a role only the actor plays is not offered their own place, two things
 * written alike are two offers, and in the dark only what is carried is offered, beside the ways out.
 */
#include "engine-verbs.h"
#include "expr/expr.h"
#include "offers.h"
#include "view_fixture.h"

typedef struct offers_case {
  view_bench b;
  view_case c;
  view_poll p;
  const sprout_offer *offers;
  size_t count;
} offers_case;

/* Opens the case and asks what the visitor could type where they stand. */
static sprout_eval_status offers_open(offers_case *k, const char *needle) {
  const sprout_way *ways;
  const sprout_reached *reached;
  size_t way_count, reached_count;
  view_bench_open(&k->b);
  view_bench_case_open(&k->b, &k->c, view_case_named(&k->b, needle));
  view_poll_open(&k->b, &k->c, &k->p);
  if (sprout_exits_from(&k->p.frame, k->p.place, &ways, &way_count) != SPROUT_EVAL_OK ||
      sprout_range_of(&k->p.frame, k->p.actor, NULL, &reached, &reached_count) != SPROUT_EVAL_OK)
    exit(2);
  return sprout_offers_to(&k->p.x, &k->p.frame, k->p.actor, ways, way_count, reached, reached_count, &k->offers, &k->count);
}

static void offers_close(offers_case *k) {
  view_poll_close(&k->p);
  view_case_close(&k->c);
  view_bench_close(&k->b);
  CHECK_INT(k->b.heap.pages, 0);
}

/* How many offers are typed exactly this. */
static size_t typed_as(const offers_case *k, const char *typed) {
  size_t i, n = 0;
  for (i = 0; i < k->count; i++)
    if (strcmp(k->offers[i].typed, typed) == 0) n++;
  return n;
}

static void the_offers_are_the_oracles_in_its_order_with_its_typed_lines_and_its_refusals(void) {
  view_bench b;
  const sprout_json *cases;
  size_t i, compared = 0;
  view_bench_open(&b);
  cases = sprout_json_get(b.golden, "cases");
  for (i = 0; i < cases->count; i++) {
    const sprout_json *expect = sprout_json_get(cases->items[i], "expect");
    const sprout_json *readings = sprout_json_get(sprout_json_get(expect, "view"), "readings");
    offers_case k;
    size_t at;
    if (sprout_json_get(expect, "fault")->kind != SPROUT_JSON_NULL || readings->count == 0) continue;
    CHECK_INT(offers_open(&k, view_text(cases->items[i], "name")), SPROUT_EVAL_OK);
    CHECK_INT(k.count, readings->count);
    for (at = 0; at < k.count && at < readings->count; at++) {
      CHECK_STR(k.offers[at].typed, view_text(readings->items[at], "typed"));
      CHECK(k.offers[at].refused == (sprout_json_get(readings->items[at], "refused")->kind != SPROUT_JSON_NULL));
    }
    offers_close(&k);
    compared++;
  }
  CHECK(compared >= 12);
  view_bench_close(&b);
}

static void go_is_offered_by_each_exit_by_its_direction_and_by_each_link_by_its_labels_typed_words(void) {
  offers_case k;
  CHECK_INT(offers_open(&k, "gate that stands open"), SPROUT_EVAL_OK);
  CHECK_INT(typed_as(&k, "go north"), 1);
  CHECK_INT(typed_as(&k, "go up"), 1);
  CHECK_INT(typed_as(&k, "go south"), 1);
  offers_close(&k);
  CHECK_INT(offers_open(&k, "a link set"), SPROUT_EVAL_OK);
  /* The label's characters are folded and split as a typed line is, whatever script they are in. */
  CHECK_INT(typed_as(&k, "go down the caf\xc3\xa9 stair"), 1);
  offers_close(&k);
  CHECK_INT(offers_open(&k, "a link not set"), SPROUT_EVAL_OK);
  CHECK_INT(typed_as(&k, "go down the caf\xc3\xa9 stair"), 0);
  offers_close(&k);
}

static void a_way_is_an_exit_filler_naming_where_it_leads(void) {
  offers_case k;
  size_t i, found = 0;
  CHECK_INT(offers_open(&k, "a link set"), SPROUT_EVAL_OK);
  for (i = 0; i < k.count; i++) {
    const sprout_resolved *r = &k.offers[i].reading;
    const sprout_stored_bound *way = sprout_exit_of(r);
    if (way == NULL) continue;
    found++;
    CHECK(!way->has_direction);
    CHECK(sprout_str_same(way->to, view_str("viewbench.yard")));
    CHECK_BYTES(way->label.bytes, way->label.length, "down the Caf\xc3\xa9\xc2\xa0Stair");
  }
  CHECK_INT(found, 1);
  offers_close(&k);
}

static void a_set_role_is_offered_one_member_at_a_time(void) {
  offers_case k;
  size_t i, sets = 0;
  CHECK_INT(offers_open(&k, "set role is offered"), SPROUT_EVAL_OK);
  for (i = 0; i < k.count; i++) {
    const sprout_resolved *r = &k.offers[i].reading;
    if (strcmp(r->verb->name, "juggle") != 0) continue;
    sets++;
    CHECK_INT(r->roles[0].bound.kind, SPROUT_BOUND_SET);
    CHECK_INT(r->roles[0].bound.set_count, 1);
  }
  CHECK_INT(sets, 5);
  offers_close(&k);
}

static void a_role_only_the_actor_plays_is_not_offered_their_own_place(void) {
  offers_case k;
  CHECK_INT(offers_open(&k, "a visitor in the yard is offered"), SPROUT_EVAL_OK);
  CHECK_INT(typed_as(&k, "take yard"), 0);
  CHECK_INT(typed_as(&k, "take guard"), 1);
  /* `examine` has no play of the actor's that moves its target, so the place is offered it. */
  CHECK_INT(typed_as(&k, "examine yard"), 1);
  offers_close(&k);
}

static void two_things_written_alike_are_two_offers(void) {
  offers_case k;
  size_t i, tins = 0;
  CHECK_INT(offers_open(&k, "two tins written alike"), SPROUT_EVAL_OK);
  CHECK_INT(typed_as(&k, "take tin"), 2);
  for (i = 0; i < k.count; i++)
    if (strcmp(k.offers[i].typed, "take tin") == 0) {
      tins++;
      CHECK(tins == 1 ? sprout_str_same(k.offers[i].reading.roles[0].bound.object, view_str("viewbench.store.tin"))
                      : sprout_str_same(k.offers[i].reading.roles[0].bound.object, view_str("viewbench.store.tin_too")));
    }
  offers_close(&k);
}

static void one_thing_does_not_fill_two_roles_of_one_offer(void) {
  offers_case k;
  CHECK_INT(offers_open(&k, "set role is offered"), SPROUT_EVAL_OK);
  CHECK_INT(typed_as(&k, "vouch to sentry before sentry for \xe2\x80\xa6"), 0);
  CHECK_INT(typed_as(&k, "vouch to sentry before usher for \xe2\x80\xa6"), 1);
  offers_close(&k);
}

static void in_the_dark_only_what_is_carried_is_offered_beside_the_ways_out(void) {
  offers_case k;
  CHECK_INT(offers_open(&k, "what is carried is still offered"), SPROUT_EVAL_OK);
  CHECK_INT(typed_as(&k, "drop pebble"), 1);
  CHECK_INT(typed_as(&k, "take coal"), 0);
  CHECK_INT(typed_as(&k, "examine coal"), 0);
  CHECK_INT(typed_as(&k, "go up"), 1);
  CHECK_INT(typed_as(&k, "look"), 1);
  offers_close(&k);
}

static void an_offer_is_greyed_by_the_consent_pass_or_by_the_engines_inside_itself(void) {
  offers_case k;
  size_t i;
  CHECK_INT(offers_open(&k, "two tins written alike"), SPROUT_EVAL_OK);
  for (i = 0; i < k.count; i++) {
    const sprout_offer *offer = &k.offers[i];
    if (strcmp(offer->typed, "stuff big into small") == 0) {
      CHECK(offer->refused);
      CHECK_STR(offer->refusal.refusal.said.name, "inside_itself");
      CHECK_STR(offer->refusal.role, "box");
    }
    if (strcmp(offer->typed, "stuff small into big") == 0) CHECK(!offer->refused);
    if (strcmp(offer->typed, "drop tin") == 0) CHECK_STR(offer->refusal.role, "actor");
  }
  offers_close(&k);
}

static void every_offer_is_a_step_so_a_world_too_large_to_list_faults_as_work_does(void) {
  offers_case k;
  const sprout_way *ways;
  const sprout_reached *reached;
  size_t way_count, reached_count;
  CHECK_INT(offers_open(&k, "a visitor in the yard is offered"), SPROUT_EVAL_OK);
  CHECK(k.p.meter.steps >= k.count);
  offers_close(&k);
  view_bench_open(&k.b);
  view_bench_case_open(&k.b, &k.c, view_case_named(&k.b, "a visitor in the yard is offered"));
  k.c.host.budgets.poll_steps = (sprout_limit){true, 20};
  view_poll_open(&k.b, &k.c, &k.p);
  CHECK_INT(sprout_exits_from(&k.p.frame, k.p.place, &ways, &way_count), SPROUT_EVAL_OK);
  CHECK_INT(sprout_range_of(&k.p.frame, k.p.actor, NULL, &reached, &reached_count), SPROUT_EVAL_OK);
  CHECK_INT(sprout_offers_to(&k.p.x, &k.p.frame, k.p.actor, ways, way_count, reached, reached_count, &k.offers, &k.count),
            SPROUT_EVAL_FAULT);
  CHECK(k.p.meter.faulted);
  offers_close(&k);
}

static void a_visitor_who_is_away_can_do_nothing(void) {
  offers_case k;
  CHECK_INT(offers_open(&k, "a visitor in the yard is offered"), SPROUT_EVAL_OK);
  CHECK_INT(sprout_offers_to(&k.p.x, &k.p.frame, view_str("viewbench"), NULL, 0, NULL, 0, &k.offers, &k.count), SPROUT_EVAL_ENGINE);
  offers_close(&k);
}

int main(void) {
  RUN(the_offers_are_the_oracles_in_its_order_with_its_typed_lines_and_its_refusals);
  RUN(go_is_offered_by_each_exit_by_its_direction_and_by_each_link_by_its_labels_typed_words);
  RUN(a_way_is_an_exit_filler_naming_where_it_leads);
  RUN(a_set_role_is_offered_one_member_at_a_time);
  RUN(a_role_only_the_actor_plays_is_not_offered_their_own_place);
  RUN(two_things_written_alike_are_two_offers);
  RUN(one_thing_does_not_fill_two_roles_of_one_offer);
  RUN(in_the_dark_only_what_is_carried_is_offered_beside_the_ways_out);
  RUN(an_offer_is_greyed_by_the_consent_pass_or_by_the_engines_inside_itself);
  RUN(every_offer_is_a_step_so_a_world_too_large_to_list_faults_as_work_does);
  RUN(a_visitor_who_is_away_can_do_nothing);
  return REPORT();
}
