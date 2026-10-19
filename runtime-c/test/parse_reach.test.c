/*
 * Tests for src/parse/reach.c: what a visitor may name (the spec's Range; Range > Sight; Parsing > Choosing a
 * reading), read in the corpus world `grammar`, the dark read in
 * `darkness`, what is unseen read in `unseen`, and what a visitor arriving in every corpus world may name, with how near, whether carried and the
 * steps it cost, held to the golden (`corpus/goldens/addresses.json`).
 */
#include "parse_golden.h"
#include "unseen_fixture.h"

/* The candidate for `id`, or NULL where it may not be named. */
static const parse_candidate *find(const parse_candidate *candidates, size_t count, const char *id) {
  size_t i;
  for (i = 0; i < count; i++)
    if (sprout_str_same(candidates[i].instance->id, bench_str(id))) return &candidates[i];
  return NULL;
}

static void reach(bench *b, parse_candidate **candidates, size_t *count) {
  CHECK_INT(parse_reach_of(&b->frame, b->actor, candidates, count), SPROUT_EVAL_OK);
}

static void it_is_every_live_thing_the_walk_reaches_but_the_world_the_visitor_first(void) {
  bench b;
  parse_candidate *candidates;
  size_t count;
  bench_open(&b, "grammar", "Marta");
  reach(&b, &candidates, &count);
  CHECK(count > 0 && sprout_str_same(candidates[0].instance->id, b.actor));
  CHECK(find(candidates, count, "study.hall.lamp") != NULL);
  CHECK(find(candidates, count, "study.hall") != NULL);
  CHECK(find(candidates, count, "study") == NULL);
  /* The chest is shut, so the coin in it is out of reach. */
  CHECK(find(candidates, count, "study.hall.chest.coin") == NULL);
  bench_close(&b);
}

static void it_ranks_the_visitors_own_place_below_everything_it_holds(void) {
  bench b;
  parse_candidate *candidates;
  size_t count;
  bench_open(&b, "grammar", "Marta");
  reach(&b, &candidates, &count);
  CHECK_INT(candidates[0].near, 0);
  CHECK(find(candidates, count, "study.hall.lamp")->near < find(candidates, count, "study.hall")->near);
  CHECK(find(candidates, count, "study.hall.chest")->near < find(candidates, count, "study.hall")->near);
  bench_close(&b);
}

static void it_says_what_the_visitor_carries(void) {
  bench b;
  parse_candidate *candidates;
  size_t count, i;
  bench_open(&b, "grammar", "Marta");
  reach(&b, &candidates, &count);
  for (i = 0; i < count; i++) CHECK(!candidates[i].carried);
  CHECK_INT(sprout_draft_place(&b.run.draft, bench_str("study.hall.lamp"), &b.actor), SPROUT_DRAFT_OK);
  reach(&b, &candidates, &count);
  CHECK(find(candidates, count, "study.hall.lamp")->carried);
  CHECK(!candidates[0].carried);
  bench_close(&b);
}

static void in_the_dark_a_visitor_names_only_themselves_and_what_they_carry(void) {
  bench b;
  parse_candidate *candidates;
  size_t count;
  sprout_str cellar = bench_str("darkness.cellar");
  bench_open(&b, "darkness", "Marta");
  CHECK_INT(sprout_draft_place(&b.run.draft, b.actor, &cellar), SPROUT_DRAFT_OK);
  reach(&b, &candidates, &count);
  CHECK_INT(count, 1);
  CHECK(sprout_str_same(candidates[0].instance->id, b.actor));
  CHECK_INT(sprout_draft_place(&b.run.draft, bench_str("darkness.kitchen.lamp"), &b.actor), SPROUT_DRAFT_OK);
  reach(&b, &candidates, &count);
  CHECK_INT(count, 2);
  CHECK(find(candidates, count, "darkness.kitchen.lamp") != NULL && find(candidates, count, "darkness.kitchen.lamp")->carried);
  CHECK(find(candidates, count, "darkness.cellar.coal") == NULL);
  bench_close(&b);
}

static void what_is_unseen_and_what_it_holds_may_not_be_named_until_it_is_seen(void) {
  bench b;
  parse_candidate *candidates;
  size_t count;
  bench_open(&b, "unseen", "Marta");
  reach(&b, &candidates, &count);
  CHECK(find(candidates, count, "unseen.hall.bell") != NULL);
  CHECK(find(candidates, count, "unseen.hall.thief") == NULL);
  CHECK(find(candidates, count, "unseen.hall.grating") == NULL);
  CHECK(find(candidates, count, "unseen.hall.niche") == NULL);
  CHECK(find(candidates, count, "unseen.hall.niche.coin") == NULL);
  unseen_write(&b.run.draft, b.frame.turn, "unseen.hall.niche", false);
  unseen_write(&b.run.draft, b.frame.turn, "unseen.hall.thief", false);
  reach(&b, &candidates, &count);
  CHECK(find(candidates, count, "unseen.hall.thief") != NULL);
  CHECK(find(candidates, count, "unseen.hall.niche") != NULL);
  CHECK(find(candidates, count, "unseen.hall.niche.coin") != NULL);
  bench_close(&b);
}

static void a_thing_the_visitor_carries_is_not_named_while_it_is_unseen(void) {
  bench b;
  parse_candidate *candidates;
  size_t count;
  bench_open(&b, "unseen", "Marta");
  CHECK_INT(sprout_draft_place(&b.run.draft, bench_str("unseen.hall.bell"), &b.actor), SPROUT_DRAFT_OK);
  reach(&b, &candidates, &count);
  CHECK(find(candidates, count, "unseen.hall.bell") != NULL && find(candidates, count, "unseen.hall.bell")->carried);
  unseen_write(&b.run.draft, b.frame.turn, "unseen.hall.bell", true);
  reach(&b, &candidates, &count);
  CHECK(find(candidates, count, "unseen.hall.bell") == NULL);
  CHECK(count > 0 && sprout_str_same(candidates[0].instance->id, b.actor));
  bench_close(&b);
}

/* What the arrived visitor may name, in the golden's order, and the steps it cost. */
static void reached_alike(bench *b, const sprout_json *world) {
  const sprout_json *expected = sprout_json_get(world, "candidates");
  parse_candidate *candidates;
  size_t count, i;
  uint64_t before = b->run.meter->steps;
  reach(b, &candidates, &count);
  /* The golden is hand-kept; whatever it holds, the visitor is the first thing they may name. */
  CHECK(count > 0 && sprout_str_same(candidates[0].instance->id, b->actor));
  CHECK_INT(b->run.meter->steps - before, (long long)sprout_json_get(world, "steps")->number);
  CHECK_INT(count, expected->count);
  for (i = 0; i < count && i < expected->count; i++) {
    const sprout_json *one = expected->items[i];
    CHECK_BYTES(candidates[i].instance->id.bytes, candidates[i].instance->id.length, one->items[0]->bytes);
    CHECK_INT(candidates[i].near, (long long)one->items[1]->number);
    CHECK_INT(candidates[i].carried, one->items[2]->boolean);
  }
}

static void every_corpus_worlds_arrived_visitor_may_name_what_the_typescript_runtime_says(void) {
  golden_worlds(reached_alike);
}

int main(void) {
  RUN(it_is_every_live_thing_the_walk_reaches_but_the_world_the_visitor_first);
  RUN(it_ranks_the_visitors_own_place_below_everything_it_holds);
  RUN(it_says_what_the_visitor_carries);
  RUN(in_the_dark_a_visitor_names_only_themselves_and_what_they_carry);
  RUN(what_is_unseen_and_what_it_holds_may_not_be_named_until_it_is_seen);
  RUN(a_thing_the_visitor_carries_is_not_named_while_it_is_unseen);
  RUN(every_corpus_worlds_arrived_visitor_may_name_what_the_typescript_runtime_says);
  return REPORT();
}
