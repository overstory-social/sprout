/*
 * Tests for src/parse/runs.c: a run of things in a role that takes one thing (the spec's Parsing > Sequences,
 * again and all), the items cases of runtime/parser/runs.spec.ts read in the corpus world `runs`, whose kitchen
 * holds the salt, the pepper, the salt and pepper shaker, the lamp, two keys and a box. What a line's turns do with
 * a run's items is the readings', and is held to the TypeScript parser by the harness.
 */
#include "parse_fixture.h"

static const char *const IDS[] = {"runs.kitchen.salt",      "runs.kitchen.pepper",   "runs.kitchen.shaker",
                                  "runs.kitchen.lamp",      "runs.kitchen.brass_key", "runs.kitchen.iron_key",
                                  "runs.kitchen.box"};
#define COUNT 7

typedef struct pantry {
  bench b;
  parse_candidate candidates[COUNT];
  const sprout_role *take;
  parse_noun_context context;
} pantry;

static void open_pantry(pantry *p) {
  size_t i;
  bench_open(&p->b, "runs", "Marta");
  for (i = 0; i < COUNT; i++) p->candidates[i] = bench_candidate(&p->b, IDS[i], i);
  p->take = bench_role(&p->b, "sprout", "take", "target");
  p->context = bench_nouns(&p->b, NULL, 0);
}

/* The items of `line` in `role`, joined by `|`; "(none)" where they are no run. */
static const char *items(pantry *p, const char *line, const sprout_role *role, const parse_candidate *among,
                         size_t count) {
  parse_words words = bench_words(&p->b, line);
  parse_stretch found[64];
  size_t made, i;
  char *out = (char *)sprout_arena_take(p->b.frame.turn, 256);
  CHECK_INT(parse_items_of_run(&p->context, words, role, among, count, found, &made), SPROUT_EVAL_OK);
  if (made == 0) return "(none)";
  out[0] = '\0';
  for (i = 0; i < made; i++) {
    parse_words part;
    part.words = words.words + found[i].start;
    part.count = found[i].end - found[i].start;
    if (i > 0) strcat(out, "|");
    strcat(out, bench_joined(&p->b, part));
  }
  return out;
}

static void they_are_its_nouns_split_at_and_and_commas(void) {
  pantry p;
  open_pantry(&p);
  CHECK_STR(items(&p, "salt and lamp", p.take, p.candidates, COUNT), "salt|lamp");
  CHECK_STR(items(&p, "salt, lamp and box", p.take, p.candidates, COUNT), "salt|lamp|box");
  CHECK_STR(items(&p, "salt, lamp, and box", p.take, p.candidates, COUNT), "salt|lamp|box");
  CHECK_STR(items(&p, "the salt, the lamp", p.take, p.candidates, COUNT), "the salt|the lamp");
  bench_close(&p.b);
}

static void a_name_that_holds_and_is_read_whole_where_it_names_something_the_longest_first(void) {
  pantry p;
  open_pantry(&p);
  CHECK_STR(items(&p, "salt and pepper shaker", p.take, p.candidates, COUNT), "(none)");
  CHECK_STR(items(&p, "the salt and pepper shaker and the lamp", p.take, p.candidates, COUNT),
            "the salt and pepper shaker|the lamp");
  CHECK_STR(items(&p, "lamp and salt and pepper shaker", p.take, p.candidates, COUNT), "lamp|salt and pepper shaker");
  /* Adjectives alone name the shaker only weakly, so the run splits. */
  CHECK_STR(items(&p, "salt and pepper", p.take, p.candidates, COUNT), "salt|pepper");
  bench_close(&p.b);
}

static void they_are_no_more_than_a_set_role_may_bind_the_hosts_figure(void) {
  pantry p;
  open_pantry(&p);
  p.b.w.host.budgets.set_role_objects.value = 2;
  CHECK_STR(items(&p, "salt, pepper, lamp and box", p.take, p.candidates, COUNT), "salt|pepper");
  p.b.w.host.budgets.set_role_objects.value = 8;
  CHECK_STR(items(&p, "salt, pepper, lamp and box", p.take, p.candidates, COUNT), "salt|pepper|lamp|box");
  bench_close(&p.b);
}

static void all_is_no_thing_of_a_run_before_the_others_or_after(void) {
  pantry p;
  parse_stretch scratch[16];
  open_pantry(&p);
  CHECK(parse_holds_all(bench_words(&p.b, "lamp and all"), scratch));
  CHECK(parse_holds_all(bench_words(&p.b, "all, lamp"), scratch));
  CHECK(!parse_holds_all(bench_words(&p.b, "all"), scratch));
  CHECK(!parse_holds_all(bench_words(&p.b, "lamp and ball"), scratch));
  bench_close(&p.b);
}

static void no_stretch_is_tried_wider_than_a_name_in_reach_holds_connectors(void) {
  pantry p;
  parse_candidate plain[COUNT - 1];
  char line[512] = "";
  size_t i, at = 0;
  uint64_t before;
  open_pantry(&p);
  for (i = 0; i < COUNT; i++)
    if (i != 2) plain[at++] = p.candidates[i];
  for (i = 0; i < 40; i++) strcat(line, i == 0 ? "salt" : " and salt");
  before = p.b.run.meter->steps;
  CHECK_STR(items(&p, line, p.take, plain, COUNT - 1), "salt|salt|salt|salt|salt|salt|salt|salt");
  CHECK(p.b.run.meter->steps - before < 40 * (COUNT - 1) * 2);
  bench_close(&p.b);
}

static void there_are_none_for_one_noun_an_empty_noun_a_set_role_or_a_value_role(void) {
  pantry p;
  open_pantry(&p);
  CHECK_STR(items(&p, "lamp", p.take, p.candidates, COUNT), "(none)");
  CHECK_STR(items(&p, "lamp and", p.take, p.candidates, COUNT), "(none)");
  CHECK_STR(items(&p, "lamp, , box", p.take, p.candidates, COUNT), "(none)");
  CHECK_STR(items(&p, "salt and lamp", bench_role(&p.b, "runs", "juggle", "things"), p.candidates, COUNT), "(none)");
  CHECK_STR(items(&p, "bridge and toll", bench_role(&p.b, "sprout", "ask", "topic"), p.candidates, COUNT), "(none)");
  bench_close(&p.b);
}

static void a_stretch_names_something_outright_only_by_a_noun_or_its_whole_name(void) {
  pantry p;
  bool named;
  open_pantry(&p);
  CHECK_INT(parse_names_outright(&p.context, bench_words(&p.b, "the salt and pepper shaker"), p.candidates, COUNT, &named),
            SPROUT_EVAL_OK);
  CHECK(named);
  CHECK_INT(parse_names_outright(&p.context, bench_words(&p.b, "salt and pepper"), p.candidates, COUNT, &named),
            SPROUT_EVAL_OK);
  CHECK(!named);
  CHECK_INT(parse_names_outright(&p.context, bench_words(&p.b, "unicorn"), p.candidates, COUNT, &named), SPROUT_EVAL_OK);
  CHECK(!named);
  bench_close(&p.b);
}

int main(void) {
  RUN(they_are_its_nouns_split_at_and_and_commas);
  RUN(a_name_that_holds_and_is_read_whole_where_it_names_something_the_longest_first);
  RUN(they_are_no_more_than_a_set_role_may_bind_the_hosts_figure);
  RUN(all_is_no_thing_of_a_run_before_the_others_or_after);
  RUN(no_stretch_is_tried_wider_than_a_name_in_reach_holds_connectors);
  RUN(there_are_none_for_one_noun_an_empty_noun_a_set_role_or_a_value_role);
  RUN(a_stretch_names_something_outright_only_by_a_noun_or_its_whole_name);
  return REPORT();
}
