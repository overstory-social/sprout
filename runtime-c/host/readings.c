/* Reads a script's readings file; see readings.h. */
#include "readings.h"

#include <stdio.h>
#include <stdlib.h>
#include <string.h>

static const char *text_of(const sprout_json *object, const char *key) {
  const sprout_json *member = sprout_json_get(object, key);
  return member != NULL && member->kind == SPROUT_JSON_STRING ? member->bytes : NULL;
}

static bool number_of(const sprout_json *object, const char *key, uint64_t *out) {
  const sprout_json *member = sprout_json_get(object, key);
  if (member == NULL || member->kind != SPROUT_JSON_NUMBER || member->number < 0) return false;
  *out = (uint64_t)member->number;
  return true;
}

const char *sproutc_readings_open(sproutc_readings *readings, const sprout_host *host, const char *path) {
  FILE *file = fopen(path, "rb");
  long size;
  sprout_json *root = NULL;
  sprout_json_error error;
  uint64_t format = 0;
  static char problem[200];

  memset(readings, 0, sizeof *readings);
  if (file == NULL) {
    snprintf(problem, sizeof problem,
             "there is no readings file at %s: write one with `node scripts/resolve-script.mjs <world> <script>`.",
             path);
    return problem;
  }
  fseek(file, 0, SEEK_END);
  size = ftell(file);
  fseek(file, 0, SEEK_SET);
  readings->text = (char *)malloc((size_t)size + 1);
  if (readings->text == NULL || fread(readings->text, 1, (size_t)size, file) != (size_t)size) {
    fclose(file);
    free(readings->text);
    readings->text = NULL;
    return "the readings file would not read.";
  }
  fclose(file);
  if (sprout_arena_init(&readings->arena, host) != SPROUT_OK) return "the host cannot give the reader memory.";
  if (sprout_json_read(&readings->arena, readings->text, (size_t)size, &root, &error) != SPROUT_OK) {
    snprintf(problem, sizeof problem, "the readings file is not JSON, at line %zu, column %zu: %s", error.line,
             error.column, error.text);
    sproutc_readings_close(readings);
    return problem;
  }
  if (root->kind != SPROUT_JSON_OBJECT || !number_of(root, "format", &format) || format != 1 ||
      sprout_json_get(root, "steps") == NULL || sprout_json_get(root, "steps")->kind != SPROUT_JSON_ARRAY) {
    sproutc_readings_close(readings);
    return "the readings file is not format 1: write it again with `scripts/resolve-script.mjs`.";
  }
  readings->steps = sprout_json_get(root, "steps");
  return NULL;
}

void sproutc_readings_close(sproutc_readings *readings) {
  sprout_arena_reset(&readings->arena);
  free(readings->text);
  readings->text = NULL;
  readings->steps = NULL;
}

size_t sproutc_readings_count(const sproutc_readings *readings) {
  return readings->steps == NULL ? 0 : readings->steps->count;
}

static bool kind_of(const char *name, sproutc_step_kind *kind) {
  static const struct {
    const char *name;
    sproutc_step_kind kind;
  } kinds[] = {{"comment", SPROUTC_STEP_COMMENT}, {"seed", SPROUTC_STEP_SEED},
               {"arrive", SPROUTC_STEP_ARRIVE},   {"leave", SPROUTC_STEP_LEAVE},
               {"tick", SPROUTC_STEP_TICK},       {"advance", SPROUTC_STEP_ADVANCE},
               {"command", SPROUTC_STEP_COMMAND}};
  size_t i;
  for (i = 0; i < sizeof kinds / sizeof kinds[0]; i++) {
    if (name != NULL && strcmp(name, kinds[i].name) == 0) {
      *kind = kinds[i].kind;
      return true;
    }
  }
  return false;
}

const char *sproutc_readings_step(const sproutc_readings *readings, size_t i, sproutc_step *step) {
  const sprout_json *one;
  const sprout_json *turns;
  uint64_t index = 0;
  if (readings->steps == NULL || i >= readings->steps->count) return "there is no such step.";
  one = readings->steps->items[i];
  memset(step, 0, sizeof *step);
  if (one->kind != SPROUT_JSON_OBJECT || !number_of(one, "index", &index) || !number_of(one, "atSeconds", &step->at_seconds) ||
      !number_of(one, "seed", &step->seed) || !kind_of(text_of(one, "kind"), &step->kind) ||
      text_of(one, "line") == NULL)
    return "a step in the readings file is missing its index, line, atSeconds, seed or kind.";
  step->index = (size_t)index;
  step->line = text_of(one, "line");
  step->nickname = text_of(one, "nickname");
  number_of(one, "forSeconds", &step->for_seconds);
  turns = sprout_json_get(one, "turns");
  if (step->kind == SPROUTC_STEP_COMMAND) {
    if (turns == NULL || turns->kind != SPROUT_JSON_ARRAY || step->nickname == NULL)
      return "a command step in the readings file has no nickname or no turns.";
    step->turns = turns->count;
    step->turn_list = turns;
  }
  return NULL;
}

const char *sproutc_readings_turn(const sproutc_step *step, size_t i, sproutc_turn_reading *turn) {
  const sprout_json *one;
  const sprout_json *skip;
  if (step->turn_list == NULL || i >= step->turns) return "there is no such turn.";
  one = step->turn_list->items[i];
  memset(turn, 0, sizeof *turn);
  skip = sprout_json_get(one, "skip");
  turn->typed = text_of(one, "typed");
  if (one->kind != SPROUT_JSON_OBJECT || turn->typed == NULL || skip == NULL || skip->kind != SPROUT_JSON_BOOL ||
      !number_of(one, "seed", &turn->seed))
    return "a turn in the readings file is missing its typed text, seed or skip.";
  turn->skip = skip->boolean;
  turn->says = sprout_json_get(one, "says");
  turn->expect = sprout_json_get(one, "expect");
  if (turn->skip) {
    turn->why = text_of(one, "why");
    return turn->why == NULL ? "a skipped turn in the readings file does not say why." : NULL;
  }
  turn->verb = text_of(one, "verb");
  turn->actor = text_of(one, "actor");
  turn->fillers = sprout_json_get(one, "fillers");
  turn->refused = sprout_json_get(one, "refused") != NULL && sprout_json_get(one, "refused")->boolean;
  if (turn->verb == NULL || turn->actor == NULL || turn->fillers == NULL || turn->fillers->kind != SPROUT_JSON_ARRAY)
    return "a turn in the readings file has no verb, actor or fillers.";
  return NULL;
}
