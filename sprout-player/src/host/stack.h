/*
 * Which stack a call runs on. On the device, a frame of the app, which may run a
 * turn, runs on a stack of the player's own, since the main stack has little
 * room left by then, and the firmware's file system is called back on the
 * main stack, the only one it accepts. On the Simulator every call is direct.
 */
#ifndef PLAYER_STACK_H
#define PLAYER_STACK_H

#include "pd_api.h"

/* Runs `fn(ctx)` on the player's own stack, taking that stack from the heap on the first call. */
void *player_on_own_stack(PlaydateAPI *pd, void *(*fn)(void *), void *ctx);

/* Runs `fn(ctx)` on the main stack while the own stack is in use, and directly otherwise. */
void *player_on_main_stack(void *(*fn)(void *), void *ctx);

#endif
