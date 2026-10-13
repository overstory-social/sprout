/*
 * Tests for src/parse/chain.c: `and` or a comma between two commands (the spec's Parsing > Sequences, again and all),
 * read in the corpus world `grammar`, the study the TypeScript specs are written about. `chain.spec.ts`'s cases,
 * ported: which words begin a command, where a line may split, and, through `sprout_parse`, every turn a line runs.
 * The study here has no way out, so where a TypeScript case goes north, these look.
 */
#include "parse_fixture.h"

static bool begins(bench *b, const char *word) { return parse_begins_command(b->w.world, bench_str(word)); }

static void a_word_begins_a_command_where_a_phrase_begins_with_it_or_with_a_way_out(void) {
  bench b;
  bench_open(&b, "grammar", "Marta");
  CHECK(begins(&b, "take"));
  CHECK(begins(&b, "pick"));
  CHECK(begins(&b, "look"));
  CHECK(!begins(&b, "lamp"));
  CHECK(begins(&b, "up"));
  /* A direction, written out or abbreviated, where a phrase begins with a way out. */
  CHECK(begins(&b, "north"));
  CHECK(begins(&b, "n"));
  CHECK(begins(&b, "sw"));
  bench_close(&b);
}

/* Where `line` may split, as the indices joined by commas. */
static const char *points(bench *b, const char *line) {
  static char text[128];
  parse_words words = bench_words(b, line);
  size_t at[32], count = parse_chain_points(b->w.world, words, at), i;
  text[0] = '\0';
  for (i = 0; i < count; i++) snprintf(text + strlen(text), sizeof text - strlen(text), "%s%zu", i > 0 ? "," : "", at[i]);
  return text;
}

static void a_line_may_split_at_a_comma_or_and_with_a_command_before_it_and_a_verb_after_it(void) {
  bench b;
  parse_words words;
  bench_open(&b, "grammar", "Marta");
  CHECK_STR(points(&b, "take lamp, take gong"), "2");
  CHECK_STR(points(&b, "take lamp, look, n"), "2,4");
  CHECK_STR(points(&b, "take lamp, gong and brass key"), "");
  /* The `and` alone where a comma stands before it, every comma just before it going with it. */
  CHECK_STR(points(&b, "take lamp, and take gong"), "3");
  CHECK_STR(points(&b, "take lamp, , take gong"), "3");
  words = bench_words(&b, "take lamp, , take gong");
  CHECK_STR(bench_joined(&b, parse_command_before(words, 3)), "take lamp");
  CHECK_STR(parse_command_after(b.frame.turn, words, 3), "take gong");
  CHECK_STR(points(&b, ", take lamp"), "");
  words = bench_words(&b, "take lamp, turn dial, look");
  CHECK_STR(bench_joined(&b, parse_stretch_after(words, 2)), "turn dial");
  CHECK_STR(points(&b, "take lamp and take gong"), "2");
  CHECK_STR(points(&b, "take lamp and look and take gong"), "2,4");
  CHECK_STR(points(&b, "take lamp and n"), "2");
  /* Nowhere a run of things stands, nor at either end of the line. */
  CHECK_STR(points(&b, "take lamp and gong"), "");
  CHECK_STR(points(&b, "and take lamp"), "");
  CHECK_STR(points(&b, ", and take lamp"), "");
  CHECK_STR(points(&b, "take lamp and"), "");
  words = bench_words(&b, "take lamp, and take gong");
  CHECK_STR(bench_joined(&b, parse_command_before(words, 3)), "take lamp");
  CHECK_STR(parse_command_after(b.frame.turn, words, 3), "take gong");
  CHECK_STR(bench_joined(&b, parse_command_before(bench_words(&b, "take lamp and look"), 2)), "take lamp");
  words = bench_words(&b, "take lamp and light bulb, and take gong");
  CHECK_STR(bench_joined(&b, parse_stretch_after(words, 2)), "light bulb");
  CHECK_STR(bench_joined(&b, parse_stretch_after(bench_words(&b, "take lamp and look"), 2)), "look");
  bench_close(&b);
}

static void put_text(char *out, size_t size, const char *text) { strncat(out, text, size - strlen(out) - 1); }

/*
 * Every turn `line` runs, appended to `out` one to a line: each reading written short, `afresh <words>` for an item
 * read on its own turn, or the answer that stops the line; a command `and` or a comma joined is read in turn from its
 * own words.
 */
static void turns_of(bench *b, sprout_arena *keep, const char *line, char *out, size_t size) {
  sprout_parsed parsed;
  size_t i;
  CHECK_INT(bench_parse(b, keep, line, 7, NULL, &parsed), SPROUT_OK);
  if (parsed.end == SPROUT_PARSED_ANSWERED) {
    put_text(out, size, "answer ");
    put_text(out, size, parsed.answer);
    put_text(out, size, "\n");
    return;
  }
  if (parsed.end != SPROUT_PARSED_READING) {
    put_text(out, size, "(not a verb's reading)\n");
    return;
  }
  bench_shown(&parsed.reading, out, size);
  put_text(out, size, "\n");
  for (i = 0; i < parsed.rest_count; i++) {
    const sprout_following *next = &parsed.rest[i];
    if (next->planned == NULL) {
      turns_of(b, keep, next->text, out, size);
    } else if (next->reread == NULL) {
      bench_shown(next->planned, out, size);
      put_text(out, size, "\n");
    } else {
      put_text(out, size, "afresh ");
      put_text(out, size, next->reread->words);
      put_text(out, size, "\n");
    }
  }
}

typedef struct joined {
  bench b;
  sprout_arena keep;
} joined;

static const char *turns(joined *j, const char *line, char *out, size_t size) {
  out[0] = '\0';
  turns_of(&j->b, &j->keep, line, out, size);
  return out;
}

static void open_joined(joined *j) {
  bench_open(&j->b, "grammar", "Marta");
  sprout_arena_init(&j->keep, &j->b.w.host);
}

static void close_joined(joined *j) {
  sprout_arena_reset(&j->keep);
  bench_close(&j->b);
}

static size_t lines_in(const char *text) {
  size_t n = 0;
  for (; *text != '\0'; text++) n += *text == '\n';
  return n;
}

static void a_line_of_commands_joined_by_commas_runs_each_as_a_turn_of_its_own(void) {
  joined j;
  char a[2048], c[2048];
  open_joined(&j);
  CHECK_STR(turns(&j, "take lamp, examine gong, look", a, sizeof a), "take target=lamp\nexamine target=gong\nlook\n");
  /* A run of things stays whole, a comma before a name and not a verb. */
  turns(&j, "take lamp and gong and brass key", c, sizeof c);
  CHECK_STR(turns(&j, "take lamp, gong and brass key", a, sizeof a), c);
  CHECK_INT(lines_in(a), 3);
  turns(&j, "take lamp and gong", c, sizeof c);
  strcat(c, "look\n");
  CHECK_STR(turns(&j, "take lamp, gong, look", a, sizeof a), c);
  /* Read whole where a reading takes it whole, as `and` before a verb is. */
  turns(&j, "juggle lamp and gong", c, sizeof c);
  CHECK_STR(turns(&j, "juggle lamp, gong", a, sizeof a), c);
  /* It stops at a command no phrase reads; a line opening with a person and a comma has no addressee. */
  CHECK_STR(turns(&j, "dance, take lamp", a, sizeof a), "answer unknown\n");
  CHECK_STR(turns(&j, "oskar, take lamp", a, sizeof a), "answer unknown\n");
  CHECK_STR(turns(&j, "oskar, look", a, sizeof a), "answer unknown\n");
  close_joined(&j);
}

static uint64_t next(uint64_t *state, uint64_t below) {
  *state = *state * 6364136223846793005u + 1442695040888963407u;
  return (*state >> 33) % below;
}

static void commands_joined_by_commas_and_and_run_the_turns_each_runs_alone_generated(void) {
  static const char *const COMMANDS[] = {"take lamp",
                                         "examine the brass disc",
                                         "look",
                                         "take iron key and gong",
                                         "take brass key, lamp and gong",
                                         "juggle lamp and gong",
                                         "unlock door with iron key"};
  static const char *const JOINS[] = {", ", " and ", ", and "};
  joined j;
  uint64_t state = 459;
  size_t run;
  open_joined(&j);
  for (run = 0; run < 150; run++) {
    char line[512], whole[4096], each[4096], one[2048];
    size_t count = 2 + (size_t)next(&state, 3), k;
    line[0] = '\0';
    each[0] = '\0';
    for (k = 0; k < count; k++) {
      const char *command = COMMANDS[next(&state, sizeof COMMANDS / sizeof *COMMANDS)];
      if (k > 0) strcat(line, JOINS[next(&state, 3)]);
      strcat(line, command);
      strcat(each, turns(&j, command, one, sizeof one));
    }
    turns(&j, line, whole, sizeof whole);
    CHECK_STR(whole, each);
    if (strcmp(whole, each) != 0) fprintf(stderr, "`%s`\n", line);
    sprout_arena_reset(&j.keep);
  }
  close_joined(&j);
}

int main(void) {
  RUN(a_word_begins_a_command_where_a_phrase_begins_with_it_or_with_a_way_out);
  RUN(a_line_may_split_at_a_comma_or_and_with_a_command_before_it_and_a_verb_after_it);
  RUN(a_line_of_commands_joined_by_commas_runs_each_as_a_turn_of_its_own);
  RUN(commands_joined_by_commas_and_and_run_the_turns_each_runs_alone_generated);
  return REPORT();
}
