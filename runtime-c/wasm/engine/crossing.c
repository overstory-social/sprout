/*
 * The crossing between the host and the runtime (engine.h): the host record, one input buffer the host writes into
 * and one answer it reads, and the calls that load a world, open a stored state, save it, and set the host's
 * budgets and log depth. No figure is the runtime's own: the budgets start at the spec's Runtime budgets table and
 * the host sets its own through sw_budgets.
 */
#include <string.h>

#include "engine.h"
#include "state.h"

__attribute__((import_module("env"), import_name("now_ms"))) double host_now_ms(void);

/* What an arena adds to each page it asks for, at most: a page's header (arena.c). The runtime's pages are a pool
 * page less this, so each takes one pool page and not two. */
#define ARENA_HEADER ((size_t)64)

/* The largest input the host may hand in at once. */
#define INPUT_LIMIT ((size_t)1 << 30)

wasm_engine the_engine;

static uint64_t host_now(void *ctx) { return (uint64_t)(host_now_ms() - ((wasm_engine *)ctx)->turn_began_ms); }
static uint64_t host_seed(void *ctx) { return ((wasm_engine *)ctx)->turn_seed; }
static bool host_read(void *ctx, const char *key, const char **bytes, size_t *length) {
  (void)ctx, (void)key, (void)bytes, (void)length;
  return false;
}
static bool host_write(void *ctx, const char *key, const char *bytes, size_t length) {
  (void)ctx, (void)key, (void)bytes, (void)length;
  return true;
}
static bool host_emit(void *ctx, const char *recipient, size_t recipient_length, const char *text,
                      size_t text_length) {
  (void)ctx, (void)recipient, (void)recipient_length, (void)text, (void)text_length;
  return true;
}

/* The spec's Runtime budgets table; a row it gives no figure for stays unset until the host sets one. */
static void spec_budgets(sprout_budgets *b) {
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
  b->longest_pass_seconds = (sprout_limit){true, 3600};
  b->nickname_characters = (sprout_limit){true, 24};
  b->list_elements = (sprout_limit){true, 16};
}

static sprout_status set_up(wasm_engine *e) {
  sprout_status status;
  if (e->host.alloc != NULL) return SPROUT_OK;
  e->host.ctx = e;
  e->host.page_bytes = PAGE_BYTES - ARENA_HEADER;
  e->host.alloc = pool_alloc;
  e->host.release = pool_release;
  e->host.now = host_now;
  e->host.seed = host_seed;
  e->host.read = host_read;
  e->host.write = host_write;
  e->host.emit = host_emit;
  e->host.accounts = true;
  e->log_depth = SPROUT_LOG_PLAY;
  spec_budgets(&e->host.budgets);
  status = sprout_arena_init(&e->scratch, &e->host);
  if (status != SPROUT_OK) e->host.alloc = NULL;
  return status;
}

void engine_begin(wasm_engine *e, uint64_t seed) {
  e->turn_seed = seed;
  e->turn_began_ms = host_now_ms();
  e->output = NULL;
  e->output_length = 0;
  sprout_arena_reset(&e->scratch);
}

int engine_answer(wasm_engine *e, int status, const char *text, size_t length) {
  char *copy = (char *)sprout_arena_take(&e->scratch, length + 1);
  if (copy == NULL) return SPROUT_NO_MEMORY;
  memcpy(copy, text, length);
  e->output = copy;
  e->output_length = length;
  return status;
}

int engine_answer_text(wasm_engine *e, int status, const char *text) { return engine_answer(e, status, text, strlen(text)); }

int engine_refuse(wasm_engine *e, const char *why) { return engine_answer_text(e, SPROUT_BAD_INPUT, why); }

int engine_answer_json(wasm_engine *e, const sprout_json *node) {
  if (node == NULL) return SPROUT_NO_MEMORY;
  return sprout_json_write_value(&e->scratch, node, &e->output, &e->output_length);
}

bool engine_ready(const wasm_engine *e) { return e->world != NULL && e->state != NULL; }

const char *engine_input_string(wasm_engine *e, size_t at, size_t length) {
  if (e->input == NULL || length > e->input_capacity || at > e->input_capacity - length) return NULL;
  return sprout_arena_copy(&e->scratch, (const char *)e->input + at, length);
}

int engine_input_json(wasm_engine *e, size_t length, const char *what, sprout_json **root) {
  int status;
  if (e->input == NULL || length > e->input_capacity) return engine_refuse(e, "Hand the input in through sw_input first.");
  status = sprout_json_read(&e->scratch, (const char *)e->input, length, root, NULL);
  if (status == SPROUT_BAD_INPUT) return engine_refuse(e, what);
  return status;
}

const char *engine_string_at(const sprout_json *object, const char *key) {
  const sprout_json *found = object == NULL ? NULL : sprout_json_get(object, key);
  if (found == NULL || found->kind != SPROUT_JSON_STRING || strlen(found->bytes) != found->length) return NULL;
  return found->bytes;
}

sprout_json *engine_text(wasm_engine *e, const char *bytes, size_t length) { return sprout_json_text(&e->scratch, bytes, length); }

sprout_json *engine_number(wasm_engine *e, double number) {
  sprout_json *node = sprout_json_make(&e->scratch, SPROUT_JSON_NUMBER, 0);
  if (node != NULL) node->number = number;
  return node;
}

sprout_json *engine_null(wasm_engine *e) { return sprout_json_make(&e->scratch, SPROUT_JSON_NULL, 0); }

sprout_json *engine_bool(wasm_engine *e, bool value) {
  sprout_json *node = sprout_json_make(&e->scratch, SPROUT_JSON_BOOL, 0);
  if (node != NULL) node->boolean = value;
  return node;
}

/* ---- the buffers ---- */

/* A buffer of at least `bytes` bytes and a NUL for the host to write into; NULL past the limit or when memory runs out. */
EXPORT("sw_input") unsigned char *sw_input(size_t bytes) {
  wasm_engine *e = &the_engine;
  if (bytes >= INPUT_LIMIT) return NULL;
  if (bytes + 1 > e->input_capacity) {
    size_t capacity = PAGE_BYTES;
    while (capacity < bytes + 1) capacity *= 2;
    pool_release(NULL, e->input, e->input_capacity);
    e->input = (unsigned char *)pool_alloc(NULL, capacity);
    e->input_capacity = e->input == NULL ? 0 : capacity;
  }
  return e->input;
}

EXPORT("sw_output") const char *sw_output(void) { return the_engine.output; }
EXPORT("sw_output_length") size_t sw_output_length(void) { return the_engine.output_length; }

/* ---- the world and its state ---- */

/* Loads the cartridge in the input buffer as the instance's one world, replacing any before it and its state. */
EXPORT("sw_load") int sw_load(size_t length) {
  wasm_engine *e = &the_engine;
  sprout_world *loaded = NULL;
  sprout_refusal refusal;
  sprout_status status = set_up(e);
  if (status != SPROUT_OK) return status;
  engine_begin(e, 0);
  if (e->input == NULL || length > e->input_capacity) return engine_refuse(e, "Hand the cartridge in through sw_input first.");
  refusal.text[0] = '\0';
  status = sprout_load_explained(&e->host, (const char *)e->input, length, &loaded, &refusal);
  /* The cartridge is read; the buffer that held it goes back to the pool. */
  pool_release(NULL, e->input, e->input_capacity);
  e->input = NULL;
  e->input_capacity = 0;
  if (status != SPROUT_OK) return refusal.text[0] == '\0' ? status : engine_answer_text(e, status, refusal.text);
  if (e->state != NULL) sprout_state_free(e->state);
  if (e->world != NULL) sprout_world_free(e->world);
  e->state = NULL;
  e->world = loaded;
  return SPROUT_OK;
}

/*
 * Opens the stored state in the input buffer, `{world, serial, instances, visitors, tombstones}` as the store keeps
 * it, against the world as the instance's live state; or, where `length` is 0, a new one for the world id there.
 */
EXPORT("sw_open") int sw_open(size_t length, size_t world_id_length) {
  wasm_engine *e = &the_engine;
  sprout_state *opened = NULL;
  sprout_refusal refusal;
  sprout_status status;
  engine_begin(e, 0);
  if (e->world == NULL) return engine_refuse(e, "Load a cartridge before opening a state.");
  if (e->input == NULL || length > e->input_capacity || world_id_length > e->input_capacity)
    return engine_refuse(e, "Hand the state in through sw_input first.");
  refusal.text[0] = '\0';
  if (length == 0) {
    const char *id = engine_input_string(e, 0, world_id_length);
    if (id == NULL) return SPROUT_NO_MEMORY;
    status = sprout_state_empty(&e->host, id, &opened);
  } else {
    status = sprout_state_read(&e->host, (const char *)e->input, length, &opened, &refusal);
  }
  if (status == SPROUT_OK) status = sprout_state_open(opened, e->world, &refusal);
  if (status != SPROUT_OK) {
    if (opened != NULL) sprout_state_free(opened);
    return refusal.text[0] == '\0' ? status : engine_answer_text(e, status, refusal.text);
  }
  if (e->state != NULL) sprout_state_free(e->state);
  e->state = opened;
  return SPROUT_OK;
}

/* The live state as the store keeps it. */
EXPORT("sw_save") int sw_save(void) {
  wasm_engine *e = &the_engine;
  engine_begin(e, 0);
  if (!engine_ready(e)) return engine_refuse(e, "There is no state to save.");
  return sprout_state_write(e->state, &e->scratch, &e->output, &e->output_length);
}

/* ---- the host's terms ---- */

/* Every entry this instance gives from now on at debug depth (1), with every effect, or at play depth (0). */
EXPORT("sw_log_depth") void sw_log_depth(int debug) { the_engine.log_depth = debug ? SPROUT_LOG_DEBUG : SPROUT_LOG_PLAY; }

/*
 * The host's budgets, the input holding them as an object by the spec's names (`steps`, `pollSteps`, …, and the
 * static cap `listElements`), each a whole number or null for none; a row not named keeps its figure.
 */
EXPORT("sw_budgets") int sw_budgets(size_t length) {
  wasm_engine *e = &the_engine;
  /* Read into a copy, so budgets refused in part leave the host's as they were. */
  sprout_budgets set = e->host.budgets;
  struct {
    const char *name;
    sprout_limit *limit;
  } rows[] = {{"steps", &set.steps},
              {"pollSteps", &set.poll_steps},
              {"output", &set.output},
              {"events", &set.events},
              {"cascadeDepth", &set.cascade_depth},
              {"passageDepth", &set.passage_depth},
              {"setRoleObjects", &set.set_role_objects},
              {"spawnsPerTurn", &set.spawns},
              {"shortestWakeSeconds", &set.shortest_wake_seconds},
              {"pendingWakesPerObject", &set.pending_wakes},
              {"longestPassSeconds", &set.longest_pass_seconds},
              {"peoplePerPlace", &set.people_per_place},
              {"extensionEffects", &set.extension_effects},
              {"nicknameCharacters", &set.nickname_characters},
              {"wallClockMs", &set.wall_clock_ms},
              {"listElements", &set.list_elements}};
  sprout_json *root;
  size_t i, j;
  int status = set_up(e);
  if (status != SPROUT_OK) return status;
  set = e->host.budgets;
  engine_begin(e, 0);
  status = engine_input_json(e, length, "The budgets are not JSON.", &root);
  if (status != SPROUT_OK) return status;
  if (root->kind != SPROUT_JSON_OBJECT) return engine_refuse(e, "The budgets are an object of figures by name.");
  for (i = 0; i < root->count; i++) {
    const sprout_json *one = root->items[i];
    for (j = 0; j < sizeof rows / sizeof *rows && strcmp(one->key, rows[j].name) != 0; j++) continue;
    if (j == sizeof rows / sizeof *rows) return engine_refuse(e, "The budgets name a row the runtime has none of.");
    if (one->kind == SPROUT_JSON_NULL) {
      *rows[j].limit = (sprout_limit){false, 0};
    } else if (one->kind == SPROUT_JSON_NUMBER && one->number >= 0 && one->number == (double)(uint64_t)one->number) {
      *rows[j].limit = (sprout_limit){true, (uint64_t)one->number};
    } else {
      return engine_refuse(e, "A budget is a whole number from 0, or null for none.");
    }
  }
  e->host.budgets = set;
  return SPROUT_OK;
}

/* The most instances the host will store for this world in the turns that follow; a negative bound is none. */
EXPORT("sw_may_hold") void sw_may_hold(double bound) {
  the_engine.host.budgets.instances = bound < 0 ? (sprout_limit){false, 0} : (sprout_limit){true, (uint64_t)bound};
}
