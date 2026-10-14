/*
 * The page pool the runtime's memory comes from (engine.h). Every block is a whole number of pages. A freed block
 * joins the free runs, kept in address order and merged with a neighbour it touches, and a request takes the first
 * run long enough, splitting off the rest, so what is released is used again whatever size was asked for. What the
 * pool holds and what the instance has grown to are both reported.
 */
#include "engine.h"

#define WASM_PAGE ((size_t)64 * 1024)

extern unsigned char __heap_base;

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

void *pool_alloc(void *ctx, size_t bytes) {
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

void pool_release(void *ctx, void *block, size_t bytes) {
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

EXPORT("sw_held_bytes") size_t sw_held_bytes(void) { return held_bytes; }
EXPORT("sw_peak_held_bytes") size_t sw_peak_held_bytes(void) { return peak_held_bytes; }
EXPORT("sw_memory_bytes") size_t sw_memory_bytes(void) { return __builtin_wasm_memory_size(0) * WASM_PAGE; }
