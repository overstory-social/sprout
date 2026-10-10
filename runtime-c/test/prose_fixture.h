/*
 * The prose bench as the C tests use it: the cartridge and the stored worlds
 * `corpus/goldens/prose.json` was written against (the TypeScript spec prose-goldens.spec.ts
 * writes them), a world loaded under each case's figures, and a turn with the lines the case says
 * recorded as its effects. Replaying a case renders them, and the case ends as the oracle ended
 * it: the same words for each reader, the same cuts or the same fault, and the same steps.
 */
#ifndef SPROUT_TEST_PROSE_FIXTURE_H
#define SPROUT_TEST_PROSE_FIXTURE_H

#include "check.h"
#include "corpus.h"
#include "draft.h"
#include "exec.h"
#include "json.h"
#include "load.h"
#include "prose.h"
#include "prose/prose.h"
#include "world.h"

typedef struct prose_bench {
  test_heap heap;
  sprout_host host;
  char *cartridge;
  size_t cartridge_length;
  sprout_arena json;
  const sprout_json *golden;
} prose_bench;

/* One case opened: the world under its figures, a state read for it, and a turn with its lines recorded. */
typedef struct prose_case {
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
} prose_case;

static inline const char *prose_text(const sprout_json *object, const char *key) {
  const sprout_json *field = sprout_json_get(object, key);
  if (field == NULL || field->kind != SPROUT_JSON_STRING) {
    fprintf(stderr, "the golden has no text `%s`\n", key);
    exit(2);
  }
  return field->bytes;
}

static inline double prose_number(const sprout_json *object, const char *key) {
  const sprout_json *field = sprout_json_get(object, key);
  if (field == NULL || field->kind != SPROUT_JSON_NUMBER) {
    fprintf(stderr, "the golden has no number `%s`\n", key);
    exit(2);
  }
  return field->number;
}

static inline sprout_str prose_str(const sprout_json *text) { return (sprout_str){text->bytes, text->length}; }

static inline bool prose_same(sprout_str a, const sprout_json *b) {
  return b != NULL && b->kind == SPROUT_JSON_STRING && a.length == b->length && memcmp(a.bytes, b->bytes, a.length) == 0;
}

static inline void prose_bench_open(prose_bench *b) {
  size_t length;
  char *text;
  sprout_json_error error;
  sprout_json *root = NULL;
  memset(b, 0, sizeof *b);
  b->host = corpus_host(&b->heap);
  b->cartridge = test_golden("prose.sproutworld", &b->cartridge_length);
  text = test_golden("prose.json", &length);
  sprout_arena_init(&b->json, &b->host);
  if (sprout_json_read(&b->json, text, length, &root, &error) != SPROUT_OK) {
    fprintf(stderr, "prose.json: %s\n", error.text);
    exit(2);
  }
  free(text);
  b->golden = root;
}

static inline void prose_bench_close(prose_bench *b) {
  sprout_arena_reset(&b->json);
  free(b->cartridge);
}

static inline sprout_limit prose_limit(const sprout_json *limits, const char *key) {
  const sprout_json *field = sprout_json_get(limits, key);
  sprout_limit limit = {false, 0};
  if (field != NULL && field->kind == SPROUT_JSON_NUMBER) {
    limit.set = true;
    limit.value = (uint64_t)field->number;
  }
  return limit;
}

static inline sprout_effect_kind prose_effect_kind(const char *name) {
  if (strcmp(name, "said") == 0) return SPROUT_EFFECT_SAID;
  if (strcmp(name, "told") == 0) return SPROUT_EFFECT_TOLD;
  if (strcmp(name, "refused") == 0) return SPROUT_EFFECT_REFUSED;
  if (strcmp(name, "notice") == 0) return SPROUT_EFFECT_NOTICE;
  fprintf(stderr, "the golden has an effect `%s`\n", name);
  exit(2);
}

static inline const char *prose_effect_name(sprout_effect_kind kind) {
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
    case SPROUT_EFFECT_DESCRIBED:
      return "described";
  }
  return "";
}

/* The one-line passage the cartridge holds for these words. */
static inline const sprout_node *prose_literal(const sprout_world *world, const char *text, size_t length) {
  size_t i;
  for (i = 0; i < world->graph.count; i++) {
    const sprout_node *node = &world->graph.entries[i], *value;
    if (!sprout_node_is(sprout_node_get(node, "kind"), "prose-literal")) continue;
    value = sprout_node_get(node, "value");
    if (value != NULL && value->length == length && memcmp(value->text, text, length) == 0) return node;
  }
  fprintf(stderr, "the cartridge has no one-line passage \"%s\"\n", text);
  exit(2);
}

/* What a golden's `said` is, as the exec records it. */
static inline void prose_speech(prose_case *c, const sprout_json *line, sprout_speech *speech) {
  const sprout_json *said = sprout_json_get(line, "said"), *one;
  memset(speech, 0, sizeof *speech);
  if ((one = sprout_json_get(said, "passage")) != NULL) {
    const sprout_stored_instance *by = sprout_draft_instance(&c->draft, prose_str(sprout_json_get(line, "by")));
    if (by == NULL || !sprout_passage_on(by->kind, prose_text(one, "name"), speech) ||
        strcmp(speech->origin, prose_text(one, "origin")) != 0) {
      fprintf(stderr, "the object that says %s has no such passage\n", prose_text(one, "name"));
      exit(2);
    }
  } else if ((one = sprout_json_get(said, "text")) != NULL) {
    speech->kind = SPROUT_SPEECH_TEXT;
    speech->node = prose_literal(c->world, one->bytes, one->length);
    speech->library = prose_text(said, "library");
  } else if ((one = sprout_json_get(said, "absent")) != NULL) {
    speech->kind = SPROUT_SPEECH_ABSENT;
    speech->name = one->bytes;
  } else {
    speech->kind = SPROUT_SPEECH_ENGINE;
    speech->name = prose_text(said, "engine");
  }
}

/* What a golden binds a name to. */
static inline sprout_evaluated prose_evaluated(prose_case *c, const sprout_json *bound) {
  const sprout_json *one;
  sprout_evaluated evaluated;
  size_t i;
  memset(&evaluated, 0, sizeof evaluated);
  if ((one = sprout_json_get(bound, "object")) != NULL) return sprout_evaluated_object(prose_str(one));
  if ((one = sprout_json_get(bound, "set")) != NULL || (one = sprout_json_get(bound, "readings")) != NULL) {
    sprout_str *items = (sprout_str *)sprout_arena_take(&c->turn, (one->count + 1) * sizeof *items);
    for (i = 0; i < one->count; i++) items[i] = prose_str(one->items[i]);
    evaluated.binds = sprout_json_get(bound, "set") != NULL ? SPROUT_BINDS_SET : SPROUT_BINDS_READINGS;
    evaluated.count = one->count;
    evaluated.items = items;
    return evaluated;
  }
  one = sprout_json_get(bound, "value");
  if (one->kind == SPROUT_JSON_STRING) {
    sprout_value value;
    sprout_string(&c->turn, one->bytes, one->length, &value);
    return sprout_evaluated_value(value);
  }
  if (one->kind == SPROUT_JSON_BOOL) return sprout_evaluated_value(sprout_bool(one->boolean));
  return sprout_evaluated_value(sprout_number(one->number));
}

/* The people a golden line is read by. */
static inline void prose_readers(prose_case *c, const sprout_json *to, sprout_effect *effect) {
  sprout_str *readers = (sprout_str *)sprout_arena_take(&c->turn, (to->count + 1) * sizeof *readers);
  size_t i;
  for (i = 0; i < to->count; i++) readers[i] = prose_str(to->items[i]);
  effect->to = readers;
  effect->to_count = to->count;
}

/* Changes the nicknames the case changes in its turn. */
static inline void prose_rename(prose_case *c, const sprout_json *renames) {
  size_t i;
  for (i = 0; i < renames->count; i++) {
    const sprout_stored_visitor *held = sprout_visitor_of(&c->draft, (sprout_str){renames->items[i]->key, renames->items[i]->key_length});
    sprout_stored_visitor changed;
    if (held == NULL) {
      fprintf(stderr, "no visitor is %s\n", renames->items[i]->key);
      exit(2);
    }
    changed = *held;
    changed.nickname = prose_str(renames->items[i]);
    CHECK_INT(sprout_draft_put_visitor(&c->draft, &changed), SPROUT_DRAFT_OK);
  }
}

/* Opens a case: its world, state and draws, and every line it says recorded as the effects of the turn. */
static inline void prose_case_open(prose_bench *b, prose_case *c, const sprout_json *golden) {
  const sprout_json *limits = sprout_json_get(golden, "limits"), *lines = sprout_json_get(golden, "lines");
  const sprout_json *states = sprout_json_get(b->golden, "states");
  const char *stored = prose_text(states, prose_text(golden, "state"));
  sprout_refusal refusal;
  size_t i, j;
  uint32_t ignored;
  memset(c, 0, sizeof *c);
  c->golden = golden;
  c->host = b->host;
  c->host.budgets.steps = prose_limit(limits, "steps");
  c->host.budgets.output = prose_limit(limits, "output");
  c->host.budgets.passage_depth = prose_limit(limits, "passageDepth");
  if (sprout_load(&c->host, b->cartridge, b->cartridge_length, &c->world) != SPROUT_OK) {
    fprintf(stderr, "the prose cartridge does not load\n");
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
  sprout_draws_begin(&c->draws, (uint64_t)prose_number(golden, "seed"));
  for (i = 0; i < (size_t)prose_number(golden, "skip"); i++) sprout_draws_below(&c->draws, 7, &ignored);
  sprout_exec_begin(&c->x, c->world, &c->draft, &c->turn, &c->meter, &c->draws, &c->fault, 0);
  prose_rename(c, sprout_json_get(golden, "renames"));
  for (i = 0; i < lines->count; i++) {
    const sprout_json *line = lines->items[i], *bindings = sprout_json_get(line, "bindings"), *speaker = sprout_json_get(line, "speaker");
    sprout_effect effect;
    sprout_effect_binding *names;
    memset(&effect, 0, sizeof effect);
    effect.kind = prose_effect_kind(prose_text(line, "effect"));
    effect.by = prose_str(sprout_json_get(line, "by"));
    prose_readers(c, sprout_json_get(line, "to"), &effect);
    if (speaker->kind == SPROUT_JSON_STRING) {
      effect.has_speaker = true;
      effect.speaker = prose_str(speaker);
    }
    prose_speech(c, line, &effect.said);
    names = (sprout_effect_binding *)sprout_arena_take(&c->turn, (bindings->count + 1) * sizeof *names);
    for (j = 0; j < bindings->count; j++) {
      names[j].name = bindings->items[j]->key;
      names[j].bound = prose_evaluated(c, bindings->items[j]);
    }
    effect.bindings = names;
    effect.binding_count = bindings->count;
    CHECK_INT(sprout_exec_record(&c->x, &effect), SPROUT_EVAL_OK);
  }
}

static inline void prose_case_close(prose_case *c) {
  sprout_arena_reset(&c->turn);
  sprout_state_free(c->state);
  sprout_world_free(c->world);
}

/* What renders a passage of the case's turn for `reader`. */
static inline prose_reading prose_reading_of(prose_case *c, const char *reader) {
  prose_reading reading;
  reading.world = c->world;
  reading.draft = &c->draft;
  reading.turn = &c->turn;
  reading.meter = &c->meter;
  reading.fault = &c->fault;
  reading.reader = (sprout_str){reader, strlen(reader)};
  reading.notes = NULL;
  return reading;
}

/* The prose of the passage `name` as the object `by` has it, or NULL where its kind has none. */
static inline const sprout_node *prose_passage_of(prose_case *c, const char *by, const char *name) {
  const sprout_stored_instance *instance = sprout_draft_instance(&c->draft, (sprout_str){by, strlen(by)});
  sprout_speech speech;
  if (instance == NULL || !sprout_passage_on(instance->kind, name, &speech)) return NULL;
  return sprout_node_get(sprout_node_get(speech.node, "body"), "prose");
}

/* The budget names the golden uses, as the meter names them. */
static inline const char *prose_budget_name(const char *typescript) {
  if (strcmp(typescript, "passageDepth") == 0) return "passage depth";
  return typescript;
}

/* What a case rendered to against what the oracle rendered. */
static inline void prose_check_told(const sprout_rendered *rendered, const sprout_json *expect) {
  const sprout_json *effects = sprout_json_get(expect, "effects"), *cut = sprout_json_get(expect, "cut");
  size_t i, j;
  CHECK_INT(rendered->told_count, effects->count);
  for (i = 0; i < rendered->told_count && i < effects->count; i++) {
    const sprout_told *told = &rendered->told[i];
    const sprout_json *want = effects->items[i], *paragraphs = sprout_json_get(want, "paragraphs");
    CHECK_STR(prose_effect_name(told->kind), prose_text(want, "kind"));
    CHECK(prose_same(told->from, sprout_json_get(want, "from")));
    CHECK(prose_same(told->to, sprout_json_get(want, "to")));
    CHECK(prose_same(told->visit, sprout_json_get(want, "visit")));
    CHECK_INT(told->paragraph_count, paragraphs->count);
    for (j = 0; j < told->paragraph_count && j < paragraphs->count; j++) {
      CHECK_BYTES(told->paragraphs[j].bytes, told->paragraphs[j].length, paragraphs->items[j]->bytes);
      CHECK_INT(told->paragraphs[j].bytes[told->paragraphs[j].length], 0);
      if (told->paragraphs[j].length != paragraphs->items[j]->length ||
          memcmp(told->paragraphs[j].bytes, paragraphs->items[j]->bytes, paragraphs->items[j]->length) != 0)
        fprintf(stderr, "  effect %zu, paragraph %zu\n", i, j);
    }
  }
  CHECK_INT(rendered->cut_count, cut->count);
  for (i = 0; i < rendered->cut_count && i < cut->count; i++) CHECK(prose_same(rendered->cut[i], cut->items[i]));
}

/* Replays a case: renders what it says and compares it with what the oracle rendered. */
static inline sprout_eval_status prose_replay(prose_bench *b, const sprout_json *golden) {
  prose_case c;
  sprout_rendered rendered;
  sprout_str actor;
  const sprout_json *expect = sprout_json_get(golden, "expect"), *fault = sprout_json_get(expect, "fault");
  const sprout_json *who = sprout_json_get(golden, "actor");
  sprout_eval_status status;
  int before = check_failures;
  prose_case_open(b, &c, golden);
  if (who->kind == SPROUT_JSON_STRING) actor = prose_str(who);
  status = sprout_render_effects(&c.x, who->kind == SPROUT_JSON_STRING ? &actor : NULL, &rendered);
  if (fault == NULL) {
    CHECK_INT(status, SPROUT_EVAL_OK);
    if (status == SPROUT_EVAL_OK) {
      prose_check_told(&rendered, expect);
      CHECK_INT(c.meter.steps, prose_number(expect, "steps"));
    } else {
      fprintf(stderr, "  ended: %s: %s\n", c.fault.name, c.fault.text);
    }
  } else {
    CHECK_INT(status, SPROUT_EVAL_FAULT);
    CHECK_STR(c.fault.name, fault->bytes);
    CHECK_STR(c.meter.fault.budget, prose_budget_name(prose_text(expect, "budget")));
    CHECK_INT(c.meter.fault.limit, prose_number(expect, "limit"));
    CHECK_INT(c.meter.steps, prose_number(expect, "steps"));
  }
  if (check_failures != before) fprintf(stderr, "  in the case `%s`\n", prose_text(golden, "name"));
  prose_case_close(&c);
  return status;
}

/* Replays every case of an area (or every case, for NULL); how many there were. */
static inline size_t prose_replay_area(prose_bench *b, const char *area) {
  const sprout_json *cases = sprout_json_get(b->golden, "cases");
  size_t i, replayed = 0;
  for (i = 0; i < cases->count; i++) {
    if (area != NULL && strcmp(prose_text(cases->items[i], "area"), area) != 0) continue;
    prose_replay(b, cases->items[i]);
    replayed++;
  }
  return replayed;
}

/* The case with this name; the test aborts if there is none. */
static inline const sprout_json *prose_named(prose_bench *b, const char *name) {
  const sprout_json *cases = sprout_json_get(b->golden, "cases");
  size_t i;
  for (i = 0; i < cases->count; i++)
    if (strcmp(prose_text(cases->items[i], "name"), name) == 0) return cases->items[i];
  fprintf(stderr, "the golden has no case `%s`\n", name);
  exit(2);
}

#endif
