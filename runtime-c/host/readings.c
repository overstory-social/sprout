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
  readings->budgets = sprout_json_get(root, "budgets");
  return NULL;
}

void sproutc_readings_close(sproutc_readings *readings) {
  sprout_arena_reset(&readings->arena);
  free(readings->text);
  readings->text = NULL;
  readings->steps = NULL;
  readings->budgets = NULL;
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
  if (sprout_json_get(one, "after") != NULL) step->world = sprout_json_get(sprout_json_get(one, "after"), "world");
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
  turn->parsed = sprout_json_get(one, "parsed");
  turn->handed = sprout_json_get(one, "handed");
  turn->before = sprout_json_get(one, "before");
  if (turn->skip) {
    turn->why = text_of(one, "why");
    return turn->why == NULL ? "a skipped turn in the readings file does not say why." : NULL;
  }
  turn->verb = text_of(one, "verb");
  turn->actor = text_of(one, "actor");
  turn->draws = sprout_json_get(one, "draws");
  turn->asides = sprout_json_get(one, "asides");
  turn->fillers = sprout_json_get(one, "fillers");
  turn->refused = sprout_json_get(one, "refused") != NULL && sprout_json_get(one, "refused")->boolean;
  if (turn->verb == NULL || turn->actor == NULL || turn->fillers == NULL || turn->fillers->kind != SPROUT_JSON_ARRAY)
    return "a turn in the readings file has no verb, actor or fillers.";
  return NULL;
}

const char *sproutc_readings_fillings(sprout_arena *arena, const sprout_json *fillers, sprout_filling **out,
                                     size_t *count) {
  sprout_filling *found = (sprout_filling *)sprout_arena_take(arena, (fillers->count + 1) * sizeof *found);
  size_t i, j;
  if (found == NULL) return "the host cannot give the reading memory.";
  for (i = 0; i < fillers->count; i++) {
    const sprout_json *one = fillers->items[i], *role = sprout_json_get(one, "role"), *binds = sprout_json_get(one, "binds");
    const sprout_json *id = sprout_json_get(one, "id"), *ids = sprout_json_get(one, "ids");
    const sprout_json *direction = sprout_json_get(one, "direction"), *label = sprout_json_get(one, "label");
    const sprout_json *to = sprout_json_get(one, "to"), *value = sprout_json_get(one, "value");
    if (role == NULL || binds == NULL || role->kind != SPROUT_JSON_STRING || binds->kind != SPROUT_JSON_STRING)
      return "a filler in the readings file has no role or binds.";
    found[i].role = role->bytes;
    if (strcmp(binds->bytes, "unbound") == 0) {
      found[i].binds = SPROUT_FILL_UNBOUND;
    } else if (strcmp(binds->bytes, "object") == 0 && id != NULL) {
      found[i].binds = SPROUT_FILL_OBJECT;
      found[i].id = id->bytes;
    } else if (strcmp(binds->bytes, "set") == 0 && ids != NULL) {
      const char **list = (const char **)sprout_arena_take(arena, (ids->count + 1) * sizeof *list);
      if (list == NULL) return "the host cannot give the reading memory.";
      for (j = 0; j < ids->count; j++) list[j] = ids->items[j]->bytes;
      found[i].binds = SPROUT_FILL_SET;
      found[i].ids = list;
      found[i].id_count = ids->count;
    } else if (strcmp(binds->bytes, "exit") == 0 && to != NULL && label != NULL) {
      found[i].binds = SPROUT_FILL_EXIT;
      found[i].id = to->bytes;
      found[i].label = label->bytes;
      found[i].direction = direction == NULL || direction->kind != SPROUT_JSON_STRING ? NULL : direction->bytes;
    } else if (strcmp(binds->bytes, "value") == 0 && value != NULL && value->kind == SPROUT_JSON_STRING) {
      found[i].binds = SPROUT_FILL_TEXT;
      found[i].text = value->bytes;
    } else if (strcmp(binds->bytes, "value") == 0 && value != NULL && value->kind == SPROUT_JSON_NUMBER) {
      found[i].binds = SPROUT_FILL_NUMBER;
      found[i].number = value->number;
    } else {
      return "a filler in the readings file fills a role with what no role takes.";
    }
  }
  *out = found;
  *count = fillers->count;
  return NULL;
}


const char *sproutc_readings_budgets(sprout_budgets *b, const sprout_json *given) {
  struct {
    const char *name;
    sprout_limit *limit;
  } rows[] = {{"steps", &b->steps},
              {"pollSteps", &b->poll_steps},
              {"output", &b->output},
              {"events", &b->events},
              {"cascadeDepth", &b->cascade_depth},
              {"passageDepth", &b->passage_depth},
              {"setRoleObjects", &b->set_role_objects},
              {"spawnsPerTurn", &b->spawns},
              {"shortestWakeSeconds", &b->shortest_wake_seconds},
              {"pendingWakesPerObject", &b->pending_wakes},
              {"peoplePerPlace", &b->people_per_place},
              {"extensionEffects", &b->extension_effects},
              {"nicknameCharacters", &b->nickname_characters},
              {"wallClockMs", &b->wall_clock_ms}};
  size_t i, j;
  for (i = 0; given != NULL && i < given->count; i++) {
    bool found = false;
    for (j = 0; j < sizeof rows / sizeof *rows && !found; j++) {
      if (strcmp(given->items[i]->key, rows[j].name) != 0) continue;
      found = true;
      rows[j].limit->set = given->items[i]->kind == SPROUT_JSON_NUMBER;
      rows[j].limit->value = rows[j].limit->set ? (uint64_t)given->items[i]->number : 0;
    }
    if (!found) return "the readings file sets a budget this host has no row for.";
  }
  return NULL;
}
