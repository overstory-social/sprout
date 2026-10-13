/*
 * A script's readings, as `scripts/resolve-script.mjs` writes them beside
 * the script: each step with what the TypeScript runtime left behind it, which
 * `sproutc play` compares its own play with; each typed line with the turns it
 * ran and what the TypeScript parser read of each, which `sproutc parse`
 * compares the runtime's own parse with, and the reading each ran, which
 * `--offered` looks for in the view. This reads that file into steps.
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

/* One command turn of a typed line, as the TypeScript runtime ran it. A skipped turn is one the parser answered, which ran no reading. */
typedef struct sproutc_turn_reading {
  const char *typed;
  uint64_t seed;
  bool skip;
  const char *why;  /* when skipped: the parser's answer */
  const sprout_json *says;   /* the lines a reader read, as the TypeScript runtime told them */
  const sprout_json *expect; /* the turn as the TypeScript runtime logged it */
  const char *verb; /* otherwise: the verb, qualified */
  const char *actor; /* otherwise: the id of the instance performing it */
  const sprout_json *fillers;
  bool refused;
  const sprout_json *parsed; /* what the TypeScript parser read of the line, or NULL where the turn read no words */
  const sprout_json *handed; /* a later turn of a line: the reading planned for it and the item it re-reads, or NULL */
  const sprout_json *before; /* a turn after the first in its step: the stored world it began from, or NULL */
} sproutc_turn_reading;

typedef struct sproutc_step {
  size_t index;
  const char *line;
  uint64_t at_seconds; /* seconds on the script's clock when the step begins */
  uint64_t seed;
  sproutc_step_kind kind;
  const char *nickname;
  const char *typed;    /* a command: the line typed */
  uint64_t for_seconds; /* an advance: how long */
  size_t turns;     /* a command: how many turns the line runs */
  const sprout_json *turn_list;
  const sprout_json *world; /* the stored world once the step is over, or NULL where the file holds none */
} sproutc_step;

typedef struct sproutc_readings {
  sprout_arena arena;
  char *text;
  const sprout_json *steps;
  const sprout_json *budgets; /* the budgets the script was played under, where not the host's defaults, or NULL */
} sproutc_readings;

/* Reads the file at `path`; NULL on success, or words for what is wrong with it. */
const char *sproutc_readings_open(sproutc_readings *readings, const sprout_host *host, const char *path);

void sproutc_readings_close(sproutc_readings *readings);

size_t sproutc_readings_count(const sproutc_readings *readings);

/* Step `i`, by its parts; NULL on success, or words for what is wrong with it. */
const char *sproutc_readings_step(const sproutc_readings *readings, size_t i, sproutc_step *step);

/* Turn `i` of a command step. */
const char *sproutc_readings_turn(const sproutc_step *step, size_t i, sproutc_turn_reading *turn);

/* `budgets` less any the readings were played under, named as the TypeScript runtime names them; NULL, or words. */
const char *sproutc_readings_budgets(sprout_budgets *budgets, const sprout_json *given);

#endif
