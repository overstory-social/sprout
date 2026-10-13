/*
 * The runtime as a WebAssembly module a JavaScript host drives (the spec's The host contract): one
 * world and its live state per instance, freestanding (no WASI, no libc beyond libc.c), every value
 * crossing as bytes. The host
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
#include "logged.h"
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
  if (block == NULL) return;
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

/*
 * What an arena adds to each page it asks for, at most: a page's header (arena.c). The runtime's pages
 * are a pool page less this, so each takes one pool page and not two.
 */
#define ARENA_HEADER ((size_t)64)

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

/* The largest input the host may hand in at once. */
#define INPUT_LIMIT ((size_t)1 << 30)

static unsigned char *input;
static size_t input_capacity;
static const char *output;
static size_t output_length;

/* A buffer of at least `bytes` bytes and a NUL for the host to write into; NULL past the limit or when memory runs out. */
EXPORT("sw_input") unsigned char *sw_input(size_t bytes) {
  if (bytes >= INPUT_LIMIT) return NULL;
  if (bytes + 1 > input_capacity) {
    size_t capacity = PAGE_BYTES;
    while (capacity < bytes + 1) capacity *= 2;
    pool_release(NULL, input, input_capacity);
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

/* The spec's Runtime budgets table, as host/host.c sets it; a row it gives no figure for stays unset. */
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
  output = NULL;
  output_length = 0;
  sprout_arena_reset(&scratch);
}

/* `text` as the answer, copied into the scratch arena; `status` given back, or SPROUT_NO_MEMORY. */
static int answer(int status, const char *text, size_t length) {
  char *copy = (char *)sprout_arena_take(&scratch, length + 1);
  if (copy == NULL) return SPROUT_NO_MEMORY;
  memcpy(copy, text, length);
  output = copy;
  output_length = length;
  return status;
}

static int answer_text(int status, const char *text) { return answer(status, text, strlen(text)); }

/* A refusal of what the host handed in, in words. */
static int refuse(const char *why) { return answer_text(SPROUT_BAD_INPUT, why); }

static bool ready(void) { return world != NULL && state != NULL; }

/* ---- the exports ---- */

/* Loads the cartridge in the input buffer as the instance's one world, replacing any before it and its state. */
EXPORT("sw_load") int sw_load(size_t length) {
  sprout_world *loaded = NULL;
  sprout_refusal refusal;
  sprout_status status;
  if (host.alloc == NULL) {
    host.page_bytes = PAGE_BYTES - ARENA_HEADER;
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
  if (input == NULL || length > input_capacity) return refuse("Hand the cartridge in through sw_input first.");
  refusal.text[0] = '\0';
  status = sprout_load_explained(&host, (const char *)input, length, &loaded, &refusal);
  /* The cartridge is read; the buffer that held it goes back to the pool. */
  pool_release(NULL, input, input_capacity);
  input = NULL;
  input_capacity = 0;
  if (status != SPROUT_OK) return refusal.text[0] == '\0' ? status : answer_text(status, refusal.text);
  if (state != NULL) sprout_state_free(state);
  if (world != NULL) sprout_world_free(world);
  state = NULL;
  world = loaded;
  return SPROUT_OK;
}

/* Opens the stored state in the input buffer against the world, or a new one for the world id there where `length` is 0. */
EXPORT("sw_open") int sw_open(size_t length, size_t world_id_length) {
  sprout_state *opened = NULL;
  sprout_refusal refusal;
  sprout_status status;
  begin(0);
  if (world == NULL) return refuse("Load a cartridge before opening a state.");
  if (input == NULL || length > input_capacity || world_id_length > input_capacity)
    return refuse("Hand the state in through sw_input first.");
  refusal.text[0] = '\0';
  if (length == 0) {
    const char *id = (const char *)sprout_arena_copy(&scratch, (const char *)input, world_id_length);
    if (id == NULL) return SPROUT_NO_MEMORY;
    status = sprout_state_empty(&host, id, &opened);
  } else {
    status = sprout_state_read(&host, (const char *)input, length, &opened, &refusal);
  }
  if (status == SPROUT_OK) status = sprout_state_open(opened, world, NULL, &refusal);
  if (status != SPROUT_OK) {
    if (opened != NULL) sprout_state_free(opened);
    return refusal.text[0] == '\0' ? status : answer_text(status, refusal.text);
  }
  if (state != NULL) sprout_state_free(state);
  state = opened;
  return SPROUT_OK;
}

/* The state as the store keeps it. */
EXPORT("sw_save") int sw_save(void) {
  begin(0);
  if (!ready()) return refuse("There is no state to save.");
  return sprout_state_write(state, &scratch, &output, &output_length);
}

static const char *const KINDS[] = {"said", "told", "refused", "described", "notice", "extension"};
static const char *const RESULTS[] = {"done", "faulted", "refused", "closed", "idle"};

/* How much of each turn the entries this instance gives keep: play depth unless the host asks for debug. */
static sprout_log_depth log_depth = SPROUT_LOG_PLAY;

/* Every entry this instance gives from now on at debug depth (1), with every effect, or at play depth (0). */
EXPORT("sw_log_depth") void sw_log_depth(int debug) { log_depth = debug ? SPROUT_LOG_DEBUG : SPROUT_LOG_PLAY; }

static sprout_json *text(const char *bytes, size_t length) { return sprout_json_text(&scratch, bytes, length); }

/* The answer is `head`, the JSON text of an object, with the member `"name":value` (`value` JSON text too) put last. */
static int with_member(const char *head, size_t head_length, const char *name, const char *value, size_t value_length) {
  size_t name_length = strlen(name), at = head_length - 1;
  char *joined = (char *)sprout_arena_take(&scratch, head_length + name_length + value_length + 5);
  if (joined == NULL) return SPROUT_NO_MEMORY;
  /* The object's closing brace gives way to `,"name":value}`. */
  memcpy(joined, head, at);
  joined[at++] = ',';
  joined[at++] = '"';
  memcpy(joined + at, name, name_length);
  at += name_length;
  joined[at++] = '"';
  joined[at++] = ':';
  memcpy(joined + at, value, value_length);
  at += value_length;
  joined[at++] = '}';
  joined[at] = '\0';
  output = joined;
  output_length = at;
  return SPROUT_OK;
}

/*
 * A turn's outcome as JSON: what it came to, whether the stored state changed, its fault in the language's
 * shape, the words a host tells a person outside the world where an arrival was closed or faulted, every
 * line by reader, what it said as the language's effects, and who it cut short, by instance. `changes` is
 * what the store writes, null where it wrote nothing; `stale` whose views it made stale, null where it faulted.
 * `entry` is what the log keeps of it at this instance's depth, null for a command, whose entry keeps what
 * the host's parser read (#624).
 */
static int told(const sprout_outcome *outcome) {
  sprout_json *root = sprout_json_make(&scratch, SPROUT_JSON_OBJECT, 9);
  sprout_json *lines = sprout_json_make(&scratch, SPROUT_JSON_ARRAY, outcome->line_count);
  sprout_json *cuts = sprout_json_make(&scratch, SPROUT_JSON_ARRAY, outcome->cut_count);
  sprout_json *stale = sprout_json_make(&scratch, outcome->committed ? SPROUT_JSON_ARRAY : SPROUT_JSON_NULL,
                                        outcome->stale_count);
  sprout_json *changed = sprout_json_make(&scratch, SPROUT_JSON_BOOL, 0);
  sprout_json *fault, *words, *entry = NULL;
  const char *head, *changes = "null";
  size_t i, head_length, changes_length = 4;
  int status;
  if (root == NULL || lines == NULL || cuts == NULL || stale == NULL || changed == NULL) return SPROUT_NO_MEMORY;
  sprout_json_adopt(root, "result", text(RESULTS[outcome->result], strlen(RESULTS[outcome->result])));
  changed->boolean = outcome->state_changed;
  sprout_json_adopt(root, "changed", changed);
  if (outcome->faulted) {
    sprout_str detail = {outcome->fault.text, strlen(outcome->fault.text)};
    fault = sprout_logged_fault(&scratch, outcome->fault_name, detail, &outcome->fault_about, false);
  } else {
    fault = sprout_json_make(&scratch, SPROUT_JSON_NULL, 0);
  }
  sprout_json_adopt(root, "fault", fault);
  words = outcome->words != NULL ? text(outcome->words, strlen(outcome->words))
                                 : sprout_json_make(&scratch, SPROUT_JSON_NULL, 0);
  sprout_json_adopt(root, "words", words);
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
  sprout_json_adopt(root, "effects", sprout_logged_effects(&scratch, outcome, false));
  for (i = 0; i < outcome->cut_count; i++)
    sprout_json_adopt(cuts, NULL, text(outcome->cuts[i].id.bytes, outcome->cuts[i].id.length));
  sprout_json_adopt(root, "cutShort", cuts);
  for (i = 0; outcome->committed && i < outcome->stale_count; i++)
    sprout_json_adopt(stale, NULL, text(outcome->stale[i].bytes, outcome->stale[i].length));
  sprout_json_adopt(root, "stale", stale);
  if (outcome->has_log && outcome->log.kind != SPROUT_TURN_COMMAND) {
    status = sprout_logged_entry(&scratch, &host, outcome, log_depth, &entry);
    if (status != SPROUT_OK) return status;
  }
  sprout_json_adopt(root, "entry", entry != NULL ? entry : sprout_json_make(&scratch, SPROUT_JSON_NULL, 0));
  if (root->count != 9 || lines->count != outcome->line_count || cuts->count != outcome->cut_count ||
      (outcome->committed && stale->count != outcome->stale_count))
    return SPROUT_NO_MEMORY;
  status = sprout_json_write(&scratch, root, &head, &head_length);
  if (status != SPROUT_OK) return status;
  /* The changes are written from the state's own records, as the store keeps them, and put in as they are. */
  if (outcome->has_changes) {
    status = sprout_changes_write(state, &outcome->changes, &scratch, &changes, &changes_length);
    if (status != SPROUT_OK) return status;
  }
  return with_member(head, head_length, "changes", changes, changes_length);
}

static int run(sprout_turn_input *in) {
  sprout_outcome outcome;
  sprout_status status = sprout_run_turn(world, state, &host, in, &outcome);
  int said = status == SPROUT_OK ? told(&outcome)
             : status == SPROUT_BAD_INPUT ? answer_text(status, outcome.fault.text)
                                          : answer_text(status, sprout_status_text(status));
  sprout_outcome_free(&outcome);
  return said;
}

/* The C string of `length` bytes at `at` in the input, copied into the scratch arena; NULL past the input. */
static const char *input_string(size_t at, size_t length) {
  if (input == NULL || length > input_capacity || at > input_capacity - length) return NULL;
  return sprout_arena_copy(&scratch, (const char *)input + at, length);
}

/* Catch-up as one maintenance turn at `instant`, as a host runs it before it admits anyone. */
EXPORT("sw_maintenance") int sw_maintenance(uint64_t seed, uint64_t instant) {
  sprout_turn_input in;
  begin(seed);
  if (!ready()) return refuse("Load a cartridge and open a state first.");
  memset(&in, 0, sizeof in);
  in.kind = SPROUT_TURN_MAINTENANCE;
  in.instant = instant;
  return run(&in);
}

/* An arrival: the input holds the visit and then the nickname. */
EXPORT("sw_arrive") int sw_arrive(size_t visit_length, size_t nickname_length, uint64_t seed, uint64_t instant) {
  sprout_turn_input in;
  sprout_admission admission;
  const char *visit, *nickname;
  sprout_status status;
  begin(seed);
  if (!ready()) return refuse("Load a cartridge and open a state first.");
  visit = input_string(0, visit_length);
  nickname = input_string(visit_length, nickname_length);
  if (visit == NULL || nickname == NULL) return refuse("Hand the visit and nickname in through sw_input first.");
  status = sprout_admit(world, state, &host, visit, nickname, nickname_length, &admission);
  if (status != SPROUT_OK) return answer_text(status, sprout_status_text(status));
  if (admission.reason != SPROUT_NICKNAME_OK) {
    int said = answer(SPROUT_BAD_INPUT, admission.words.bytes, admission.words.length);
    sprout_admission_free(&admission);
    return said;
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

/* A departure: the input holds the visit. */
EXPORT("sw_depart") int sw_depart(size_t visit_length, uint64_t seed, uint64_t instant) {
  sprout_turn_input in;
  const char *visit;
  begin(seed);
  if (!ready()) return refuse("Load a cartridge and open a state first.");
  visit = input_string(0, visit_length);
  if (visit == NULL) return refuse("Hand the visit in through sw_input first.");
  memset(&in, 0, sizeof in);
  in.kind = SPROUT_TURN_DEPARTURE;
  in.instant = instant;
  in.visit = visit;
  return run(&in);
}

/* A tick of the place whose id the input holds; `seed` is the step's, which the turn's own is drawn from with the place's path. */
EXPORT("sw_tick") int sw_tick(size_t place_length, uint64_t seed, uint64_t instant) {
  sprout_turn_input in;
  const char *place;
  begin(seed);
  if (!ready()) return refuse("Load a cartridge and open a state first.");
  place = input_string(0, place_length);
  if (place == NULL) return refuse("Hand the place in through sw_input first.");
  memset(&in, 0, sizeof in);
  in.kind = SPROUT_TURN_TICK;
  in.instant = instant;
  in.place = place;
  return run(&in);
}

/*
 * The wake asked under `serial` of the object whose id the input holds, its `nth` this step (from 0); `seed` is the
 * step's, which the turn's own is drawn from with the object's path and `nth`.
 */
EXPORT("sw_wake") int sw_wake(size_t object_length, uint64_t serial, uint64_t nth, uint64_t seed, uint64_t instant) {
  sprout_turn_input in;
  const char *object;
  begin(seed);
  if (!ready()) return refuse("Load a cartridge and open a state first.");
  object = input_string(0, object_length);
  if (object == NULL) return refuse("Hand the object in through sw_input first.");
  memset(&in, 0, sizeof in);
  in.kind = SPROUT_TURN_WAKE;
  in.instant = instant;
  in.object = object;
  in.serial = serial;
  in.nth = nth;
  return run(&in);
}

/* The string member `key` of `object`, or NULL where it has none, or one holding a NUL, which no id or line does. */
static const char *string_at(const sprout_json *object, const char *key) {
  const sprout_json *found = object == NULL ? NULL : sprout_json_get(object, key);
  if (found == NULL || found->kind != SPROUT_JSON_STRING || strlen(found->bytes) != found->length) return NULL;
  return found->bytes;
}

/* The array member `key` of `object`, or NULL where it has none. */
static const sprout_json *array_at(const sprout_json *object, const char *key) {
  const sprout_json *found = object == NULL ? NULL : sprout_json_get(object, key);
  return found != NULL && found->kind == SPROUT_JSON_ARRAY ? found : NULL;
}

/* A reading's fillings from fillers as a view writes them, or as the readings file does (`value`); words for what is wrong. */
static const char *fillings_of(const sprout_json *fillers, sprout_filling **out) {
  sprout_filling *found = (sprout_filling *)sprout_arena_take(&scratch, (fillers->count + 1) * sizeof *found);
  size_t i, j;
  if (found == NULL) return "There is no memory for the reading.";
  for (i = 0; i < fillers->count; i++) {
    const sprout_json *one = fillers->items[i];
    const char *role = string_at(one, "role"), *binds = string_at(one, "binds");
    const sprout_json *ids = array_at(one, "ids"), *value = one == NULL ? NULL : sprout_json_get(one, "value");
    if (role == NULL || binds == NULL) return "A filler names no role, or does not say what it binds.";
    found[i].role = role;
    if (strcmp(binds, "unbound") == 0) {
      found[i].binds = SPROUT_FILL_UNBOUND;
    } else if (strcmp(binds, "object") == 0 && string_at(one, "id") != NULL) {
      found[i].binds = SPROUT_FILL_OBJECT;
      found[i].id = string_at(one, "id");
    } else if (strcmp(binds, "set") == 0 && ids != NULL) {
      const char **list = (const char **)sprout_arena_take(&scratch, (ids->count + 1) * sizeof *list);
      if (list == NULL) return "There is no memory for the reading.";
      for (j = 0; j < ids->count; j++) {
        if (ids->items[j]->kind != SPROUT_JSON_STRING) return "A set filler holds something other than ids.";
        list[j] = ids->items[j]->bytes;
      }
      found[i].binds = SPROUT_FILL_SET;
      found[i].ids = list;
      found[i].id_count = ids->count;
    } else if (strcmp(binds, "exit") == 0 && string_at(one, "to") != NULL && string_at(one, "label") != NULL) {
      found[i].binds = SPROUT_FILL_EXIT;
      found[i].id = string_at(one, "to");
      found[i].label = string_at(one, "label");
      found[i].direction = string_at(one, "direction");
    } else if (strcmp(binds, "value") == 0 && value != NULL && value->kind == SPROUT_JSON_STRING) {
      found[i].binds = SPROUT_FILL_TEXT;
      found[i].text = value->bytes;
    } else if (strcmp(binds, "value") == 0 && value != NULL && value->kind == SPROUT_JSON_NUMBER) {
      found[i].binds = SPROUT_FILL_NUMBER;
      found[i].number = value->number;
    } else {
      return "A filler binds what no role takes, or lacks what it binds.";
    }
  }
  *out = found;
  return NULL;
}

/* What the host's parser drew and said before the reading's own lines, as the readings file writes them. */
static const char *parsing_of(const sprout_json *root, sprout_reading *reading) {
  const sprout_json *draws = array_at(root, "draws"), *asides = array_at(root, "asides");
  size_t i;
  if (draws != NULL && draws->count > 0) {
    uint64_t *bounds = (uint64_t *)sprout_arena_take(&scratch, draws->count * sizeof *bounds);
    if (bounds == NULL) return "There is no memory for the reading.";
    for (i = 0; i < draws->count; i++) {
      double bound = draws->items[i]->number;
      /* A draw's bound is how many things the parser drew among: a whole number, at least one. */
      if (draws->items[i]->kind != SPROUT_JSON_NUMBER || bound < 1 || bound > 4294967296.0 || bound != __builtin_floor(bound))
        return "A draw is not a whole number of things to draw among.";
      bounds[i] = (uint64_t)bound;
    }
    reading->draws = bounds;
    reading->draw_count = draws->count;
  }
  if (asides != NULL && asides->count > 0) {
    sprout_aside *said = (sprout_aside *)sprout_arena_take(&scratch, asides->count * sizeof *said);
    if (said == NULL) return "There is no memory for the reading.";
    for (i = 0; i < asides->count; i++) {
      said[i].line = string_at(asides->items[i], "line");
      said[i].thing = string_at(asides->items[i], "thing");
      said[i].pronoun = string_at(asides->items[i], "pronoun");
      if (said[i].line == NULL || said[i].thing == NULL) return "An aside names no line or no thing.";
    }
    reading->asides = said;
    reading->aside_count = asides->count;
  }
  return NULL;
}

/*
 * A command: the input holds `{"visit", "verb", "fillers", "typed"}` and, where the host's parser drew or
 * said anything first, `"draws"` and `"asides"`: a reading already read, so no parser runs here.
 */
EXPORT("sw_command") int sw_command(size_t length, uint64_t seed, uint64_t instant) {
  const sprout_json *fillers;
  const sprout_stored_visitor *visitor;
  const char *visit, *verb, *typed, *wrong;
  sprout_filling *fillings = NULL;
  sprout_reading reading;
  sprout_turn_input in;
  sprout_json *root;
  int status;
  begin(seed);
  if (!ready()) return refuse("Load a cartridge and open a state first.");
  if (input == NULL || length > input_capacity) return refuse("Hand the command in through sw_input first.");
  status = sprout_json_read(&scratch, (const char *)input, length, &root, NULL);
  if (status != SPROUT_OK) return status == SPROUT_BAD_INPUT ? refuse("The command is not JSON.") : status;
  visit = string_at(root, "visit");
  verb = string_at(root, "verb");
  typed = string_at(root, "typed");
  fillers = array_at(root, "fillers");
  if (visit == NULL || verb == NULL || typed == NULL || fillers == NULL)
    return refuse("A command names its visit, verb, typed line and fillers.");
  visitor = sprout_state_find_visitor(state, (sprout_str){visit, strlen(visit)});
  if (visitor == NULL) return refuse("No visitor of this world has that visit.");
  memset(&reading, 0, sizeof reading);
  wrong = fillings_of(fillers, &fillings);
  if (wrong == NULL) wrong = parsing_of(root, &reading);
  if (wrong != NULL) return refuse(wrong);
  reading.verb = verb;
  reading.actor = sprout_arena_copy(&scratch, visitor->instance.bytes, visitor->instance.length);
  if (reading.actor == NULL) return SPROUT_NO_MEMORY;
  reading.filling_count = fillers->count;
  reading.fillings = fillings;
  memset(&in, 0, sizeof in);
  in.kind = SPROUT_TURN_COMMAND;
  in.instant = instant;
  in.visit = visit;
  in.reading = &reading;
  in.text = typed;
  in.text_length = strlen(typed);
  return run(&in);
}

/* A visitor's scene, the input holding the visit: `{"view", "verbs"}`, the view's JSON beside its verbs. */
EXPORT("sw_scene") int sw_scene(size_t visit_length) {
  sprout_seen_view view;
  sprout_json *tree, *verbs, *root;
  const char *visit;
  sprout_status status;
  size_t i;
  begin(0);
  if (!ready()) return refuse("Load a cartridge and open a state first.");
  visit = input_string(0, visit_length);
  if (visit == NULL) return refuse("Hand the visit in through sw_input first.");
  status = sprout_scene(world, state, &host, visit, &view);
  if (status == SPROUT_BAD_INPUT) return answer_text(status, view.fault.text);
  if (status != SPROUT_OK) return answer_text(status, sprout_status_text(status));
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
  if (!ready()) return refuse("Load a cartridge and open a state first.");
  visit = input_string(0, visit_length);
  verb = input_string(visit_length, verb_length);
  if (visit == NULL || verb == NULL) return refuse("Hand the visit and verb in through sw_input first.");
  status = sprout_readings_for(world, state, &host, visit, verb, &scratch, &view);
  if (status == SPROUT_BAD_INPUT) return answer_text(status, view.fault.text);
  if (status != SPROUT_OK) return answer_text(status, sprout_status_text(status));
  tree = sprout_view_tree(&scratch, &view);
  if (tree == NULL) return SPROUT_NO_MEMORY;
  return sprout_json_write(&scratch, tree, &output, &output_length);
}
