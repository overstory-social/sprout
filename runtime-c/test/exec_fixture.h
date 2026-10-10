/*
 * The statements' bench as the C tests use it: the cartridge and the stored
 * worlds `corpus/goldens/exec.json` was written against (the TypeScript spec
 * exec-goldens.spec.ts writes them), a world loaded under each case's
 * figures, and a turn to run a body in. A case names its body by the entry of
 * the cartridge's graph that holds it; replaying one runs the body, drains
 * the queue, and compares what it ended in with what the TypeScript runtime
 * ended in: the committed state or the fault, the steps, the effects in
 * order, the handlers that ran and the descriptions owed.
 */
#ifndef SPROUT_TEST_EXEC_FIXTURE_H
#define SPROUT_TEST_EXEC_FIXTURE_H

#include "check.h"
#include "corpus.h"
#include "draft.h"
#include "exec.h"
#include "json.h"
#include "load.h"
#include "stmt/stmt.h"
#include "world.h"

typedef struct exec_bench {
  test_heap heap;
  sprout_host host;
  char *cartridge;
  size_t cartridge_length;
  sprout_arena json;
  const sprout_json *golden;
} exec_bench;

/* One case opened: the world under its figures, a state read for it, and a turn ready to run its body. */
typedef struct exec_case {
  const sprout_json *golden;
  sprout_host host;
  sprout_world *world;
  sprout_state *state;
  sprout_arena turn;
  sprout_draft draft;
  sprout_meter meter;
  sprout_draws draws;
  sprout_eval_fault fault;
  sprout_exec x;
  sprout_frame frame;
} exec_case;

static inline const char *exec_text(const sprout_json *object, const char *key) {
  const sprout_json *field = sprout_json_get(object, key);
  if (field == NULL || field->kind != SPROUT_JSON_STRING) {
    fprintf(stderr, "the golden has no text `%s`\n", key);
    exit(2);
  }
  return field->bytes;
}

static inline double exec_number(const sprout_json *object, const char *key) {
  const sprout_json *field = sprout_json_get(object, key);
  if (field == NULL || field->kind != SPROUT_JSON_NUMBER) {
    fprintf(stderr, "the golden has no number `%s`\n", key);
    exit(2);
  }
  return field->number;
}

static inline bool exec_has_number(const sprout_json *object, const char *key) {
  const sprout_json *field = sprout_json_get(object, key);
  return field != NULL && field->kind == SPROUT_JSON_NUMBER;
}

static inline sprout_str exec_str(const char *text) {
  sprout_str str = {text, strlen(text)};
  return str;
}

/* A bench over a cartridge and the golden written beside it, both from corpus/goldens. */
static inline void exec_bench_open_files(exec_bench *b, const char *cartridge, const char *golden) {
  size_t golden_length;
  char *text;
  sprout_json_error error;
  sprout_json *root = NULL;
  memset(b, 0, sizeof *b);
  b->host = corpus_host(&b->heap);
  b->cartridge = test_golden(cartridge, &b->cartridge_length);
  text = test_golden(golden, &golden_length);
  sprout_arena_init(&b->json, &b->host);
  if (sprout_json_read(&b->json, text, golden_length, &root, &error) != SPROUT_OK) {
    fprintf(stderr, "%s: %s\n", golden, error.text);
    exit(2);
  }
  free(text);
  b->golden = root;
}

static inline void exec_bench_open(exec_bench *b) { exec_bench_open_files(b, "exec.sproutworld", "exec.json"); }

static inline void exec_bench_close(exec_bench *b) {
  sprout_arena_reset(&b->json);
  free(b->cartridge);
}

/* A limit from the golden's figures: null leaves it to the host, which sets none. */
static inline sprout_limit exec_limit(const sprout_json *limits, const char *key) {
  const sprout_json *field = sprout_json_get(limits, key);
  sprout_limit limit = {false, 0};
  if (field != NULL && field->kind == SPROUT_JSON_NUMBER) {
    limit.set = true;
    limit.value = (uint64_t)field->number;
  }
  return limit;
}

/* The host's figures a case ran under in the oracle. */
static inline void exec_fill_budgets(sprout_budgets *budgets, const sprout_json *limits) {
  budgets->steps = exec_limit(limits, "steps");
  budgets->events = exec_limit(limits, "events");
  budgets->cascade_depth = exec_limit(limits, "cascadeDepth");
  budgets->spawns = exec_limit(limits, "spawnsPerTurn");
  budgets->shortest_wake_seconds = exec_limit(limits, "shortestWakeSeconds");
  budgets->pending_wakes = exec_limit(limits, "pendingWakesPerObject");
  budgets->people_per_place = exec_limit(limits, "peoplePerPlace");
  budgets->extension_effects = exec_limit(limits, "extensionEffects");
  budgets->list_elements = exec_limit(limits, "listElements");
  budgets->instances = exec_limit(limits, "instances");
}

static inline const sprout_str *exec_ids(exec_case *c, const sprout_json *list) {
  sprout_str *ids = (sprout_str *)sprout_arena_take(&c->turn, (list->count + 1) * sizeof *ids);
  size_t i;
  for (i = 0; i < list->count; i++) ids[i] = (sprout_str){list->items[i]->bytes, list->items[i]->length};
  return ids;
}

/* Opens a case: nothing has run, and the frame names `self` with every binding the golden gives. */
static inline void exec_case_open(exec_bench *b, exec_case *c, const sprout_json *golden) {
  const sprout_json *bind = sprout_json_get(golden, "bind"), *speaker = sprout_json_get(golden, "speaker");
  const sprout_json *states = sprout_json_get(b->golden, "states");
  const char *stored = exec_text(states, exec_text(golden, "state"));
  sprout_refusal refusal;
  size_t i;
  memset(c, 0, sizeof *c);
  c->golden = golden;
  c->host = b->host;
  exec_fill_budgets(&c->host.budgets, sprout_json_get(golden, "limits"));
  if (sprout_load(&c->host, b->cartridge, b->cartridge_length, &c->world) != SPROUT_OK) {
    fprintf(stderr, "the statements' cartridge does not load\n");
    exit(2);
  }
  if (sprout_state_read(&c->host, stored, strlen(stored), &c->state, &refusal) != SPROUT_OK ||
      sprout_state_open(c->state, c->world, NULL, &refusal) != SPROUT_OK) {
    fprintf(stderr, "state: %s\n", refusal.text);
    exit(2);
  }
  sprout_arena_init(&c->turn, &b->host);
  sprout_draft_open(&c->draft, &c->turn, c->world, c->state);
  sprout_meter_begin(&c->meter, &c->host, SPROUT_TURN_COMMAND);
  sprout_draws_begin(&c->draws, exec_has_number(golden, "seed") ? (uint64_t)exec_number(golden, "seed") : 1);
  sprout_exec_begin(&c->x, c->world, &c->draft, &c->turn, &c->meter, &c->draws, &c->fault,
                    (uint64_t)exec_number(golden, "instant"));
  c->x.heard_count = sprout_json_get(golden, "heard")->count;
  c->x.heard_by = exec_ids(c, sprout_json_get(golden, "heard"));
  c->x.left_out_count = sprout_json_get(golden, "leftOut")->count;
  c->x.left_out = exec_ids(c, sprout_json_get(golden, "leftOut"));
  c->x.records_as_said = strcmp(exec_text(golden, "records"), "as-said") == 0;
  if (speaker != NULL && speaker->kind == SPROUT_JSON_STRING) {
    c->x.has_speaker = true;
    c->x.speaker = exec_str(speaker->bytes);
  }
  c->frame = sprout_exec_frame(&c->x, exec_str(exec_text(golden, "self")), exec_text(golden, "library"), NULL);
  for (i = 0; bind != NULL && i < bind->count; i++)
    c->frame.bindings = sprout_bind(&c->frame, bind->items[i]->key, sprout_evaluated_object(exec_str(bind->items[i]->bytes)));
}

static inline void exec_case_close(exec_case *c) {
  sprout_arena_reset(&c->turn);
  sprout_state_free(c->state);
  sprout_world_free(c->world);
}

static inline const sprout_node *exec_body_of(const exec_case *c) {
  return &c->world->graph.entries[(size_t)exec_number(c->golden, "node")];
}

/* The statement a case's body starts with, which a module's test hands to the module that runs it. */
static inline const sprout_node *exec_first_statement(const exec_case *c) {
  return sprout_node_get(exec_body_of(c), "statements")->items[0];
}

/* A run of an acting body in this case's turn, for the function of a statement module a test calls. */
static inline sprout_run exec_run(exec_case *c) {
  sprout_run run;
  memset(&run, 0, sizeof run);
  run.x = &c->x;
  run.mode = SPROUT_BODY_ACT;
  return run;
}

/* A number property of an instance as the turn stands. */
static inline double exec_property(exec_case *c, const char *id, const char *name) {
  sprout_value value;
  const sprout_stored_instance *instance = sprout_draft_instance(&c->draft, exec_str(id));
  if (instance == NULL || expr_get(&c->frame, instance, name, &value) != SPROUT_EVAL_OK) {
    fprintf(stderr, "no property %s of %s\n", name, id);
    exit(2);
  }
  return value.kind == SPROUT_NUMBER ? value.as.number : value.kind == SPROUT_BOOL ? (double)value.as.boolean : -1;
}

/* ---- comparing what a run recorded with what the oracle recorded ---- */

static inline bool exec_same_str(sprout_str a, const sprout_json *b) {
  return b != NULL && b->kind == SPROUT_JSON_STRING && a.length == b->length && memcmp(a.bytes, b->bytes, a.length) == 0;
}

static inline const char *exec_effect_name(sprout_effect_kind kind) {
  switch (kind) {
    case SPROUT_EFFECT_SAID:
      return "said";
    case SPROUT_EFFECT_TOLD:
      return "told";
    case SPROUT_EFFECT_REFUSED:
      return "refused";
    case SPROUT_EFFECT_NOTICE:
      return "notice";
    case SPROUT_EFFECT_EXTENSION:
      return "extension";
  }
  return "";
}

/* The one key of a golden's `said` and its value. */
static inline void exec_check_speech(const sprout_speech *speech, const sprout_json *said) {
  const sprout_json *one;
  switch (speech->kind) {
    case SPROUT_SPEECH_PASSAGE:
      one = sprout_json_get(said, "passage");
      CHECK(one != NULL);
      if (one == NULL) return;
      CHECK_STR(speech->origin, exec_text(one, "origin"));
      CHECK_STR(speech->name, exec_text(one, "name"));
      return;
    case SPROUT_SPEECH_TEXT:
      one = sprout_json_get(said, "text");
      CHECK(one != NULL);
      if (one == NULL) return;
      CHECK_BYTES(sprout_node_get(speech->node, "value")->text, sprout_node_get(speech->node, "value")->length, one->bytes);
      CHECK_STR(speech->library, exec_text(said, "library"));
      return;
    case SPROUT_SPEECH_ABSENT:
      CHECK_STR(speech->name, exec_text(said, "absent"));
      return;
    case SPROUT_SPEECH_ENGINE:
      CHECK_STR(speech->name, exec_text(said, "engine"));
      return;
    case SPROUT_SPEECH_RECORDED:
      one = sprout_json_get(said, "recorded");
      CHECK(one != NULL);
      if (one == NULL) return;
      CHECK_STR(speech->extension, exec_text(one, "extension"));
      CHECK_STR(speech->statement, exec_text(one, "statement"));
      return;
  }
}

/* A binding's canonical form, which is what the golden holds under its name. */
static inline void exec_check_bindings(exec_bench *b, exec_case *c, const sprout_effect_binding *bindings, size_t count,
                                       const sprout_json *golden) {
  size_t i, j;
  CHECK_INT(count, golden->count);
  for (i = 0; i < golden->count; i++) {
    const sprout_json *want = golden->items[i];
    const char *wanted, *shown;
    size_t wanted_length, shown_length, prefix = want->key_length + 3;
    bool found = false;
    for (j = 0; j < count; j++) {
      if (strlen(bindings[j].name) != want->key_length || memcmp(bindings[j].name, want->key, want->key_length) != 0) continue;
      found = true;
      CHECK_INT(sprout_json_write(&b->json, want, &wanted, &wanted_length), SPROUT_OK);
      CHECK_INT(sprout_eval_show(&c->frame, &bindings[j].bound, &shown, &shown_length), SPROUT_EVAL_OK);
      CHECK(wanted_length == shown_length + prefix && memcmp(wanted + prefix, shown, shown_length) == 0);
      if (!(wanted_length == shown_length + prefix && memcmp(wanted + prefix, shown, shown_length) == 0))
        fprintf(stderr, "  binding %s: %.*s, expected %.*s\n", bindings[j].name, (int)shown_length, shown,
                (int)(wanted_length - prefix), wanted + prefix);
    }
    CHECK(found);
  }
}

static inline void exec_check_effects(exec_bench *b, exec_case *c, const sprout_json *golden) {
  size_t i, j;
  CHECK_INT(c->x.effect_count, golden->count);
  for (i = 0; i < c->x.effect_count && i < golden->count; i++) {
    const sprout_effect *effect = &c->x.effects[i];
    const sprout_json *want = golden->items[i], *to = sprout_json_get(want, "to"), *speaker = sprout_json_get(want, "speaker");
    CHECK_STR(exec_effect_name(effect->kind), exec_text(want, "effect"));
    CHECK_INT(effect->to_count, to->count);
    for (j = 0; j < effect->to_count && j < to->count; j++) CHECK(exec_same_str(effect->to[j], to->items[j]));
    CHECK(exec_same_str(effect->by, sprout_json_get(want, "by")));
    if (speaker->kind == SPROUT_JSON_NULL) CHECK(!effect->has_speaker);
    else CHECK(effect->has_speaker && exec_same_str(effect->speaker, speaker));
    exec_check_speech(&effect->said, sprout_json_get(want, "said"));
    exec_check_bindings(b, c, effect->bindings, effect->binding_count, sprout_json_get(want, "bindings"));
  }
}

static inline void exec_check_trail(exec_case *c, const sprout_json *expect) {
  const sprout_json *ran = sprout_json_get(expect, "ran"), *owed = sprout_json_get(expect, "owed");
  const sprout_json *destroyed = sprout_json_get(expect, "destroyed");
  size_t i;
  CHECK_INT(c->x.ran_count, ran->count);
  for (i = 0; i < c->x.ran_count && i < ran->count; i++) {
    CHECK_STR(c->x.ran[i].origin, exec_text(ran->items[i], "origin"));
    CHECK_STR(c->x.ran[i].on, exec_text(ran->items[i], "on"));
  }
  CHECK_INT(c->x.owed_count, owed->count);
  for (i = 0; i < c->x.owed_count && i < owed->count; i++) {
    CHECK(exec_same_str(c->x.owed[i].mover, sprout_json_get(owed->items[i], "mover")));
    CHECK(exec_same_str(c->x.owed[i].place, sprout_json_get(owed->items[i], "place")));
    CHECK_INT(c->x.owed[i].after, exec_number(owed->items[i], "after"));
  }
  CHECK_INT(c->x.gone_count, destroyed->count);
  for (i = 0; i < c->x.gone_count && i < destroyed->count; i++) CHECK(exec_same_str(c->x.gone[i], destroyed->items[i]));
}

/* The golden's budget names, as the meter names them. */
static inline const char *exec_budget_name(const char *typescript) {
  if (strcmp(typescript, "spawnsPerTurn") == 0) return "spawns";
  if (strcmp(typescript, "cascadeDepth") == 0) return "cascade depth";
  if (strcmp(typescript, "extensionEffects") == 0) return "effects";
  return typescript;
}

/* The state after the turn commits: the golden's, or the state it began with. */
static inline void exec_check_after(exec_bench *b, exec_case *c, const sprout_json *expect) {
  const sprout_json *after = sprout_json_get(expect, "after");
  const char *written;
  size_t length;
  sprout_changes changes;
  const char *want = after->kind == SPROUT_JSON_STRING ? after->bytes : exec_text(sprout_json_get(b->golden, "states"), exec_text(c->golden, "state"));
  CHECK_INT(sprout_draft_commit(&c->draft, &changes), SPROUT_DRAFT_OK);
  CHECK_INT(sprout_state_write(c->state, &written, &length), SPROUT_OK);
  CHECK_BYTES(written, length, want);
}

/*
 * Replays a case: the body runs and the queue drains, and the case ends as
 * the oracle ended it. Returns the status of the run.
 */
static inline sprout_eval_status exec_replay(exec_bench *b, const sprout_json *golden) {
  exec_case c;
  sprout_ended ended;
  sprout_eval_status status = SPROUT_EVAL_OK;
  const sprout_json *prior, *expect = sprout_json_get(golden, "expect"), *fault = sprout_json_get(expect, "fault");
  int before = check_failures;
  exec_case_open(b, &c, golden);
  prior = sprout_json_get(golden, "prior");
  if (prior->kind == SPROUT_JSON_OBJECT) {
    /* A body run first in the same turn, as its own object and with no names bound. */
    sprout_frame first = sprout_exec_frame(&c.x, exec_str(exec_text(prior, "self")), exec_text(golden, "library"), NULL);
    status = sprout_exec_body(&c.x, &c.world->graph.entries[(size_t)exec_number(prior, "node")], &first, SPROUT_BODY_ACT, &ended);
  }
  if (status == SPROUT_EVAL_OK) status = sprout_exec_body(&c.x, exec_body_of(&c), &c.frame, SPROUT_BODY_ACT, &ended);
  if (status == SPROUT_EVAL_OK) status = sprout_exec_drain(&c.x);
  if (fault == NULL) {
    CHECK_INT(status, SPROUT_EVAL_OK);
    if (status == SPROUT_EVAL_OK) {
      CHECK_INT(c.meter.steps, exec_number(expect, "steps"));
      CHECK_INT(c.meter.spawns, exec_number(expect, "spawns"));
      CHECK_INT(c.x.events, exec_number(expect, "events"));
      exec_check_effects(b, &c, sprout_json_get(expect, "effects"));
      exec_check_trail(&c, expect);
      exec_check_after(b, &c, expect);
    } else {
      fprintf(stderr, "  ended: %s: %s\n", c.fault.name, c.fault.text);
    }
  } else if (strcmp(fault->bytes, "Error") == 0) {
    CHECK_INT(status, SPROUT_EVAL_ENGINE);
    CHECK_STR(c.fault.text, exec_text(expect, "detail"));
    CHECK_INT(c.meter.steps, exec_number(expect, "steps"));
  } else {
    CHECK_INT(status, SPROUT_EVAL_FAULT);
    CHECK_STR(c.fault.name, fault->bytes);
    if (strcmp(fault->bytes, "BudgetExhausted") == 0) {
      CHECK_STR(c.meter.fault.budget, exec_budget_name(exec_text(expect, "budget")));
      CHECK_INT(c.meter.fault.limit, exec_number(expect, "limit"));
    } else {
      CHECK_STR(c.fault.text, exec_text(expect, "detail"));
    }
    CHECK_INT(c.meter.steps, exec_number(expect, "steps"));
  }
  if (check_failures != before) fprintf(stderr, "  in the case `%s`\n", exec_text(golden, "name"));
  exec_case_close(&c);
  return status;
}

/* Replays every case of an area (or every case, for NULL); how many there were. */
static inline size_t exec_replay_area(exec_bench *b, const char *area) {
  const sprout_json *cases = sprout_json_get(b->golden, "cases");
  size_t i, replayed = 0;
  for (i = 0; i < cases->count; i++) {
    if (area != NULL && strcmp(exec_text(cases->items[i], "area"), area) != 0) continue;
    exec_replay(b, cases->items[i]);
    replayed++;
  }
  return replayed;
}

/* The case with this name; the test aborts if there is none. */
static inline const sprout_json *exec_named(exec_bench *b, const char *name) {
  const sprout_json *cases = sprout_json_get(b->golden, "cases");
  size_t i;
  for (i = 0; i < cases->count; i++)
    if (strcmp(exec_text(cases->items[i], "name"), name) == 0) return cases->items[i];
  fprintf(stderr, "the golden has no case `%s`\n", name);
  exit(2);
}

/* The body the golden locates but does not run, by name; the test aborts if there is none. */
static inline const sprout_json *exec_unrun(exec_bench *b, const char *name) {
  const sprout_json *bodies = sprout_json_get(b->golden, "unrun");
  size_t i;
  for (i = 0; i < bodies->count; i++)
    if (strcmp(exec_text(bodies->items[i], "name"), name) == 0) return bodies->items[i];
  fprintf(stderr, "the golden has no unrun body `%s`\n", name);
  exit(2);
}

#endif
