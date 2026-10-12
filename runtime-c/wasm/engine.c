/*
 * The runtime as a WebAssembly module a JavaScript host drives: one world and its live state per
 * instance, freestanding (no WASI, no libc beyond libc.c), every value crossing as bytes. The host
 * writes its input into the buffer `sw_input` hands it, calls one export, and reads the answer from
 * `sw_output`. Memory comes to the runtime in pages from a pool here, which grows the instance's
 * memory and never gives it back, so what the pool holds and what the instance has grown to are both
 * reported. The clock is the host's import `env.now_ms`; the seed is handed in with each turn.
 */
#include <stddef.h>
#include <stdint.h>
#include <string.h>

#include "arena.h"
#include "json.h"
#include "sprout.h"
#include "state.h"
#include "view_json.h"

#define EXPORT(name) __attribute__((export_name(name)))
#define PAGE_BYTES ((size_t)64 * 1024)
#define WASM_PAGE ((size_t)64 * 1024)

extern unsigned char __heap_base;
__attribute__((import_module("env"), import_name("now_ms"))) double host_now_ms(void);

/* ---- the page pool ---- */

/*
 * Every block is a whole number of pages. A freed block joins the free runs, kept in address order and
 * merged with a neighbour it touches, and a request takes the first run long enough, splitting off the
 * rest, so what is released is used again whatever size was asked for.
 */
typedef struct free_run {
  struct free_run *next;
  size_t bytes;
} free_run;

static uintptr_t heap_top;
static free_run *free_runs;
static size_t held_bytes, peak_held_bytes;

static void *grown(size_t bytes) {
  uintptr_t start, end;
  if (heap_top == 0) heap_top = ((uintptr_t)&__heap_base + PAGE_BYTES - 1) & ~(uintptr_t)(PAGE_BYTES - 1);
  start = heap_top;
  end = start + bytes;
  if (end > __builtin_wasm_memory_size(0) * WASM_PAGE) {
    size_t more = (end - __builtin_wasm_memory_size(0) * WASM_PAGE + WASM_PAGE - 1) / WASM_PAGE;
    if (__builtin_wasm_memory_grow(0, more) == (size_t)-1) return NULL;
  }
  heap_top = end;
  return (void *)start;
}

static size_t whole_pages(size_t bytes) { return (bytes + PAGE_BYTES - 1) & ~(PAGE_BYTES - 1); }

static void *pool_alloc(void *ctx, size_t bytes) {
  free_run **at;
  void *block = NULL;
  (void)ctx;
  bytes = whole_pages(bytes);
  for (at = &free_runs; *at != NULL; at = &(*at)->next) {
    free_run *run = *at;
    if (run->bytes < bytes) continue;
    if (run->bytes == bytes) {
      *at = run->next;
    } else {
      free_run *rest = (free_run *)((char *)run + bytes);
      rest->next = run->next;
      rest->bytes = run->bytes - bytes;
      *at = rest;
    }
    block = run;
    break;
  }
  if (block == NULL) block = grown(bytes);
  if (block == NULL) return NULL;
  held_bytes += bytes;
  if (held_bytes > peak_held_bytes) peak_held_bytes = held_bytes;
  return block;
}

static void pool_release(void *ctx, void *block, size_t bytes) {
  free_run *freed = (free_run *)block, **at = &free_runs;
  (void)ctx;
  bytes = whole_pages(bytes);
  held_bytes -= bytes;
  while (*at != NULL && (uintptr_t)*at < (uintptr_t)freed) {
    if ((char *)*at + (*at)->bytes == (char *)freed) {
      /* Joins the run before it, and then perhaps the one after. */
      free_run *before = *at;
      before->bytes += bytes;
      if (before->next != NULL && (char *)before + before->bytes == (char *)before->next) {
        before->bytes += before->next->bytes;
        before->next = before->next->next;
      }
      return;
    }
    at = &(*at)->next;
  }
  freed->bytes = bytes;
  freed->next = *at;
  if (freed->next != NULL && (char *)freed + bytes == (char *)freed->next) {
    freed->bytes += freed->next->bytes;
    freed->next = freed->next->next;
  }
  *at = freed;
}

/* ---- the host record ---- */

static uint64_t turn_seed;
static double turn_began_ms;

static uint64_t host_now(void *ctx) {
  (void)ctx;
  return (uint64_t)(host_now_ms() - turn_began_ms);
}
static uint64_t host_seed(void *ctx) {
  (void)ctx;
  return turn_seed;
}
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

static sprout_host host;
static sprout_world *world;
static sprout_state *state;
static sprout_arena scratch;

/* ---- crossing: one input buffer the host writes into, one output it reads ---- */

static unsigned char *input;
static size_t input_capacity;
static const char *output;
static size_t output_length;

EXPORT("sw_input") unsigned char *sw_input(size_t bytes) {
  if (bytes + 1 > input_capacity) {
    size_t capacity = PAGE_BYTES;
    while (capacity < bytes + 1) capacity *= 2;
    if (input != NULL) pool_release(NULL, input, input_capacity);
    input = (unsigned char *)pool_alloc(NULL, capacity);
    input_capacity = input == NULL ? 0 : capacity;
  }
  return input;
}

EXPORT("sw_output") const char *sw_output(void) { return output; }
EXPORT("sw_output_length") size_t sw_output_length(void) { return output_length; }
EXPORT("sw_held_bytes") size_t sw_held_bytes(void) { return held_bytes; }
EXPORT("sw_peak_held_bytes") size_t sw_peak_held_bytes(void) { return peak_held_bytes; }
EXPORT("sw_memory_bytes") size_t sw_memory_bytes(void) { return __builtin_wasm_memory_size(0) * WASM_PAGE; }

static void budgets(sprout_budgets *b) {
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

static void begin(uint64_t seed) {
  turn_seed = seed;
  turn_began_ms = host_now_ms();
  sprout_arena_reset(&scratch);
  output = NULL;
  output_length = 0;
}

/* `text` as the answer, copied into the scratch arena. */
static int answer(const char *text, size_t length) {
  char *copy = (char *)sprout_arena_take(&scratch, length + 1);
  if (copy == NULL) return SPROUT_NO_MEMORY;
  memcpy(copy, text, length);
  output = copy;
  output_length = length;
  return SPROUT_OK;
}

static int answer_text(const char *text) { return answer(text, strlen(text)); }

/* ---- the exports ---- */

/* Loads the cartridge in the input buffer; the instance's one world. */
EXPORT("sw_load") int sw_load(size_t length) {
  sprout_status status;
  if (host.alloc == NULL) {
    host.page_bytes = PAGE_BYTES;
    host.alloc = pool_alloc;
    host.release = pool_release;
    host.now = host_now;
    host.seed = host_seed;
    host.read = host_read;
    host.write = host_write;
    host.emit = host_emit;
    budgets(&host.budgets);
    status = sprout_arena_init(&scratch, &host);
    if (status != SPROUT_OK) return status;
  }
  begin(0);
  status = sprout_load(&host, (const char *)input, length, &world);
  /* The cartridge is read; the buffer that held it goes back to the pool. */
  pool_release(NULL, input, input_capacity);
  input = NULL;
  input_capacity = 0;
  return status;
}

/* Opens the stored state in the input buffer against the world, or a new one where `length` is 0. */
EXPORT("sw_open") int sw_open(size_t length, size_t world_id_length) {
  sprout_status status;
  begin(0);
  if (length == 0) {
    char *id = (char *)sprout_arena_take(&scratch, world_id_length + 1);
    if (id == NULL) return SPROUT_NO_MEMORY;
    memcpy(id, input, world_id_length);
    status = sprout_state_empty(&host, id, &state);
  } else {
    status = sprout_state_read(&host, (const char *)input, length, &state, NULL);
  }
  if (status != SPROUT_OK) return status;
  return sprout_state_open(state, world, NULL, NULL);
}

/* The state as the store keeps it. */
EXPORT("sw_save") int sw_save(void) {
  begin(0);
  return sprout_state_write(state, &scratch, &output, &output_length);
}

static const char *const KINDS[] = {"said", "told", "refused", "described", "notice", "extension"};
static const char *const RESULTS[] = {"done", "faulted", "refused", "closed", "idle"};

static sprout_json *text(const char *bytes, size_t length) { return sprout_json_text(&scratch, bytes, length); }

/* A turn's outcome as JSON: what it came to, its fault, and every line, by reader. */
static int told(const sprout_outcome *outcome) {
  sprout_json *root = sprout_json_make(&scratch, SPROUT_JSON_OBJECT, 5);
  sprout_json *lines = sprout_json_make(&scratch, SPROUT_JSON_ARRAY, outcome->line_count);
  sprout_json *changed = sprout_json_make(&scratch, SPROUT_JSON_BOOL, 0);
  sprout_json *fault;
  size_t i;
  if (root == NULL || lines == NULL || changed == NULL) return SPROUT_NO_MEMORY;
  sprout_json_adopt(root, "result", text(RESULTS[outcome->result], strlen(RESULTS[outcome->result])));
  changed->boolean = outcome->state_changed;
  sprout_json_adopt(root, "changed", changed);
  fault = outcome->faulted ? text(outcome->fault_name, strlen(outcome->fault_name))
                           : sprout_json_make(&scratch, SPROUT_JSON_NULL, 0);
  sprout_json_adopt(root, "fault", fault);
  for (i = 0; i < outcome->line_count; i++) {
    const sprout_line *line = &outcome->lines[i];
    sprout_json *one = sprout_json_make(&scratch, SPROUT_JSON_ARRAY, 3);
    if (one == NULL) return SPROUT_NO_MEMORY;
    sprout_json_adopt(one, NULL, text(line->recipient, line->recipient_length));
    sprout_json_adopt(one, NULL, text(KINDS[line->kind], strlen(KINDS[line->kind])));
    sprout_json_adopt(one, NULL, text(line->text, line->text_length));
    sprout_json_adopt(lines, NULL, one);
  }
  sprout_json_adopt(root, "lines", lines);
  return sprout_json_write(&scratch, root, &output, &output_length);
}

static int run(sprout_turn_input *in) {
  sprout_outcome outcome;
  sprout_status status = sprout_run_turn(world, state, &host, in, &outcome);
  int wrote;
  if (status != SPROUT_OK) {
    int said = answer_text(status == SPROUT_BAD_INPUT ? outcome.fault.text : sprout_status_text(status));
    (void)said;
    return status;
  }
  wrote = told(&outcome);
  sprout_outcome_free(&outcome);
  return wrote;
}

/* The C string of `length` bytes at `at` in the input, copied into the scratch arena. */
static const char *input_string(size_t at, size_t length) {
  char *copy = (char *)sprout_arena_take(&scratch, length + 1);
  if (copy != NULL) memcpy(copy, input + at, length);
  return copy;
}

/* An arrival: the input holds the visit and then the nickname. */
EXPORT("sw_arrive") int sw_arrive(size_t visit_length, size_t nickname_length, uint64_t seed, uint64_t instant) {
  sprout_turn_input in;
  sprout_admission admission;
  const char *visit, *nickname;
  sprout_status status;
  begin(seed);
  visit = input_string(0, visit_length);
  nickname = input_string(visit_length, nickname_length);
  if (visit == NULL || nickname == NULL) return SPROUT_NO_MEMORY;
  status = sprout_admit(world, state, &host, visit, nickname, nickname_length, &admission);
  if (status != SPROUT_OK) return status;
  if (admission.reason != SPROUT_NICKNAME_OK) {
    int said = answer(admission.words.bytes, admission.words.length);
    sprout_admission_free(&admission);
    return said == SPROUT_OK ? SPROUT_BAD_INPUT : said;
  }
  memset(&in, 0, sizeof in);
  in.kind = SPROUT_TURN_ARRIVAL;
  in.instant = instant;
  in.visit = visit;
  in.nickname = (const char *)sprout_arena_copy(&scratch, admission.kept.bytes, admission.kept.length);
  in.nickname_length = admission.kept.length;
  sprout_admission_free(&admission);
  if (in.nickname == NULL) return SPROUT_NO_MEMORY;
  return run(&in);
}

/* A reading's fillings from a view's fillers, as `sw_readings` writes them. */
static int fillings_of(const sprout_json *fillers, sprout_filling **out) {
  sprout_filling *found = (sprout_filling *)sprout_arena_take(&scratch, (fillers->count + 1) * sizeof *found);
  size_t i, j;
  if (found == NULL) return SPROUT_NO_MEMORY;
  for (i = 0; i < fillers->count; i++) {
    const sprout_json *one = fillers->items[i];
    const sprout_json *binds = sprout_json_get(one, "binds"), *id = sprout_json_get(one, "id");
    const sprout_json *ids = sprout_json_get(one, "ids"), *to = sprout_json_get(one, "to");
    const sprout_json *direction = sprout_json_get(one, "direction"), *label = sprout_json_get(one, "label");
    found[i].role = sprout_json_get(one, "role")->bytes;
    if (strcmp(binds->bytes, "object") == 0) {
      found[i].binds = SPROUT_FILL_OBJECT;
      found[i].id = id->bytes;
    } else if (strcmp(binds->bytes, "set") == 0) {
      const char **list = (const char **)sprout_arena_take(&scratch, (ids->count + 1) * sizeof *list);
      if (list == NULL) return SPROUT_NO_MEMORY;
      for (j = 0; j < ids->count; j++) list[j] = ids->items[j]->bytes;
      found[i].binds = SPROUT_FILL_SET;
      found[i].ids = list;
      found[i].id_count = ids->count;
    } else if (strcmp(binds->bytes, "exit") == 0) {
      found[i].binds = SPROUT_FILL_EXIT;
      found[i].id = to->bytes;
      found[i].label = label->bytes;
      found[i].direction = direction->kind == SPROUT_JSON_STRING ? direction->bytes : NULL;
    } else {
      found[i].binds = SPROUT_FILL_UNBOUND;
    }
  }
  *out = found;
  return SPROUT_OK;
}

/*
 * A command: the input holds `{"visit", "verb", "fillers", "typed"}`, a reading a view offered, so
 * no parser runs here (the TypeScript parser is the host's).
 */
EXPORT("sw_command") int sw_command(size_t length, uint64_t seed, uint64_t instant) {
  const sprout_json *root, *visit, *verb, *fillers, *typed;
  const sprout_stored_visitor *visitor;
  sprout_filling *fillings;
  sprout_reading reading;
  sprout_turn_input in;
  sprout_json *tree;
  int status;
  begin(seed);
  status = sprout_json_read(&scratch, (const char *)input, length, &tree, NULL);
  if (status != SPROUT_OK) return status;
  root = tree;
  visit = sprout_json_get(root, "visit");
  verb = sprout_json_get(root, "verb");
  fillers = sprout_json_get(root, "fillers");
  typed = sprout_json_get(root, "typed");
  visitor = sprout_state_find_visitor(state, (sprout_str){visit->bytes, visit->length});
  if (visitor == NULL) return answer_text("no such visitor") == SPROUT_OK ? SPROUT_BAD_INPUT : SPROUT_NO_MEMORY;
  status = fillings_of(fillers, &fillings);
  if (status != SPROUT_OK) return status;
  memset(&reading, 0, sizeof reading);
  reading.verb = verb->bytes;
  reading.actor = (const char *)sprout_arena_copy(&scratch, visitor->instance.bytes, visitor->instance.length);
  reading.filling_count = fillers->count;
  reading.fillings = fillings;
  memset(&in, 0, sizeof in);
  in.kind = SPROUT_TURN_COMMAND;
  in.instant = instant;
  in.visit = visit->bytes;
  in.reading = &reading;
  in.text = typed->bytes;
  in.text_length = typed->length;
  return run(&in);
}

/* A visitor's scene, the input holding the visit: `{"view", "verbs"}`, the view's JSON beside its verbs. */
EXPORT("sw_scene") int sw_scene(size_t visit_length) {
  sprout_seen_view view;
  sprout_json *tree, *verbs, *root;
  sprout_status status;
  size_t i;
  begin(0);
  status = sprout_scene(world, state, &host, input_string(0, visit_length), &view);
  if (status != SPROUT_OK) return status;
  tree = sprout_view_tree(&scratch, &view);
  verbs = sprout_json_make(&scratch, SPROUT_JSON_ARRAY, view.verb_count);
  root = sprout_json_make(&scratch, SPROUT_JSON_OBJECT, 2);
  if (tree == NULL || verbs == NULL || root == NULL) {
    sprout_view_free(&view);
    return SPROUT_NO_MEMORY;
  }
  for (i = 0; i < view.verb_count; i++) sprout_json_adopt(verbs, NULL, text(view.verbs[i], strlen(view.verbs[i])));
  sprout_json_adopt(root, "view", tree);
  sprout_json_adopt(root, "verbs", verbs);
  status = sprout_json_write(&scratch, root, &output, &output_length);
  sprout_view_free(&view);
  return status;
}

/* One verb's readings for a visitor, the input holding the visit and then the verb. */
EXPORT("sw_readings") int sw_readings(size_t visit_length, size_t verb_length) {
  sprout_seen_view view;
  sprout_json *tree;
  sprout_status status;
  const char *visit, *verb;
  begin(0);
  visit = input_string(0, visit_length);
  verb = input_string(visit_length, verb_length);
  status = sprout_readings_for(world, state, &host, visit, verb, &scratch, &view);
  if (status != SPROUT_OK) return status;
  tree = sprout_view_tree(&scratch, &view);
  if (tree == NULL) return SPROUT_NO_MEMORY;
  return sprout_json_write(&scratch, tree, &output, &output_length);
}
