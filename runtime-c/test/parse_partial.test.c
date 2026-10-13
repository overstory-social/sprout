/*
 * Tests for src/parse/partial.c: a line read in part (the spec's Parsing > When nothing matches; Verbs > Carried
 * roles), the cases of runtime/parser/partial.spec.ts. The partials of `unlock [target] with [tool]` are made in the
 * study (the corpus world `grammar`) from fills built here, where the line `unlock door with gong` puts its slots;
 * a line read in part for a carried role is read through `sprout_parse` in the corpus world `carried`, and a tie
 * among partials in the study.
 */
#include "parse_fixture.h"

typedef struct partial_bench {
  bench b;
  const sprout_typed_phrase *phrase; /* `unlock [target] with [tool]` */
  parse_span spans[2];
  parse_filled fills[2];
  const parse_filled *placed[2];
  parse_partials partials;
} partial_bench;

static void open_study(partial_bench *p) {
  size_t i;
  memset(p, 0, sizeof *p);
  bench_open(&p->b, "grammar", "Marta");
  for (i = 0; i < p->b.w.world->phrase_count; i++)
    if (strcmp(p->b.w.world->phrases[i].verb->name, "unlock") == 0 && p->b.w.world->phrases[i].part_count == 4)
      p->phrase = &p->b.w.world->phrases[i];
  CHECK(p->phrase != NULL);
  p->spans[0] = (parse_span){0, 1, 2};
  p->spans[1] = (parse_span){1, 3, 4};
}

/* `id` as an option a fill names, `near` 2 and matching `literal` of the line's words. */
static const parse_named *thing(partial_bench *p, const char *id, size_t literal) {
  parse_candidate *candidate = (parse_candidate *)sprout_arena_take(p->b.frame.turn, sizeof *candidate);
  parse_named *named = (parse_named *)sprout_arena_take(p->b.frame.turn, sizeof *named);
  *candidate = bench_candidate(&p->b, id, 2);
  memset(named, 0, sizeof *named);
  named->candidate = candidate;
  named->near = 2;
  named->literal = literal;
  return named;
}

/* A fill of `fills` naming `count` things, each as `thing` makes it. */
static parse_filled filled(parse_fills fills, const parse_named *const *things, size_t count) {
  parse_filled out;
  parse_named *each = (parse_named *)malloc((count + 1) * sizeof *each);
  size_t i;
  memset(&out, 0, sizeof out);
  for (i = 0; i < count; i++) each[i] = *things[i];
  out.fills = fills;
  out.things = each;
  out.thing_count = count;
  return out;
}

/* The partials the two fills make for `unlock door with gong`, the steps they spent, and how many were made. */
static uint64_t partials(partial_bench *p, parse_filled target, parse_filled tool) {
  parse_placement placement;
  uint64_t before = p->b.run.meter->steps;
  memset(&p->partials, 0, sizeof p->partials);
  p->fills[0] = target;
  p->fills[1] = tool;
  p->placed[0] = &p->fills[0];
  p->placed[1] = &p->fills[1];
  memset(&placement, 0, sizeof placement);
  placement.phrase = p->phrase;
  placement.words = bench_words(&p->b, "unlock door with gong");
  placement.spans = p->spans;
  placement.count = 2;
  placement.fills = p->placed;
  CHECK_INT(parse_partials_of(&p->b.frame, &placement, p->b.frame.turn, &p->partials), SPROUT_EVAL_OK);
  free((void *)target.things);
  free((void *)tool.things);
  return p->b.run.meter->steps - before;
}

static void is_partial(const parse_partial *partial, const char *words, size_t literal, const char *uncarried) {
  CHECK_BYTES(partial->words.bytes, partial->words.length, words);
  CHECK_INT(partial->literal, literal);
  CHECK_INT(partial->bound, 2);
  if (uncarried == NULL) CHECK(partial->uncarried.bytes == NULL);
  else CHECK_BYTES(partial->uncarried.bytes, partial->uncarried.length, uncarried);
}

static void it_is_written_as_a_visitor_types_it_each_a_step_and_the_best_kept(void) {
  partial_bench p;
  const parse_named *door[1], *unfit[2];
  open_study(&p);
  door[0] = thing(&p, "study.hall.door", 1);
  unfit[0] = thing(&p, "study.hall.gong", 2);
  unfit[1] = thing(&p, "study.hall.guard", 1);
  CHECK_INT(partials(&p, filled(PARSE_FILLS_OPTIONS, door, 1), filled(PARSE_FILLS_UNFIT, unfit, 2)), 2);
  CHECK_INT(p.partials.made, 2);
  CHECK_INT(p.partials.count, 1);
  is_partial(&p.partials.best[0], "unlock the door with the brass disc", 5, NULL);
  /* Tied, both are kept in the order made: a proper name stands alone. */
  unfit[0] = thing(&p, "study.hall.gong", 1);
  CHECK_INT(partials(&p, filled(PARSE_FILLS_OPTIONS, door, 1), filled(PARSE_FILLS_UNFIT, unfit, 2)), 2);
  CHECK_INT(p.partials.count, 2);
  is_partial(&p.partials.best[0], "unlock the door with the brass disc", 4, NULL);
  is_partial(&p.partials.best[1], "unlock the door with Oskar", 4, NULL);
  bench_close(&p.b);
}

static void it_names_the_thing_not_carried_only_where_a_carried_role_is_all_that_is_wrong(void) {
  partial_bench p;
  const parse_named *door[1], *gong[1], *key[1];
  open_study(&p);
  door[0] = thing(&p, "study.hall.door", 1);
  gong[0] = thing(&p, "study.hall.gong", 1);
  key[0] = thing(&p, "study.hall.brass_key", 2);
  partials(&p, filled(PARSE_FILLS_OPTIONS, door, 1), filled(PARSE_FILLS_OUTWARD, key, 1));
  CHECK_INT(p.partials.count, 1);
  is_partial(&p.partials.best[0], "unlock the door with the brass key", 5, "study.hall.brass_key");
  partials(&p, filled(PARSE_FILLS_UNFIT, gong, 1), filled(PARSE_FILLS_OUTWARD, key, 1));
  CHECK_INT(p.partials.count, 1);
  is_partial(&p.partials.best[0], "unlock the brass disc with the brass key", 5, NULL);
  bench_close(&p.b);
}

static void it_writes_a_run_in_a_role_that_takes_one_thing_as_its_first_item(void) {
  partial_bench p;
  const parse_named *door[1], *guard[1];
  parse_filled run;
  parse_later later;
  open_study(&p);
  door[0] = thing(&p, "study.hall.door", 1);
  guard[0] = thing(&p, "study.hall.guard", 1);
  memset(&later, 0, sizeof later);
  later.start = 2;
  later.end = 3;
  later.filled = filled(PARSE_FILLS_OPTIONS, guard, 1);
  run = filled(PARSE_FILLS_RUN, door, 1);
  run.later = &later;
  run.later_count = 1;
  partials(&p, run, filled(PARSE_FILLS_UNFIT, guard, 1));
  CHECK_INT(p.partials.count, 1);
  is_partial(&p.partials.best[0], "unlock the door with Oskar", 4, NULL);
  free((void *)later.filled.things);
  bench_close(&p.b);
}

static void there_are_none_where_no_slot_names_what_it_cannot_take_or_one_names_nothing_or_no_thing(void) {
  partial_bench p;
  const parse_named *door[1], *gong[1], *key[1];
  parse_filled nothing;
  open_study(&p);
  door[0] = thing(&p, "study.hall.door", 1);
  gong[0] = thing(&p, "study.hall.gong", 1);
  key[0] = thing(&p, "study.hall.brass_key", 1);
  CHECK_INT(partials(&p, filled(PARSE_FILLS_OPTIONS, door, 1), filled(PARSE_FILLS_OPTIONS, key, 1)), 0);
  CHECK_INT(p.partials.count, 0);
  nothing = filled(PARSE_FILLS_NOTHING, NULL, 0);
  nothing.end = 1;
  CHECK_INT(partials(&p, nothing, filled(PARSE_FILLS_UNFIT, gong, 1)), 0);
  CHECK_INT(p.partials.count, 0);
  CHECK_INT(partials(&p, filled(PARSE_FILLS_OPTIONS, door, 1), filled(PARSE_FILLS_UNFIT, NULL, 0)), 0);
  CHECK_INT(p.partials.count, 0);
  CHECK_INT(p.partials.made, 0);
  bench_close(&p.b);
}

static parse_partial partial(const char *words, size_t literal, size_t bound) {
  parse_partial out;
  memset(&out, 0, sizeof out);
  out.words = bench_str(words);
  out.literal = literal;
  out.bound = bound;
  return out;
}

static void the_one_answered_matched_most_words_then_filled_most_roles_whatever_order_they_came_in(void) {
  bench b;
  parse_partial two[2];
  const parse_partial *chosen;
  size_t among;
  uint64_t before;
  two[0] = partial("a", 3, 1);
  two[1] = partial("b", 2, 2);
  CHECK(parse_compare_partial(&two[0], &two[1]) < 0);
  two[0] = partial("a", 2, 1);
  CHECK(parse_compare_partial(&two[0], &two[1]) > 0);
  bench_open(&b, "grammar", "Marta");
  two[0] = partial("first", 2, 1);
  two[1] = partial("best", 2, 2);
  before = b.run.meter->steps;
  CHECK_INT(parse_choose_partial(&b.frame, two, 2, &chosen, &among), SPROUT_EVAL_OK);
  CHECK_BYTES(chosen->words.bytes, chosen->words.length, "best");
  CHECK_INT(among, 1);
  CHECK_INT(b.run.meter->steps - before, 0);
  bench_close(&b);
}

static void it_is_drawn_among_those_still_tied_a_step_and_varies_with_the_seed(void) {
  bench b;
  parse_partial two[2];
  const parse_partial *chosen;
  size_t among, brass = 0, iron = 0;
  uint64_t seed, before;
  two[0] = partial("brass", 2, 2);
  two[1] = partial("iron", 2, 2);
  bench_open(&b, "grammar", "Marta");
  for (seed = 0; seed < 16; seed++) {
    turn_drop(&b.run);
    CHECK_INT(turn_open(&b.run, b.w.world, b.w.state, &b.w.host, SPROUT_TURN_COMMAND, seed, 0, NULL, NULL), SPROUT_OK);
    b.frame = sprout_exec_frame(&b.run.x, b.actor, NULL, NULL);
    before = b.run.meter->steps;
    CHECK_INT(parse_choose_partial(&b.frame, two, 2, &chosen, &among), SPROUT_EVAL_OK);
    CHECK_INT(among, 2);
    CHECK_INT(b.run.meter->steps - before, 1);
    if (chosen == &two[0]) brass++;
    else iron++;
  }
  CHECK(brass > 0 && iron > 0);
  bench_close(&b);
}

/* ---- a line read in part, through `sprout_parse` ---- */

typedef struct typing {
  turn_world w;
  sprout_arena keep;
  sprout_parsed out;
} typing;

static void open_typing(typing *t, const char *world) {
  sprout_outcome arrived;
  memset(t, 0, sizeof *t);
  tw_open(&t->w, world);
  tw_arrive(&t->w, "v-marta", "Marta", 1000, &arrived);
  sprout_outcome_free(&arrived);
  sprout_arena_init(&t->keep, &t->w.host);
}

static void close_typing(typing *t) {
  sprout_arena_reset(&t->keep);
  tw_close(&t->w);
}

/* Parses `line` as Marta under seed 7, which must read it. */
static void typed(typing *t, const char *line) {
  sprout_status status;
  t->w.seed = 7;
  status = sprout_parse(t->w.world, t->w.state, &t->w.host, "v-marta", line, strlen(line), NULL, &t->keep, &t->out);
  CHECK_INT(status, SPROUT_OK);
  if (status != SPROUT_OK) fprintf(stderr, "`%s`: %s\n", line, t->out.fault.text);
}

/* Whether the line was answered with `answer`, binding `name` third, to the thing or the words `text`. */
static void answered_with(const typing *t, const char *answer, const char *name, bool object, const char *text) {
  CHECK_INT(t->out.end, SPROUT_PARSED_ANSWERED);
  if (t->out.end != SPROUT_PARSED_ANSWERED) return;
  CHECK_STR(t->out.answer, answer);
  CHECK_STR(t->out.line, answer);
  CHECK_INT(t->out.binding_count, 3);
  if (t->out.binding_count != 3) return;
  CHECK_STR(t->out.bindings[2].name, name);
  CHECK(t->out.bindings[2].object == object);
  CHECK_BYTES(t->out.bindings[2].text.bytes, t->out.bindings[2].text.length, text);
}

/* What the reading binds `role` to: the thing's id, or "(none)". */
static const char *bound_to(const typing *t, const char *role) {
  size_t i;
  for (i = 0; i < t->out.reading.filling_count; i++)
    if (strcmp(t->out.reading.fillings[i].role, role) == 0 && t->out.reading.fillings[i].binds == SPROUT_FILL_OBJECT)
      return t->out.reading.fillings[i].id;
  return "(none)";
}

static void take_iron_key(typing *t) {
  sprout_filling filling;
  sprout_reading reading = tw_reading("sprout.take", tw_person(&t->w, "v-marta"), &filling, "target", "carried.cellar.iron_key");
  sprout_outcome done;
  tw_command(&t->w, "v-marta", &reading, 1001, &done);
  sprout_outcome_free(&done);
}

static void a_carried_role_naming_only_what_lies_further_out_is_not_carrying_that_thing(void) {
  typing t;
  open_typing(&t, "carried");
  typed(&t, "unlock strongbox with iron key");
  answered_with(&t, "not_carrying", "thing", true, "carried.cellar.iron_key");
  /* In the open crate, further out still. */
  typed(&t, "unlock strongbox with brass key");
  answered_with(&t, "not_carrying", "thing", true, "carried.cellar.crate.brass_key");
  CHECK_INT(t.out.draw_count, 0);
  close_typing(&t);
}

static void what_is_carried_is_read_and_never_drawn_against_what_lies_further_out(void) {
  typing t;
  open_typing(&t, "carried");
  take_iron_key(&t);
  /* The brass key in the crate answers to `key` as well, and does not compete. */
  typed(&t, "unlock strongbox with key");
  CHECK_INT(t.out.end, SPROUT_PARSED_READING);
  CHECK_STR(bound_to(&t, "tool"), "carried.cellar.iron_key");
  CHECK(!t.out.drawn);
  close_typing(&t);
}

static void a_role_that_also_cannot_take_what_fills_it_is_cannot(void) {
  typing t;
  open_typing(&t, "carried");
  typed(&t, "unlock crate with iron key");
  answered_with(&t, "cannot", "reading", false, "unlock the crate with the iron key");
  close_typing(&t);
}

static void an_intents_slot_given_to_a_carried_role_fills_the_same_way(void) {
  typing t;
  open_typing(&t, "carried");
  typed(&t, "open strongbox with iron key");
  answered_with(&t, "not_carrying", "thing", true, "carried.cellar.iron_key");
  take_iron_key(&t);
  typed(&t, "open strongbox with iron key");
  CHECK_INT(t.out.end, SPROUT_PARSED_INTENT);
  close_typing(&t);
}

static void a_role_that_is_not_carried_reaches_further_out(void) {
  typing t;
  open_typing(&t, "carried");
  take_iron_key(&t);
  typed(&t, "put iron key in crate");
  CHECK_INT(t.out.end, SPROUT_PARSED_READING);
  CHECK_STR(bound_to(&t, "item"), "carried.cellar.iron_key");
  CHECK_STR(bound_to(&t, "container"), "carried.cellar.crate");
  close_typing(&t);
}

static void partials_tied_are_drawn_from_the_turns_stream_its_first_draw(void) {
  typing t;
  open_typing(&t, "grammar");
  /* Both pebbles answer, and neither is a key. */
  typed(&t, "unlock door with pebble");
  answered_with(&t, "cannot", "reading", false, "unlock the door with the pebble");
  CHECK_INT(t.out.draw_count, 1);
  if (t.out.draw_count == 1) CHECK_INT(t.out.draws[0], 2);
  CHECK(!t.out.drawn);
  close_typing(&t);
}

int main(void) {
  RUN(it_is_written_as_a_visitor_types_it_each_a_step_and_the_best_kept);
  RUN(it_names_the_thing_not_carried_only_where_a_carried_role_is_all_that_is_wrong);
  RUN(it_writes_a_run_in_a_role_that_takes_one_thing_as_its_first_item);
  RUN(there_are_none_where_no_slot_names_what_it_cannot_take_or_one_names_nothing_or_no_thing);
  RUN(the_one_answered_matched_most_words_then_filled_most_roles_whatever_order_they_came_in);
  RUN(it_is_drawn_among_those_still_tied_a_step_and_varies_with_the_seed);
  RUN(a_carried_role_naming_only_what_lies_further_out_is_not_carrying_that_thing);
  RUN(what_is_carried_is_read_and_never_drawn_against_what_lies_further_out);
  RUN(a_role_that_also_cannot_take_what_fills_it_is_cannot);
  RUN(an_intents_slot_given_to_a_carried_role_fills_the_same_way);
  RUN(a_role_that_is_not_carried_reaches_further_out);
  RUN(partials_tied_are_drawn_from_the_turns_stream_its_first_draw);
  return REPORT();
}
