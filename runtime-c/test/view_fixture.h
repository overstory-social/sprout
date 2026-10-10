/*
 * The view bench as the C tests use it: the cartridge and the stored worlds `corpus/goldens/views.json` was
 * written against (the TypeScript spec view-goldens.spec.ts writes them), a world loaded under each case's
 * figures, and the visitor's view polled over it. A case is a stored world, a visit and the figures the poll ran
 * under; replaying one polls the view and compares it with the oracle's: the view as canonical JSON, the tree a
 * chip client walks over it, the steps the poll spent and the fault it raised.
 */
#ifndef SPROUT_TEST_VIEW_FIXTURE_H
#define SPROUT_TEST_VIEW_FIXTURE_H

#include "check.h"
#include "chips.h"
#include "corpus.h"
#include "draft.h"
#include "exec.h"
#include "json.h"
#include "load.h"
#include "view.h"
#include "view_json.h"
#include "world.h"

typedef struct view_bench {
  test_heap heap;
  sprout_host host;
  char *cartridge;
  size_t cartridge_length;
  sprout_arena json;
  const sprout_json *golden;
} view_bench;

/* One case opened: the world under its figures and a state read for it. */
typedef struct view_case {
  const sprout_json *golden;
  sprout_host host;
  sprout_world *world;
  sprout_state *state;
  char *cartridge; /* a corpus world's, owned by the case; NULL for a bench case */
} view_case;

static inline const char *view_text(const sprout_json *object, const char *key) {
  const sprout_json *field = sprout_json_get(object, key);
  if (field == NULL || field->kind != SPROUT_JSON_STRING) {
    fprintf(stderr, "the golden has no text `%s`\n", key);
    exit(2);
  }
  return field->bytes;
}

static inline void view_bench_open(view_bench *b) {
  size_t length;
  char *text;
  sprout_json_error error;
  sprout_json *root = NULL;
  memset(b, 0, sizeof *b);
  b->host = corpus_host(&b->heap);
  b->cartridge = test_golden("views.sproutworld", &b->cartridge_length);
  text = test_golden("views.json", &length);
  sprout_arena_init(&b->json, &b->host);
  if (sprout_json_read(&b->json, text, length, &root, &error) != SPROUT_OK) {
    fprintf(stderr, "views.json: %s\n", error.text);
    exit(2);
  }
  free(text);
  b->golden = root;
}

static inline void view_bench_close(view_bench *b) {
  sprout_arena_reset(&b->json);
  free(b->cartridge);
}

/* A limit from the golden's figures: null leaves it to the host, which sets none. */
static inline sprout_limit view_limit(const sprout_json *limits, const char *key) {
  const sprout_json *field = sprout_json_get(limits, key);
  sprout_limit limit = {false, 0};
  if (field != NULL && field->kind == SPROUT_JSON_NUMBER) {
    limit.set = true;
    limit.value = (uint64_t)field->number;
  }
  return limit;
}

/* The host's figures a case was polled under in the oracle. */
static inline void view_fill_budgets(sprout_budgets *budgets, const sprout_json *limits) {
  budgets->steps = view_limit(limits, "steps");
  budgets->poll_steps = view_limit(limits, "pollSteps");
  budgets->events = view_limit(limits, "events");
  budgets->cascade_depth = view_limit(limits, "cascadeDepth");
  budgets->passage_depth = view_limit(limits, "passageDepth");
  budgets->set_role_objects = view_limit(limits, "setRoleObjects");
  budgets->spawns = view_limit(limits, "spawnsPerTurn");
  budgets->shortest_wake_seconds = view_limit(limits, "shortestWakeSeconds");
  budgets->pending_wakes = view_limit(limits, "pendingWakesPerObject");
  budgets->people_per_place = view_limit(limits, "peoplePerPlace");
  budgets->extension_effects = view_limit(limits, "extensionEffects");
  budgets->list_elements = view_limit(limits, "listElements");
  budgets->instances = view_limit(limits, "instances");
}

/*
 * Opens a case over `cartridge`, the world's bytes: the world loaded under the case's figures and its stored world
 * read and opened.
 */
static inline void view_case_open(const view_bench *b, view_case *c, const sprout_json *golden, const char *cartridge,
                                  size_t length) {
  const char *stored = view_text(golden, "state");
  sprout_refusal refusal;
  memset(c, 0, sizeof *c);
  c->golden = golden;
  c->host = b->host;
  view_fill_budgets(&c->host.budgets, sprout_json_get(golden, "limits"));
  if (sprout_load_explained(&c->host, cartridge, length, &c->world, &refusal) != SPROUT_OK) {
    fprintf(stderr, "the case's cartridge does not load: %s\n", refusal.text);
    exit(2);
  }
  if (sprout_state_read(&c->host, stored, strlen(stored), &c->state, &refusal) != SPROUT_OK ||
      sprout_state_open(c->state, c->world, NULL, &refusal) != SPROUT_OK) {
    fprintf(stderr, "state: %s\n", refusal.text);
    exit(2);
  }
}

/* A bench case opened over the bench's cartridge. */
static inline void view_bench_case_open(view_bench *b, view_case *c, const sprout_json *golden) {
  view_case_open(b, c, golden, b->cartridge, b->cartridge_length);
}

/* A corpus world's case opened over the cartridge packed for it. */
static inline void view_corpus_case_open(view_bench *b, view_case *c, const sprout_json *golden) {
  size_t length;
  char *bytes = corpus_cartridge(view_text(golden, "world"), &length);
  view_case_open(b, c, golden, bytes, length);
  c->cartridge = bytes;
}

static inline void view_case_close(view_case *c) {
  sprout_state_free(c->state);
  sprout_world_free(c->world);
  free(c->cartridge);
}

/* The canonical text of a golden's member. */
static inline const char *view_canon(sprout_arena *arena, const sprout_json *member, size_t *length) {
  const char *bytes;
  corpus_value_text(arena, member, &bytes, length);
  return bytes;
}

/* What a golden case is called: a bench case by its name, a corpus world by its own. */
static inline const char *view_label(const sprout_json *golden) {
  const sprout_json *name = sprout_json_get(golden, "name");
  return view_text(golden, name != NULL ? "name" : "world");
}

/*
 * Polls a case and compares the view with the oracle's: its canonical JSON, the chip tree over it, the steps it
 * spent, and the fault it raised, if any. Returns the status of the poll, leaving the view in `view`.
 */
static inline sprout_status view_replay(view_bench *b, const sprout_json *golden, view_case *c, sprout_seen_view *view) {
  const sprout_json *expect = sprout_json_get(golden, "expect"), *fault = sprout_json_get(expect, "fault");
  const sprout_json *steps = sprout_json_get(expect, "steps");
  sprout_status status;
  const char *bytes;
  size_t length, wanted_length;
  const char *wanted;
  int before = check_failures;
  status = sprout_view(c->world, c->state, &c->host, view_text(golden, "visit"), view);
  CHECK_INT(status, SPROUT_OK);
  if (status != SPROUT_OK) {
    fprintf(stderr, "  ended: %s\n", view->fault.text);
    return status;
  }
  wanted = view_canon(&b->json, sprout_json_get(expect, "view"), &wanted_length);
  CHECK_INT(sprout_view_json(view, &bytes, &length), SPROUT_OK);
  CHECK(length == wanted_length && memcmp(bytes, wanted, length) == 0);
  if (length != wanted_length || memcmp(bytes, wanted, length) != 0) {
    size_t at = 0;
    while (at < length && at < wanted_length && bytes[at] == wanted[at]) at++;
    fprintf(stderr, "  the view differs at byte %zu:\n    got    ...%.120s\n    wanted ...%.120s\n", at, bytes + (at > 40 ? at - 40 : 0),
            wanted + (at > 40 ? at - 40 : 0));
  }
  {
    sprout_chip_tree tree;
    sprout_json *json;
    sprout_arena *arena = sprout_view_arena(view);
    const char *chips;
    size_t chips_length, wanted_chips_length;
    const char *wanted_chips = view_canon(&b->json, sprout_json_get(expect, "chips"), &wanted_chips_length);
    CHECK_INT(sprout_chip_tree_of(arena, view, &tree), SPROUT_OK);
    json = sprout_chip_tree_json(arena, &tree);
    CHECK(json != NULL);
    if (json != NULL) {
      CHECK_INT(sprout_json_write(arena, json, &chips, &chips_length), SPROUT_OK);
      CHECK(chips_length == wanted_chips_length && memcmp(chips, wanted_chips, chips_length) == 0);
    }
  }
  if (fault->kind == SPROUT_JSON_NULL) {
    CHECK(!view->faulted);
    if (steps->kind == SPROUT_JSON_NUMBER) CHECK_INT(view->steps, steps->number);
  } else {
    CHECK(view->faulted);
    CHECK_STR(view->fault_name, view_text(fault, "name"));
    CHECK_BYTES(view->fault_object.bytes, view->fault_object.length, view_text(fault, "object"));
    CHECK_STR(view->fault.budget, "steps per poll");
    CHECK_INT(view->fault.limit, sprout_json_get(sprout_json_get(golden, "limits"), "pollSteps")->number);
  }
  if (check_failures != before) fprintf(stderr, "  in the case `%s`\n", view_label(golden));
  return status;
}

#endif
