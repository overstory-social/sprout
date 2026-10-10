/*
 * The reading bench as the C tests use it: the cartridge and the stored
 * worlds `corpus/goldens/readings.json` was written against (the TypeScript
 * spec reading-goldens.spec.ts writes them), a world loaded under each case's
 * figures, and a turn to run a reading in. A case is a reading, as the
 * parser's file holds it, in a state; replaying one runs it through the
 * consent pass and the effect pass, drains the queue, and compares how it
 * ended with how the TypeScript runtime ended it: acted, refused or gone, or
 * the fault; the steps; the effects in order; the handlers that ran; the
 * descriptions owed; and the state committed.
 */
#ifndef SPROUT_TEST_READING_FIXTURE_H
#define SPROUT_TEST_READING_FIXTURE_H

#include "engine-verbs.h"
#include "exec_fixture.h"
#include "exits.h"
#include "intents.h"
#include "reading/reading.h"

static inline void reading_bench_open(exec_bench *b) { exec_bench_open_files(b, "readings.sproutworld", "readings.json"); }

/*
 * A golden's state opened: the world under the figures it gives (the host's own where it gives none), the state it
 * names read for it, and a turn ready to run, its frame `self`'s.
 */
static inline void reading_open(exec_bench *b, exec_case *c, const sprout_json *golden, const char *self) {
  const sprout_json *states = sprout_json_get(b->golden, "states"), *limits = sprout_json_get(golden, "limits");
  const char *stored = exec_text(states, exec_text(golden, "state"));
  sprout_refusal refusal;
  memset(c, 0, sizeof *c);
  c->golden = golden;
  c->host = b->host;
  if (limits != NULL) exec_fill_budgets(&c->host.budgets, limits);
  if (sprout_load(&c->host, b->cartridge, b->cartridge_length, &c->world) != SPROUT_OK) {
    fprintf(stderr, "the readings' cartridge does not load\n");
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
                    exec_has_number(golden, "instant") ? (uint64_t)exec_number(golden, "instant") : 0);
  c->frame = sprout_exec_frame(&c->x, exec_str(self), NULL, NULL);
}

/* A case opened: its state, and a turn ready to run its reading. */
static inline void reading_case_open(exec_bench *b, exec_case *c, const sprout_json *golden) {
  reading_open(b, c, golden, exec_text(sprout_json_get(golden, "reading"), "actor"));
}

/* The first case in this state, opened; the test aborts if there is none. */
static inline void reading_case_in(exec_bench *b, exec_case *c, const char *state) {
  const sprout_json *cases = sprout_json_get(b->golden, "cases");
  size_t i;
  for (i = 0; i < cases->count; i++)
    if (strcmp(exec_text(cases->items[i], "state"), state) == 0) {
      reading_case_open(b, c, cases->items[i]);
      return;
    }
  fprintf(stderr, "the golden has no case in the state `%s`\n", state);
  exit(2);
}

/* The verb a golden names by library and name; the test aborts if the world declares none. */
static inline const sprout_verb *reading_verb(const sprout_world *world, const char *qualified) {
  size_t i;
  for (i = 0; i < world->verb_count; i++) {
    char name[256];
    snprintf(name, sizeof name, "%s.%s", world->verbs[i]->library, world->verbs[i]->name);
    if (strcmp(name, qualified) == 0) return world->verbs[i];
  }
  fprintf(stderr, "the world declares no verb `%s`\n", qualified);
  exit(2);
}

static inline size_t reading_role_index(const sprout_verb *verb, const char *role) {
  size_t i;
  for (i = 0; i < verb->role_count; i++)
    if (strcmp(verb->roles[i].name, role) == 0) return i;
  fprintf(stderr, "`%s` has no role `%s`\n", verb->name, role);
  exit(2);
}

static inline sprout_str reading_str(const sprout_json *text) {
  sprout_str str = {text->bytes, text->length};
  return str;
}

/* One filler of a golden's reading, as the reading holds it. */
static inline void reading_fill(exec_case *c, const sprout_json *filler, sprout_filled *out) {
  const char *binds = exec_text(filler, "binds");
  const sprout_json *id = sprout_json_get(filler, "id"), *ids = sprout_json_get(filler, "ids");
  const sprout_json *value = sprout_json_get(filler, "value"), *direction = sprout_json_get(filler, "direction");
  size_t i;
  memset(out, 0, sizeof *out);
  if (strcmp(binds, "unbound") == 0) return;
  out->filled = true;
  if (strcmp(binds, "object") == 0) {
    out->bound.kind = SPROUT_BOUND_OBJECT;
    out->bound.object = reading_str(id);
  } else if (strcmp(binds, "set") == 0) {
    out->bound.kind = SPROUT_BOUND_SET;
    out->bound.set = (sprout_str *)sprout_arena_take(&c->turn, (ids->count + 1) * sizeof *out->bound.set);
    for (i = 0; i < ids->count; i++) out->bound.set[i] = reading_str(ids->items[i]);
    out->bound.set_count = ids->count;
  } else if (strcmp(binds, "exit") == 0) {
    out->bound.kind = SPROUT_BOUND_EXIT;
    out->bound.has_direction = direction->kind == SPROUT_JSON_STRING;
    if (out->bound.has_direction) out->bound.direction = reading_str(direction);
    out->bound.label = reading_str(sprout_json_get(filler, "label"));
    out->bound.to = reading_str(sprout_json_get(filler, "to"));
  } else {
    out->bound.kind = SPROUT_BOUND_VALUE;
    out->bound.value_is_string = value->kind == SPROUT_JSON_STRING;
    if (out->bound.value_is_string) out->bound.value_string = reading_str(value);
    else out->bound.value_number = value->number;
  }
}

/* The reading a golden holds: its verb, its actor, and a filler for each role of the verb. */
static inline sprout_resolved reading_of(exec_case *c, const sprout_json *reading) {
  sprout_resolved resolved;
  const sprout_json *fillers = sprout_json_get(reading, "fillers");
  sprout_filled *roles;
  size_t i;
  resolved.verb = reading_verb(c->world, exec_text(reading, "verb"));
  resolved.actor = exec_str(exec_text(reading, "actor"));
  roles = (sprout_filled *)sprout_arena_take(&c->turn, (resolved.verb->role_count + 1) * sizeof *roles);
  for (i = 0; i < fillers->count; i++)
    reading_fill(c, fillers->items[i], &roles[reading_role_index(resolved.verb, exec_text(fillers->items[i], "role"))]);
  resolved.roles = roles;
  return resolved;
}

/* Runs a reading as a command turn does: both passes, and, unless refused, the queue. */
static inline sprout_eval_status reading_run(exec_case *c, const sprout_resolved *reading, sprout_reading_end *end,
                                             sprout_permit_refusal *refusal) {
  sprout_frame frame = sprout_exec_frame(&c->x, reading->actor, NULL, NULL);
  sprout_eval_status status = sprout_perform(&c->x, &frame, reading, end, refusal);
  if (status == SPROUT_EVAL_OK && *end != SPROUT_READING_REFUSED) status = sprout_exec_drain(&c->x);
  return status;
}

static inline void reading_check_refusal(exec_bench *b, exec_case *c, const sprout_permit_refusal *refusal,
                                         const sprout_json *want) {
  const sprout_json *origin = sprout_json_get(want, "origin");
  CHECK(exec_same_str(refusal->refusal.by, sprout_json_get(want, "by")));
  CHECK_STR(refusal->role, exec_text(want, "role"));
  if (origin->kind == SPROUT_JSON_NULL) CHECK(refusal->refusal.origin == NULL);
  else CHECK(refusal->refusal.origin != NULL && strcmp(refusal->refusal.origin, origin->bytes) == 0);
  exec_check_speech(&refusal->refusal.said, sprout_json_get(want, "said"));
  exec_check_bindings(b, c, refusal->refusal.bindings, refusal->refusal.binding_count, sprout_json_get(want, "bindings"));
}

/*
 * Replays a case: the reading runs and the queue drains, and the case ends
 * as the oracle ended it. Returns the status of the run.
 */
static inline sprout_eval_status reading_replay(exec_bench *b, const sprout_json *golden) {
  exec_case c;
  sprout_resolved reading;
  sprout_reading_end end = SPROUT_READING_ACTED;
  sprout_permit_refusal refusal;
  sprout_eval_status status;
  const sprout_json *expect = sprout_json_get(golden, "expect");
  const char *how = exec_text(expect, "how");
  int before = check_failures;
  memset(&refusal, 0, sizeof refusal);
  reading_case_open(b, &c, golden);
  reading = reading_of(&c, sprout_json_get(golden, "reading"));
  c.frame = sprout_exec_frame(&c.x, reading.actor, NULL, NULL);
  status = reading_run(&c, &reading, &end, &refusal);
  if (strcmp(how, "fault") != 0) {
    CHECK_INT(status, SPROUT_EVAL_OK);
    if (status != SPROUT_EVAL_OK) {
      fprintf(stderr, "  ended: %s: %s\n", c.fault.name, c.fault.text);
    } else {
      CHECK_INT(end, strcmp(how, "refused") == 0 ? SPROUT_READING_REFUSED
                                                  : strcmp(how, "gone") == 0 ? SPROUT_READING_GONE : SPROUT_READING_ACTED);
      CHECK_INT(c.meter.steps, exec_number(expect, "steps"));
      if (end == SPROUT_READING_REFUSED) {
        reading_check_refusal(b, &c, &refusal, sprout_json_get(expect, "refused"));
        CHECK_INT(c.x.effect_count, 0);
      } else {
        CHECK_INT(c.meter.spawns, exec_number(expect, "spawns"));
        CHECK_INT(c.x.events, exec_number(expect, "events"));
        exec_check_effects(b, &c, sprout_json_get(expect, "effects"));
        exec_check_trail(&c, expect);
      }
      exec_check_after(b, &c, expect);
    }
  } else {
    const sprout_json *fault = sprout_json_get(expect, "fault");
    if (strcmp(fault->bytes, "Error") == 0) {
      CHECK_INT(status, SPROUT_EVAL_ENGINE);
    } else {
      CHECK_INT(status, SPROUT_EVAL_FAULT);
      CHECK_STR(c.fault.name, fault->bytes);
    }
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
static inline size_t reading_replay_area(exec_bench *b, const char *area) {
  const sprout_json *cases = sprout_json_get(b->golden, "cases");
  size_t i, replayed = 0;
  for (i = 0; i < cases->count; i++) {
    if (area != NULL && strcmp(exec_text(cases->items[i], "area"), area) != 0) continue;
    reading_replay(b, cases->items[i]);
    replayed++;
  }
  return replayed;
}

/* The case with this name; the test aborts if there is none. */
static inline const sprout_json *reading_named(exec_bench *b, const char *name) {
  const sprout_json *cases = sprout_json_get(b->golden, "cases");
  size_t i;
  for (i = 0; i < cases->count; i++)
    if (strcmp(exec_text(cases->items[i], "name"), name) == 0) return cases->items[i];
  fprintf(stderr, "the golden has no case `%s`\n", name);
  exit(2);
}

#endif
