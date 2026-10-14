/*
 * The runtime as a WebAssembly module a JavaScript host drives (the spec's The host contract): one world and its
 * live state per instance, freestanding (no WASI, no libc beyond libc.c), every value crossing as bytes. The host
 * writes its input into the buffer `sw_input` hands it, calls one export, and reads the answer from `sw_output`.
 * Memory comes to the runtime in pages from a pool (pool.c), which grows the instance's memory and never gives it
 * back. The clock is the host's import `env.now_ms`, read only for the budget's wall-clock backstop; the seed is
 * handed in with each turn, and is the turn's own whatever its kind.
 *
 * The modules share one context, `wasm_engine`: crossing.c (the buffers, loading, opening, saving and the host's
 * budgets), turns.c (the write turns), lines.c (the commands of a typed line), polls.c (the view in its parts),
 * questions.c (what a host asks of the committed world between turns) and parsing.c (a typed line read and never run).
 */
#ifndef SPROUT_WASM_ENGINE_H
#define SPROUT_WASM_ENGINE_H

#include <stddef.h>
#include <stdint.h>

#include "arena.h"
#include "json.h"
#include "sprout.h"

#define EXPORT(name) __attribute__((export_name(name)))

/* A page of the pool, and of WebAssembly memory. */
#define PAGE_BYTES ((size_t)64 * 1024)

/* A line under way: what it holds, the command it hands out next, how many it has handed out, and whether the last has run. */
typedef struct wasm_line {
  bool used;
  sprout_arena keep;
  sprout_commands commands;
  sprout_turn_input pending;
  uint64_t handed;
  bool more, waiting;
} wasm_line;

typedef struct wasm_engine {
  sprout_host host;
  sprout_world *world;
  sprout_state *state;
  sprout_arena scratch; /* what one call answers with, emptied when the next begins */
  uint64_t turn_seed;
  double turn_began_ms;
  sprout_log_depth log_depth;
  /* The buffer the host writes into, and the answer it reads. */
  unsigned char *input;
  size_t input_capacity;
  const char *output;
  size_t output_length;
  /* The lines under way, by number; a slot is used again once its line is over or ended. */
  wasm_line *lines;
  size_t line_count;
} wasm_engine;

/* The instance's one engine. */
extern wasm_engine the_engine;

/* ---- pool.c ---- */

void *pool_alloc(void *ctx, size_t bytes);
void pool_release(void *ctx, void *block, size_t bytes);

/* ---- crossing.c ---- */

/* A call begins: `seed` is its turn's, the clock starts, and the answer and scratch of the call before are let go. */
void engine_begin(wasm_engine *e, uint64_t seed);

/* `text` as the answer, copied into the scratch arena; `status` given back, or SPROUT_NO_MEMORY. */
int engine_answer(wasm_engine *e, int status, const char *text, size_t length);
int engine_answer_text(wasm_engine *e, int status, const char *text);

/* A refusal of what the host handed in, in words. */
int engine_refuse(wasm_engine *e, const char *why);

/* `node` written as the answer. */
int engine_answer_json(wasm_engine *e, const sprout_json *node);

bool engine_ready(const wasm_engine *e);

/* The C string of `length` bytes at `at` in the input, copied into the scratch arena; NULL past the input. */
const char *engine_input_string(wasm_engine *e, size_t at, size_t length);

/* The input's `length` bytes read as JSON into `*root`; a status, with words where they are not JSON. */
int engine_input_json(wasm_engine *e, size_t length, const char *what, sprout_json **root);

/* The string member `key` of `object`, or NULL where it has none, or one holding a NUL, which no id or line does. */
const char *engine_string_at(const sprout_json *object, const char *key);

/* JSON nodes in the scratch arena: text, a whole number, null, a truth. */
sprout_json *engine_text(wasm_engine *e, const char *bytes, size_t length);
sprout_json *engine_number(wasm_engine *e, double number);
sprout_json *engine_null(wasm_engine *e);
sprout_json *engine_bool(wasm_engine *e, bool value);

/* ---- turns.c ---- */

/* Runs `in` over the live state and answers what it came to; a command of the line `line` hands it what it came to. */
int turns_run(wasm_engine *e, sprout_turn_input *in, wasm_line *line);

/* ---- lines.c ---- */

/* The line numbered `number` that is under way, or NULL. */
wasm_line *lines_find(wasm_engine *e, double number);

/* The line whose command `command` is, `{"line", "step"}` naming the one it waits on now; NULL where it is none such. */
wasm_line *lines_waiting_on(wasm_engine *e, const sprout_json *line, const sprout_json *step);

/* Hands the line what the command it handed out came to, so its next is ready; `ran` false where it could not run. */
void lines_ran(wasm_line *line, const sprout_outcome *outcome, bool ran);

/* ---- questions.c ---- */

/* Whether the visitor under `visit` stands in a place now: false for one away, or whose place is gone. */
bool questions_stands_in_place(wasm_engine *e, const char *visit);

#endif
