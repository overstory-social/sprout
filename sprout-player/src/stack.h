/*
 * Which stack a call runs on. The device's main stack is shared with the Lua
 * interpreter and the firmware, and little of it is left by the time Lua
 * calls the player: a turn that renders nested prose ran the firmware's own
 * frames off the end of it. So a call that may run a turn runs on a stack of
 * the player's own, taken from the heap once, and the firmware's file system
 * is called back on the main stack, which is where it works. On the
 * Simulator the host's stack is large and every call is direct.
 */
#ifndef PLAYER_STACK_H
#define PLAYER_STACK_H

#include "pd_api.h"

/* Runs `fn(ctx)` on the player's own stack, taking that stack from the heap on the first call. */
void *player_on_own_stack(PlaydateAPI *pd, void *(*fn)(void *), void *ctx);

/* Runs `fn(ctx)` on the main stack when the own stack is in use, and directly otherwise. */
void *player_on_main_stack(void *(*fn)(void *), void *ctx);

#endif
