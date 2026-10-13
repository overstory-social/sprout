/*
 * host/stack.c: a call on the player's own stack and a call back on the main stack each run the function
 * once with its context and hand back its result, nested or not. The switch itself is device code (Thumb-2) and
 * runs only there; here, as on the Simulator, both calls are direct, which is what this pins.
 */
#include <stdint.h>

#include "host/stack.h"
#include "support.h"

static int runs = 0;

static void *doubled(void *ctx) {
  runs++;
  return (void *)(intptr_t)(*(int *)ctx * 2);
}

static void *inner_on_main(void *ctx) {
  runs++;
  return player_on_main_stack(doubled, ctx);
}

static void a_call_on_the_own_stack_runs_once_and_answers(void) {
  int n = 21;
  begin("own");
  runs = 0;
  CHECK((int)(intptr_t)player_on_own_stack(&fake->api, doubled, &n) == 42, "the answer came back");
  CHECK(runs == 1, "ran %d times", runs);
  end();
}

static void a_call_back_on_the_main_stack_runs_once_and_answers(void) {
  int n = 5;
  begin("main");
  runs = 0;
  CHECK((int)(intptr_t)player_on_main_stack(doubled, &n) == 10, "the answer came back");
  CHECK(runs == 1, "ran %d times", runs);
  end();
}

static void a_call_back_nested_in_a_call_out_still_answers(void) {
  int n = 8;
  begin("nested");
  runs = 0;
  CHECK((int)(intptr_t)player_on_own_stack(&fake->api, inner_on_main, &n) == 16, "the answer came back");
  CHECK(runs == 2, "ran %d times", runs);
  end();
}

int main(void) {
  test_program("stack");
  a_call_on_the_own_stack_runs_once_and_answers();
  a_call_back_on_the_main_stack_runs_once_and_answers();
  a_call_back_nested_in_a_call_out_still_answers();
  return finish();
}
