/*
 * A script's readings, as `scripts/resolve-script.mjs` writes them beside
 * the script: each typed line already read by the TypeScript parser, so the
 * host needs no parser. This reads that file into steps the host plays.
 */
#ifndef SPROUTC_READINGS_H
#define SPROUTC_READINGS_H

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

/* One command turn of a typed line. A skipped turn is one the parser answered; the host does not run it. */
typedef struct sproutc_turn_reading {
  const char *typed;
  uint64_t seed;
  bool skip;
  const char *why;  /* when skipped: the parser's answer */
  const sprout_json *draws;  /* otherwise: the bounds the parser drew below reading the line */
  const sprout_json *asides; /* otherwise: what the parser said before the reading's own lines */
  const sprout_json *says;   /* the lines a reader read, as the TypeScript runtime told them: the parser's, which this host echoes when it skips the turn */
  const sprout_json *expect; /* the turn as the TypeScript runtime logged it */
  const char *verb; /* otherwise: the verb, qualified */
  const char *actor; /* otherwise: the id of the instance performing it */
  const sprout_json *fillers;
  bool refused;
} sproutc_turn_reading;

typedef struct sproutc_step {
  size_t index;
  const char *line;
  uint64_t at_seconds; /* seconds on the script's clock when the step begins */
  uint64_t seed;
  sproutc_step_kind kind;
  const char *nickname;
  uint64_t for_seconds; /* an advance: how long */
  size_t turns;     /* a command: how many turns the line runs */
  const sprout_json *turn_list;
} sproutc_step;

typedef struct sproutc_readings {
  sprout_arena arena;
  char *text;
  const sprout_json *steps;
} sproutc_readings;

/* Reads the file at `path`; NULL on success, or words for what is wrong with it. */
const char *sproutc_readings_open(sproutc_readings *readings, const sprout_host *host, const char *path);

void sproutc_readings_close(sproutc_readings *readings);

size_t sproutc_readings_count(const sproutc_readings *readings);

/* Step `i`, by its parts; NULL on success, or words for what is wrong with it. */
const char *sproutc_readings_step(const sproutc_readings *readings, size_t i, sproutc_step *step);

/* Turn `i` of a command step. */
const char *sproutc_readings_turn(const sproutc_step *step, size_t i, sproutc_turn_reading *turn);

#endif
