/*
 * Tests for src/parse/rank.c: choosing a reading (the spec's Parsing > Choosing a reading; the working notes' Holes
 * 461), over readings of `take` and the standard library's `open_with` intent in the study (the corpus world
 * `grammar`), ranked as each case says. `rank.spec.ts`'s cases, ported: how the engine writes a thing is the study's
 * own, where the pebbles are both "a pebble" and everything else is written apart.
 */
#include "parse_fixture.h"

#define BRASS_KEY "study.hall.brass_key"
#define IRON_KEY "study.hall.iron_key"
#define GONG "study.hall.gong"
#define PEBBLE_A "study.hall.pebble_a"
#define PEBBLE_B "study.hall.pebble_b"

/* One ranked reading and what it holds. */
typedef struct held {
  parse_ranked ranked;
  size_t near[2];
  sprout_stored_bound bounds[2];
} held;

static const size_t ROLES[2] = {0, 1};

/* Taking `target`: allowed, two words matched, as near as 1, nothing named whole, unless a case says. */
static void taking(bench *b, held *h, const char *target) {
  memset(h, 0, sizeof *h);
  h->ranked.reading.verb = bench_verb(b, "sprout", "take");
  h->ranked.reading.actor = b->actor;
  h->ranked.reading.count = 1;
  h->ranked.reading.roles = ROLES;
  h->bounds[0].kind = SPROUT_BOUND_OBJECT;
  h->bounds[0].object = bench_str(target);
  h->ranked.allowed = true;
  h->ranked.literal = 2;
  h->near[0] = 1;
  h->ranked.near_count = 1;
  h->ranked.whole = true;
}

static const sprout_intent *intent_named(bench *b, const char *name) {
  size_t i;
  for (i = 0; i < b->w.world->intent_count; i++)
    if (strcmp(b->w.world->intents[i].name, name) == 0) return &b->w.world->intents[i];
  fprintf(stderr, "no intent %s\n", name);
  exit(2);
}

/* Opening `y` with `x` by the library's intent, allowed as an intent's reading is. */
static void opening(bench *b, held *h, const char *y, const char *x) {
  memset(h, 0, sizeof *h);
  h->ranked.reading.intent = intent_named(b, "open_with");
  h->ranked.reading.actor = b->actor;
  h->ranked.reading.count = 2;
  h->ranked.reading.roles = ROLES;
  h->bounds[0].kind = h->bounds[1].kind = SPROUT_BOUND_OBJECT;
  h->bounds[0].object = bench_str(y);
  h->bounds[1].object = bench_str(x);
  h->ranked.allowed = true;
  h->ranked.literal = 2;
  h->near[0] = h->near[1] = 1;
  h->ranked.near_count = 2;
  h->ranked.whole = true;
}

/* The ranked readings `count` helds hold, in order. */
static parse_ranked *rankings(held *h, size_t count) {
  static parse_ranked out[8];
  size_t i;
  for (i = 0; i < count; i++) {
    out[i] = h[i].ranked;
    out[i].near = h[i].near;
    out[i].reading.bounds = h[i].bounds;
  }
  return out;
}

static int compared(held *a, held *z) {
  parse_ranked *both = rankings(a, 1), first = both[0];
  return parse_compare_ranked(&first, &rankings(z, 1)[0]);
}

/* The stream begun from `seed`, as a turn begun from it draws. */
static void seeded(bench *b, uint64_t seed) { CHECK_INT(sprout_draws_begin(b->run.draws, seed), SPROUT_OK); }

static const char *target_of(const parse_chosen *chosen) { return chosen->ranked->reading.bounds[0].object.bytes; }

static void consent_then_words_matched_then_nearness_rank_them(void) {
  bench b;
  held a, z;
  bench_open(&b, "grammar", "Marta");
  taking(&b, &a, GONG);
  taking(&b, &z, GONG);
  z.ranked.allowed = false;
  CHECK(compared(&a, &z) < 0);
  /* Allowed outranks everything else a refused reading has. */
  a.ranked.literal = 1;
  a.near[0] = 9;
  z.ranked.literal = 5;
  z.near[0] = 0;
  CHECK(compared(&a, &z) < 0);
  taking(&b, &a, GONG);
  taking(&b, &z, GONG);
  a.ranked.literal = 3;
  CHECK(compared(&a, &z) < 0);
  taking(&b, &a, GONG);
  a.near[1] = 5;
  a.ranked.near_count = z.ranked.near_count = 2;
  z.near[1] = 6;
  CHECK(compared(&a, &z) < 0);
  a.near[0] = 2;
  a.near[1] = 0;
  z.near[0] = 1;
  z.near[1] = 9;
  CHECK(compared(&a, &z) > 0);
  /* Nearness one does not have is none: 0. */
  z.ranked.near_count = 1;
  z.near[0] = 2;
  CHECK(compared(&a, &z) == 0);
  taking(&b, &a, GONG);
  taking(&b, &z, BRASS_KEY);
  CHECK(compared(&a, &z) == 0);
  bench_close(&b);
}

static void a_whole_name_ranks_first_only_where_the_specs_three_rules_tie(void) {
  bench b;
  held a, z;
  bench_open(&b, "grammar", "Marta");
  taking(&b, &a, GONG);
  taking(&b, &z, GONG);
  a.ranked.by_name = 1;
  CHECK(compared(&a, &z) < 0);
  a.ranked.allowed = false;
  CHECK(compared(&a, &z) > 0);
  taking(&b, &a, GONG);
  a.ranked.by_name = 1;
  a.ranked.literal = 1;
  CHECK(compared(&a, &z) > 0);
  taking(&b, &a, GONG);
  a.ranked.by_name = 1;
  a.near[0] = 2;
  CHECK(compared(&a, &z) > 0);
  bench_close(&b);
}

static void the_best_alone_is_chosen_drawing_nothing_and_spending_nothing(void) {
  bench b;
  held h[2];
  parse_chosen chosen;
  uint64_t before, made;
  bench_open(&b, "grammar", "Marta");
  taking(&b, &h[0], BRASS_KEY);
  h[0].near[0] = 3;
  taking(&b, &h[1], IRON_KEY);
  before = b.run.meter->steps;
  made = b.run.draws->made;
  CHECK_INT(parse_choose(&b.frame, rankings(h, 2), 2, &chosen), SPROUT_EVAL_OK);
  CHECK_STR(target_of(&chosen), IRON_KEY);
  CHECK_INT(chosen.among, 1);
  CHECK(chosen.meant == NULL);
  CHECK_INT(b.run.meter->steps - before, 0);
  CHECK_INT(b.run.draws->made - made, 0);
  bench_close(&b);
}

static void those_still_tied_are_drawn_a_step_naming_the_thing_where_words_tell_it_apart(void) {
  bench b;
  held h[3];
  parse_chosen chosen;
  uint64_t seed, before;
  bool brass = false, iron = false;
  bench_open(&b, "grammar", "Marta");
  for (seed = 0; seed < 32; seed++) {
    taking(&b, &h[0], BRASS_KEY);
    taking(&b, &h[1], IRON_KEY);
    taking(&b, &h[2], GONG);
    h[2].ranked.literal = 1;
    seeded(&b, seed);
    before = b.run.meter->steps;
    CHECK_INT(parse_choose(&b.frame, rankings(h, 3), 3, &chosen), SPROUT_EVAL_OK);
    CHECK_INT(chosen.among, 2);
    CHECK(chosen.meant != NULL && strcmp(chosen.meant->bytes, target_of(&chosen)) == 0);
    CHECK_INT(b.run.meter->steps - before, 1);
    brass = brass || strcmp(target_of(&chosen), BRASS_KEY) == 0;
    iron = iron || strcmp(target_of(&chosen), IRON_KEY) == 0;
  }
  CHECK(brass && iron);
  bench_close(&b);
}

static void the_draw_is_the_first_on_the_stream_and_picks_among_the_tied_in_the_order_made(void) {
  bench b;
  held h[4];
  parse_chosen chosen;
  sprout_draws alone;
  uint32_t expected;
  uint64_t seed;
  static const size_t tied[3] = {0, 2, 3};
  bench_open(&b, "grammar", "Marta");
  for (seed = 0; seed < 16; seed++) {
    taking(&b, &h[0], BRASS_KEY);
    taking(&b, &h[1], PEBBLE_A);
    h[1].ranked.allowed = false;
    taking(&b, &h[2], IRON_KEY);
    taking(&b, &h[3], GONG);
    seeded(&b, seed);
    CHECK_INT(sprout_draws_begin(&alone, seed), SPROUT_OK);
    CHECK(sprout_draws_below(&alone, 3, &expected));
    CHECK_INT(parse_choose(&b.frame, rankings(h, 4), 4, &chosen), SPROUT_EVAL_OK);
    CHECK_STR(target_of(&chosen), h[tied[expected]].bounds[0].object.bytes);
  }
  bench_close(&b);
}

static void things_written_alike_are_drawn_without_naming_one(void) {
  bench b;
  held h[2];
  parse_chosen chosen;
  bench_open(&b, "grammar", "Marta");
  taking(&b, &h[0], PEBBLE_A);
  taking(&b, &h[1], PEBBLE_B);
  CHECK_INT(parse_choose(&b.frame, rankings(h, 2), 2, &chosen), SPROUT_EVAL_OK);
  CHECK_INT(chosen.among, 2);
  CHECK(chosen.meant == NULL);
  bench_close(&b);
}

/* A small deterministic stream for the generated cases. */
static uint32_t next(uint32_t *state) {
  *state = *state * 1664525u + 1013904223u;
  return *state >> 8;
}

static void the_chosen_is_allowed_where_any_is_then_matched_most_then_nearest_then_named_whole(void) {
  static const char *const things[] = {BRASS_KEY, IRON_KEY, GONG, PEBBLE_A, PEBBLE_B};
  bench b;
  held h[6];
  parse_chosen chosen;
  uint32_t state = 461;
  size_t run, i, count;
  bench_open(&b, "grammar", "Marta");
  for (run = 0; run < 500; run++) {
    const parse_ranked *ranked, *best;
    bool any = false;
    count = 1 + next(&state) % 6;
    for (i = 0; i < count; i++) {
      taking(&b, &h[i], things[next(&state) % 5]);
      h[i].ranked.allowed = next(&state) % 2 == 0;
      h[i].ranked.literal = next(&state) % 3;
      h[i].near[0] = next(&state) % 4;
      h[i].ranked.by_name = next(&state) % 2;
      any = any || h[i].ranked.allowed;
    }
    ranked = rankings(h, count);
    seeded(&b, next(&state) % 1000);
    CHECK_INT(parse_choose(&b.frame, ranked, count, &chosen), SPROUT_EVAL_OK);
    best = chosen.ranked;
    if (any) CHECK(best->allowed);
    for (i = 0; i < count; i++) {
      const parse_ranked *one = &ranked[i];
      if (one == best || one->allowed != best->allowed) continue;
      CHECK(one->literal <= best->literal);
      if (one->literal != best->literal) continue;
      CHECK(one->near[0] >= best->near[0]);
      if (one->near[0] != best->near[0]) continue;
      CHECK(one->by_name <= best->by_name);
    }
  }
  bench_close(&b);
}

static void an_intents_reading_is_drawn_as_a_verbs_naming_the_first_slot_that_differs(void) {
  bench b;
  held h[2];
  parse_chosen chosen;
  bench_open(&b, "grammar", "Marta");
  opening(&b, &h[0], GONG, BRASS_KEY);
  opening(&b, &h[1], GONG, IRON_KEY);
  CHECK_INT(parse_choose(&b.frame, rankings(h, 2), 2, &chosen), SPROUT_EVAL_OK);
  CHECK_INT(chosen.among, 2);
  CHECK(chosen.meant != NULL && strcmp(chosen.meant->bytes, chosen.ranked->reading.bounds[1].object.bytes) == 0);
  bench_close(&b);
}

static void a_rival_is_matched_by_the_name_of_a_role_whatever_its_verb(void) {
  bench b;
  held h[2];
  parse_chosen chosen;
  uint64_t seed;
  bench_open(&b, "grammar", "Marta");
  /* Taking the iron key, tied with opening the gong with the brass key: no slot of the one is a role of the other. */
  for (seed = 0; seed < 8; seed++) {
    taking(&b, &h[0], IRON_KEY);
    opening(&b, &h[1], GONG, BRASS_KEY);
    h[1].ranked.near_count = 1;
    seeded(&b, seed);
    CHECK_INT(parse_choose(&b.frame, rankings(h, 2), 2, &chosen), SPROUT_EVAL_OK);
    CHECK_INT(chosen.among, 2);
    CHECK(chosen.meant == NULL);
  }
  bench_close(&b);
}

int main(void) {
  RUN(consent_then_words_matched_then_nearness_rank_them);
  RUN(a_whole_name_ranks_first_only_where_the_specs_three_rules_tie);
  RUN(the_best_alone_is_chosen_drawing_nothing_and_spending_nothing);
  RUN(those_still_tied_are_drawn_a_step_naming_the_thing_where_words_tell_it_apart);
  RUN(the_draw_is_the_first_on_the_stream_and_picks_among_the_tied_in_the_order_made);
  RUN(things_written_alike_are_drawn_without_naming_one);
  RUN(the_chosen_is_allowed_where_any_is_then_matched_most_then_nearest_then_named_whole);
  RUN(an_intents_reading_is_drawn_as_a_verbs_naming_the_first_slot_that_differs);
  RUN(a_rival_is_matched_by_the_name_of_a_role_whatever_its_verb);
  return REPORT();
}
