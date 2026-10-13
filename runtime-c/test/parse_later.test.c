/*
 * Tests for src/parse/later.c: a run's items after its first (the spec's Parsing > Sequences, again and all), in the
 * corpus world `runs`, which stands in for the pantry `runs.spec.ts` is written about. The items of a run filled
 * where `take salt, lamp and key` puts them are planned directly, and `runs.spec.ts`'s cases for a run in a role that
 * takes one thing, and for `and` before a verb, are read through `sprout_parse`.
 */
#include "parse_fixture.h"

/* The typed phrase `take [target]`. */
static const sprout_typed_phrase *take_phrase(bench *b) {
  const sprout_verb *take = bench_verb(b, "sprout", "take");
  size_t i;
  for (i = 0; i < b->w.world->phrase_count; i++) {
    const sprout_typed_phrase *phrase = &b->w.world->phrases[i];
    if (phrase->verb == take && phrase->part_count == 2 && !phrase->parts[0].is_slot &&
        strcmp(phrase->parts[0].words[0], "take") == 0 && phrase->parts[1].is_slot)
      return phrase;
  }
  fprintf(stderr, "no `take [target]`\n");
  exit(2);
}

static void each_item_after_the_first_is_planned_or_left_for_its_own_turn(void) {
  bench b;
  parse_candidate *candidates;
  size_t candidate_count, count;
  parse_fill_context fill;
  parse_filled filled;
  parse_words line, slot;
  parse_span span;
  parse_run run;
  bool words = false;
  sprout_stored_bound first;
  parse_following *later;
  const sprout_typed_phrase *phrase;
  uint64_t before;
  bench_open(&b, "runs", "Marta");
  phrase = take_phrase(&b);
  line = bench_words(&b, "take salt, lamp and key");
  CHECK_INT(parse_reach_of(&b.frame, b.actor, &candidates, &candidate_count), SPROUT_EVAL_OK);
  memset(&fill, 0, sizeof fill);
  fill.nouns = bench_nouns(&b, NULL, 0);
  fill.candidates = candidates;
  fill.candidate_count = candidate_count;
  slot.words = line.words + 1;
  slot.count = line.count - 1;
  CHECK_INT(parse_fill_slot(&fill, &phrase->verb->roles[phrase->parts[1].role], slot, &filled), SPROUT_EVAL_OK);
  CHECK_INT(filled.fills, PARSE_FILLS_RUN);
  CHECK_INT(filled.later_count, 2);
  span.role = phrase->parts[1].role;
  span.start = 1;
  span.end = line.count;
  memset(&first, 0, sizeof first);
  first.kind = SPROUT_BOUND_OBJECT;
  first.object = filled.things[0].candidate->instance->id;
  memset(&run, 0, sizeof run);
  run.phrase = phrase;
  run.count = 1;
  run.spans = &span;
  run.words = &words;
  run.bounds = &first;
  run.later_count = filled.later_count;
  run.later = filled.later;
  before = b.run.meter->steps;
  CHECK_INT(parse_later_of(&b.run.x, &b.frame, b.actor, line, &run, NULL, 0, b.frame.turn, &later, &count),
            SPROUT_EVAL_OK);
  CHECK_INT(count, 2);
  /* The lamp is planned, the item's role filled by it. */
  CHECK(later[0].reread == NULL);
  CHECK_INT(later[0].planned.count, 1);
  CHECK_BYTES(later[0].planned.bounds[0].object.bytes, later[0].planned.bounds[0].object.length, "runs.kitchen.lamp");
  /* Two keys tie, so the item's words are read afresh, the line's reading planned without the item's role. */
  CHECK(later[1].reread != NULL);
  CHECK_INT(later[1].planned.count, 0);
  if (later[1].reread != NULL) {
    CHECK_STR(later[1].reread->role, "target");
    CHECK_STR(later[1].reread->words, "key");
    CHECK_INT(later[1].reread->value_count, 0);
    CHECK_INT(later[1].reread->referent_count, 0);
  }
  /* A step for the lamp, and one for each key. */
  CHECK(b.run.meter->steps - before >= 3);
  bench_close(&b);
}

typedef struct pantry {
  bench b;
  sprout_arena keep;
  sprout_parsed out;
} pantry;

static void open_pantry(pantry *p) {
  bench_world(&p->b, "runs");
  sprout_arena_init(&p->keep, &p->b.w.host);
}

static void close_pantry(pantry *p) {
  sprout_arena_reset(&p->keep);
  tw_close(&p->b.w);
}

/* What `reading` binds `role` to, by the last segment of its id; "-" for none. */
static const char *bound_in(const sprout_reading *reading, const char *role) {
  size_t i;
  for (i = 0; i < reading->filling_count; i++)
    if (strcmp(reading->fillings[i].role, role) == 0) return bench_last(reading->fillings[i].id);
  return "-";
}

/*
 * What `line`'s first reading binds `role` to, then each turn after it, joined by spaces: a planned reading's;
 * `afresh:` and an item's words its own turn reads; or `[command]` read from its own words.
 */
static const char *turns(pantry *p, const char *line, uint64_t seed) {
  static char text[1024];
  const char *role = strncmp(line, "put", 3) == 0 ? "item" : "target";
  size_t i;
  text[0] = '\0';
  CHECK_INT(bench_parse(&p->b, &p->keep, line, seed, NULL, &p->out), SPROUT_OK);
  if (p->out.end != SPROUT_PARSED_READING) {
    snprintf(text, sizeof text, "answered %s", p->out.answer == NULL ? "(faulted)" : p->out.answer);
    return text;
  }
  strcat(text, bound_in(&p->out.reading, role));
  for (i = 0; i < p->out.rest_count; i++) {
    const sprout_following *one = &p->out.rest[i];
    strcat(text, " ");
    if (one->planned == NULL) snprintf(text + strlen(text), sizeof text - strlen(text), "[%s]", one->text);
    else if (one->reread != NULL) snprintf(text + strlen(text), sizeof text - strlen(text), "afresh:%s", one->reread->words);
    else strcat(text, bound_in(one->planned, role));
  }
  return text;
}

static void a_run_reads_its_first_item_and_plans_a_reading_for_each_after_it_in_order(void) {
  pantry p;
  open_pantry(&p);
  CHECK_STR(turns(&p, "take salt and lamp", 7), "salt lamp");
  CHECK_STR(turns(&p, "take box, pepper, and salt", 7), "box pepper salt");
  CHECK_STR(turns(&p, "put salt and pepper in box", 7), "salt pepper");
  CHECK_STR(bound_in(p.out.rest[0].planned, "container"), "box");
  /* A name holding `and` is read whole, and as one item of a run. */
  CHECK_STR(turns(&p, "take salt and pepper shaker", 7), "shaker");
  CHECK_STR(turns(&p, "take salt and pepper shaker and lamp", 7), "shaker lamp");
  close_pantry(&p);
}

static void a_run_keeps_what_a_pronoun_named_and_leaves_an_item_that_names_nothing_or_ties_for_its_own_turn(void) {
  pantry p;
  const sprout_reread *reread;
  open_pantry(&p);
  bench_command(&p.b, "sprout.examine", "runs.kitchen.box");
  CHECK_STR(turns(&p, "put salt and lamp in it", 7), "salt lamp");
  CHECK_STR(bound_in(&p.out.reading, "container"), "box");
  CHECK_STR(bound_in(p.out.rest[0].planned, "container"), "box");
  CHECK_STR(turns(&p, "take lamp and unicorn and salt", 7), "lamp afresh:unicorn salt");
  CHECK_STR(turns(&p, "take lamp and key", 7), "lamp afresh:key");
  /* The item's turn reads its words alone, with what `it` named when the line began. */
  CHECK_STR(turns(&p, "put salt and key in it", 7), "salt afresh:key");
  reread = p.out.rest[0].reread;
  CHECK_STR(reread->role, "item");
  CHECK_INT(reread->value_count, 0);
  CHECK_INT(reread->referent_count, 1);
  CHECK_STR(reread->referents[0], "runs.kitchen.box");
  CHECK_INT(p.out.rest[0].planned->filling_count, 1);
  CHECK_STR(bound_in(p.out.rest[0].planned, "container"), "box");
  CHECK_STR(turns(&p, "take lamp and brass key", 7), "lamp brass_key");
  close_pantry(&p);
}

static void a_run_with_all_or_whose_first_item_names_nothing_is_answered(void) {
  pantry p;
  open_pantry(&p);
  CHECK_STR(turns(&p, "take lamp and all", 7), "answered unknown");
  CHECK_STR(turns(&p, "take all and lamp", 7), "answered unknown");
  CHECK_STR(turns(&p, "take everything and lamp", 7), "answered unknown");
  CHECK_STR(turns(&p, "take the lamp in the box and lamp", 7), "answered not_here");
  CHECK_STR(turns(&p, "take unicorn and lamp", 7), "answered unknown");
  /* A set role binds every item at once, with nothing after it. */
  CHECK_INT(bench_parse(&p.b, &p.keep, "juggle salt and lamp", 7, NULL, &p.out), SPROUT_OK);
  CHECK_INT(p.out.rest_count, 0);
  CHECK_INT(p.out.reading.fillings[0].id_count, 2);
  close_pantry(&p);
}

static void and_before_a_verb_joins_two_commands_the_second_read_on_its_own_turn(void) {
  pantry p;
  open_pantry(&p);
  CHECK_STR(turns(&p, "take salt and take lamp", 7), "salt [take lamp]");
  CHECK_STR(turns(&p, "take salt, and look", 7), "salt [look]");
  /* A run runs before the command it joins. */
  CHECK_STR(turns(&p, "take salt and lamp and take box", 7), "salt lamp [take box]");
  /* A first command that names nothing answers the line. */
  CHECK_STR(turns(&p, "take the lamp in the box and take lamp", 7), "answered not_here");
  CHECK_STR(turns(&p, "take unicorn and take lamp", 7), "answered unknown");
  CHECK_STR(turns(&p, "dance and take lamp", 7), "answered unknown");
  close_pantry(&p);
}

static uint64_t next(uint64_t *state, uint64_t below) {
  *state = *state * 6364136223846793005u + 1442695040888963407u;
  return (*state >> 33) % below;
}

static void a_run_of_names_in_reach_runs_once_for_each_in_order_generated(void) {
  static const char *const NAMES[][2] = {{"salt", "salt"},         {"pepper", "pepper"},
                                         {"the salt and pepper shaker", "shaker"},
                                         {"lamp", "lamp"},         {"the brass key", "brass_key"},
                                         {"iron key", "iron_key"}, {"box", "box"}};
  static const char *const BETWEEN[] = {", ", " and "};
  static const char *const LAST[] = {" and ", ", and ", ", "};
  pantry p;
  uint64_t state = 448;
  size_t run;
  open_pantry(&p);
  for (run = 0; run < 200; run++) {
    char line[512] = "take ", expected[512] = "";
    size_t count = 2 + (size_t)next(&state, 4), k;
    const char *between = BETWEEN[next(&state, 2)];
    for (k = 0; k < count; k++) {
      size_t at = (size_t)next(&state, sizeof NAMES / sizeof *NAMES);
      if (k > 0) strcat(line, k + 1 == count ? LAST[next(&state, 3)] : between);
      strcat(line, NAMES[at][0]);
      if (k > 0) strcat(expected, " ");
      strcat(expected, NAMES[at][1]);
    }
    CHECK_STR(turns(&p, line, next(&state, 1000)), expected);
    if (strcmp(turns(&p, line, 7), expected) != 0) fprintf(stderr, "`%s`\n", line);
    sprout_arena_reset(&p.keep);
  }
  close_pantry(&p);
}

int main(void) {
  RUN(each_item_after_the_first_is_planned_or_left_for_its_own_turn);
  RUN(a_run_reads_its_first_item_and_plans_a_reading_for_each_after_it_in_order);
  RUN(a_run_keeps_what_a_pronoun_named_and_leaves_an_item_that_names_nothing_or_ties_for_its_own_turn);
  RUN(a_run_with_all_or_whose_first_item_names_nothing_is_answered);
  RUN(and_before_a_verb_joins_two_commands_the_second_read_on_its_own_turn);
  RUN(a_run_of_names_in_reach_runs_once_for_each_in_order_generated);
  return REPORT();
}
