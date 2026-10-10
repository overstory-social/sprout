/*
 * The evaluator's bench as the C tests use it: the cartridge and the stored
 * worlds `corpus/goldens/eval.json` was written against (the TypeScript spec
 * eval-goldens.spec.ts writes them), a world loaded from the cartridge, and a
 * turn to evaluate in.
 */
#ifndef SPROUT_TEST_EVAL_FIXTURE_H
#define SPROUT_TEST_EVAL_FIXTURE_H

#include "check.h"
#include "corpus.h"
#include "draft.h"
#include "eval.h"
#include "json.h"
#include "load.h"
#include "world.h"

typedef struct bench {
  test_heap heap;
  sprout_host host;
  char *cartridge;
  sprout_world *world;
  sprout_arena json;
  const sprout_json *golden;
  const char *state_names[4];
  sprout_state *states[4];
  size_t state_count;
} bench;

/* One turn over a stored state: a draft, a meter under the host's figures, the draws, and a frame for `self`. */
typedef struct bench_turn {
  sprout_host host;
  sprout_arena turn;
  sprout_draft draft;
  sprout_meter meter;
  sprout_draws draws;
  sprout_eval_fault fault;
  sprout_frame frame;
} bench_turn;

static inline const char *bench_text(const sprout_json *object, const char *key) {
  const sprout_json *field = sprout_json_get(object, key);
  if (field == NULL || field->kind != SPROUT_JSON_STRING) {
    fprintf(stderr, "the golden has no text `%s`\n", key);
    exit(2);
  }
  return field->bytes;
}

static inline double bench_number(const sprout_json *object, const char *key) {
  const sprout_json *field = sprout_json_get(object, key);
  if (field == NULL || field->kind != SPROUT_JSON_NUMBER) {
    fprintf(stderr, "the golden has no number `%s`\n", key);
    exit(2);
  }
  return field->number;
}

/* Whether the golden holds a number under `key` (null is none). */
static inline bool bench_has_number(const sprout_json *object, const char *key) {
  const sprout_json *field = sprout_json_get(object, key);
  return field != NULL && field->kind == SPROUT_JSON_NUMBER;
}

static inline void bench_open(bench *b) {
  size_t length, golden_length;
  char *text;
  sprout_json_error error;
  sprout_json *root = NULL;
  memset(b, 0, sizeof *b);
  b->host = corpus_host(&b->heap);
  b->host.budgets.list_elements = (sprout_limit){true, 16};
  b->cartridge = test_golden("eval.sproutworld", &length);
  if (sprout_load(&b->host, b->cartridge, length, &b->world) != SPROUT_OK) {
    fprintf(stderr, "the evaluator's cartridge does not load\n");
    exit(2);
  }
  text = test_golden("eval.json", &golden_length);
  sprout_arena_init(&b->json, &b->host);
  if (sprout_json_read(&b->json, text, golden_length, &root, &error) != SPROUT_OK) {
    fprintf(stderr, "eval.json: %s\n", error.text);
    exit(2);
  }
  free(text);
  b->golden = root;
}

/* The golden case with this name; the test aborts if there is none. */
static inline const sprout_json *bench_case(bench *b, const char *name) {
  const sprout_json *cases = sprout_json_get(b->golden, "cases");
  size_t i;
  for (i = 0; i < cases->count; i++)
    if (strcmp(bench_text(cases->items[i], "name"), name) == 0) return cases->items[i];
  fprintf(stderr, "the golden has no case `%s`\n", name);
  exit(2);
}

/* The expression the golden case with this name evaluates. */
static inline const sprout_node *bench_expr(bench *b, const char *name) {
  return &b->world->graph.entries[(size_t)bench_number(bench_case(b, name), "node")];
}

/* The stored world named in the golden, opened against the world once. */
static inline sprout_state *bench_state(bench *b, const char *name) {
  size_t i;
  const char *stored = bench_text(sprout_json_get(b->golden, "states"), name);
  sprout_refusal refusal;
  sprout_state *state = NULL;
  for (i = 0; i < b->state_count; i++)
    if (strcmp(b->state_names[i], name) == 0) return b->states[i];
  if (sprout_state_read(&b->host, stored, strlen(stored), &state, &refusal) != SPROUT_OK ||
      sprout_state_open(state, b->world, NULL, &refusal) != SPROUT_OK) {
    fprintf(stderr, "state %s: %s\n", name, refusal.text);
    exit(2);
  }
  b->state_names[b->state_count] = name;
  b->states[b->state_count++] = state;
  return state;
}

static inline void bench_close(bench *b) {
  size_t i;
  for (i = 0; i < b->state_count; i++) sprout_state_free(b->states[i]);
  sprout_arena_reset(&b->json);
  sprout_world_free(b->world);
  free(b->cartridge);
}

/* Opens a turn for `self` over the state; a figure below 0 leaves that budget to the host's default (none). */
static inline void bench_turn_open(bench *b, bench_turn *t, const char *state, const char *self, const char *library,
                                   long steps, long spawns, long seed) {
  memset(t, 0, sizeof *t);
  t->host = b->host;
  if (steps >= 0) t->host.budgets.steps = (sprout_limit){true, (uint64_t)steps};
  if (spawns >= 0) t->host.budgets.spawns = (sprout_limit){true, (uint64_t)spawns};
  sprout_arena_init(&t->turn, &b->host);
  sprout_draft_open(&t->draft, &t->turn, b->world, bench_state(b, state));
  sprout_meter_begin(&t->meter, &t->host, SPROUT_TURN_COMMAND);
  t->frame.world = b->world;
  t->frame.draft = &t->draft;
  t->frame.turn = &t->turn;
  t->frame.meter = &t->meter;
  t->frame.self.bytes = self;
  t->frame.self.length = strlen(self);
  t->frame.library = library;
  t->frame.fault = &t->fault;
  if (seed >= 0) {
    sprout_draws_begin(&t->draws, (uint64_t)seed);
    t->frame.draws = &t->draws;
  }
}

static inline void bench_turn_bind(bench_turn *t, const char *name, const char *id) {
  sprout_str str = {id, strlen(id)};
  t->frame.bindings = sprout_bind(&t->frame, name, sprout_evaluated_object(str));
}

/* A turn for the case with this name: its state, its self, its figures, and its bindings. */
static inline void bench_turn_for(bench *b, bench_turn *t, const char *name) {
  const sprout_json *golden = bench_case(b, name), *bind = sprout_json_get(golden, "bind");
  size_t i;
  bench_turn_open(b, t, bench_text(golden, "state"), bench_text(golden, "self"), bench_text(golden, "library"),
                  bench_has_number(golden, "budget") ? (long)bench_number(golden, "budget") : -1, -1,
                  bench_has_number(golden, "seed") ? (long)bench_number(golden, "seed") : -1);
  for (i = 0; bind != NULL && i < bind->count; i++) bench_turn_bind(t, bind->items[i]->key, bind->items[i]->bytes);
}

static inline void bench_turn_close(bench_turn *t) { sprout_arena_reset(&t->turn); }

/* An id as the runtime holds ids. */
static inline sprout_str bench_id(const char *id) {
  sprout_str str = {id, strlen(id)};
  return str;
}

#endif
