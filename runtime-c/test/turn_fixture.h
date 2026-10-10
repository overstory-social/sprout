/*
 * What the turn specs share: a corpus world loaded under a host whose seed and clock the test sets, a stored
 * world that starts empty and is opened against it, and small helpers to run a turn and read what it said. The
 * worlds are the corpus's own, packed once by the CMake setup test.
 */
#ifndef SPROUT_TEST_TURN_FIXTURE_H
#define SPROUT_TEST_TURN_FIXTURE_H

#include "corpus.h"
#include "state.h"
#include "turn.h"

typedef struct turn_world {
  test_heap heap;
  sprout_host host;
  uint64_t seed;
  char *cartridge;
  sprout_world *world;
  sprout_state *state;
} turn_world;

static inline void *tw_alloc(void *ctx, size_t bytes) { return test_alloc(&((turn_world *)ctx)->heap, bytes); }
static inline void tw_release(void *ctx, void *block, size_t bytes) { test_release(&((turn_world *)ctx)->heap, block, bytes); }
static inline uint64_t tw_seed(void *ctx) { return ((turn_world *)ctx)->seed; }

/* The host's budgets as the spec's table gives them, less the rows it leaves to the host. */
static inline void tw_default_budgets(sprout_budgets *b) {
  memset(b, 0, sizeof *b);
  b->steps = (sprout_limit){true, 50000};
  b->poll_steps = (sprout_limit){true, 10000};
  b->output = (sprout_limit){true, 8000};
  b->events = (sprout_limit){true, 256};
  b->cascade_depth = (sprout_limit){true, 20};
  b->passage_depth = (sprout_limit){true, 8};
  b->set_role_objects = (sprout_limit){true, 8};
  b->spawns = (sprout_limit){true, 8};
  b->shortest_wake_seconds = (sprout_limit){true, 60};
  b->pending_wakes = (sprout_limit){true, 1};
  b->nickname_characters = (sprout_limit){true, 24};
  b->list_elements = (sprout_limit){true, 16};
}

/* Loads the corpus world `name` and begins its stored world, empty and opened. */
static inline void tw_open(turn_world *w, const char *name) {
  size_t length;
  sprout_refusal refusal;
  memset(w, 0, sizeof *w);
  w->host.ctx = w;
  w->host.page_bytes = 65536;
  w->host.alloc = tw_alloc;
  w->host.release = tw_release;
  w->host.seed = tw_seed;
  w->heap.refuse_after = -1;
  tw_default_budgets(&w->host.budgets);
  w->cartridge = corpus_cartridge(name, &length);
  if (sprout_load_explained(&w->host, w->cartridge, length, &w->world, &refusal) != SPROUT_OK) {
    fprintf(stderr, "%s: %s\n", name, refusal.text);
    exit(2);
  }
  if (sprout_state_empty(&w->host, w->world->header.name, &w->state) != SPROUT_OK ||
      sprout_state_open(w->state, w->world, NULL, &refusal) != SPROUT_OK) {
    fprintf(stderr, "%s: the stored world would not open\n", name);
    exit(2);
  }
}

static inline void tw_close(turn_world *w) {
  sprout_state_free(w->state);
  sprout_world_free(w->world);
  free(w->cartridge);
  CHECK_INT(w->heap.pages, 0);
}

/* A copy of the stored world's canonical bytes, malloc'd. */
static inline char *tw_bytes(turn_world *w) {
  const char *bytes;
  size_t length;
  char *copy;
  if (sprout_state_write(w->state, &bytes, &length) != SPROUT_OK) exit(2);
  copy = (char *)malloc(length + 1);
  if (copy == NULL) exit(2);
  memcpy(copy, bytes, length);
  copy[length] = '\0';
  return copy;
}

/* Runs a turn of `kind` at `instant`, with the host's seed `seed`; the status, and the outcome in `out`. */
static inline sprout_status tw_run(turn_world *w, sprout_turn_input input, uint64_t seed, sprout_outcome *out) {
  w->seed = seed;
  return sprout_run_turn(w->world, w->state, &w->host, &input, out);
}

static inline sprout_turn_input tw_input(sprout_turn_kind kind, uint64_t instant) {
  sprout_turn_input input;
  memset(&input, 0, sizeof input);
  input.kind = kind;
  input.instant = instant;
  return input;
}

/* Admits `nickname` as `visit`, runs catch-up and then the arrival, as a host does; the arrival's outcome. */
static inline void tw_arrive(turn_world *w, const char *visit, const char *nickname, uint64_t instant, sprout_outcome *out) {
  sprout_turn_input catch_up = tw_input(SPROUT_TURN_MAINTENANCE, instant), arrival = tw_input(SPROUT_TURN_ARRIVAL, instant);
  sprout_outcome caught;
  CHECK_INT(tw_run(w, catch_up, 0, &caught), SPROUT_OK);
  sprout_outcome_free(&caught);
  arrival.visit = visit;
  arrival.nickname = nickname;
  arrival.nickname_length = strlen(nickname);
  CHECK_INT(tw_run(w, arrival, 0, out), SPROUT_OK);
}

/* The id of the instance that is `visit`, or "" before they arrive. */
static inline const char *tw_person(turn_world *w, const char *visit) {
  const sprout_stored_visitor *record = sprout_state_find_visitor(w->state, (sprout_str){visit, strlen(visit)});
  return record == NULL ? "" : record->instance.bytes;
}

/* Whether the outcome told `visit` exactly `text`, as one paragraph. */
static inline bool tw_told(const sprout_outcome *out, const char *visit, const char *text) {
  size_t i;
  for (i = 0; i < out->line_count; i++)
    if (out->lines[i].recipient_length == strlen(visit) && memcmp(out->lines[i].recipient, visit, out->lines[i].recipient_length) == 0 &&
        out->lines[i].text_length == strlen(text) && memcmp(out->lines[i].text, text, out->lines[i].text_length) == 0)
      return true;
  return false;
}

/* A reading of `verb` by `actor`, filled with the one thing `id` in the role `role` (a tool or target). */
static inline sprout_reading tw_reading(const char *verb, const char *actor, sprout_filling *filling, const char *role, const char *id) {
  sprout_reading reading;
  memset(&reading, 0, sizeof reading);
  memset(filling, 0, sizeof *filling);
  reading.verb = verb;
  reading.actor = actor;
  if (role != NULL) {
    filling->role = role;
    filling->binds = SPROUT_FILL_OBJECT;
    filling->id = id;
    reading.filling_count = 1;
    reading.fillings = filling;
  }
  return reading;
}

/* Runs the command `reading` as `visit` at `instant`; the outcome in `out`. */
static inline void tw_command(turn_world *w, const char *visit, const sprout_reading *reading, uint64_t instant, sprout_outcome *out) {
  sprout_turn_input input = tw_input(SPROUT_TURN_COMMAND, instant);
  input.visit = visit;
  input.reading = reading;
  if (tw_run(w, input, 0, out) != SPROUT_OK) { CHECK_STR(out->fault.text, ""); }
}

/* Runs `verb` (a verb of the world, by its short name) on `target` (an object of the world, by its path below it). */
static inline void tw_do(turn_world *w, const char *visit, const char *verb, const char *target, uint64_t instant,
                         sprout_outcome *out) {
  char verb_id[128], target_id[128];
  sprout_filling filling;
  sprout_reading reading;
  snprintf(verb_id, sizeof verb_id, "%s.%s", w->world->header.name, verb);
  snprintf(target_id, sizeof target_id, "%s.%s", w->world->header.name, target);
  reading = tw_reading(verb_id, tw_person(w, visit), &filling, "target", target_id);
  tw_command(w, visit, &reading, instant, out);
}

/* Goes through the exit `direction` of the visitor's place, which leads to `to` (below the world) and is labelled `label`. */
static inline void tw_go(turn_world *w, const char *visit, const char *direction, const char *label, const char *to,
                         uint64_t instant, sprout_outcome *out) {
  char to_id[128];
  sprout_filling filling;
  sprout_reading reading;
  memset(&reading, 0, sizeof reading);
  memset(&filling, 0, sizeof filling);
  snprintf(to_id, sizeof to_id, "%s.%s", w->world->header.name, to);
  filling.role = "way";
  filling.binds = SPROUT_FILL_EXIT;
  filling.id = to_id;
  filling.direction = direction;
  filling.label = label;
  reading.verb = "sprout.go";
  reading.actor = tw_person(w, visit);
  reading.filling_count = 1;
  reading.fillings = &filling;
  tw_command(w, visit, &reading, instant, out);
}

/* The instance stored under `id`, or NULL. */
static inline const sprout_stored_instance *tw_instance(turn_world *w, const char *id) {
  return sprout_state_find(w->state, (sprout_str){id, strlen(id)});
}

/* A stored property of the instance under `id` as a whole number or a boolean's 0 or 1; -1 where it is neither. */
static inline long long tw_property(turn_world *w, const char *id, const char *name) {
  const sprout_stored_instance *instance = tw_instance(w, id);
  size_t i;
  for (i = 0; instance != NULL && i < instance->property_count; i++) {
    const sprout_stored_property *property = &instance->properties[i];
    if (property->name.length != strlen(name) || memcmp(property->name.bytes, name, property->name.length) != 0) continue;
    if (property->value.kind == SPROUT_BOOL) return property->value.boolean ? 1 : 0;
    if (property->value.kind == SPROUT_NUMBER) return (long long)property->value.number;
  }
  return -1;
}

#endif
