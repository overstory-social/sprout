/*
 * Tests for src/parse/item.c: an item of a run read on its own turn (the spec's Parsing > Sequences, again and all).
 * In the corpus world `runs` (its salt, its tall guard and owl hearing `toll` and not), and `carried` for a role only what the
 * actor carries may fill.
 */
#include "parse_fixture.h"

/* The reading a line planned for an item's turn: `verb` of `library`, each role in `roles` bound to the thing in `ids`. */
typedef struct within {
  parse_reading reading;
  size_t roles[2];
  sprout_stored_bound bounds[2];
} within;

static void plan(bench *b, within *w, const char *library, const char *verb, const char *role, const char *id) {
  const sprout_verb *v = bench_verb(b, library, verb);
  memset(w, 0, sizeof *w);
  w->reading.verb = v;
  w->reading.actor = b->actor;
  w->reading.roles = w->roles;
  w->reading.bounds = w->bounds;
  if (role == NULL) return;
  for (w->roles[0] = 0; strcmp(v->roles[w->roles[0]].name, role) != 0; w->roles[0]++) continue;
  w->bounds[0].kind = SPROUT_BOUND_OBJECT;
  w->bounds[0].object = bench_str(id);
  w->reading.count = 1;
}

/* `words` read as the item filling `role` of the planned reading, with what the pronouns named and one value role's words. */
static parse_item_read item(bench *b, const within *w, const char *role, const char *words, const char *referent,
                            const char *value_role, const char *value_words) {
  parse_item_read out;
  sprout_reread reread;
  sprout_reread_value value;
  const sprout_way *ways;
  size_t way_count;
  sprout_str here = bench_instance(b, b->actor.bytes)->container;
  memset(&reread, 0, sizeof reread);
  reread.role = role;
  reread.words = words;
  reread.referents = referent == NULL ? NULL : &referent;
  reread.referent_count = referent == NULL ? 0 : 1;
  value.role = value_role;
  value.words = value_words;
  reread.values = &value;
  reread.value_count = value_role == NULL ? 0 : 1;
  CHECK_INT(sprout_ways_from(&b->frame, here, &ways, &way_count), SPROUT_EVAL_OK);
  CHECK_INT(parse_read_item(&b->run.x, &b->frame, b->actor, &w->reading, &reread, ways, way_count, &out), SPROUT_EVAL_OK);
  return out;
}

/* What the item's only reading binds `role` to, by the last segment of its id; "(unbound)" or "(answered)". */
static const char *bound(const parse_item_read *read, const sprout_verb *verb, const char *role) {
  static char text[128];
  const parse_reading *reading;
  size_t i;
  if (read->answer != NULL || read->readings.count == 0) return "(answered)";
  reading = &read->readings.ranked[0].reading;
  for (i = 0; i < reading->count; i++) {
    const sprout_stored_bound *one = &reading->bounds[i];
    if (strcmp(verb->roles[reading->roles[i]].name, role) != 0) continue;
    if (one->kind == SPROUT_BOUND_VALUE) snprintf(text, sizeof text, "%.*s", (int)one->value_string.length, one->value_string.bytes);
    else snprintf(text, sizeof text, "%s", bench_last(one->object.bytes));
    return text;
  }
  return "(unbound)";
}

static void an_item_fills_only_its_own_role_every_other_keeping_what_the_line_bound(void) {
  bench b;
  within w;
  parse_item_read read;
  const sprout_verb *put;
  bench_open(&b, "runs", "Marta");
  put = bench_verb(&b, "sprout", "put");
  plan(&b, &w, "sprout", "put", "container", "runs.kitchen.box");
  /* `it` names the salt now, and the box was what the line's `it` named. */
  read = item(&b, &w, "item", "brass key", "runs.kitchen.salt", NULL, NULL);
  CHECK(read.answer == NULL);
  CHECK_INT(read.readings.count, 1);
  CHECK_INT(read.readings.ranked[0].reading.count, 2);
  CHECK_STR(put->roles[read.readings.ranked[0].reading.roles[0]].name, "container");
  CHECK_STR(bound(&read, put, "container"), "box");
  CHECK_STR(bound(&read, put, "item"), "brass_key");
  CHECK_INT(read.readings.ranked[0].rest_count, 0);
  CHECK(read.readings.ranked[0].run == NULL);
  bench_close(&b);
}

static void an_item_binds_a_value_role_from_its_words_against_the_thing_it_names(void) {
  bench b;
  within w;
  parse_item_read read;
  const sprout_verb *ask;
  bench_open(&b, "runs", "Marta");
  ask = bench_verb(&b, "sprout", "ask");
  plan(&b, &w, "sprout", "ask", NULL, NULL);
  read = item(&b, &w, "target", "tall guard", NULL, "topic", "toll");
  CHECK_STR(bound(&read, ask, "topic"), "toll");
  /* The owl hears no `toll`, so the topic is unbound for it. */
  read = item(&b, &w, "target", "owl", NULL, "topic", "toll");
  CHECK_STR(bound(&read, ask, "target"), "owl");
  CHECK_STR(bound(&read, ask, "topic"), "(unbound)");
  bench_close(&b);
}

static void an_items_pronoun_names_what_it_named_as_the_line_began_and_what_the_line_bound_must_be_in_reach(void) {
  bench b;
  within w;
  parse_item_read read;
  const sprout_str *removed;
  size_t removed_count;
  bench_open(&b, "runs", "Marta");
  plan(&b, &w, "sprout", "take", NULL, NULL);
  read = item(&b, &w, "target", "it", "runs.kitchen.salt", NULL, NULL);
  CHECK_STR(bound(&read, bench_verb(&b, "sprout", "take"), "target"), "salt");
  plan(&b, &w, "sprout", "put", "container", "runs.kitchen.box");
  CHECK_INT(sprout_draft_remove(&b.run.draft, bench_str("runs.kitchen.box"), &removed, &removed_count), SPROUT_DRAFT_OK);
  read = item(&b, &w, "item", "salt", NULL, NULL, NULL);
  CHECK_STR(read.answer, "not_here");
  bench_close(&b);
}

static void an_item_naming_things_that_tie_is_drawn_and_the_engine_says_which_was_meant(void) {
  bench b;
  sprout_arena keep;
  sprout_filling filling;
  sprout_reading planned;
  sprout_reread reread;
  sprout_handed handed;
  sprout_parsed out;
  bool brass = false, iron = false;
  uint64_t seed;
  bench_open(&b, "runs", "Marta");
  sprout_arena_init(&keep, &b.w.host);
  planned = tw_reading("sprout.take", b.actor.bytes, &filling, "target", "runs.kitchen.lamp");
  planned.filling_count = 0;
  memset(&reread, 0, sizeof reread);
  reread.role = "target";
  reread.words = "key";
  handed.planned = &planned;
  handed.reread = &reread;
  for (seed = 0; seed < 12; seed++) {
    const char *id;
    CHECK_INT(bench_parse(&b, &keep, "take lamp and key", seed, &handed, &out), SPROUT_OK);
    CHECK_INT(out.end, SPROUT_PARSED_READING);
    CHECK(out.drawn);
    CHECK_INT(out.drawn_among, 2);
    CHECK_INT(out.draw_count, 1);
    CHECK_INT(out.reading.filling_count, 1);
    id = out.reading.fillings[0].id;
    CHECK_INT(out.aside_count, 1);
    CHECK_STR(out.asides[0].line, "meant");
    CHECK_STR(out.asides[0].thing, id);
    brass = brass || strcmp(id, "runs.kitchen.brass_key") == 0;
    iron = iron || strcmp(id, "runs.kitchen.iron_key") == 0;
  }
  CHECK(brass && iron);
  sprout_arena_reset(&keep);
  bench_close(&b);
}

static void an_item_naming_nothing_in_reach_is_not_here_whatever_its_words(void) {
  bench b;
  within w;
  bench_open(&b, "runs", "Marta");
  plan(&b, &w, "sprout", "take", NULL, NULL);
  CHECK_STR(item(&b, &w, "target", "the salt in the box", NULL, NULL, NULL).answer, "not_here");
  CHECK_STR(item(&b, &w, "target", "unicorn", NULL, NULL, NULL).answer, "not_here");
  CHECK_STR(item(&b, &w, "whatever", "salt", NULL, NULL, NULL).answer, "unknown");
  CHECK_STR(item(&b, &w, "target", "  ", NULL, NULL, NULL).answer, "unknown");
  bench_close(&b);
}

static void an_item_a_carried_role_names_out_of_hand_is_not_carrying(void) {
  bench b;
  within w;
  parse_item_read read;
  bench_open(&b, "carried", "Marta");
  plan(&b, &w, "sprout", "unlock", "target", "carried.cellar.strongbox");
  read = item(&b, &w, "tool", "iron key", NULL, NULL, NULL);
  CHECK_STR(read.answer, "not_carrying");
  CHECK(read.given);
  CHECK_STR(read.binding.name, "thing");
  CHECK(read.binding.object);
  CHECK_BYTES(read.binding.text.bytes, read.binding.text.length, "carried.cellar.iron_key");
  bench_close(&b);
}

static void an_item_naming_what_cannot_fill_its_role_is_cannot_written_with_what_the_line_bound(void) {
  bench b;
  within w;
  parse_item_read read;
  uint64_t before;
  bench_open(&b, "runs", "Marta");
  plan(&b, &w, "sprout", "put", "item", "runs.kitchen.brass_key");
  before = b.run.meter->steps;
  read = item(&b, &w, "container", "salt", NULL, NULL, NULL);
  CHECK_STR(read.answer, "cannot");
  CHECK_STR(read.binding.name, "reading");
  CHECK(!read.binding.object);
  CHECK_BYTES(read.binding.text.bytes, read.binding.text.length, "put the brass key in the salt");
  /* Every phrase of the world is a step, asked whether it writes the verb. */
  CHECK(b.run.meter->steps - before >= b.w.world->phrase_count);
  bench_close(&b);
}

int main(void) {
  RUN(an_item_fills_only_its_own_role_every_other_keeping_what_the_line_bound);
  RUN(an_item_binds_a_value_role_from_its_words_against_the_thing_it_names);
  RUN(an_items_pronoun_names_what_it_named_as_the_line_began_and_what_the_line_bound_must_be_in_reach);
  RUN(an_item_naming_things_that_tie_is_drawn_and_the_engine_says_which_was_meant);
  RUN(an_item_naming_nothing_in_reach_is_not_here_whatever_its_words);
  RUN(an_item_a_carried_role_names_out_of_hand_is_not_carrying);
  RUN(an_item_naming_what_cannot_fill_its_role_is_cannot_written_with_what_the_line_bound);
  return REPORT();
}
