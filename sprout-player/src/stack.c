/* See stack.h. The switch is a few instructions of Thumb-2 on the device, and nothing on the Simulator. */
#include "stack.h"

#include <stdint.h>

#if defined(__arm__) || defined(__thumb__)

#define OWN_STACK_BYTES (128u * 1024u)

static char *own_stack = NULL;
static uintptr_t main_sp = 0; /* the main stack pointer saved while the own stack is in use, else 0 */

/* Calls `fn(ctx)` with the stack pointer at `top`, and restores it after; r4 keeps the pointer across the call. */
static void *call_with_sp(void *(*fn)(void *), void *ctx, uintptr_t top) {
  register void *(*f)(void *) __asm__("r5") = fn;
  register void *a __asm__("r6") = ctx;
  register uintptr_t t __asm__("r8") = top;
  register void *result __asm__("r0");
  __asm__ volatile(
      "mov r4, sp\n\t"
      "mov sp, r8\n\t"
      "mov r0, r6\n\t"
      "blx r5\n\t"
      "mov sp, r4\n\t"
      : "=r"(result)
      : "r"(f), "r"(a), "r"(t)
      : "r1", "r2", "r3", "r4", "r12", "lr", "cc", "memory", "d0", "d1", "d2", "d3", "d4", "d5", "d6", "d7");
  return result;
}

static uintptr_t sp_now(void) {
  uintptr_t sp;
  __asm__ volatile("mov %0, sp" : "=r"(sp));
  return sp;
}

void *player_on_own_stack(PlaydateAPI *pd, void *(*fn)(void *), void *ctx) {
  uintptr_t top, saved;
  void *result;
  if (main_sp != 0) return fn(ctx); /* already on the own stack */
  if (own_stack == NULL) own_stack = (char *)pd->system->realloc(NULL, OWN_STACK_BYTES);
  if (own_stack == NULL) return fn(ctx);
  top = ((uintptr_t)own_stack + OWN_STACK_BYTES) & ~(uintptr_t)7;
  saved = main_sp;
  main_sp = sp_now();
  result = call_with_sp(fn, ctx, top);
  main_sp = saved;
  return result;
}

void *player_on_main_stack(void *(*fn)(void *), void *ctx) {
  uintptr_t back;
  void *result;
  if (main_sp == 0) return fn(ctx); /* on the main stack already */
  /*
   * The main stack below the saved pointer is free while the own stack is in use, but for the registers the
   * switch out pushed just under it: the call runs a little further down, clear of them.
   */
  back = main_sp - 1024u;
  main_sp = 0;
  result = call_with_sp(fn, ctx, back & ~(uintptr_t)7);
  main_sp = back;
  return result;
}

#else

void *player_on_own_stack(PlaydateAPI *pd, void *(*fn)(void *), void *ctx) {
  (void)pd;
  return fn(ctx);
}

void *player_on_main_stack(void *(*fn)(void *), void *ctx) { return fn(ctx); }

#endif
