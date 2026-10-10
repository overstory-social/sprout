/*
 * Tests for src/reading/sure.c (the spec's The runtime > The view; Movement and consent > After the move): a
 * poll runs no `do`, so it reads them. The first `move` written directly in a play's `do`, between names that
 * play's frame binds, is the move it is sure to propose: read across a reading's plays in the effect pass's
 * order it greys an offer that would put a thing inside itself with the engine's `inside_itself`, and read in the
 * actor's own plays it says which roles move their filler. Each play read is a step, and each container climbed
 * another.
 */
#include "expr/expr.h"
#include "offers.h"
#include "reading/reading.h"
#include "view_fixture.h"

typedef struct sure_case {
  view_bench b;
  view_case c;
  view_poll p;
  const sprout_offer *offers;
  size_t count;
} sure_case;

static void sure_open(sure_case *k, const char *needle) {
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

static void sure_close(sure_case *k) {
  view_poll_close(&k->p);
  view_case_close(&k->c);
  view_bench_close(&k->b);
  CHECK_INT(k->b.heap.pages, 0);
}

static const sprout_resolved *reading_typed(sure_case *k, const char *typed) {
  size_t i;
  for (i = 0; i < k->count; i++)
    if (strcmp(k->offers[i].typed, typed) == 0) return &k->offers[i].reading;
  fprintf(stderr, "no offer is typed `%s`\n", typed);
  exit(2);
}

static void a_sure_move_that_puts_a_thing_inside_itself_is_refused_in_the_engines_words(void) {
  sure_case k;
  sprout_permit_refusal refusal;
  bool refused;
  sure_open(&k, "two tins written alike");
  memset(&refusal, 0, sizeof refusal);
  CHECK_INT(sprout_inside_itself(&k.p.x, &k.p.frame, reading_typed(&k, "stuff big into small"), &refused, &refusal), SPROUT_EVAL_OK);
  CHECK(refused);
  CHECK_STR(refusal.role, "box");
  CHECK(refusal.refusal.origin == NULL);
  CHECK_STR(refusal.refusal.said.name, "inside_itself");
  CHECK_INT(refusal.refusal.binding_count, 1);
  CHECK_STR(refusal.refusal.bindings[0].name, "item");
  CHECK(sprout_str_same(refusal.refusal.bindings[0].bound.id, view_str("viewbench.store.big")));
  sure_close(&k);
}

static void a_sure_move_that_does_not_is_not_refused(void) {
  sure_case k;
  sprout_permit_refusal refusal;
  bool refused = true;
  sure_open(&k, "two tins written alike");
  CHECK_INT(sprout_inside_itself(&k.p.x, &k.p.frame, reading_typed(&k, "stuff small into big"), &refused, &refusal), SPROUT_EVAL_OK);
  CHECK(!refused);
  sure_close(&k);
}

static void a_reading_with_no_move_written_in_a_do_is_not_refused(void) {
  sure_case k;
  sprout_permit_refusal refusal;
  bool refused = true;
  sure_open(&k, "two tins written alike");
  CHECK_INT(sprout_inside_itself(&k.p.x, &k.p.frame, reading_typed(&k, "look"), &refused, &refusal), SPROUT_EVAL_OK);
  CHECK(!refused);
  sure_close(&k);
}

static void each_play_read_and_each_container_climbed_is_a_step(void) {
  sure_case k;
  sprout_permit_refusal refusal;
  bool refused;
  uint64_t before;
  sure_open(&k, "two tins written alike");
  before = k.p.meter.steps;
  CHECK_INT(sprout_inside_itself(&k.p.x, &k.p.frame, reading_typed(&k, "stuff big into small"), &refused, &refusal), SPROUT_EVAL_OK);
  /* The one play there is, then `small` and `big` on the way up from `small`. */
  CHECK_INT(k.p.meter.steps - before, 3);
  sure_close(&k);
}

static void the_actors_own_play_says_which_role_it_moves_its_filler_into(void) {
  sure_case k;
  const sprout_verb *take;
  bool moves = false;
  sure_open(&k, "a visitor in the yard is offered");
  take = view_verb(k.c.world, "sprout.take");
  CHECK_INT(sprout_moves_its_filler(&k.p.frame, take, &take->roles[0], k.p.actor, &moves), SPROUT_EVAL_OK);
  CHECK(moves);
  sure_close(&k);
}

static void a_role_the_actors_play_leaves_alone_is_not_moved(void) {
  sure_case k;
  const sprout_verb *examine;
  bool moves = true;
  uint64_t before;
  sure_open(&k, "a visitor in the yard is offered");
  examine = view_verb(k.c.world, "sprout.examine");
  before = k.p.meter.steps;
  CHECK_INT(sprout_moves_its_filler(&k.p.frame, examine, &examine->roles[0], k.p.actor, &moves), SPROUT_EVAL_OK);
  CHECK(!moves);
  CHECK_INT(k.p.meter.steps - before, 0);
  sure_close(&k);
}

static void a_budget_spent_reading_plays_faults_as_any_work_does(void) {
  sure_case k;
  sprout_permit_refusal refusal;
  bool refused;
  sure_open(&k, "two tins written alike");
  k.c.host.budgets.poll_steps = (sprout_limit){true, k.p.meter.steps + 1};
  CHECK_INT(sprout_inside_itself(&k.p.x, &k.p.frame, reading_typed(&k, "stuff big into small"), &refused, &refusal), SPROUT_EVAL_FAULT);
  CHECK(k.p.meter.faulted);
  sure_close(&k);
}

int main(void) {
  RUN(a_sure_move_that_puts_a_thing_inside_itself_is_refused_in_the_engines_words);
  RUN(a_sure_move_that_does_not_is_not_refused);
  RUN(a_reading_with_no_move_written_in_a_do_is_not_refused);
  RUN(each_play_read_and_each_container_climbed_is_a_step);
  RUN(the_actors_own_play_says_which_role_it_moves_its_filler_into);
  RUN(a_role_the_actors_play_leaves_alone_is_not_moved);
  RUN(a_budget_spent_reading_plays_faults_as_any_work_does);
  return REPORT();
}
