/*
 * A script's steps, read from the JSON file `sproutc play --script` names: the shape the player reads
 * (player/src/script.ts), each step one visitor typing a line or one host event. Each step is given the line the
 * typed grammar writes for it and the clock and seed it begins under: the clock starts at 0 and moves only at
 * `advance`, the seed starts at 0 and changes only at `seed`, as the player plays a script. A step's `expect` is
 * the script's own; `sproutc` plays the step and leaves checking it to whoever reads the trace.
 */
#ifndef SPROUTC_STEPS_H
#define SPROUTC_STEPS_H

#include <stdbool.h>
#include <stdint.h>

#include "arena.h"
#include "json.h"

typedef enum sproutc_step_kind {
  SPROUTC_STEP_COMMENT,
  SPROUTC_STEP_SEED,
  SPROUTC_STEP_ARRIVE,
  SPROUTC_STEP_LEAVE,
  SPROUTC_STEP_TICK,
  SPROUTC_STEP_ADVANCE,
  SPROUTC_STEP_COMMAND
} sproutc_step_kind;

typedef struct sproutc_step {
  size_t index;          /* from 0, in the script's order */
  const char *line;      /* as the typed grammar writes it: `Marta> look`, `@arrive Marta`, `# …` */
  uint64_t at_seconds;   /* seconds on the script's clock when the step begins */
  uint64_t seed;         /* the script's seed when the step begins */
  sproutc_step_kind kind;
  const char *nickname;  /* a command's, an arrival's and a departure's */
  const char *typed;     /* a command: the line typed */
  uint64_t for_seconds;  /* an advance: how long */
} sproutc_step;

typedef struct sproutc_steps {
  sprout_arena arena;
  char *text;
  size_t count;
  sproutc_step *steps;
} sproutc_steps;

/* Reads the script at `path`; NULL on success, or words naming the step and saying what to write. */
const char *sproutc_steps_open(sproutc_steps *steps, const sprout_host *host, const char *path);

void sproutc_steps_close(sproutc_steps *steps);

#endif
