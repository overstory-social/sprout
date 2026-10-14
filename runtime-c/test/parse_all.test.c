/*
 * Tests for src/parse/all.c: `all` and `except` in a slot (the spec's Parsing > Sequences, again and all), read in
 * the corpus worlds `grammar` (the study) and `all-in-order` (a hall where one
 * kind plays `examine`'s target and a world verb's, and one plays nothing).
 */
#include "parse_fixture.h"

/* The study's hall, reached in reach order, nothing carried. */
static const char *const REACHED[] = {
    NULL, /* the actor */
    "study.hall.brass_key", "study.hall.iron_key", "study.hall.lamp", "study.hall.lamp_oil",
    "study.hall.gong",      "study.hall.pebble_a", "study.hall.pebble_b", "study.hall.chest",
    "study.hall.guard",     "study.hall.dial",     "study.hall.door"};
#define REACHED_COUNT (sizeof REACHED / sizeof *REACHED)

typedef struct taking {
  bench b;
  parse_candidate candidates[REACHED_COUNT];
  parse_all_context all;
} taking;

static void open_study(taking *t) {
  size_t i;
  bench_open(&t->b, "grammar", "Marta");
  for (i = 0; i < REACHED_COUNT; i++)
    t->candidates[i] = bench_candidate(&t->b, i == 0 ? t->b.actor.bytes : REACHED[i], i);
  memset(&t->all, 0, sizeof t->all);
  t->all.fill.nouns = bench_nouns(&t->b, NULL, 0);
  t->all.fill.candidates = t->candidates;
  t->all.fill.candidate_count = REACHED_COUNT;
  t->all.actor = t->b.actor;
  t->all.here = bench_str("study.hall");
}

/* What `line` fills `role` of `verb` with as `all`, under a set role's figure of `cap`; `*is_all` whether it is `all`. */
static parse_filled all_in(taking *t, const char *line, const char *library, const char *verb, const char *role,
                           uint64_t cap, bool *is_all) {
  parse_filled out;
  t->b.w.host.budgets.set_role_objects = (sprout_limit){true, cap};
  CHECK_INT(parse_all_in(&t->all, bench_words(&t->b, line), bench_role(&t->b, library, verb, role),
                         bench_verb(&t->b, library, verb), is_all, &out),
            SPROUT_EVAL_OK);
  return out;
}

/* The things `all` takes in turn, or the one set it takes at once, each by the last segment of its id. */
static const char *taken(const parse_filled *filled) {
  static char text[512];
  size_t i, count = filled->fills == PARSE_FILLS_ALL                                 ? filled->thing_count
                    : filled->fills == PARSE_FILLS_OPTIONS && filled->set_count == 1 ? filled->sets[0].count
                                                                                     : 0;
  text[0] = '\0';
  for (i = 0; i < count; i++) {
    const sprout_str id = filled->fills == PARSE_FILLS_ALL ? filled->things[i].candidate->instance->id
                                                           : filled->sets[0].things[i]->instance->id;
    const char *dot = strrchr(id.bytes, '.');
    if (i > 0) strcat(text, " ");
    strcat(text, dot == NULL ? id.bytes : dot + 1);
  }
  return text;
}

static void everything_is_all_with_except_after_it_and_each_is_neither(void) {
  taking t;
  bool is_all;
  parse_filled filled;
  char everything[512];
  open_study(&t);
  filled = all_in(&t, "everything except the brass key", "study", "unlock", "tool", 8, &is_all);
  CHECK(is_all);
  CHECK_INT(filled.fills, PARSE_FILLS_ALL);
  CHECK_STR(taken(&filled), "iron_key");
  filled = all_in(&t, "everything", "study", "unlock", "tool", 8, &is_all);
  snprintf(everything, sizeof everything, "%s", taken(&filled));
  filled = all_in(&t, "all", "study", "unlock", "tool", 8, &is_all);
  CHECK_STR(taken(&filled), everything);
  all_in(&t, "each", "study", "unlock", "tool", 8, &is_all);
  CHECK(!is_all);
  bench_close(&t.b);
}

static void words_that_do_not_begin_with_all_or_a_value_role_are_read_as_any_slot(void) {
  taking t;
  bool is_all;
  open_study(&t);
  all_in(&t, "key", "sprout", "take", "target", 8, &is_all);
  CHECK(!is_all);
  all_in(&t, "all", "study", "turn", "number", 8, &is_all);
  CHECK(!is_all);
  bench_close(&t.b);
}

static void a_role_only_the_actor_plays_takes_every_thing_in_reach_but_people_in_the_order_reached(void) {
  taking t;
  bool is_all;
  parse_filled filled;
  open_study(&t);
  filled = all_in(&t, "all", "sprout", "take", "target", 20, &is_all);
  CHECK_INT(filled.fills, PARSE_FILLS_ALL);
  CHECK_STR(taken(&filled), "brass_key iron_key lamp lamp_oil gong pebble_a pebble_b chest guard dial door");
  /* Each matched the one word `all`, and is as near as reach left it. */
  CHECK(filled.things[0].literal == 1 && filled.things[0].near == 1 && !filled.things[0].by_name);
  /* A role that takes one thing takes everything, left to the readings to cap once the refused are left out. */
  filled = all_in(&t, "all", "sprout", "take", "target", 3, &is_all);
  CHECK_INT(filled.thing_count, 11);
  bench_close(&t.b);
}

static void a_role_of_a_kind_takes_what_composes_it_and_a_set_role_takes_all_at_once(void) {
  taking t;
  bool is_all;
  parse_filled filled;
  open_study(&t);
  filled = all_in(&t, "all", "study", "unlock", "tool", 8, &is_all);
  CHECK_STR(taken(&filled), "brass_key iron_key");
  filled = all_in(&t, "all", "study", "juggle", "things", 8, &is_all);
  CHECK_INT(filled.fills, PARSE_FILLS_OPTIONS);
  CHECK_INT(filled.set_count, 1);
  CHECK_STR(taken(&filled), "brass_key iron_key lamp lamp_oil gong pebble_a pebble_b chest");
  /* The set's things' nearness summed, and `all` the one word it matched. */
  CHECK_INT(filled.sets[0].near, 1 + 2 + 3 + 4 + 5 + 6 + 7 + 8);
  CHECK_INT(filled.sets[0].literal, 1);
  /* No more than a set role may bind. */
  filled = all_in(&t, "all", "study", "juggle", "things", 3, &is_all);
  CHECK_STR(taken(&filled), "brass_key iron_key lamp");
  CHECK_INT(filled.sets[0].near, 1 + 2 + 3);
  bench_close(&t.b);
}

static void an_open_role_a_kind_plays_takes_what_plays_a_part_in_the_verb(void) {
  taking t;
  bool is_all;
  parse_filled filled;
  open_study(&t);
  filled = all_in(&t, "all", "sprout", "ask", "target", 8, &is_all);
  CHECK_STR(taken(&filled), "guard");
  bench_close(&t.b);
}

static void except_leaves_out_by_name_noun_or_kind_and_names_nothing_where_it_names_nothing(void) {
  taking t;
  bool is_all;
  parse_filled filled;
  open_study(&t);
  filled = all_in(&t, "all except the brass key and pebble", "study", "unlock", "tool", 8, &is_all);
  CHECK_STR(taken(&filled), "iron_key");
  /* `all`, `except` and the four words of the nouns after it. */
  CHECK_INT(filled.things[0].literal, 6);
  /* Every key answers to `metal`, so nothing is left. */
  filled = all_in(&t, "all except metal", "study", "unlock", "tool", 8, &is_all);
  CHECK(filled.fills == PARSE_FILLS_NOTHING && filled.start == 0 && filled.end == 3);
  filled = all_in(&t, "all except zebra", "study", "unlock", "tool", 8, &is_all);
  CHECK(filled.fills == PARSE_FILLS_NOTHING && filled.start == 2 && filled.end == 3);
  filled = all_in(&t, "all except", "study", "unlock", "tool", 8, &is_all);
  CHECK(filled.fills == PARSE_FILLS_UNFIT && filled.thing_count == 0);
  filled = all_in(&t, "all the keys", "study", "unlock", "tool", 8, &is_all);
  CHECK(filled.fills == PARSE_FILLS_UNFIT && filled.thing_count == 0);
  /* A kind's name leaves out every thing of it. */
  filled = all_in(&t, "all except key", "sprout", "take", "target", 20, &is_all);
  CHECK_STR(taken(&filled), "lamp lamp_oil gong pebble_a pebble_b chest guard dial door");
  bench_close(&t.b);
}

static void except_leaves_out_only_what_it_is_the_whole_name_of_where_it_is_one(void) {
  taking t;
  bool is_all;
  parse_filled filled;
  open_study(&t);
  /* The lamp oil answers to `lamp` as well, and is still taken. */
  filled = all_in(&t, "all except lamp", "sprout", "take", "target", 20, &is_all);
  CHECK_STR(taken(&filled), "brass_key iron_key lamp_oil gong pebble_a pebble_b chest guard dial door");
  bench_close(&t.b);
}

static void a_carried_role_takes_only_what_the_actor_carries(void) {
  taking t;
  bool is_all;
  parse_filled filled;
  sprout_role tool;
  open_study(&t);
  tool = *bench_role(&t.b, "study", "unlock", "tool");
  tool.carried = true;
  t.candidates[2].carried = true; /* the iron key */
  t.candidates[5].carried = true; /* the gong, which is no key */
  CHECK_INT(parse_all_in(&t.all, bench_words(&t.b, "all"), &tool, bench_verb(&t.b, "study", "unlock"), &is_all, &filled),
            SPROUT_EVAL_OK);
  CHECK_STR(taken(&filled), "iron_key");
  t.candidates[2].carried = t.candidates[5].carried = false;
  CHECK_INT(parse_all_in(&t.all, bench_words(&t.b, "all"), &tool, bench_verb(&t.b, "study", "unlock"), &is_all, &filled),
            SPROUT_EVAL_OK);
  CHECK(filled.fills == PARSE_FILLS_NOTHING && filled.start == 0 && filled.end == 1);
  bench_close(&t.b);
}

/* The hall of `all-in-order`, reached in its order, the visitor first, each thing carried where `carried` says. */
static void open_gallery(taking *t, const bool *carried) {
  static const char *const things[] = {"all_in_order.hall.apple", "all_in_order.hall.bell", "all_in_order.hall.lamp",
                                       "all_in_order.hall.mirror", "all_in_order.hall.pear"};
  size_t i;
  bench_open(&t->b, "all-in-order", "Marta");
  t->candidates[0] = bench_candidate(&t->b, t->b.actor.bytes, 0);
  for (i = 0; i < 5; i++) {
    t->candidates[i + 1] = bench_candidate(&t->b, things[i], i + 1);
    t->candidates[i + 1].carried = carried != NULL && carried[i];
  }
  memset(&t->all, 0, sizeof t->all);
  t->all.fill.nouns = bench_nouns(&t->b, NULL, 0);
  t->all.fill.candidates = t->candidates;
  t->all.fill.candidate_count = 6;
  t->all.actor = t->b.actor;
  t->all.here = bench_str("all_in_order.hall");
}

static void an_engine_verbs_open_role_takes_every_thing_but_people_though_some_kind_plays_it(void) {
  taking t;
  bool is_all;
  parse_filled filled;
  open_gallery(&t, NULL);
  filled = all_in(&t, "all", "sprout", "examine", "target", 8, &is_all);
  CHECK_STR(taken(&filled), "apple bell lamp mirror pear");
  /* Unlike a world verb's open role some kind plays, which takes only what plays it. */
  filled = all_in(&t, "all", "all_in_order", "polish", "target", 8, &is_all);
  CHECK_STR(taken(&filled), "bell mirror");
  bench_close(&t.b);
}

static void an_engine_verbs_carried_role_takes_only_what_the_actor_carries(void) {
  static const bool carried[5] = {false, true, false, false, true};
  taking t;
  bool is_all;
  parse_filled filled;
  sprout_role target;
  open_gallery(&t, carried);
  target = *bench_role(&t.b, "sprout", "examine", "target");
  target.carried = true;
  CHECK_INT(parse_all_in(&t.all, bench_words(&t.b, "all"), &target, bench_verb(&t.b, "sprout", "examine"), &is_all,
                         &filled),
            SPROUT_EVAL_OK);
  CHECK_STR(taken(&filled), "bell pear");
  bench_close(&t.b);
}

static void each_kind_asked_and_each_thing_except_is_weighed_against_is_a_step(void) {
  taking t;
  bool is_all;
  uint64_t before, plain;
  open_study(&t);
  before = t.b.run.meter->steps;
  all_in(&t, "all", "sprout", "take", "target", 8, &is_all);
  plain = t.b.run.meter->steps - before;
  CHECK(plain > REACHED_COUNT);
  before = t.b.run.meter->steps;
  all_in(&t, "all except gong", "sprout", "take", "target", 8, &is_all);
  CHECK(t.b.run.meter->steps - before > plain + REACHED_COUNT);
  bench_close(&t.b);
}

int main(void) {
  RUN(everything_is_all_with_except_after_it_and_each_is_neither);
  RUN(words_that_do_not_begin_with_all_or_a_value_role_are_read_as_any_slot);
  RUN(a_role_only_the_actor_plays_takes_every_thing_in_reach_but_people_in_the_order_reached);
  RUN(a_role_of_a_kind_takes_what_composes_it_and_a_set_role_takes_all_at_once);
  RUN(an_open_role_a_kind_plays_takes_what_plays_a_part_in_the_verb);
  RUN(except_leaves_out_by_name_noun_or_kind_and_names_nothing_where_it_names_nothing);
  RUN(except_leaves_out_only_what_it_is_the_whole_name_of_where_it_is_one);
  RUN(a_carried_role_takes_only_what_the_actor_carries);
  RUN(an_engine_verbs_open_role_takes_every_thing_but_people_though_some_kind_plays_it);
  RUN(an_engine_verbs_carried_role_takes_only_what_the_actor_carries);
  RUN(each_kind_asked_and_each_thing_except_is_weighed_against_is_a_step);
  return REPORT();
}
