/*
 * Tests for src/parse/nouns.c: what a noun names among what a visitor can reach (the spec's Names > Articles;
 * Verbs > Slots, Set roles; Parsing > Matching a line, Pronouns), read in
 * the corpus world `grammar`: the things of its hall, each nearer than the next as the list stands.
 */
#include "parse_fixture.h"

static const char *const HERE_IDS[] = {"study.hall.brass_key", "study.hall.iron_key", "study.hall.lamp",
                                       "study.hall.gong",      "study.hall.pebble_a", "study.hall.pebble_b",
                                       "study.hall.door"};
#define HERE_COUNT 7

typedef struct study {
  bench b;
  parse_candidate here[HERE_COUNT + 3];
  const sprout_role *take, *tool, *things;
  parse_noun_context within;
} study;

static void open_study(study *s) {
  size_t i;
  bench_open(&s->b, "grammar", "Marta");
  for (i = 0; i < HERE_COUNT; i++) s->here[i] = bench_candidate(&s->b, HERE_IDS[i], i);
  s->take = bench_role(&s->b, "sprout", "take", "target");
  s->tool = bench_role(&s->b, "study", "unlock", "tool");
  s->things = bench_role(&s->b, "study", "juggle", "things");
  s->within = bench_nouns(&s->b, NULL, 0);
}

static bool fits_role(const void *role, const sprout_stored_instance *instance) {
  return parse_fits((const sprout_role *)role, instance);
}

static parse_noun_found noun_among(study *s, const char *line, const sprout_role *role, const parse_candidate *among,
                                   size_t count, const parse_noun_context *context) {
  parse_noun_found found;
  CHECK_INT(parse_things_in(context, bench_words(&s->b, line), fits_role, role, among, count, &found), SPROUT_EVAL_OK);
  return found;
}

static parse_noun_found noun(study *s, const char *line, const sprout_role *role) {
  return noun_among(s, line, role, s->here, HERE_COUNT, &s->within);
}

/* Whether `found` is `expected` and its things, in order, are `ids` with these figures. */
static void named(const parse_noun_found *found, parse_found expected, size_t count, const char *const *ids,
                  const size_t *near, const size_t *literal, const bool *by_name) {
  size_t i;
  CHECK_INT(found->found, expected);
  CHECK_INT(found->count, count);
  for (i = 0; i < count && i < found->count; i++) {
    const parse_named *one = &found->things[i];
    CHECK_BYTES(one->candidate->instance->id.bytes, one->candidate->instance->id.length, ids[i]);
    CHECK_INT(one->near, near[i]);
    CHECK_INT(one->literal, literal[i]);
    CHECK_INT(one->by_name, by_name[i]);
  }
}

static void it_is_tried_as_typed_and_without_a_leading_article_or_determiner(void) {
  study s;
  parse_words forms[2];
  open_study(&s);
  CHECK_INT(parse_forms(bench_words(&s.b, "the brass key"), forms), 2);
  CHECK_STR(bench_joined(&s.b, forms[1]), "brass key");
  CHECK_INT(parse_forms(bench_words(&s.b, "the"), forms), 1);
  CHECK_INT(parse_forms(bench_words(&s.b, "key"), forms), 1);
  CHECK_INT(parse_answers_to(bench_words(&s.b, "my brass key"), &s.here[0].address), PARSE_BY_NAME);
  CHECK_INT(parse_answers_to(bench_words(&s.b, "metal"), &s.here[0].address), PARSE_BY_NOUN);
  CHECK_INT(parse_answers_to(bench_words(&s.b, "iron"), &s.here[0].address), PARSE_BY_NONE);
  bench_close(&s.b);
}

static void it_is_every_thing_that_answers_and_fits_with_how_near_and_how_many_words_it_matched(void) {
  study s;
  parse_noun_found found;
  parse_candidate alike[2];
  open_study(&s);
  {
    const char *ids[] = {"study.hall.gong"};
    size_t near[] = {3}, literal[] = {1};
    bool by_name[] = {false};
    found = noun(&s, "this gong", s.take);
    named(&found, PARSE_FOUND_SOME, 1, ids, near, literal, by_name);
  }
  {
    const char *ids[] = {"study.hall.brass_key"};
    size_t near[] = {0}, literal[] = {2};
    bool by_name[] = {true};
    found = noun(&s, "brass key", s.tool);
    named(&found, PARSE_FOUND_SOME, 1, ids, near, literal, by_name);
  }
  {
    /* The parser ranks the readings they make; nothing is asked, and nothing is drawn here. */
    const char *ids[] = {"study.hall.brass_key", "study.hall.iron_key"};
    size_t near[] = {0, 1}, literal[] = {1, 1};
    bool by_name[] = {false, false};
    found = noun(&s, "key", s.take);
    named(&found, PARSE_FOUND_SOME, 2, ids, near, literal, by_name);
  }
  {
    const char *ids[] = {"study.hall.pebble_a", "study.hall.pebble_b"};
    size_t near[] = {2, 1}, literal[] = {1, 1};
    bool by_name[] = {true, true};
    alike[0] = bench_candidate(&s.b, "study.hall.pebble_a", 2);
    alike[1] = bench_candidate(&s.b, "study.hall.pebble_b", 1);
    found = noun_among(&s, "pebble", s.take, alike, 2, &s.within);
    named(&found, PARSE_FOUND_SOME, 2, ids, near, literal, by_name);
  }
  bench_close(&s.b);
}

static void it_drops_nothing_that_answers_and_marks_what_was_named_in_full(void) {
  study s;
  parse_noun_found found;
  parse_candidate both[2];
  const char *ids[] = {"study.hall.lamp_oil", "study.hall.lamp"};
  size_t near[] = {1, 2}, literal[] = {1, 1};
  bool by_name[] = {false, true};
  open_study(&s);
  /* Oil answers to `lamp` too; the lamp's whole name is `lamp`, which only the ranking weighs. */
  both[0] = bench_candidate(&s.b, "study.hall.lamp_oil", 1);
  both[1] = bench_candidate(&s.b, "study.hall.lamp", 2);
  found = noun_among(&s, "lamp", s.take, both, 2, &s.within);
  named(&found, PARSE_FOUND_SOME, 2, ids, near, literal, by_name);
  bench_close(&s.b);
}

static void it_is_unfit_where_what_answers_cannot_fill_the_role_and_nothing_where_nothing_answers(void) {
  study s;
  parse_noun_found found;
  const char *ids[] = {"study.hall.gong"};
  size_t near[] = {3}, literal[] = {1};
  bool by_name[] = {false};
  open_study(&s);
  found = noun(&s, "gong", s.tool);
  named(&found, PARSE_FOUND_UNFIT, 1, ids, near, literal, by_name);
  found = noun(&s, "unicorn", s.take);
  CHECK_INT(found.found, PARSE_FOUND_NOTHING);
  CHECK(parse_fits(s.tool, s.here[1].instance));
  CHECK(!parse_fits(s.tool, s.here[6].instance));
  CHECK(parse_fits(s.take, s.here[6].instance));
  bench_close(&s.b);
}

static void it_charges_one_step_for_every_candidate_it_is_tried_against(void) {
  study s;
  uint64_t before;
  open_study(&s);
  before = s.b.run.meter->steps;
  noun(&s, "gong", s.take);
  CHECK_INT(s.b.run.meter->steps - before, HERE_COUNT);
  bench_close(&s.b);
}

static bool always(const void *context, const sprout_stored_instance *instance) {
  (void)context, (void)instance;
  return true;
}

static void generated_it_drops_nothing_named_outright_and_adjectives_alone_only_beside_one(void) {
  static const char *const vocabulary[] = {"the",    "brass", "key",  "metal", "lamp",  "oil",
                                           "gong",   "disc",  "pebble", "iron", "shiny", "thing"};
  study s;
  unsigned long seed = 463;
  size_t run, i;
  open_study(&s);
  s.here[HERE_COUNT] = bench_candidate(&s.b, "study.hall.lamp_oil", 1);
  for (run = 0; run < 300; run++) {
    char line[64] = "";
    size_t words, outright = 0, answering = 0, at = 0;
    parse_noun_found found;
    parse_words typed;
    seed = seed * 1103515245UL + 12345UL;
    words = 1 + (seed >> 16) % 3;
    for (i = 0; i < words; i++) {
      seed = seed * 1103515245UL + 12345UL;
      if (i > 0) strcat(line, " ");
      strcat(line, vocabulary[(seed >> 16) % 12]);
    }
    typed = bench_words(&s.b, line);
    CHECK_INT(parse_things_in(&s.within, typed, always, NULL, s.here, HERE_COUNT + 1, &found), SPROUT_EVAL_OK);
    for (i = 0; i < HERE_COUNT + 1; i++) {
      parse_by by = parse_answers_to(typed, &s.here[i].address);
      if (by != PARSE_BY_NONE) answering++;
      if (by != PARSE_BY_NONE && by != PARSE_BY_ADJECTIVE) outright++;
    }
    /* What answers outright, or where nothing does, what answers by adjectives; in the candidates' order. */
    CHECK_INT(found.found == PARSE_FOUND_NOTHING ? 0 : found.count, outright > 0 ? outright : answering);
    for (i = 0; i < HERE_COUNT + 1 && found.found != PARSE_FOUND_NOTHING; i++) {
      parse_by by = parse_answers_to(typed, &s.here[i].address);
      if (by == PARSE_BY_NONE || (outright > 0 && by == PARSE_BY_ADJECTIVE)) continue;
      CHECK(at < found.count && found.things[at].candidate == &s.here[i]);
      at++;
    }
  }
  bench_close(&s.b);
}

static void a_pronoun_names_what_the_last_command_was_done_to_where_it_is_in_reach(void) {
  study s;
  parse_noun_found found;
  parse_noun_context context;
  sprout_str referents[2];
  open_study(&s);
  s.here[HERE_COUNT] = bench_candidate(&s.b, s.b.actor.bytes, 2);
  referents[0] = bench_str("study.hall.lamp");
  context = bench_nouns(&s.b, referents, 1);
  found = noun_among(&s, "it", s.take, s.here, HERE_COUNT + 1, &context);
  CHECK_INT(found.found, PARSE_FOUND_SOME);
  CHECK_INT(found.count, 1);
  CHECK(found.things[0].candidate == &s.here[2] && found.things[0].near == 2 && found.things[0].literal == 1);
  CHECK(!found.things[0].by_name && found.things[0].pronoun == PARSE_PRONOUN_IT);
  referents[0] = bench_str("study.hall.pebble_a");
  referents[1] = bench_str("study.hall.pebble_b");
  context = bench_nouns(&s.b, referents, 2);
  found = noun_among(&s, "them", s.take, s.here, HERE_COUNT + 1, &context);
  CHECK_INT(found.count, 2);
  CHECK(found.things[0].near == 4 && found.things[1].near == 5 && found.things[1].pronoun == PARSE_PRONOUN_THEY);
  context = bench_nouns(&s.b, NULL, 0);
  CHECK_INT(noun_among(&s, "it", s.take, s.here, HERE_COUNT + 1, &context).found, PARSE_FOUND_NOTHING);
  referents[0] = bench_str("study.hall.chest.coin");
  context = bench_nouns(&s.b, referents, 1);
  CHECK_INT(noun_among(&s, "it", s.take, s.here, HERE_COUNT + 1, &context).found, PARSE_FOUND_NOTHING);
  /* `him` and `her` only where it is a person or declares that pronoun. */
  referents[0] = bench_str("study.hall.lamp");
  context = bench_nouns(&s.b, referents, 1);
  CHECK_INT(noun_among(&s, "her", s.take, s.here, HERE_COUNT + 1, &context).found, PARSE_FOUND_NOTHING);
  referents[0] = s.b.actor;
  context = bench_nouns(&s.b, referents, 1);
  CHECK_INT(noun_among(&s, "him", s.take, s.here, HERE_COUNT + 1, &context).found, PARSE_FOUND_SOME);
  CHECK_INT(noun_among(&s, "her", s.take, s.here, HERE_COUNT + 1, &context).found, PARSE_FOUND_SOME);
  bench_close(&s.b);
}

static bool only_iron(const void *context, const sprout_stored_instance *instance) {
  (void)context;
  return sprout_str_same(instance->id, bench_str("study.hall.iron_key"));
}

static bool never(const void *context, const sprout_stored_instance *instance) {
  (void)context, (void)instance;
  return false;
}

static void of_what_may_fill_a_slot_it_is_what_answers_and_what_the_slot_says_fits(void) {
  study s;
  parse_noun_found found;
  open_study(&s);
  CHECK_INT(parse_things_in(&s.within, bench_words(&s.b, "key"), only_iron, NULL, s.here, HERE_COUNT, &found), SPROUT_EVAL_OK);
  CHECK(found.found == PARSE_FOUND_SOME && found.count == 1 && found.things[0].candidate == &s.here[1]);
  CHECK_INT(parse_things_in(&s.within, bench_words(&s.b, "key"), never, NULL, s.here, HERE_COUNT, &found), SPROUT_EVAL_OK);
  CHECK(found.found == PARSE_FOUND_UNFIT && found.count == 2);
  CHECK_INT(parse_things_in(&s.within, bench_words(&s.b, "zebra"), always, NULL, s.here, HERE_COUNT, &found), SPROUT_EVAL_OK);
  CHECK_INT(found.found, PARSE_FOUND_NOTHING);
  bench_close(&s.b);
}

static void adjectives_alone_name_a_thing_weakly_matching_no_word_literally(void) {
  study s;
  parse_noun_found found;
  const char *ids[] = {"study.hall.brass_key", "study.hall.gong"};
  size_t near[] = {0, 3}, literal[] = {0, 0};
  bool by_name[] = {false, false};
  open_study(&s);
  CHECK_INT(parse_answers_to(bench_words(&s.b, "brass"), &s.here[0].address), PARSE_BY_ADJECTIVE);
  CHECK_INT(parse_answers_to(bench_words(&s.b, "brass key"), &s.here[0].address), PARSE_BY_NAME);
  CHECK_INT(parse_answers_to(bench_words(&s.b, "brass metal"), &s.here[0].address), PARSE_BY_NOUN);
  CHECK_INT(parse_answers_to(bench_words(&s.b, "metal brass"), &s.here[0].address), PARSE_BY_NONE);
  found = noun(&s, "brass", s.take);
  named(&found, PARSE_FOUND_SOME, 2, ids, near, literal, by_name);
  bench_close(&s.b);
}

static void a_relative_phrase_names_what_stands_directly_in_what_follows_in_or_on(void) {
  static const char *const lines[] = {"coin in chest", "the coin on the chest", "coin that is in the chest"};
  study s;
  parse_noun_found found;
  size_t i;
  open_study(&s);
  s.here[HERE_COUNT] = bench_candidate(&s.b, "study.hall.chest", 7);
  s.here[HERE_COUNT + 1] = bench_candidate(&s.b, "study.hall.chest.coin", 8);
  for (i = 0; i < 3; i++) {
    found = noun_among(&s, lines[i], s.take, s.here, HERE_COUNT + 2, &s.within);
    CHECK(found.found == PARSE_FOUND_SOME && found.count == 1 && found.things[0].near == 8);
  }
  found = noun_among(&s, "coin that is in the chest", s.take, s.here, HERE_COUNT + 2, &s.within);
  CHECK(found.count == 1 && found.things[0].literal == 5 && !found.things[0].by_name);
  found = noun_among(&s, "the one in the chest", s.take, s.here, HERE_COUNT + 2, &s.within);
  CHECK(found.found == PARSE_FOUND_SOME && found.count == 1 && found.things[0].near == 8 && found.things[0].literal == 3);
  /* The keys are not in the chest, and nothing is in the gong. */
  CHECK_INT(noun_among(&s, "key in chest", s.take, s.here, HERE_COUNT + 2, &s.within).found, PARSE_FOUND_NOTHING);
  CHECK_INT(noun_among(&s, "one in gong", s.take, s.here, HERE_COUNT + 2, &s.within).found, PARSE_FOUND_NOTHING);
  bench_close(&s.b);
}

static const char *stretch(study *s, const char *line, size_t at) {
  parse_words words = bench_words(&s->b, line), part;
  parse_stretch nouns[16];
  size_t count = parse_nouns_of_run(words, nouns);
  if (at >= count) return "(none)";
  part.words = words.words + nouns[at].start;
  part.count = nouns[at].end - nouns[at].start;
  return bench_joined(&s->b, part);
}

static void a_set_roles_run_splits_on_and_and_commas_a_comma_before_and_one_split(void) {
  study s;
  open_study(&s);
  CHECK_STR(stretch(&s, "gong and lamp", 0), "gong");
  CHECK_STR(stretch(&s, "gong and lamp", 1), "lamp");
  CHECK_STR(stretch(&s, "gong, lamp, and brass key", 2), "brass key");
  CHECK_STR(stretch(&s, "gong, lamp, and brass key", 3), "(none)");
  CHECK_STR(stretch(&s, "gong and", 1), "");
  CHECK_STR(stretch(&s, ", gong", 0), "");
  CHECK_STR(stretch(&s, ", gong", 1), "gong");
  CHECK_STR(stretch(&s, "gong , , lamp", 1), "");
  CHECK_STR(stretch(&s, "gong , , lamp", 2), "lamp");
  bench_close(&s.b);
}

static void a_set_roles_run_is_every_set_its_nouns_make_each_thing_once_in_the_order_typed(void) {
  study s;
  parse_run_found found;
  open_study(&s);
  CHECK_INT(parse_run_in(&s.within, bench_words(&s.b, "lamp and gong and lamp"), s.things, s.here, HERE_COUNT, &found),
            SPROUT_EVAL_OK);
  CHECK(found.sets && found.count == 1);
  CHECK(found.named[0].count == 2 && found.named[0].things[0] == &s.here[2] && found.named[0].things[1] == &s.here[3]);
  CHECK(found.named[0].near == 7 && found.named[0].literal == 3 && found.named[0].by_name == 2);
  /* A noun that names two things makes a set with each. */
  CHECK_INT(parse_run_in(&s.within, bench_words(&s.b, "gong and key"), s.things, s.here, HERE_COUNT, &found), SPROUT_EVAL_OK);
  CHECK(found.sets && found.count == 2);
  CHECK(found.named[0].things[1] == &s.here[0] && found.named[0].near == 3 && found.named[0].literal == 2);
  CHECK(found.named[1].things[1] == &s.here[1] && found.named[1].near == 4 && found.named[1].by_name == 0);
  bench_close(&s.b);
}

static void a_set_roles_run_is_decided_by_its_first_noun_that_names_nothing_it_may_take(void) {
  study s;
  parse_run_found found;
  open_study(&s);
  CHECK_INT(parse_run_in(&s.within, bench_words(&s.b, "gong and unicorn"), s.things, s.here, HERE_COUNT, &found), SPROUT_EVAL_OK);
  CHECK(!found.sets && found.found == PARSE_FOUND_NOTHING && found.start == 2 && found.end == 3);
  CHECK_INT(parse_run_in(&s.within, bench_words(&s.b, "gong and"), s.things, s.here, HERE_COUNT, &found), SPROUT_EVAL_OK);
  CHECK(!found.sets && found.found == PARSE_FOUND_UNFIT && found.start == 2 && found.end == 2);
  bench_close(&s.b);
}

/* A thing in several places stands directly in each, so a relative phrase finds it in any of them. */
static void a_thing_in_several_places_is_named_as_in_each_of_them(void) {
  bench b;
  sprout_arena keep;
  sprout_parsed out;
  bench_open(&b, "several-places", "Marta");
  sprout_arena_init(&keep, &b.w.host);
  CHECK_INT(bench_parse(&b, &keep, "examine the door in the tiny room", 1, NULL, &out), SPROUT_OK);
  CHECK_INT(out.end, SPROUT_PARSED_READING);
  CHECK_INT(out.reading.filling_count, 1);
  CHECK_STR(out.reading.fillings[0].id, "several_places.tiny_room.pdoor");
  sprout_arena_reset(&keep);
  /* Marta goes through to the dreary room, where the same door stands. */
  bench_command(&b, "several_places.swing", "several_places.tiny_room.pdoor");
  {
    sprout_outcome gone;
    tw_go(&b.w, "v-marta", "east", "east, through the door", "dreary_room", 1002, &gone);
    sprout_outcome_free(&gone);
  }
  CHECK_INT(bench_parse(&b, &keep, "examine the door in the dreary room", 1, NULL, &out), SPROUT_OK);
  CHECK_INT(out.end, SPROUT_PARSED_READING);
  CHECK_STR(out.reading.fillings[0].id, "several_places.tiny_room.pdoor");
  sprout_arena_reset(&keep);
  bench_close(&b);
}

int main(void) {
  RUN(a_thing_in_several_places_is_named_as_in_each_of_them);
  RUN(it_is_tried_as_typed_and_without_a_leading_article_or_determiner);
  RUN(it_is_every_thing_that_answers_and_fits_with_how_near_and_how_many_words_it_matched);
  RUN(it_drops_nothing_that_answers_and_marks_what_was_named_in_full);
  RUN(it_is_unfit_where_what_answers_cannot_fill_the_role_and_nothing_where_nothing_answers);
  RUN(it_charges_one_step_for_every_candidate_it_is_tried_against);
  RUN(generated_it_drops_nothing_named_outright_and_adjectives_alone_only_beside_one);
  RUN(a_pronoun_names_what_the_last_command_was_done_to_where_it_is_in_reach);
  RUN(of_what_may_fill_a_slot_it_is_what_answers_and_what_the_slot_says_fits);
  RUN(adjectives_alone_name_a_thing_weakly_matching_no_word_literally);
  RUN(a_relative_phrase_names_what_stands_directly_in_what_follows_in_or_on);
  RUN(a_set_roles_run_splits_on_and_and_commas_a_comma_before_and_one_split);
  RUN(a_set_roles_run_is_every_set_its_nouns_make_each_thing_once_in_the_order_typed);
  RUN(a_set_roles_run_is_decided_by_its_first_noun_that_names_nothing_it_may_take);
  return REPORT();
}
