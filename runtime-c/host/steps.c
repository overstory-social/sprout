/* Reads a script's steps; see steps.h. */
#include "steps.h"

#include <ctype.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#include "draws.h"

#define SHAPES                                                                                                  \
  "a step is `{ \"as\": \"Marta\", \"type\": \"look\" }`, `{ \"arrive\": \"Marta\" }`, `{ \"leave\": \"Marta\" }`, " \
  "`{ \"tick\": true }`, `{ \"advance\": \"40 minutes\" }`, `{ \"seed\": 7 }` or `{ \"comment\": \"…\" }`"

static char problem[600];

static const char *text_of(const sprout_json *object, const char *key) {
  const sprout_json *member = sprout_json_get(object, key);
  return member != NULL && member->kind == SPROUT_JSON_STRING ? member->bytes : NULL;
}

/* A nickname: text with something other than spaces in it. */
static const char *named(const sprout_json *object, const char *key) {
  const char *text = text_of(object, key);
  const char *at;
  for (at = text; at != NULL && *at != '\0'; at++)
    if (!isspace((unsigned char)*at)) return text;
  return NULL;
}

/* How long `text` says passes, as `40 minutes`; false where it does not say it so. */
static bool seconds_of(const char *text, uint64_t *seconds) {
  static const struct {
    const char *name;
    uint64_t each;
  } units[] = {{"second", 1}, {"seconds", 1}, {"minute", 60}, {"minutes", 60}, {"hour", 3600}, {"hours", 3600}};
  char unit[16];
  const char *at = text;
  uint64_t count = 0;
  size_t i, n = 0;
  while (isspace((unsigned char)*at)) at++;
  if (!isdigit((unsigned char)*at)) return false;
  while (isdigit((unsigned char)*at)) {
    if (count > UINT64_MAX / 3600 / 10) return false;
    count = count * 10 + (uint64_t)(*at++ - '0');
  }
  if (!isspace((unsigned char)*at)) return false;
  while (isspace((unsigned char)*at)) at++;
  while (*at != '\0' && !isspace((unsigned char)*at)) {
    if (n + 1 >= sizeof unit) return false;
    unit[n++] = *at++;
  }
  unit[n] = '\0';
  while (isspace((unsigned char)*at)) at++;
  if (*at != '\0') return false;
  for (i = 0; i < sizeof units / sizeof units[0]; i++) {
    if (strcmp(unit, units[i].name) == 0) {
      *seconds = count * units[i].each;
      return true;
    }
  }
  return false;
}

/* `head` then `tail`, in the arena; NULL where it gives no memory. */
static const char *joined(sprout_arena *arena, const char *head, const char *tail) {
  size_t a = strlen(head), b = strlen(tail);
  char *line = (char *)sprout_arena_take(arena, a + b + 1);
  if (line == NULL) return NULL;
  memcpy(line, head, a);
  memcpy(line + a, tail, b + 1);
  return line;
}

/* How many members `object` has besides `expect`. */
static size_t keys_beside_expect(const sprout_json *object) {
  size_t i, n = 0;
  for (i = 0; i < object->count; i++)
    if (strcmp(object->items[i]->key, "expect") != 0) n++;
  return n;
}

/*
 * Where each step's seed comes from: the one a seed step just set, and otherwise the next of the stream begun from
 * the last seed set (the spec's The command line).
 */
typedef struct seeding {
  uint64_t set;  /* the seed a seed step set, then each later step's in turn */
  bool fresh;    /* whether no step has played since it was set */
  sprout_draws stream;
} seeding;

/* Reads step `index`, `one`, beginning under `*now` and `*seeds`, which it moves on; NULL, or words. */
static const char *step_of(sprout_arena *arena, size_t index, const sprout_json *one, uint64_t *now, seeding *seeds,
                           sproutc_step *step) {
  const sprout_json *member;
  memset(step, 0, sizeof *step);
  step->index = index;
  step->at_seconds = *now;
  if (one->kind != SPROUT_JSON_OBJECT) goto shapeless;
  if (keys_beside_expect(one) == 2 && named(one, "as") != NULL && text_of(one, "type") != NULL) {
    step->kind = SPROUTC_STEP_COMMAND;
    step->nickname = named(one, "as");
    step->typed = text_of(one, "type");
    step->line = joined(arena, joined(arena, step->nickname, "> "), step->typed);
  } else if (keys_beside_expect(one) != 1) {
    goto shapeless;
  } else if (named(one, "arrive") != NULL) {
    step->kind = SPROUTC_STEP_ARRIVE;
    step->nickname = named(one, "arrive");
    step->line = joined(arena, "@arrive ", step->nickname);
  } else if (named(one, "leave") != NULL) {
    step->kind = SPROUTC_STEP_LEAVE;
    step->nickname = named(one, "leave");
    step->line = joined(arena, "@leave ", step->nickname);
  } else if ((member = sprout_json_get(one, "tick")) != NULL && member->kind == SPROUT_JSON_BOOL && member->boolean) {
    step->kind = SPROUTC_STEP_TICK;
    step->line = "@tick";
  } else if (text_of(one, "advance") != NULL) {
    if (!seconds_of(text_of(one, "advance"), &step->for_seconds)) {
      snprintf(problem, sizeof problem, "step %zu: write how long passes, as in `{ \"advance\": \"40 minutes\" }`.",
               index + 1);
      return problem;
    }
    step->kind = SPROUTC_STEP_ADVANCE;
    step->line = joined(arena, "@advance ", text_of(one, "advance"));
    *now += step->for_seconds;
  } else if ((member = sprout_json_get(one, "seed")) != NULL && member->kind == SPROUT_JSON_NUMBER &&
             member->number >= 0 && member->number <= 9007199254740991.0 &&
             member->number == (double)(uint64_t)member->number) {
    char digits[24];
    snprintf(digits, sizeof digits, "%llu", (unsigned long long)member->number);
    step->kind = SPROUTC_STEP_SEED;
    step->line = joined(arena, "@seed ", digits);
    if (sprout_draws_begin(&seeds->stream, (uint64_t)member->number) != SPROUT_OK) {
      snprintf(problem, sizeof problem, "step %zu: a seed is a whole number from 0 to 4294967295.", index + 1);
      return problem;
    }
    seeds->set = (uint64_t)member->number;
    seeds->fresh = true;
  } else if (text_of(one, "comment") != NULL) {
    step->kind = SPROUTC_STEP_COMMENT;
    step->line = joined(arena, "# ", text_of(one, "comment"));
  } else {
    goto shapeless;
  }
  if (step->line == NULL) return "the host cannot give the script memory.";
  step->seed = seeds->set;
  if (step->kind != SPROUTC_STEP_SEED && step->kind != SPROUTC_STEP_COMMENT) {
    uint32_t next;
    if (!seeds->fresh) {
      sprout_draws_below(&seeds->stream, (uint64_t)1 << 32, &next);
      seeds->set = next;
      step->seed = next;
    }
    seeds->fresh = false;
  }
  return NULL;
shapeless:
  snprintf(problem, sizeof problem, "step %zu: %s.", index + 1, SHAPES);
  return problem;
}

const char *sproutc_steps_open(sproutc_steps *steps, const sprout_host *host, const char *path) {
  FILE *file = fopen(path, "rb");
  long size;
  sprout_json *root = NULL;
  const sprout_json *list;
  sprout_json_error error;
  uint64_t now = 0;
  seeding seeds = {0, true, {0, 0}};
  size_t i;
  const char *why;

  memset(steps, 0, sizeof *steps);
  if (file == NULL) {
    snprintf(problem, sizeof problem, "there is no script at %s.", path);
    return problem;
  }
  fseek(file, 0, SEEK_END);
  size = ftell(file);
  fseek(file, 0, SEEK_SET);
  steps->text = (char *)malloc((size_t)size + 1);
  if (steps->text == NULL || fread(steps->text, 1, (size_t)size, file) != (size_t)size) {
    fclose(file);
    free(steps->text);
    steps->text = NULL;
    return "the script would not read.";
  }
  fclose(file);
  if (sprout_arena_init(&steps->arena, host) != SPROUT_OK) return "the host cannot give the script memory.";
  if (sprout_json_read(&steps->arena, steps->text, (size_t)size, &root, &error) != SPROUT_OK) {
    snprintf(problem, sizeof problem, "%s is not JSON, at line %zu, column %zu: %s", path, error.line, error.column,
             error.text);
    sproutc_steps_close(steps);
    return problem;
  }
  list = root->kind == SPROUT_JSON_OBJECT ? sprout_json_get(root, "steps") : NULL;
  if (list == NULL || list->kind != SPROUT_JSON_ARRAY) {
    snprintf(problem, sizeof problem, "%s: a script is `{ \"steps\": [ … ] }`, and %s.", path, SHAPES);
    sproutc_steps_close(steps);
    return problem;
  }
  steps->steps = (sproutc_step *)sprout_arena_take(&steps->arena, (list->count + 1) * sizeof *steps->steps);
  if (steps->steps == NULL) {
    sproutc_steps_close(steps);
    return "the host cannot give the script memory.";
  }
  for (i = 0; i < list->count; i++) {
    why = step_of(&steps->arena, i, list->items[i], &now, &seeds, &steps->steps[i]);
    if (why != NULL) {
      sproutc_steps_close(steps);
      return why;
    }
  }
  steps->count = list->count;
  return NULL;
}

void sproutc_steps_close(sproutc_steps *steps) {
  sprout_arena_reset(&steps->arena);
  free(steps->text);
  steps->text = NULL;
  steps->steps = NULL;
  steps->count = 0;
}
