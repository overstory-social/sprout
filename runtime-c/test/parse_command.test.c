/*
 * Tests for src/parse/command.c: a typed line read as the command turn it begins reads it, under that turn's
 * budget and seed and writing nothing (the spec's Parsing > When nothing matches; Verbs > Exits; The runtime >
 * Turns). A line of no words, `again` before any reading, and words no placement reads are `unknown`, said to the
 * actor where they stand, and a way out written elsewhere is `not_here`; what this runtime does not read yet is
 * refused in words, never answered wrongly. The harness (`sproutc parse`) holds
 * every answer to the TypeScript parser's, steps included.
 */
#include "turn_fixture.h"

#include "parse/parse.h"

static void a_trailing_question_mark_is_read_as_nothing_but_alone_it_is_kept(void) {
  struct {
    const char *line, *read;
  } cases[] = {{"what is in the box?", "what is in the box"},
               {"x ?  ", "x "},
               {"?", "?"},
               {"  ?  ", "  ?  "},
               {"look", "look"},
               {"", ""}};
  size_t i;
  for (i = 0; i < sizeof cases / sizeof cases[0]; i++) {
    sprout_str read = parse_without_question((sprout_str){cases[i].line, strlen(cases[i].line)});
    CHECK_BYTES(read.bytes, read.length, cases[i].read);
  }
}

#ifdef SPROUT_NO_PARSER

static void a_runtime_built_without_the_parser_refuses_every_line(void) {
  sprout_parsed out;
  sprout_arena keep;
  memset(&keep, 0, sizeof keep);
  CHECK_INT(sprout_parse(NULL, NULL, NULL, "v-marta", "look", 4, NULL, &keep, &out), SPROUT_BAD_INPUT);
  CHECK_STR(out.fault.text, "this runtime was built without the parser, so it reads no typed line.");
}

int main(void) {
  RUN(a_runtime_built_without_the_parser_refuses_every_line);
  RUN(a_trailing_question_mark_is_read_as_nothing_but_alone_it_is_kept);
  return REPORT();
}

#else

/* The fixture's world first, so the host's context is the world's too. */
typedef struct parsing {
  turn_world w;
  sprout_arena keep;
  sprout_parsed out;
  size_t seeds; /* how many times the parse asked the host for its seed */
} parsing;

static uint64_t counted_seed(void *ctx) {
  parsing *p = (parsing *)ctx;
  p->seeds++;
  return p->w.seed;
}

/* The unknown-word world, with Marta standing in its hall, and the host's seed counted. */
static void open_hall(parsing *p) {
  sprout_outcome arrived;
  memset(p, 0, sizeof *p);
  tw_open(&p->w, "unknown-word");
  tw_arrive(&p->w, "v-marta", "Marta", 1000, &arrived);
  sprout_outcome_free(&arrived);
  sprout_arena_init(&p->keep, &p->w.host);
}

static void close_hall(parsing *p) {
  sprout_arena_reset(&p->keep);
  tw_close(&p->w);
}

/* Parses `line` as `visit`, under seed 7. */
static sprout_status parse(parsing *p, const char *visit, const char *line, const sprout_handed *handed) {
  p->w.seed = 7;
  return sprout_parse(p->w.world, p->w.state, &p->w.host, visit, line, strlen(line), handed, &p->keep, &p->out);
}

/* Whether the outcome is the engine's `unknown`, said to Marta in the hall with `actor` and `here` bound. */
static void is_unknown(parsing *p) {
  const sprout_parsed *out = &p->out;
  CHECK_INT(out->end, SPROUT_PARSED_ANSWERED);
  CHECK_STR(out->line, "unknown");
  CHECK_INT(out->binding_count, 2);
  if (out->binding_count != 2) return;
  CHECK_STR(out->bindings[0].name, "actor");
  CHECK(out->bindings[0].object);
  CHECK_BYTES(out->bindings[0].text.bytes, out->bindings[0].text.length, tw_person(&p->w, "v-marta"));
  CHECK_STR(out->bindings[1].name, "here");
  CHECK_BYTES(out->bindings[1].text.bytes, out->bindings[1].text.length, "unknown_word.hall");
  CHECK_INT(out->draw_count, 0);
}

static void a_line_of_no_words_is_unknown_and_spends_only_the_ways_out(void) {
  parsing p;
  uint64_t blank;
  open_hall(&p);
  CHECK_INT(parse(&p, "v-marta", "   ", NULL), SPROUT_OK);
  is_unknown(&p);
  /* The hall's one way out, asked whether it applies. */
  CHECK_INT(p.out.steps, 1);
  blank = p.out.steps;
  CHECK_INT(parse(&p, "v-marta", "again", NULL), SPROUT_OK);
  is_unknown(&p);
  /* With words, what Marta can reach is walked too, one step for each thing. */
  CHECK(p.out.steps > blank);
  close_hall(&p);
}

static void again_before_any_reading_is_unknown_and_after_one_is_not_read_yet(void) {
  parsing p;
  sprout_outcome taken;
  sprout_filling filling;
  sprout_reading reading;
  open_hall(&p);
  CHECK_INT(parse(&p, "v-marta", "g", NULL), SPROUT_OK);
  is_unknown(&p);
  reading = tw_reading("sprout.take", tw_person(&p.w, "v-marta"), &filling, "target", "unknown_word.hall.ball");
  tw_command(&p.w, "v-marta", &reading, 1001, &taken);
  sprout_outcome_free(&taken);
  CHECK_INT(parse(&p, "v-marta", "again", NULL), SPROUT_BAD_INPUT);
  CHECK(strstr(p.out.fault.text, "`again` after a reading") != NULL);
  close_hall(&p);
}

static void what_this_runtime_does_not_read_yet_is_refused_in_words(void) {
  parsing p;
  sprout_reading planned;
  sprout_handed handed;
  open_hall(&p);
  CHECK_INT(parse(&p, "v-marta", "take ball", NULL), SPROUT_BAD_INPUT);
  CHECK(strstr(p.out.fault.text, "a line a phrase reads") != NULL);
  /* A noun naming nothing in reach is `not_here` or `unknown` by the world's words, which this runtime does not read yet. */
  CHECK_INT(parse(&p, "v-marta", "take unicorn", NULL), SPROUT_BAD_INPUT);
  CHECK(strstr(p.out.fault.text, "a noun that names nothing in reach") != NULL);
  CHECK_INT(parse(&p, "v-marta", "take ball and drop it", NULL), SPROUT_BAD_INPUT);
  CHECK(strstr(p.out.fault.text, "`and` or a comma") != NULL);
  memset(&planned, 0, sizeof planned);
  planned.verb = "sprout.look";
  planned.actor = tw_person(&p.w, "v-marta");
  handed.planned = &planned;
  handed.reread = NULL;
  CHECK_INT(parse(&p, "v-marta", "look", &handed), SPROUT_BAD_INPUT);
  CHECK(strstr(p.out.fault.text, "a turn a line handed") != NULL);
  close_hall(&p);
}

static void words_that_name_no_way_out_are_unknown_and_a_way_written_elsewhere_is_not_here(void) {
  parsing p;
  sprout_outcome arrived;
  open_hall(&p);
  /* The library's `go` places any words at all, as a way out to try; these are none, and no other phrase reads them. */
  CHECK_INT(parse(&p, "v-marta", "xyzzy", NULL), SPROUT_OK);
  is_unknown(&p);
  CHECK_INT(parse(&p, "v-marta", "go plugh", NULL), SPROUT_OK);
  is_unknown(&p);
  close_hall(&p);
  memset(&p, 0, sizeof p);
  tw_open(&p.w, "out-of-reach-exit");
  tw_arrive(&p.w, "v-marta", "Marta", 1000, &arrived);
  sprout_outcome_free(&arrived);
  sprout_arena_init(&p.keep, &p.w.host);
  /* Only the yard has a window. */
  CHECK_INT(parse(&p, "v-marta", "enter window", NULL), SPROUT_OK);
  CHECK_INT(p.out.end, SPROUT_PARSED_ANSWERED);
  CHECK_STR(p.out.line, "not_here");
  close_hall(&p);
}

static void a_visit_that_cannot_type_is_refused_in_words(void) {
  parsing p;
  open_hall(&p);
  CHECK_INT(parse(&p, "v-nobody", "look", NULL), SPROUT_BAD_INPUT);
  CHECK_STR(p.out.fault.text, "`v-nobody` has never visited this world.");
  close_hall(&p);
}

static void a_parse_that_spends_its_budget_faults_as_its_turn_would(void) {
  parsing p;
  open_hall(&p);
  p.w.host.budgets.steps = (sprout_limit){true, 1};
  CHECK_INT(parse(&p, "v-marta", "again", NULL), SPROUT_OK);
  CHECK_INT(p.out.end, SPROUT_PARSED_FAULTED);
  CHECK_STR(p.out.fault_name, "BudgetExhausted");
  CHECK_STR(p.out.fault.budget, "steps");
  CHECK_INT(p.out.steps, 2);
  close_hall(&p);
}

static void a_parse_draws_from_the_hosts_seed_and_writes_nothing(void) {
  parsing p;
  char *before, *after;
  open_hall(&p);
  p.w.host.seed = counted_seed;
  before = tw_bytes(&p.w);
  CHECK_INT(parse(&p, "v-marta", "again", NULL), SPROUT_OK);
  CHECK_INT(p.seeds, 1);
  after = tw_bytes(&p.w);
  CHECK_STR(after, before);
  free(before);
  free(after);
  p.w.host.seed = tw_seed;
  close_hall(&p);
}

int main(void) {
  RUN(a_line_of_no_words_is_unknown_and_spends_only_the_ways_out);
  RUN(again_before_any_reading_is_unknown_and_after_one_is_not_read_yet);
  RUN(what_this_runtime_does_not_read_yet_is_refused_in_words);
  RUN(words_that_name_no_way_out_are_unknown_and_a_way_written_elsewhere_is_not_here);
  RUN(a_visit_that_cannot_type_is_refused_in_words);
  RUN(a_trailing_question_mark_is_read_as_nothing_but_alone_it_is_kept);
  RUN(a_parse_that_spends_its_budget_faults_as_its_turn_would);
  RUN(a_parse_draws_from_the_hosts_seed_and_writes_nothing);
  return REPORT();
}

#endif
