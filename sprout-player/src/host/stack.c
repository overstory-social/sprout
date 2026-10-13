/* See stack.h. The switch is a few instructions of Thumb-2 on the device, and nothing elsewhere. */
#include "stack.h"

#include <stdbool.h>
#include <stdint.h>

#if defined(PLAYER_DEVICE) && defined(__thumb__)

#define OWN_STACK_BYTES (128u * 1024u)
#define HOP_MARGIN 1024u /* below the saved main pointer sit the registers the switch out pushed */

static char *own_stack = NULL;
static bool own_live = false; /* whether a call on the own stack is under way, hopped back or not */
static uintptr_t main_sp = 0; /* the main stack pointer saved by the switch out, 0 while hopped back */

/* Calls `fn(ctx)` with the stack pointer at `top` and restores it after; r4 keeps the pointer across the call. */
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
  uintptr_t top;
  void *result;
  if (own_live) return fn(ctx);
  if (own_stack == NULL) own_stack = (char *)pd->system->realloc(NULL, OWN_STACK_BYTES);
  if (own_stack == NULL) return fn(ctx);
  top = ((uintptr_t)own_stack + OWN_STACK_BYTES) & ~(uintptr_t)7;
  own_live = true;
  main_sp = sp_now();
  result = call_with_sp(fn, ctx, top);
  main_sp = 0;
  own_live = false;
  return result;
}

void *player_on_main_stack(void *(*fn)(void *), void *ctx) {
  uintptr_t saved;
  void *result;
  if (!own_live || main_sp == 0) return fn(ctx); /* on the main stack already, or hopped back to it */
  saved = main_sp;
  main_sp = 0;
  result = call_with_sp(fn, ctx, (saved - HOP_MARGIN) & ~(uintptr_t)7);
  main_sp = saved;
  return result;
}

#else

void *player_on_own_stack(PlaydateAPI *pd, void *(*fn)(void *), void *ctx) {
  (void)pd;
  return fn(ctx);
}

void *player_on_main_stack(void *(*fn)(void *), void *ctx) { return fn(ctx); }

#endif
