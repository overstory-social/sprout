/*
 * Tests for src/parse/readings.c: the readings one placement of a phrase makes (the spec's Parsing > Matching a line,
 * Choosing a reading; Verbs > Slots, Set roles, Value roles; Parsing > Sequences, again and all). Each case tries
 * the phrases of one verb or intent against a line as the command turn does, every placement whose slots all fill
 * handed to `parse_placement_readings`: in the study (the corpus world `grammar`), `intents`,
 * `all-leaves-out-refused`, `synonyms` and `pronouns`, each reading a line to a reading.
 */
#include "parse_fixture.h"

typedef struct reading_bench {
  bench b;
  parse_all_context all;
  parse_readings readings;
  const sprout_typed_phrase *phrase;
  const sprout_typed_intent_phrase *intent;
  parse_words words;
  bool nothing;
} reading_bench;

static void open_world(reading_bench *r, const char *world) {
  const sprout_stored_instance *marta;
  parse_candidate *candidates;
  bench_open(&r->b, world, "Marta");
  marta = bench_instance(&r->b, r->b.actor.bytes);
  memset(&r->all, 0, sizeof r->all);
  memset(&r->readings, 0, sizeof r->readings);
  r->all.fill.nouns = bench_nouns(&r->b, NULL, 0);
  r->all.actor = r->b.actor;
  r->all.here = marta->container;
  CHECK_INT(sprout_ways_from(&r->b.frame, marta->container, &r->all.fill.ways, &r->all.fill.way_count), SPROUT_EVAL_OK);
  CHECK_INT(parse_reach_of(&r->b.frame, r->b.actor, &candidates, &r->all.fill.candidate_count), SPROUT_EVAL_OK);
  r->all.fill.candidates = candidates;
}

/* Puts `id` in Marta's hands, and reaches again. */
static void hold(reading_bench *r, const char *id) {
  parse_candidate *candidates;
  CHECK_INT(sprout_draft_place(&r->b.run.draft, bench_str(id), &r->b.actor), SPROUT_DRAFT_OK);
  CHECK_INT(parse_reach_of(&r->b.frame, r->b.actor, &candidates, &r->all.fill.candidate_count), SPROUT_EVAL_OK);
  r->all.fill.candidates = candidates;
}

/* One placement: its slots filled, `all` first, and handed on where every slot fills. */
static sprout_eval_status placed(void *context, const parse_span *spans, size_t count) {
  reading_bench *r = (reading_bench *)context;
  const parse_filled **fills = (const parse_filled **)sprout_arena_take(r->b.frame.turn, (count + 1) * sizeof *fills);
  parse_placement placement;
  size_t i;
  for (i = 0; i < count; i++) {
    parse_words words;
    parse_filled *filled = (parse_filled *)sprout_arena_take(r->b.frame.turn, sizeof *filled);
    bool all = false;
    words.words = r->words.words + spans[i].start;
    words.count = spans[i].end - spans[i].start;
    if (r->phrase != NULL) {
      const sprout_role *role = &r->phrase->verb->roles[spans[i].role];
      CHECK_INT(parse_all_in(&r->all, words, role, r->phrase->verb, &all, filled), SPROUT_EVAL_OK);
      if (!all) CHECK_INT(parse_fill_slot(&r->all.fill, role, words, filled), SPROUT_EVAL_OK);
    } else {
      const sprout_intent *intent = r->intent->intent;
      const sprout_role *roles[8];
      size_t s, f, n = 0, k;
      for (s = 0; s < intent->step_count; s++)
        for (f = 0; f < intent->steps[s].filler_count; f++)
          if (intent->steps[s].filler_slots[f] == spans[i].role)
            for (k = 0; k < intent->steps[s].verb->role_count; k++)
              if (strcmp(intent->steps[s].verb->roles[k].name, intent->steps[s].filler_roles[f]) == 0 && n < 8)
                roles[n++] = &intent->steps[s].verb->roles[k];
      CHECK_INT(parse_fill_intent_slot(&r->all.fill, roles, n, words, filled), SPROUT_EVAL_OK);
    }
    if (filled->fills != PARSE_FILLS_OPTIONS && filled->fills != PARSE_FILLS_WORDS && filled->fills != PARSE_FILLS_ALL &&
        filled->fills != PARSE_FILLS_RUN)
      return SPROUT_EVAL_OK;
    fills[i] = filled;
  }
  placement.phrase = r->phrase;
  placement.intent = r->intent;
  placement.words = r->words;
  placement.spans = spans;
  placement.count = count;
  placement.fills = fills;
  return parse_placement_readings(&r->b.run.x, &r->b.frame, r->b.actor, &placement, r->b.frame.turn, &r->readings,
                                  &r->nothing);
}

/* Tries `line` against the phrases of `library.name`, a verb's or an intent's: every one, or only the `nth` (from 1). */
static void read_as(reading_bench *r, const char *line, const char *library, const char *name, size_t nth) {
  const sprout_world *world = r->b.w.world;
  size_t i, seen = 0;
  r->words = bench_words(&r->b, line);
  for (i = 0; i < world->phrase_count + world->intent_phrase_count; i++) {
    const sprout_typed_part *parts;
    size_t part_count;
    if (i < world->phrase_count) {
      const sprout_verb *verb = world->phrases[i].verb;
      if (strcmp(verb->library, library) != 0 || strcmp(verb->name, name) != 0) continue;
      r->phrase = &world->phrases[i];
      r->intent = NULL;
      parts = r->phrase->parts;
      part_count = r->phrase->part_count;
    } else {
      const sprout_intent *intent = world->intent_phrases[i - world->phrase_count].intent;
      if (strcmp(intent->library, library) != 0 || strcmp(intent->name, name) != 0) continue;
      r->phrase = NULL;
      r->intent = &world->intent_phrases[i - world->phrase_count];
      parts = r->intent->parts;
      part_count = r->intent->part_count;
    }
    if (nth != 0 && ++seen != nth) continue;
    CHECK_INT(parse_slot_spans(r->b.frame.turn, parts, part_count, r->words.words, r->words.count, placed, r),
              SPROUT_EVAL_OK);
  }
}

static void reread(reading_bench *r, const char *line, const char *library, const char *name) {
  memset(&r->readings, 0, sizeof r->readings);
  r->nothing = false;
  read_as(r, line, library, name, 0);
}

/* What the reading binds `role` (or the intent's slot) to, written out: an id's last segment, a set's joined, a value. */
static const char *bound(const parse_reading *reading, const char *role) {
  static char text[256];
  size_t i, j;
  if (reading == NULL) return "(no reading)";
  for (i = 0; i < reading->count; i++) {
    const char *name = reading->verb != NULL ? reading->verb->roles[reading->roles[i]].name
                                             : reading->intent->slots[reading->roles[i]];
    const sprout_stored_bound *b = &reading->bounds[i];
    if (strcmp(name, role) != 0) continue;
    text[0] = '\0';
    if (b->kind == SPROUT_BOUND_OBJECT) {
      snprintf(text, sizeof text, "%s", strrchr(b->object.bytes, '.') + 1);
    } else if (b->kind == SPROUT_BOUND_SET) {
      for (j = 0; j < b->set_count; j++) {
        if (j > 0) strcat(text, " ");
        strcat(text, strrchr(b->set[j].bytes, '.') + 1);
      }
    } else if (b->kind == SPROUT_BOUND_VALUE) {
      if (b->value_is_string) snprintf(text, sizeof text, "%.*s", (int)b->value_string.length, b->value_string.bytes);
      else snprintf(text, sizeof text, "%g", b->value_number);
    }
    return text;
  }
  return "(unbound)";
}

static const parse_reading *first(const reading_bench *r) {
  return r->readings.count > 0 ? &r->readings.ranked[0].reading : NULL;
}

static const parse_reading *second(const reading_bench *r) {
  return r->readings.count > 1 ? &r->readings.ranked[1].reading : NULL;
}

static void a_role_of_a_kind_fills_with_a_thing_of_it_and_a_tool_left_out_is_unbound(void) {
  reading_bench r;
  const parse_ranked *one;
  open_world(&r, "grammar");
  reread(&r, "unlock door with iron key", "study", "unlock");
  /* `unlock [target]` finds no "door with iron key", so the one reading is the other phrase's. */
  CHECK_INT(r.readings.count, 1);
  one = &r.readings.ranked[0];
  CHECK_STR(bound(&one->reading, "target"), "door");
  CHECK_STR(bound(&one->reading, "tool"), "iron_key");
  /* `unlock` and `with`, `door`, and `iron key`. */
  CHECK_INT(one->literal, 5);
  CHECK(one->allowed && one->whole);
  CHECK_INT(one->near_count, 2);
  reread(&r, "unlock door", "study", "unlock");
  CHECK_INT(r.readings.count, 1);
  CHECK_INT(r.readings.ranked[0].reading.count, 1);
  CHECK_STR(bound(first(&r), "tool"), "(unbound)");
  bench_close(&r.b);
}

static void a_set_role_takes_a_run_in_the_order_typed_duplicates_collapsed(void) {
  reading_bench r;
  open_world(&r, "grammar");
  reread(&r, "juggle gong", "study", "juggle");
  CHECK_STR(bound(first(&r), "things"), "gong");
  reread(&r, "juggle brass key and gong", "study", "juggle");
  CHECK_STR(bound(first(&r), "things"), "brass_key gong");
  reread(&r, "juggle gong, iron key, and the brass key", "study", "juggle");
  CHECK_STR(bound(first(&r), "things"), "gong iron_key brass_key");
  reread(&r, "juggle gong and gong", "study", "juggle");
  CHECK_STR(bound(first(&r), "things"), "gong");
  reread(&r, "juggle gong and", "study", "juggle");
  CHECK_INT(r.readings.count, 0);
  bench_close(&r.b);
}

static void a_value_binds_only_where_a_player_hears_it_spelt_as_a_visitor_types_it(void) {
  reading_bench r;
  size_t i;
  static const char *const unheard[] = {"ask oskar about toll", "ask oskar about potatoes!", "ask oskar about 3"};
  open_world(&r, "grammar");
  reread(&r, "ask oskar about old press", "sprout", "ask");
  /* `ask [target] [topic]` reads it too, its topic "about old press" binding nothing: a reading of its own, ranked below. */
  CHECK_INT(r.readings.count, 2);
  CHECK_STR(bound(first(&r), "topic"), "old_press");
  CHECK(r.readings.ranked[0].whole);
  CHECK_STR(bound(second(&r), "topic"), "(unbound)");
  CHECK(!r.readings.ranked[1].whole);
  CHECK(parse_compare_ranked(&r.readings.ranked[0], &r.readings.ranked[1]) < 0);
  reread(&r, "ask oskar about the bridge", "sprout", "ask");
  CHECK_STR(bound(first(&r), "topic"), "bridge");
  reread(&r, "ask oskar bridge", "sprout", "ask");
  CHECK_STR(bound(first(&r), "topic"), "bridge");
  for (i = 0; i < sizeof unheard / sizeof *unheard; i++) {
    reread(&r, unheard[i], "sprout", "ask");
    CHECK_STR(bound(first(&r), "target"), "guard");
    CHECK_STR(bound(first(&r), "topic"), "(unbound)");
  }
  reread(&r, "turn dial to 7", "study", "turn");
  CHECK_STR(bound(first(&r), "number"), "7");
  reread(&r, "turn dial to 007", "study", "turn");
  CHECK_STR(bound(first(&r), "number"), "7");
  reread(&r, "turn dial to 13", "study", "turn");
  CHECK_STR(bound(first(&r), "number"), "(unbound)");
  CHECK(!r.readings.ranked[0].whole);
  reread(&r, "turn dial to seven", "study", "turn");
  CHECK_STR(bound(first(&r), "number"), "(unbound)");
  reread(&r, "turn dial to 99999999999999999999", "study", "turn");
  CHECK_STR(bound(first(&r), "number"), "(unbound)");
  bench_close(&r.b);
}

static void one_reading_made_two_ways_is_the_way_that_matched_more_kept_where_first_made(void) {
  reading_bench r;
  open_world(&r, "grammar");
  /* `ask [target] about [topic]` and `ask [target] [topic]` both make asking Oskar with no topic. */
  reread(&r, "ask oskar about toll", "sprout", "ask");
  CHECK_INT(r.readings.count, 1);
  CHECK_INT(r.readings.ranked[0].literal, 3);
  /* Made first by the phrase matching less, then another reading, then the same by the phrase matching more. */
  memset(&r.readings, 0, sizeof r.readings);
  read_as(&r, "ask oskar about toll", "sprout", "ask", 2);
  CHECK_INT(r.readings.ranked[0].literal, 2);
  read_as(&r, "take gong", "sprout", "take", 0);
  read_as(&r, "ask oskar about toll", "sprout", "ask", 1);
  CHECK_INT(r.readings.count, 2);
  CHECK_STR(r.readings.ranked[0].reading.verb->name, "ask");
  CHECK_INT(r.readings.ranked[0].literal, 3);
  CHECK_STR(r.readings.ranked[1].reading.verb->name, "take");
  bench_close(&r.b);
}

static void each_way_of_taking_an_option_from_each_slot_is_a_reading_and_a_step(void) {
  reading_bench r;
  uint64_t before, one;
  open_world(&r, "grammar");
  before = r.b.run.meter->steps;
  reread(&r, "x gong", "sprout", "examine");
  one = r.b.run.meter->steps - before;
  before = r.b.run.meter->steps;
  reread(&r, "x pebble", "sprout", "examine");
  /* Two pebbles, two readings, each a step and a consent pass. */
  CHECK_INT(r.readings.count, 2);
  CHECK(r.b.run.meter->steps - before > one);
  CHECK_STR(bound(first(&r), "target"), "pebble_a");
  CHECK_STR(bound(second(&r), "target"), "pebble_b");
  bench_close(&r.b);
}

static void a_reading_its_consent_pass_refuses_is_kept_ranked_below(void) {
  reading_bench r;
  open_world(&r, "grammar");
  /* Taking the brass key is refused, for it is held. */
  hold(&r, "study.hall.brass_key");
  reread(&r, "take key", "sprout", "take");
  CHECK_INT(r.readings.count, 2);
  CHECK(!r.readings.ranked[0].allowed && r.readings.ranked[1].allowed);
  bench_close(&r.b);
}

static void the_intents_slots_are_bound_by_name_and_it_asks_no_consent(void) {
  reading_bench r;
  const parse_ranked *one;
  open_world(&r, "intents");
  /* The key unlocks only from the hand. */
  hold(&r, "intents.cellar.key");
  reread(&r, "open strongbox with key", "sprout", "open_with");
  CHECK_INT(r.readings.count, 1);
  one = &r.readings.ranked[0];
  CHECK(one->reading.verb == NULL && one->reading.intent != NULL);
  CHECK_STR(bound(&one->reading, "y"), "strongbox");
  CHECK_STR(bound(&one->reading, "x"), "key");
  CHECK(one->allowed && one->whole);
  CHECK_INT(one->literal, 4);
  CHECK_INT(one->near_count, 2);
  bench_close(&r.b);
}

static void all_makes_a_reading_for_each_thing_its_consent_pass_allows_the_first_ranked(void) {
  reading_bench r;
  size_t i;
  open_world(&r, "all-leaves-out-refused");
  /* The lamp refuses to be examined, and is left out; the rest run after the first. */
  reread(&r, "examine all", "sprout", "examine");
  CHECK_INT(r.readings.count, 1);
  CHECK_STR(bound(first(&r), "target"), "sack");
  CHECK_INT(r.readings.ranked[0].rest_count, 2);
  /* In the order reached, nearest first: the lunch is in the sack. */
  CHECK_STR(bound(&r.readings.ranked[0].rest[0], "target"), "ball");
  CHECK_STR(bound(&r.readings.ranked[0].rest[1], "target"), "lunch");
  CHECK(!r.nothing);
  /* No more than a set role's figure, the refused not counted. */
  r.b.w.host.budgets.set_role_objects = (sprout_limit){true, 2};
  reread(&r, "examine all", "sprout", "examine");
  CHECK_INT(r.readings.ranked[0].rest_count, 1);
  r.b.w.host.budgets.set_role_objects = (sprout_limit){true, 8};
  /* Nothing is held, so `drop` refuses each: `all` names nothing. */
  reread(&r, "drop all", "sprout", "drop");
  CHECK_INT(r.readings.count, 0);
  CHECK(r.nothing);
  /* What another slot names is no thing of `all`'s, though putting it would be allowed. */
  hold(&r, "all_leaves_out_refused.hall.sack");
  hold(&r, "all_leaves_out_refused.hall.ball");
  reread(&r, "put all in sack", "sprout", "put");
  CHECK_INT(r.readings.count, 1);
  CHECK_STR(bound(first(&r), "item"), "ball");
  CHECK_STR(bound(first(&r), "container"), "sack");
  for (i = 0; i < r.readings.ranked[0].rest_count; i++)
    CHECK(strcmp(bound(&r.readings.ranked[0].rest[i], "item"), "sack") != 0);
  bench_close(&r.b);
}

static void an_objects_synonym_reads_only_where_the_object_takes_part(void) {
  reading_bench r;
  open_world(&r, "synonyms");
  reread(&r, "force cabinet", "sprout", "open");
  CHECK_INT(r.readings.count, 1);
  CHECK_STR(bound(first(&r), "target"), "cabinet");
  reread(&r, "force chest", "sprout", "open");
  CHECK_INT(r.readings.count, 0);
  reread(&r, "jimmy chest", "sprout", "open");
  CHECK_STR(bound(first(&r), "target"), "chest");
  bench_close(&r.b);
}

static void what_a_pronoun_named_is_carried_with_the_pronoun_typed(void) {
  reading_bench r;
  sprout_str referent;
  open_world(&r, "pronouns");
  referent = bench_str("pronouns.cellar.cat");
  r.all.fill.nouns = bench_nouns(&r.b, &referent, 1);
  reread(&r, "pet it", "pronouns", "pet");
  CHECK_INT(r.readings.count, 1);
  CHECK_INT(r.readings.ranked[0].pronoun_count, 1);
  CHECK_STR(r.readings.ranked[0].pronouns[0].id.bytes, "pronouns.cellar.cat");
  CHECK_INT(r.readings.ranked[0].pronouns[0].pronoun, PARSE_PRONOUN_IT);
  /* Named outright, nothing is carried. */
  reread(&r, "pet cat", "pronouns", "pet");
  CHECK_INT(r.readings.ranked[0].pronoun_count, 0);
  bench_close(&r.b);
}

int main(void) {
  RUN(a_role_of_a_kind_fills_with_a_thing_of_it_and_a_tool_left_out_is_unbound);
  RUN(a_set_role_takes_a_run_in_the_order_typed_duplicates_collapsed);
  RUN(a_value_binds_only_where_a_player_hears_it_spelt_as_a_visitor_types_it);
  RUN(one_reading_made_two_ways_is_the_way_that_matched_more_kept_where_first_made);
  RUN(each_way_of_taking_an_option_from_each_slot_is_a_reading_and_a_step);
  RUN(a_reading_its_consent_pass_refuses_is_kept_ranked_below);
  RUN(the_intents_slots_are_bound_by_name_and_it_asks_no_consent);
  RUN(all_makes_a_reading_for_each_thing_its_consent_pass_allows_the_first_ranked);
  RUN(an_objects_synonym_reads_only_where_the_object_takes_part);
  RUN(what_a_pronoun_named_is_carried_with_the_pronoun_typed);
  return REPORT();
}
