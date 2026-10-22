/*
 * Tests for src/parse/command.c: a typed line read as the command turn it begins reads it, under that turn's budget
 * and seed and writing nothing (the spec's Parsing > Matching a line, Choosing a reading, Pronouns, Synonyms, When
 * nothing matches; Verbs > Exits; The runtime > Turns), in the corpus worlds: the
 * study (`grammar`), `unknown-word`, `intents`, `pronouns`, `synonyms`, `all-leaves-out-refused`, `no-way`,
 * `out-of-reach-synonym`, `all-narrowed`, `drop-all-on` and `all-empty-handed`. A line reads to
 * the best of its readings, a tie drawn from the turn's stream; a line no reading reads is answered as answers.c
 * says; a line `and` splits, `again` and a turn a line handed are read as sequences are (their own cases are
 * parse_chain, parse_again, parse_planned, parse_item and parse_later's).
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

static void again_before_any_reading_is_unknown_and_after_one_runs_it(void) {
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
  CHECK_INT(parse(&p, "v-marta", "again", NULL), SPROUT_OK);
  CHECK_INT(p.out.end, SPROUT_PARSED_READING);
  CHECK_STR(p.out.reading.verb, "sprout.take");
  CHECK_STR(p.out.reading.fillings[0].id, "unknown_word.hall.ball");
  close_hall(&p);
}

static void a_line_splits_before_a_verb_and_a_turn_a_line_handed_reads_as_handed(void) {
  parsing p;
  sprout_reading planned;
  sprout_handed handed;
  open_hall(&p);
  CHECK_INT(parse(&p, "v-marta", "take ball and drop it", NULL), SPROUT_OK);
  CHECK_INT(p.out.end, SPROUT_PARSED_READING);
  CHECK_STR(p.out.reading.verb, "sprout.take");
  CHECK_INT(p.out.rest_count, 1);
  CHECK(p.out.rest[0].planned == NULL);
  CHECK_STR(p.out.rest[0].text, "drop it");
  memset(&planned, 0, sizeof planned);
  planned.verb = "sprout.look";
  planned.actor = tw_person(&p.w, "v-marta");
  handed.planned = &planned;
  handed.reread = NULL;
  CHECK_INT(parse(&p, "v-marta", "look and look", &handed), SPROUT_OK);
  CHECK_INT(p.out.end, SPROUT_PARSED_READING);
  CHECK_STR(p.out.reading.verb, "sprout.look");
  CHECK_INT(p.out.rest_count, 0);
  handed.planned = NULL;
  CHECK_INT(parse(&p, "v-marta", "look", &handed), SPROUT_BAD_INPUT);
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

/* The corpus world `name`, Marta arrived in it. */
static void open_world(parsing *p, const char *name) {
  sprout_outcome arrived;
  memset(p, 0, sizeof *p);
  tw_open(&p->w, name);
  tw_arrive(&p->w, "v-marta", "Marta", 1000, &arrived);
  sprout_outcome_free(&arrived);
  sprout_arena_init(&p->keep, &p->w.host);
}

/* Parses `line` as Marta under `seed`, which must read it. */
static void read_at(parsing *p, const char *line, uint64_t seed) {
  sprout_status status;
  p->w.seed = seed;
  status = sprout_parse(p->w.world, p->w.state, &p->w.host, "v-marta", line, strlen(line), NULL, &p->keep, &p->out);
  CHECK_INT(status, SPROUT_OK);
  if (status != SPROUT_OK) fprintf(stderr, "`%s`: %s\n", line, p->out.fault.text);
}

static void read_as(parsing *p, const char *line) { read_at(p, line, 7); }

/* What the reading binds `role` to, written out: an id, a set's ids joined, a value; "(unbound)" for none. */
static const char *bound_to(const parsing *p, const char *role) {
  static char text[512];
  size_t i, j;
  for (i = 0; i < p->out.reading.filling_count; i++) {
    const sprout_filling *one = &p->out.reading.fillings[i];
    if (strcmp(one->role, role) != 0) continue;
    text[0] = '\0';
    switch (one->binds) {
      case SPROUT_FILL_OBJECT:
        snprintf(text, sizeof text, "%s", one->id);
        break;
      case SPROUT_FILL_SET:
        for (j = 0; j < one->id_count; j++) {
          if (j > 0) strcat(text, " ");
          strcat(text, one->ids[j]);
        }
        break;
      case SPROUT_FILL_TEXT:
        snprintf(text, sizeof text, "%s", one->text);
        break;
      case SPROUT_FILL_NUMBER:
        snprintf(text, sizeof text, "%g", one->number);
        break;
      default:
        snprintf(text, sizeof text, "(%d)", (int)one->binds);
    }
    return text;
  }
  return "(unbound)";
}

/* Runs Marta's command `verb` on `target` (a full id), as a turn of its own. */
static void command(parsing *p, const char *verb, const char *target) {
  sprout_filling filling;
  sprout_reading reading = tw_reading(verb, tw_person(&p->w, "v-marta"), &filling, "target", target);
  sprout_outcome done;
  tw_command(&p->w, "v-marta", &reading, 1001, &done);
  sprout_outcome_free(&done);
}

static const char *aside_of(const parsing *p, const char *line) {
  size_t i;
  for (i = 0; i < p->out.aside_count; i++)
    if (strcmp(p->out.asides[i].line, line) == 0) return p->out.asides[i].thing;
  return NULL;
}

static void a_line_reads_as_a_standard_library_verb_the_article_and_a_determiner_optional(void) {
  static const char *const lines[] = {"take brass key", "take the brass key", "TAKE  My Brass Key",
                                      "pick up that brass key", "get a brass key"};
  parsing p;
  size_t i;
  open_world(&p, "grammar");
  for (i = 0; i < sizeof lines / sizeof *lines; i++) {
    read_as(&p, lines[i]);
    CHECK_INT(p.out.end, SPROUT_PARSED_READING);
    CHECK_STR(p.out.reading.verb, "sprout.take");
    CHECK_STR(p.out.reading.actor, tw_person(&p.w, "v-marta"));
    CHECK_INT(p.out.reading.filling_count, 1);
    CHECK_STR(bound_to(&p, "target"), "study.hall.brass_key");
    CHECK(!p.out.drawn);
    CHECK_INT(p.out.draw_count, 0);
    CHECK_INT(p.out.rest_count, 0);
    CHECK(p.out.steps > 0);
  }
  close_hall(&p);
}

static void the_engine_verbs_read_by_the_phrases_the_library_gives_them(void) {
  static const char *const verbs[][2] = {{"l", "sprout.look"},       {"look around", "sprout.look"},
                                         {"i", "sprout.inventory"},  {"z", "sprout.wait"},
                                         {"?", "sprout.help"},       {"x gong", "sprout.examine"},
                                         {"look at gong", "sprout.examine"}, {"inspect gong", "sprout.examine"}};
  parsing p;
  size_t i;
  open_world(&p, "grammar");
  for (i = 0; i < sizeof verbs / sizeof *verbs; i++) {
    read_as(&p, verbs[i][0]);
    CHECK_STR(p.out.reading.verb, verbs[i][1]);
  }
  CHECK_STR(bound_to(&p, "target"), "study.hall.gong");
  close_hall(&p);
}

static void a_role_fills_with_what_it_takes_and_a_value_only_where_it_is_heard(void) {
  parsing p;
  open_world(&p, "grammar");
  read_as(&p, "unlock door with iron key");
  CHECK_STR(p.out.reading.verb, "study.unlock");
  CHECK_STR(bound_to(&p, "target"), "study.hall.door");
  CHECK_STR(bound_to(&p, "tool"), "study.hall.iron_key");
  read_as(&p, "unlock door");
  CHECK_INT(p.out.reading.filling_count, 1);
  read_as(&p, "ask oskar about old press");
  CHECK_STR(bound_to(&p, "target"), "study.hall.guard");
  CHECK_STR(bound_to(&p, "topic"), "old_press");
  /* `ask [target] [topic]` reads it too, binding nothing, and ranks below: nothing is drawn. */
  CHECK(!p.out.drawn);
  read_as(&p, "ask oskar about toll");
  CHECK_STR(bound_to(&p, "topic"), "(unbound)");
  read_as(&p, "turn dial to 7");
  CHECK_INT(p.out.reading.fillings[1].binds, SPROUT_FILL_NUMBER);
  CHECK_STR(bound_to(&p, "number"), "7");
  read_as(&p, "juggle gong");
  CHECK_STR(bound_to(&p, "things"), "study.hall.gong");
  close_hall(&p);
}

static void a_thing_answers_to_its_name_its_nouns_and_its_whole_name_first(void) {
  static const char *const lines[][2] = {{"take shiny thing", "study.hall.brass_key"}, {"take gong", "study.hall.gong"},
                                         {"take disc", "study.hall.gong"},           {"take oil", "study.hall.lamp_oil"},
                                         {"take lamp oil", "study.hall.lamp_oil"},   {"take lamp", "study.hall.lamp"},
                                         {"x lamp oil", "study.hall.lamp_oil"}};
  parsing p;
  size_t i;
  open_world(&p, "grammar");
  for (i = 0; i < sizeof lines / sizeof *lines; i++) {
    read_as(&p, lines[i][0]);
    CHECK_STR(bound_to(&p, "target"), lines[i][1]);
    CHECK(!p.out.drawn);
  }
  close_hall(&p);
}

static void things_written_alike_are_drawn_from_the_seed_and_nothing_is_said_of_it(void) {
  parsing p;
  uint64_t seed;
  bool a = false, b = false;
  open_world(&p, "grammar");
  for (seed = 0; seed < 32; seed++) {
    char first[64];
    read_at(&p, "take pebble", seed);
    snprintf(first, sizeof first, "%s", bound_to(&p, "target"));
    CHECK(p.out.drawn);
    CHECK_INT(p.out.drawn_among, 2);
    CHECK(aside_of(&p, "meant") == NULL);
    /* The draw is the turn's first, below how many tied. */
    CHECK_INT(p.out.draw_count, 1);
    CHECK_INT(p.out.draws[0], 2);
    read_at(&p, "take pebble", seed);
    CHECK_STR(bound_to(&p, "target"), first);
    a = a || strcmp(first, "study.hall.pebble_a") == 0;
    b = b || strcmp(first, "study.hall.pebble_b") == 0;
  }
  CHECK(a && b);
  close_hall(&p);
}

static void things_that_differ_are_drawn_and_the_engines_meant_names_the_one_taken(void) {
  parsing p;
  uint64_t seed;
  open_world(&p, "grammar");
  for (seed = 0; seed < 16; seed++) {
    const char *meant;
    read_at(&p, "take key", seed);
    CHECK(p.out.drawn);
    CHECK_INT(p.out.drawn_among, 2);
    meant = aside_of(&p, "meant");
    CHECK(meant != NULL && strcmp(meant, bound_to(&p, "target")) == 0);
  }
  close_hall(&p);
}

static void a_reading_its_consent_pass_allows_is_taken_over_one_it_refuses(void) {
  parsing p;
  uint64_t seed;
  open_world(&p, "grammar");
  command(&p, "sprout.take", "study.hall.brass_key");
  for (seed = 0; seed < 16; seed++) {
    /* Taking the brass key is refused, for it is held; dropping the iron key, for it is not. */
    read_at(&p, "take key", seed);
    CHECK_STR(bound_to(&p, "target"), "study.hall.iron_key");
    CHECK(!p.out.drawn);
    read_at(&p, "drop key", seed);
    CHECK_STR(bound_to(&p, "target"), "study.hall.brass_key");
  }
  close_hall(&p);
}

static void all_reads_as_its_first_thing_and_each_after_it_is_a_reading_to_run(void) {
  parsing p;
  open_world(&p, "all-leaves-out-refused");
  read_as(&p, "examine all");
  CHECK_STR(p.out.reading.verb, "sprout.examine");
  CHECK_STR(bound_to(&p, "target"), "all_leaves_out_refused.hall.sack");
  /* The lamp refuses to be examined, and is left out. */
  CHECK_INT(p.out.rest_count, 2);
  CHECK(p.out.rest[0].planned != NULL && p.out.rest[0].reread == NULL);
  CHECK_STR(p.out.rest[0].planned->fillings[0].id, "all_leaves_out_refused.hall.ball");
  CHECK_STR(p.out.rest[1].planned->fillings[0].id, "all_leaves_out_refused.hall.sack.lunch");
  CHECK_STR(p.out.rest[1].planned->verb, "sprout.examine");
  close_hall(&p);
}

static void a_line_an_intents_phrase_reads_is_the_intent_its_slots_bound_by_name(void) {
  parsing p;
  open_world(&p, "intents");
  command(&p, "sprout.take", "intents.cellar.key");
  read_as(&p, "open strongbox with key");
  CHECK_INT(p.out.end, SPROUT_PARSED_INTENT);
  CHECK_STR(p.out.reading.verb, "sprout.open_with");
  CHECK_STR(bound_to(&p, "y"), "intents.cellar.strongbox");
  CHECK_STR(bound_to(&p, "x"), "intents.cellar.key");
  CHECK_INT(p.out.rest_count, 0);
  close_hall(&p);
}

static void a_pronoun_a_thing_declares_another_for_is_corrected_before_the_reading(void) {
  parsing p;
  open_world(&p, "pronouns");
  command(&p, "pronouns.pet", "pronouns.cellar.cat");
  read_as(&p, "pet it");
  CHECK_STR(bound_to(&p, "target"), "pronouns.cellar.cat");
  CHECK_INT(p.out.aside_count, 1);
  CHECK_STR(p.out.asides[0].line, "pronoun_correction");
  CHECK_STR(p.out.asides[0].thing, "pronouns.cellar.cat");
  CHECK_STR(p.out.asides[0].pronoun, "she");
  /* Not where the pronoun agrees, nor where the thing was named. */
  read_as(&p, "pet her");
  CHECK_INT(p.out.aside_count, 0);
  read_as(&p, "pet cat");
  CHECK_INT(p.out.aside_count, 0);
  close_hall(&p);
}

static void an_objects_synonym_reads_only_where_the_object_takes_part(void) {
  parsing p;
  open_world(&p, "synonyms");
  read_as(&p, "force cabinet");
  CHECK_STR(p.out.reading.verb, "sprout.open");
  read_as(&p, "force chest");
  CHECK_INT(p.out.end, SPROUT_PARSED_ANSWERED);
  CHECK_STR(p.out.line, "unknown");
  close_hall(&p);
}

/* Whether the line was answered with the engine's line `name`, its words, or a place's passage of that name. */
static void answered(const parsing *p, const char *name) {
  CHECK_INT(p->out.end, SPROUT_PARSED_ANSWERED);
  if (p->out.end != SPROUT_PARSED_ANSWERED) return;
  CHECK_STR(p->out.answer, name);
}

static void a_noun_naming_nothing_in_reach_is_not_here_whatever_its_words_and_a_line_no_verb_reads_is_unknown(void) {
  parsing p;
  open_world(&p, "unknown-word");
  /* Nothing in the world is called jewels, nor ball again; the gong is in the cellar. */
  read_as(&p, "take jewels");
  answered(&p, "not_here");
  CHECK_INT(p.out.binding_count, 2);
  read_as(&p, "take ball again");
  answered(&p, "not_here");
  read_as(&p, "examine through the ball");
  answered(&p, "not_here");
  read_as(&p, "take gong");
  answered(&p, "not_here");
  read_as(&p, "take the ball in the box");
  answered(&p, "not_here");
  read_as(&p, "xyzzy jewels");
  answered(&p, "unknown");
  close_hall(&p);
}

static void a_narrowed_all_that_leaves_nothing_is_not_here_before_another_phrase_read_in_part(void) {
  parsing p;
  open_world(&p, "all-narrowed");
  /* `take [target] from [source]` reads it in part, the lamp no container; the lamp holds nothing. */
  read_as(&p, "take all from the lamp");
  answered(&p, "not_here");
  read_as(&p, "take all cakes in the sack");
  answered(&p, "not_here");
  /* Where something is left, it reads. */
  read_as(&p, "take all from the table");
  CHECK_INT(p.out.end, SPROUT_PARSED_READING);
  CHECK_STR(bound_to(&p, "target"), "all_narrowed.tea_room.table.orange_cake");
  close_hall(&p);
}

static void drop_all_on_a_thing_puts_what_is_held_there_and_is_never_narrowed_to_what_it_holds(void) {
  parsing p;
  open_world(&p, "drop-all-on");
  command(&p, "sprout.take", "drop_all_on.tea_room.orange_cake");
  command(&p, "sprout.take", "drop_all_on.tea_room.red_cake");
  /* The table is a container: `drop [item] on [surface]` reads it, the first cake held its first turn. */
  read_as(&p, "drop all on the table");
  CHECK_INT(p.out.end, SPROUT_PARSED_READING);
  CHECK_STR(p.out.reading.verb, "sprout.put_on");
  CHECK_STR(bound_to(&p, "item"), "drop_all_on.tea_room.orange_cake");
  CHECK_STR(bound_to(&p, "surface"), "drop_all_on.tea_room.table");
  read_as(&p, "put all on the table");
  CHECK_INT(p.out.end, SPROUT_PARSED_READING);
  CHECK_STR(bound_to(&p, "surface"), "drop_all_on.tea_room.table");
  /* No phrase that begins `drop` reads `in`, and `in` is no holder in drop's target. */
  read_as(&p, "drop all in the sack");
  answered(&p, "unknown");
  close_hall(&p);
  open_world(&p, "all-narrowed");
  command(&p, "sprout.take", "all_narrowed.tea_room.blue_cake");
  /* The table only `contains`: the phrase reads it in part, rather than `all` narrowed to nothing held there. */
  read_as(&p, "drop all on the table");
  answered(&p, "cannot");
  /* `take` places nothing, so `on` there still says what holds the things. */
  read_as(&p, "take all on the table");
  CHECK_INT(p.out.end, SPROUT_PARSED_READING);
  CHECK_STR(bound_to(&p, "target"), "all_narrowed.tea_room.table.orange_cake");
  close_hall(&p);
}

static void all_with_empty_hands_in_a_role_whose_things_are_carried_is_empty_handed(void) {
  parsing p;
  open_world(&p, "all-empty-handed");
  /* `drop`'s target and `put`'s and `put_on`'s item are moved away by the actor's own `do`; `juggle`'s is carried. */
  read_as(&p, "drop all");
  answered(&p, "empty_handed");
  CHECK_INT(p.out.binding_count, 2);
  read_as(&p, "drop all cakes");
  answered(&p, "empty_handed");
  read_as(&p, "put all in the table");
  answered(&p, "empty_handed");
  read_as(&p, "drop all on the table");
  answered(&p, "empty_handed");
  read_as(&p, "juggle all");
  answered(&p, "empty_handed");
  /* A noun after `all` that names nothing is answered as any noun is. */
  read_as(&p, "drop all wombats");
  answered(&p, "not_here");
  /* `take` brings things to the actor: nothing left to take is not here, whatever the hands hold. */
  command(&p, "sprout.take", "all_empty_handed.tea_room.orange_cake");
  command(&p, "sprout.take", "all_empty_handed.tea_room.red_cake");
  read_as(&p, "take all except the table");
  answered(&p, "not_here");
  read_as(&p, "drop all");
  CHECK_INT(p.out.end, SPROUT_PARSED_READING);
  CHECK_STR(bound_to(&p, "target"), "all_empty_handed.tea_room.orange_cake");
  close_hall(&p);
  /* The table only `contains`, so `drop [item] on [surface]` does not read the line whole: its part answers. */
  open_world(&p, "all-narrowed");
  read_as(&p, "drop all on the table");
  answered(&p, "cannot");
  read_as(&p, "drop all");
  answered(&p, "empty_handed");
  close_hall(&p);
}

static void a_noun_after_all_naming_nothing_in_reach_is_not_here_as_any_noun_is(void) {
  parsing p;
  open_world(&p, "unknown-word");
  /* The gong is in the cellar, and nothing is called a zebra. */
  read_as(&p, "take all gongs");
  answered(&p, "not_here");
  read_as(&p, "take all zebras");
  answered(&p, "not_here");
  close_hall(&p);
}

static void a_way_that_does_not_go_is_answered_by_the_exit_or_the_worlds_no_way(void) {
  parsing p;
  open_world(&p, "no-way");
  read_as(&p, "north");
  answered(&p, "refused");
  CHECK_STR(p.out.words, "The brambles are too thick.");
  CHECK_BYTES(p.out.by.bytes, p.out.by.length, "no_way.clearing");
  CHECK_INT(p.out.binding_count, 2);
  read_as(&p, "east");
  answered(&p, "refused");
  CHECK_STR(p.out.line, "boarded");
  CHECK(p.out.words == NULL && !p.out.absent);
  CHECK_BYTES(p.out.by.bytes, p.out.by.length, "no_way.clearing");
  read_as(&p, "down");
  answered(&p, "no_way");
  CHECK_STR(p.out.line, "no_way");
  CHECK_INT(p.out.binding_count, 3);
  if (p.out.binding_count == 3) {
    CHECK_STR(p.out.bindings[2].name, "way");
    CHECK(!p.out.bindings[2].object);
    CHECK_BYTES(p.out.bindings[2].text.bytes, p.out.bindings[2].text.length, "down");
  }
  /* A direction abbreviated is written out. */
  read_as(&p, "go d");
  CHECK_BYTES(p.out.bindings[2].text.bytes, p.out.bindings[2].text.length, "down");
  read_as(&p, "go yonder");
  answered(&p, "unknown");
  close_hall(&p);
}

static void an_objects_synonym_out_of_reach_is_not_here_where_its_noun_names_the_object(void) {
  parsing p;
  open_world(&p, "out-of-reach-synonym");
  read_as(&p, "enter window");
  answered(&p, "not_here");
  read_as(&p, "enter door");
  answered(&p, "unknown");
  close_hall(&p);
}

int main(void) {
  RUN(a_noun_naming_nothing_in_reach_is_not_here_whatever_its_words_and_a_line_no_verb_reads_is_unknown);
  RUN(a_way_that_does_not_go_is_answered_by_the_exit_or_the_worlds_no_way);
  RUN(a_narrowed_all_that_leaves_nothing_is_not_here_before_another_phrase_read_in_part);
  RUN(a_noun_after_all_naming_nothing_in_reach_is_not_here_as_any_noun_is);
  RUN(all_with_empty_hands_in_a_role_whose_things_are_carried_is_empty_handed);
  RUN(drop_all_on_a_thing_puts_what_is_held_there_and_is_never_narrowed_to_what_it_holds);
  RUN(an_objects_synonym_out_of_reach_is_not_here_where_its_noun_names_the_object);
  RUN(a_line_reads_as_a_standard_library_verb_the_article_and_a_determiner_optional);
  RUN(the_engine_verbs_read_by_the_phrases_the_library_gives_them);
  RUN(a_role_fills_with_what_it_takes_and_a_value_only_where_it_is_heard);
  RUN(a_thing_answers_to_its_name_its_nouns_and_its_whole_name_first);
  RUN(things_written_alike_are_drawn_from_the_seed_and_nothing_is_said_of_it);
  RUN(things_that_differ_are_drawn_and_the_engines_meant_names_the_one_taken);
  RUN(a_reading_its_consent_pass_allows_is_taken_over_one_it_refuses);
  RUN(all_reads_as_its_first_thing_and_each_after_it_is_a_reading_to_run);
  RUN(a_line_an_intents_phrase_reads_is_the_intent_its_slots_bound_by_name);
  RUN(a_pronoun_a_thing_declares_another_for_is_corrected_before_the_reading);
  RUN(an_objects_synonym_reads_only_where_the_object_takes_part);
  RUN(a_line_of_no_words_is_unknown_and_spends_only_the_ways_out);
  RUN(again_before_any_reading_is_unknown_and_after_one_runs_it);
  RUN(a_line_splits_before_a_verb_and_a_turn_a_line_handed_reads_as_handed);
  RUN(words_that_name_no_way_out_are_unknown_and_a_way_written_elsewhere_is_not_here);
  RUN(a_visit_that_cannot_type_is_refused_in_words);
  RUN(a_trailing_question_mark_is_read_as_nothing_but_alone_it_is_kept);
  RUN(a_parse_that_spends_its_budget_faults_as_its_turn_would);
  RUN(a_parse_draws_from_the_hosts_seed_and_writes_nothing);
  return REPORT();
}

#endif
