/*
 * Tests for src/options.c (the spec's Verbs > Value roles, A role-player narrows its own options): a value role
 * binds only what some participant's `from` hears, so its options are exactly those, first heard first: a
 * symbol role's, the options each participant's list property holds now, and an integer role's, each range a
 * participant's integer property or literal range gives. A role nobody narrows has none, and each `from` asked
 * is a step.
 */
#include "expr/expr.h"
#include "offers.h"
#include "options.h"
#include "view_fixture.h"

typedef struct options_case {
  view_bench b;
  view_case c;
  view_poll p;
  const sprout_offer *offers;
  size_t count;
} options_case;

static void options_open(options_case *k, const char *needle) {
  const sprout_way *ways;
  const sprout_reached *reached;
  size_t way_count, reached_count;
  view_bench_open(&k->b);
  view_bench_case_open(&k->b, &k->c, view_case_named(&k->b, needle));
  view_poll_open(&k->b, &k->c, &k->p);
  if (sprout_exits_from(&k->p.frame, k->p.place, &ways, &way_count) != SPROUT_EVAL_OK ||
      sprout_range_of(&k->p.frame, k->p.actor, NULL, &reached, &reached_count) != SPROUT_EVAL_OK ||
      sprout_offers_to(&k->p.x, &k->p.frame, k->p.actor, ways, way_count, reached, reached_count, &k->offers,
                       &k->count) != SPROUT_EVAL_OK)
    exit(2);
}

static void options_close(options_case *k) {
  view_poll_close(&k->p);
  view_case_close(&k->c);
  view_bench_close(&k->b);
  CHECK_INT(k->b.heap.pages, 0);
}

/* The options of the offer typed this, which the test aborts without. */
static const sprout_role_options *options_of(options_case *k, const char *typed, size_t *count) {
  const sprout_role_options *options;
  size_t i;
  for (i = 0; i < k->count; i++)
    if (strcmp(k->offers[i].typed, typed) == 0) {
      if (sprout_value_options(&k->p.x, &k->p.frame, &k->offers[i].reading, &options, count) != SPROUT_EVAL_OK) exit(2);
      return options;
    }
  fprintf(stderr, "no offer is typed `%s`\n", typed);
  exit(2);
}

static void the_options_are_the_oracles_for_every_offer_of_every_bench_case(void) {
  view_bench b;
  const sprout_json *cases;
  size_t i, offers_compared = 0;
  view_bench_open(&b);
  cases = sprout_json_get(b.golden, "cases");
  for (i = 0; i < cases->count; i++) {
    const sprout_json *expect = sprout_json_get(cases->items[i], "expect");
    const sprout_json *readings = sprout_json_get(sprout_json_get(expect, "view"), "readings");
    options_case k;
    size_t at;
    if (sprout_json_get(expect, "fault")->kind != SPROUT_JSON_NULL || readings->count == 0) continue;
    options_open(&k, view_text(cases->items[i], "name"));
    for (at = 0; at < k.count && at < readings->count; at++) {
      const sprout_json *wanted = sprout_json_get(readings->items[at], "options");
      const sprout_role_options *held;
      size_t held_count, o, j;
      CHECK_INT(sprout_value_options(&k.p.x, &k.p.frame, &k.offers[at].reading, &held, &held_count), SPROUT_EVAL_OK);
      CHECK_INT(held_count, wanted->count);
      for (o = 0; o < held_count && o < wanted->count; o++) {
        const sprout_json *role = wanted->items[o];
        CHECK_STR(held[o].role, view_text(role, "role"));
        CHECK(held[o].symbol == (strcmp(view_text(role, "takes"), "symbol") == 0));
        if (held[o].symbol) {
          const sprout_json *list = sprout_json_get(role, "options");
          CHECK_INT(held[o].option_count, list->count);
          for (j = 0; j < held[o].option_count && j < list->count; j++)
            CHECK_BYTES(held[o].options[j].bytes, held[o].options[j].length, view_text(list->items[j], "value"));
        } else {
          const sprout_json *list = sprout_json_get(role, "ranges");
          CHECK_INT(held[o].range_count, list->count);
          for (j = 0; j < held[o].range_count && j < list->count; j++) {
            CHECK(held[o].ranges[j].min == sprout_json_get(list->items[j], "min")->number);
            CHECK(held[o].ranges[j].max == sprout_json_get(list->items[j], "max")->number);
          }
        }
      }
      offers_compared++;
    }
    options_close(&k);
  }
  CHECK(offers_compared > 100);
  view_bench_close(&b);
}

static void a_symbol_role_offers_what_each_participants_list_property_holds_first_heard_first(void) {
  options_case k;
  const sprout_role_options *options;
  size_t count;
  options_open(&k, "changes what it hears");
  options = options_of(&k, "vouch to sentry before usher for \xe2\x80\xa6", &count);
  CHECK_INT(count, 1);
  CHECK(options[0].symbol);
  CHECK_INT(options[0].option_count, 4);
  CHECK_BYTES(options[0].options[0].bytes, options[0].options[0].length, "old_road");
  CHECK_BYTES(options[0].options[1].bytes, options[0].options[1].length, "weather");
  CHECK_BYTES(options[0].options[2].bytes, options[0].options[2].length, "bridge");
  CHECK_BYTES(options[0].options[3].bytes, options[0].options[3].length, "toll");
  options_close(&k);
}

static void an_option_two_participants_hear_is_offered_once(void) {
  options_case k;
  const sprout_role_options *options;
  size_t count;
  options_open(&k, "set role is offered");
  options = options_of(&k, "vouch to sentry before usher for \xe2\x80\xa6", &count);
  CHECK_INT(options[0].option_count, 2);
  options_close(&k);
}

static void an_integer_role_offers_the_range_a_property_or_a_literal_gives(void) {
  options_case k;
  const sprout_role_options *options;
  size_t count;
  options_open(&k, "set role is offered");
  options = options_of(&k, "punch \xe2\x80\xa6 on keypad", &count);
  CHECK(!options[0].symbol);
  CHECK_INT(options[0].range_count, 1);
  CHECK(options[0].ranges[0].min == 1 && options[0].ranges[0].max == 12);
  options = options_of(&k, "turn dial to \xe2\x80\xa6", &count);
  CHECK_INT(options[0].range_count, 1);
  CHECK(options[0].ranges[0].min == 0 && options[0].ranges[0].max == 9);
  options_close(&k);
}

static void a_role_nobody_narrows_has_no_options_and_a_verb_without_one_has_no_entry(void) {
  options_case k;
  const sprout_role_options *options;
  size_t count;
  options_open(&k, "set role is offered");
  options = options_of(&k, "ask keypad about \xe2\x80\xa6", &count);
  CHECK_INT(count, 1);
  CHECK_INT(options[0].option_count, 0);
  options_of(&k, "look", &count);
  CHECK_INT(count, 0);
  options_close(&k);
}

static void each_from_asked_is_a_step(void) {
  options_case k;
  uint64_t before;
  size_t count;
  options_open(&k, "set role is offered");
  before = k.p.meter.steps;
  options_of(&k, "vouch to sentry before usher for \xe2\x80\xa6", &count);
  /* The sentry's and the usher's `from` are each asked once. */
  CHECK_INT(k.p.meter.steps - before, 2);
  before = k.p.meter.steps;
  options_of(&k, "look", &count);
  CHECK_INT(k.p.meter.steps - before, 0);
  options_close(&k);
}

int main(void) {
  RUN(the_options_are_the_oracles_for_every_offer_of_every_bench_case);
  RUN(a_symbol_role_offers_what_each_participants_list_property_holds_first_heard_first);
  RUN(an_option_two_participants_hear_is_offered_once);
  RUN(an_integer_role_offers_the_range_a_property_or_a_literal_gives);
  RUN(a_role_nobody_narrows_has_no_options_and_a_verb_without_one_has_no_entry);
  RUN(each_from_asked_is_a_step);
  return REPORT();
}
