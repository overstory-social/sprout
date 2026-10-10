/*
 * Tests for host/evaluate.c: `sproutc eval` evaluates the expression an
 * entry of the bench cartridge holds, as the body of an object, against a
 * stored world, and prints the canonical form of the result and the steps it
 * took; a fault is printed with its words and exits 1; a command line it
 * cannot follow exits 2 with words for what is wrong.
 */
#include <stdio.h>

#include "check.h"
#include "corpus.h"
#include "json.h"
#include "play.h"

typedef struct run {
  int code;
  char out[2048];
  char err[2048];
} run;

static char *golden_path(const char *name) {
  static char paths[4][1024];
  static int next = 0;
  char *path = paths[next++ % 4];
  snprintf(path, 1024, "%s/%s", SPROUT_GOLDENS, name);
  return path;
}

/* Reads a tmpfile back into a buffer. */
static void drain(FILE *file, char *into, size_t size) {
  size_t n;
  fflush(file);
  rewind(file);
  n = fread(into, 1, size - 1, file);
  into[n] = '\0';
  fclose(file);
}

static run sproutc(int argc, char **argv) {
  run r;
  FILE *out = tmpfile(), *err = tmpfile();
  r.code = sproutc_main(argc, argv, out, err);
  drain(out, r.out, sizeof r.out);
  drain(err, r.err, sizeof r.err);
  return r;
}

/* Writes the golden's stored world of this name to a file and returns its path. */
static const char *state_file(const sprout_json *golden, const char *name) {
  static char path[64];
  const sprout_json *states = sprout_json_get(golden, "states");
  const sprout_json *stored = sprout_json_get(states, name);
  FILE *file;
  snprintf(path, sizeof path, "evaluate-host-%s.json", name);
  file = fopen(path, "wb");
  fwrite(stored->bytes, 1, stored->length, file);
  fclose(file);
  return path;
}

typedef struct world {
  test_heap heap;
  sprout_host host;
  sprout_arena arena;
  const sprout_json *golden;
} world;

static void open_world(world *w) {
  size_t length;
  char *text = test_golden("eval.json", &length);
  sprout_json *root = NULL;
  sprout_json_error error;
  w->host = corpus_host(&w->heap);
  sprout_arena_init(&w->arena, &w->host);
  CHECK_INT(sprout_json_read(&w->arena, text, length, &root, &error), SPROUT_OK);
  free(text);
  w->golden = root;
}

static const sprout_json *golden_case(const world *w, const char *name) {
  const sprout_json *cases = sprout_json_get(w->golden, "cases");
  size_t i;
  for (i = 0; i < cases->count; i++)
    if (strcmp(sprout_json_get(cases->items[i], "name")->bytes, name) == 0) return cases->items[i];
  fprintf(stderr, "no case %s\n", name);
  exit(2);
}

static void a_value_is_printed_with_the_steps_it_took(void) {
  world w;
  run r;
  char node[16], expected[256];
  const sprout_json *one;
  char *argv[10];
  open_world(&w);
  one = golden_case(&w, "get reads the property");
  snprintf(node, sizeof node, "%.0f", sprout_json_get(one, "node")->number);
  argv[0] = "eval";
  argv[1] = golden_path("eval.sproutworld");
  argv[2] = "--state";
  argv[3] = (char *)state_file(w.golden, "fresh");
  argv[4] = "--node";
  argv[5] = node;
  argv[6] = "--self";
  argv[7] = (char *)sprout_json_get(one, "self")->bytes;
  r = sproutc(8, argv);
  snprintf(expected, sizeof expected, "{\"value\":3}\nsteps %.0f\n", sprout_json_get(one, "steps")->number);
  CHECK_INT(r.code, 0);
  CHECK_STR(r.out, expected);
  CHECK_STR(r.err, "");
}

static void bound_names_and_a_seed_reach_the_expression(void) {
  world w;
  run r;
  char node[16];
  const sprout_json *one;
  char *argv[14];
  open_world(&w);
  one = golden_case(&w, "recall reads what was written");
  snprintf(node, sizeof node, "%.0f", sprout_json_get(one, "node")->number);
  argv[0] = "eval";
  argv[1] = golden_path("eval.sproutworld");
  argv[2] = "--state";
  argv[3] = (char *)state_file(w.golden, "worn");
  argv[4] = "--node";
  argv[5] = node;
  argv[6] = "--self";
  argv[7] = (char *)sprout_json_get(one, "self")->bytes;
  argv[8] = "--bind";
  argv[9] = "actor=eval_bench#1";
  r = sproutc(10, argv);
  CHECK_INT(r.code, 0);
  CHECK_STR(r.out, "{\"value\":6}\nsteps 5\n");
  one = golden_case(&w, "chance draws true from the seed");
  snprintf(node, sizeof node, "%.0f", sprout_json_get(one, "node")->number);
  argv[5] = node;
  argv[8] = "--seed";
  argv[9] = "5";
  r = sproutc(10, argv);
  CHECK_INT(r.code, 0);
  CHECK_STR(r.out, "{\"value\":true}\nsteps 1\n");
}

static void a_fault_is_printed_in_the_hosts_words_and_exits_one(void) {
  world w;
  run r;
  char node[16];
  const sprout_json *one;
  char *argv[12];
  open_world(&w);
  one = golden_case(&w, "a deep expression past the step budget");
  snprintf(node, sizeof node, "%.0f", sprout_json_get(one, "node")->number);
  argv[0] = "eval";
  argv[1] = golden_path("eval.sproutworld");
  argv[2] = "--state";
  argv[3] = (char *)state_file(w.golden, "fresh");
  argv[4] = "--node";
  argv[5] = node;
  argv[6] = "--self";
  argv[7] = (char *)sprout_json_get(one, "self")->bytes;
  argv[8] = "--steps";
  argv[9] = "25";
  r = sproutc(10, argv);
  CHECK_INT(r.code, 1);
  CHECK_STR(r.out,
            "fault BudgetExhausted: This turn used more steps than the host allows (25) while running message 0, so it "
            "was stopped and nothing it did was kept.\nsteps 25\n");
}

static void a_command_line_it_cannot_follow_exits_two_in_words(void) {
  run r;
  char *argv[8];
  argv[0] = "eval";
  argv[1] = golden_path("eval.sproutworld");
  r = sproutc(2, argv);
  CHECK_INT(r.code, 2);
  CHECK(strstr(r.err, "write --state, --node and --self.") != NULL);
  argv[2] = "--state";
  argv[3] = "nowhere.json";
  argv[4] = "--node";
  argv[5] = "1";
  argv[6] = "--self";
  argv[7] = "eval_bench";
  r = sproutc(8, argv);
  CHECK_INT(r.code, 2);
  CHECK_STR(r.err, "sproutc: cannot read nowhere.json.\n");
  argv[2] = "--nonsense";
  argv[3] = "1";
  r = sproutc(4, argv);
  CHECK_INT(r.code, 2);
  CHECK(strstr(r.err, "`--nonsense` is not something `sproutc eval` takes.") != NULL);
  argv[2] = "--node";
  argv[3] = "five";
  r = sproutc(4, argv);
  CHECK_INT(r.code, 2);
  CHECK(strstr(r.err, "--node wants a whole number after it, as in `--node 5`.") != NULL);
}

static void a_node_past_the_graph_is_named(void) {
  world w;
  run r;
  char *argv[8];
  open_world(&w);
  argv[0] = "eval";
  argv[1] = golden_path("eval.sproutworld");
  argv[2] = "--state";
  argv[3] = (char *)state_file(w.golden, "fresh");
  argv[4] = "--node";
  argv[5] = "99999999";
  argv[6] = "--self";
  argv[7] = "eval_bench";
  r = sproutc(8, argv);
  CHECK_INT(r.code, 2);
  CHECK(strstr(r.err, "there is no entry 99999999.") != NULL);
}

int main(void) {
  RUN(a_value_is_printed_with_the_steps_it_took);
  RUN(bound_names_and_a_seed_reach_the_expression);
  RUN(a_fault_is_printed_in_the_hosts_words_and_exits_one);
  RUN(a_command_line_it_cannot_follow_exits_two_in_words);
  RUN(a_node_past_the_graph_is_named);
  return REPORT();
}
