/*
 * Tests for src/eval.c: every case the TypeScript evaluator's goldens hold
 * (corpus/goldens/eval.json) is evaluated here against the same cartridge and
 * stored worlds, and must end in the same value, the same fault and the same
 * number of steps; a spawn makes the same instances; and the step budget
 * faults at the host's figure, in the words the host's budgets give.
 */
#include "eval_fixture.h"

/* The canonical text of the golden's expected result, for comparing as bytes. */
static void expect_text(bench *b, const sprout_json *expect, const char **bytes, size_t *length) {
  CHECK_INT(sprout_json_write(&b->json, expect, bytes, length), SPROUT_OK);
}

static const char *fault_budget_name(const char *typescript) {
  if (strcmp(typescript, "steps") == 0) return "steps";
  if (strcmp(typescript, "spawnsPerTurn") == 0) return "spawns";
  return typescript;
}

static void replay_case(bench *b, const sprout_json *golden) {
  bench_turn t;
  const sprout_json *expect = sprout_json_get(golden, "expect"), *bind = sprout_json_get(golden, "bind");
  const sprout_json *fault = sprout_json_get(expect, "fault");
  sprout_evaluated result;
  sprout_eval_status status;
  size_t i;
  int before = check_failures;
  bench_turn_open(b, &t, bench_text(golden, "state"), bench_text(golden, "self"), bench_text(golden, "library"),
                  bench_has_number(golden, "budget") ? (long)bench_number(golden, "budget") : -1, -1,
                  bench_has_number(golden, "seed") ? (long)bench_number(golden, "seed") : -1);
  for (i = 0; bind != NULL && i < bind->count; i++)
    bench_turn_bind(&t, bind->items[i]->key, bind->items[i]->bytes);
  status = sprout_eval(&t.frame, &b->world->graph.entries[(size_t)bench_number(golden, "node")], &result);
  if (fault == NULL) {
    const char *shown, *wanted;
    size_t shown_length, wanted_length;
    CHECK_INT(status, SPROUT_EVAL_OK);
    if (status == SPROUT_EVAL_OK) {
      CHECK_INT(sprout_eval_show(&t.frame, &result, &shown, &shown_length), SPROUT_EVAL_OK);
      expect_text(b, expect, &wanted, &wanted_length);
      /* The writer prints the member's key before its value: `"expect":`, then the canonical form. */
      CHECK(wanted_length == shown_length + 9 && memcmp(wanted, "\"expect\":", 9) == 0);
      CHECK(wanted_length == shown_length + 9 && memcmp(wanted + 9, shown, shown_length) == 0);
      CHECK_INT(t.meter.steps, bench_number(golden, "steps"));
    } else {
      fprintf(stderr, "  faulted: %s: %s\n", t.fault.name, t.fault.text);
    }
  } else {
    CHECK_INT(status, SPROUT_EVAL_FAULT);
    CHECK_STR(t.fault.name, fault->bytes);
    if (strcmp(fault->bytes, "BudgetExhausted") == 0) {
      CHECK_STR(t.meter.fault.budget, fault_budget_name(bench_text(expect, "budget")));
      CHECK_INT(t.meter.fault.limit, bench_number(expect, "limit"));
      CHECK_STR(t.fault.text, t.meter.fault.text);
      /* The step that went over is recorded, as TypeScript records it. */
      CHECK_INT(t.meter.steps, bench_number(golden, "steps"));
    } else {
      CHECK_STR(t.fault.text, bench_text(expect, "detail"));
      CHECK_INT(t.meter.steps, bench_number(golden, "steps"));
    }
  }
  if (check_failures != before) fprintf(stderr, "  in the case `%s`: %s\n", bench_text(golden, "name"), bench_text(golden, "text"));
  bench_turn_close(&t);
}

static void every_golden_case_ends_as_the_typescript_evaluator_did(void) {
  bench b;
  const sprout_json *cases;
  size_t i;
  bench_open(&b);
  cases = sprout_json_get(b.golden, "cases");
  CHECK(cases != NULL && cases->count > 40);
  for (i = 0; cases != NULL && i < cases->count; i++) replay_case(&b, cases->items[i]);
  bench_close(&b);
  CHECK_INT(b.heap.pages, 0);
}

static void replay_spawn(bench *b, const sprout_json *golden) {
  bench_turn t;
  const sprout_json *expect = sprout_json_get(golden, "expect"), *fault = sprout_json_get(expect, "fault");
  sprout_spawned made;
  sprout_eval_status status;
  size_t i;
  int before = check_failures;
  bench_turn_open(b, &t, bench_text(golden, "state"), bench_text(golden, "spawner"), bench_text(golden, "library"),
                  -1, bench_has_number(golden, "spawns") ? (long)bench_number(golden, "spawns") : -1, -1);
  status = sprout_spawn(&t.frame, bench_text(golden, "kind"),
                        (sprout_str){bench_text(golden, "container"), strlen(bench_text(golden, "container"))}, &made);
  if (fault == NULL) {
    const sprout_json *contents = sprout_json_get(expect, "contents"), *placed = sprout_json_get(expect, "placed");
    CHECK_INT(status, SPROUT_EVAL_OK);
    if (status == SPROUT_EVAL_OK) {
      CHECK_BYTES(made.id.bytes, made.id.length, bench_text(expect, "id"));
      CHECK_INT(made.count, contents->count);
      for (i = 0; i < made.count && i < contents->count; i++)
        CHECK_BYTES(made.contents[i].bytes, made.contents[i].length, contents->items[i]->bytes);
      for (i = 0; i < placed->count; i++) {
        const sprout_json *one = placed->items[i];
        const char *id = bench_text(one, "id");
        const sprout_stored_instance *instance = sprout_draft_instance(&t.draft, (sprout_str){id, strlen(id)});
        CHECK(instance != NULL);
        if (instance == NULL) continue;
        CHECK_STR(instance->kind->qualified, bench_text(one, "kind"));
        CHECK_BYTES(instance->container.bytes, instance->container.length, bench_text(one, "container"));
      }
      CHECK_INT(t.meter.spawns, bench_number(golden, "spawned"));
    } else {
      fprintf(stderr, "  faulted: %s: %s\n", t.fault.name, t.fault.text);
    }
  } else {
    CHECK_INT(status, SPROUT_EVAL_FAULT);
    CHECK_STR(t.fault.name, fault->bytes);
    if (strcmp(fault->bytes, "BudgetExhausted") == 0) {
      CHECK_STR(t.meter.fault.budget, fault_budget_name(bench_text(expect, "budget")));
      CHECK_INT(t.meter.fault.limit, bench_number(expect, "limit"));
    } else {
      CHECK_STR(t.fault.text, bench_text(expect, "detail"));
    }
    /* A fault writes nothing: the draft holds the instances the state held. */
    CHECK_INT(sprout_draft_held(&t.draft), bench_state(b, bench_text(golden, "state"))->instance_count);
  }
  if (check_failures != before) fprintf(stderr, "  in the spawn `%s`\n", bench_text(golden, "name"));
  bench_turn_close(&t);
}

static void every_golden_spawn_makes_what_the_typescript_runtime_made(void) {
  bench b;
  const sprout_json *spawns;
  size_t i;
  bench_open(&b);
  spawns = sprout_json_get(b.golden, "spawns");
  CHECK(spawns != NULL && spawns->count > 5);
  for (i = 0; spawns != NULL && i < spawns->count; i++) replay_spawn(&b, spawns->items[i]);
  bench_close(&b);
  CHECK_INT(b.heap.pages, 0);
}

static void a_deep_expression_faults_at_the_hosts_step_count_in_the_hosts_words(void) {
  bench b;
  bench_turn t;
  sprout_evaluated result;
  const sprout_json *cases;
  size_t i;
  bench_open(&b);
  cases = sprout_json_get(b.golden, "cases");
  for (i = 0; cases != NULL && i < cases->count; i++) {
    const sprout_json *one = cases->items[i];
    if (strcmp(bench_text(one, "name"), "a deep expression within the step budget") != 0) continue;
    /* The expression takes 79 steps: the host's figure of 78 stops it on the 79th. */
    bench_turn_open(&b, &t, "fresh", bench_text(one, "self"), bench_text(one, "library"), 78, -1, -1);
    CHECK_INT(sprout_eval(&t.frame, &b.world->graph.entries[(size_t)bench_number(one, "node")], &result),
              SPROUT_EVAL_FAULT);
    CHECK_STR(t.fault.name, "BudgetExhausted");
    CHECK_STR(t.fault.text, "steps: a command turn may take 78 steps.");
    CHECK_INT(t.meter.steps, 79);
    bench_turn_close(&t);
    bench_turn_open(&b, &t, "fresh", bench_text(one, "self"), bench_text(one, "library"), 79, -1, -1);
    CHECK_INT(sprout_eval(&t.frame, &b.world->graph.entries[(size_t)bench_number(one, "node")], &result),
              SPROUT_EVAL_OK);
    CHECK_INT(t.meter.steps, 79);
    bench_turn_close(&t);
  }
  bench_close(&b);
}

static void with_no_figure_from_the_host_nothing_runs_out(void) {
  bench b;
  bench_turn t;
  sprout_evaluated result;
  const sprout_json *cases;
  size_t i;
  bench_open(&b);
  cases = sprout_json_get(b.golden, "cases");
  for (i = 0; cases != NULL && i < cases->count; i++) {
    const sprout_json *one = cases->items[i];
    if (strcmp(bench_text(one, "name"), "a deep expression within the step budget") != 0) continue;
    bench_turn_open(&b, &t, "fresh", bench_text(one, "self"), bench_text(one, "library"), -1, -1, -1);
    CHECK_INT(sprout_eval(&t.frame, &b.world->graph.entries[(size_t)bench_number(one, "node")], &result),
              SPROUT_EVAL_OK);
    bench_turn_close(&t);
  }
  bench_close(&b);
}

static void a_condition_that_holds_runs_its_branch_with_each_narrowed_name_bound(void) {
  bench b;
  bench_turn t;
  sprout_frame inner;
  bool taken = false;
  const sprout_binding *shelf, *cup;
  bench_open(&b);
  bench_turn_for(&b, &t, "a name placed nearest");
  CHECK_INT(sprout_eval_branch(&t.frame, bench_expr(&b, "a name placed nearest"), &taken, &inner), SPROUT_EVAL_OK);
  CHECK(taken);
  shelf = inner.bindings;
  CHECK(shelf != NULL && strcmp(shelf->name, "shelf") == 0);
  if (shelf != NULL) CHECK_BYTES(shelf->bound.id.bytes, shelf->bound.id.length, "eval_bench.hall.shelf");
  /* The frame it was given is as it was: the narrowing is the branch's alone. */
  CHECK(t.frame.bindings == NULL);
  bench_turn_close(&t);
  bench_turn_for(&b, &t, "&& narrows a dotted path");
  CHECK_INT(sprout_eval_branch(&t.frame, bench_expr(&b, "&& narrows a dotted path"), &taken, &inner), SPROUT_EVAL_OK);
  CHECK(taken);
  cup = inner.bindings;
  CHECK(cup != NULL && strcmp(cup->name, "shelf.cup") == 0);
  bench_turn_close(&t);
  bench_close(&b);
}

static void a_condition_that_does_not_hold_runs_no_branch(void) {
  bench b;
  bench_turn t;
  sprout_frame inner;
  bool taken = true;
  bench_open(&b);
  bench_turn_for(&b, &t, "&& leaves its right unevaluated");
  CHECK_INT(sprout_eval_branch(&t.frame, bench_expr(&b, "&& leaves its right unevaluated"), &taken, &inner), SPROUT_EVAL_OK);
  CHECK(!taken);
  /* `false && ...`: the `&&` and its left, and the right is never read. */
  CHECK_INT(t.meter.steps, 2);
  bench_turn_close(&t);
  bench_close(&b);
}

/* `1 + 1 + ... + 1`, `terms` ones, as the nodes a cartridge would hold: a spine as long as that to its left. */
static const sprout_node *sum_of_ones(size_t terms) {
  static const char *binary_keys[] = {"kind", "operator", "left", "right"};
  static const char *integer_keys[] = {"kind", "value"};
  sprout_node *kind_binary = (sprout_node *)calloc(1, sizeof *kind_binary), *plus = (sprout_node *)calloc(1, sizeof *plus);
  sprout_node *kind_integer = (sprout_node *)calloc(1, sizeof *kind_integer), *one = (sprout_node *)calloc(1, sizeof *one);
  sprout_node *leaf = (sprout_node *)calloc(1, sizeof *leaf), *sum = NULL;
  size_t i;
  kind_binary->kind = SPROUT_NODE_STRING, kind_binary->text = "binary", kind_binary->length = 6;
  plus->kind = SPROUT_NODE_STRING, plus->text = "+", plus->length = 1;
  kind_integer->kind = SPROUT_NODE_STRING, kind_integer->text = "integer", kind_integer->length = 7;
  one->kind = SPROUT_NODE_NUMBER, one->number = 1;
  leaf->kind = SPROUT_NODE_OBJECT, leaf->count = 2, leaf->keys = integer_keys, leaf->index = SPROUT_NOT_AN_ENTRY;
  leaf->items = (const sprout_node **)calloc(2, sizeof(sprout_node *));
  leaf->items[0] = kind_integer, leaf->items[1] = one;
  sum = leaf;
  for (i = 1; i < terms; i++) {
    sprout_node *next = (sprout_node *)calloc(1, sizeof *next);
    next->kind = SPROUT_NODE_OBJECT, next->count = 4, next->keys = binary_keys, next->index = SPROUT_NOT_AN_ENTRY;
    next->items = (const sprout_node **)calloc(4, sizeof(sprout_node *));
    next->items[0] = kind_binary, next->items[1] = plus, next->items[2] = sum, next->items[3] = leaf;
    sum = next;
  }
  return sum;
}

/* Frees what sum_of_ones built: each `+` node and its items, the shared leaf, and the four leaf nodes under them. */
static void free_sum(const sprout_node *top) {
  const sprout_node *leaf = top;
  sprout_node *sum = (sprout_node *)top;
  while (leaf->count == 4) leaf = leaf->items[3];
  if (top != leaf) {
    free((void *)top->items[0]);
    free((void *)top->items[1]);
  }
  free((void *)leaf->items[0]);
  free((void *)leaf->items[1]);
  while (sum != leaf) {
    sprout_node *inner = (sprout_node *)sum->items[2];
    free((void *)sum->items);
    free(sum);
    sum = inner;
  }
  free((void *)leaf->items);
  free((void *)leaf);
}

static void a_spine_is_walked_by_loop_however_long_it_is(void) {
  bench b;
  bench_turn t;
  sprout_evaluated result;
  bench_open(&b);
  bench_turn_for(&b, &t, "get reads the property");
  const sprout_node *spine = sum_of_ones(300000);
  CHECK_INT(sprout_eval(&t.frame, spine, &result), SPROUT_EVAL_OK);
  CHECK(result.value.kind == SPROUT_NUMBER && result.value.as.number == 300000);
  /* The first `1`, then for each `+` the `+` itself and the `1` on its right. */
  CHECK_INT(t.meter.steps, 1 + 2 * 299999);
  bench_turn_close(&t);
  bench_close(&b);
  CHECK_INT(b.heap.pages, 0);
  free_sum(spine);
}

int main(void) {
  RUN(every_golden_case_ends_as_the_typescript_evaluator_did);
  RUN(a_condition_that_holds_runs_its_branch_with_each_narrowed_name_bound);
  RUN(a_condition_that_does_not_hold_runs_no_branch);
  RUN(a_spine_is_walked_by_loop_however_long_it_is);
  RUN(every_golden_spawn_makes_what_the_typescript_runtime_made);
  RUN(a_deep_expression_faults_at_the_hosts_step_count_in_the_hosts_words);
  RUN(with_no_figure_from_the_host_nothing_runs_out);
  return REPORT();
}
