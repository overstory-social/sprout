/*
 * A reading an earlier turn of a line planned, as its own turn runs it (the spec's Parsing > Sequences, again and all;
 * Intents): an intent's step, a thing of `all` or of a run. The world may have changed since the line was read, so
 * every thing and way out it binds must still be in the actor's reach, as `again` asks of the last reading; where one
 * is not, command.c answers the turn with `not_here`, which stops the line.
 */
#include <string.h>

#include "parse.h"

static bool reached(sprout_str id, const parse_candidate *candidates, size_t count) {
  size_t i;
  for (i = 0; i < count; i++)
    if (sprout_str_same(candidates[i].instance->id, id)) return true;
  return false;
}

/* Whether a way out that leads goes where `bound` does, under the same label and in the same direction. */
static bool leads(const sprout_stored_bound *bound, const sprout_way *ways, size_t count) {
  size_t i;
  for (i = 0; i < count; i++) {
    const sprout_way *way = &ways[i];
    if (way->refuses || !sprout_str_same(way->to, bound->to) || !sprout_str_is(bound->label, way->label)) continue;
    if (way->direction == NULL ? !bound->has_direction : bound->has_direction && sprout_str_is(bound->direction, way->direction))
      return true;
  }
  return false;
}

bool parse_in_reach(const parse_reading *reading, const parse_candidate *candidates, size_t candidate_count,
                    const sprout_way *ways, size_t way_count) {
  size_t i, j;
  for (i = 0; i < reading->count; i++) {
    const sprout_stored_bound *bound = &reading->bounds[i];
    switch (bound->kind) {
      case SPROUT_BOUND_OBJECT:
        if (!reached(bound->object, candidates, candidate_count)) return false;
        break;
      case SPROUT_BOUND_SET:
        for (j = 0; j < bound->set_count; j++)
          if (!reached(bound->set[j], candidates, candidate_count)) return false;
        break;
      case SPROUT_BOUND_EXIT:
        if (!leads(bound, ways, way_count)) return false;
        break;
      case SPROUT_BOUND_VALUE:
        break;
    }
  }
  return true;
}

static sprout_str str_of(const char *text) {
  sprout_str str;
  str.bytes = text == NULL ? "" : text;
  str.length = text == NULL ? 0 : strlen(text);
  return str;
}

/* The verb `library.name`, or NULL. */
static const sprout_verb *verb_of(const sprout_world *world, const char *qualified) {
  const char *dot = strchr(qualified, '.');
  size_t i;
  if (dot == NULL) return NULL;
  for (i = 0; i < world->verb_count; i++) {
    const sprout_verb *verb = world->verbs[i];
    if (strlen(verb->library) == (size_t)(dot - qualified) &&
        memcmp(verb->library, qualified, (size_t)(dot - qualified)) == 0 && strcmp(verb->name, dot + 1) == 0)
      return verb;
  }
  return NULL;
}

/* What one filling binds; false where it binds nothing. */
static bool bound_of(sprout_arena *arena, const sprout_filling *filling, sprout_stored_bound *out, bool *ok) {
  size_t i;
  memset(out, 0, sizeof *out);
  *ok = true;
  switch (filling->binds) {
    case SPROUT_FILL_OBJECT:
      out->kind = SPROUT_BOUND_OBJECT;
      out->object = str_of(filling->id);
      return true;
    case SPROUT_FILL_SET:
      out->kind = SPROUT_BOUND_SET;
      out->set = (sprout_str *)sprout_arena_take(arena, (filling->id_count + 1) * sizeof *out->set);
      if (out->set == NULL) return *ok = false;
      for (i = 0; i < filling->id_count; i++) out->set[i] = str_of(filling->ids[i]);
      out->set_count = filling->id_count;
      return true;
    case SPROUT_FILL_EXIT:
      out->kind = SPROUT_BOUND_EXIT;
      out->has_direction = filling->direction != NULL;
      if (filling->direction != NULL) out->direction = str_of(filling->direction);
      out->label = str_of(filling->label);
      out->to = str_of(filling->id);
      return true;
    case SPROUT_FILL_TEXT:
      out->kind = SPROUT_BOUND_VALUE;
      out->value_is_string = true;
      out->value_string = str_of(filling->text);
      return true;
    case SPROUT_FILL_NUMBER:
      out->kind = SPROUT_BOUND_VALUE;
      out->value_number = filling->number;
      return true;
    case SPROUT_FILL_UNBOUND:
      break;
  }
  return false;
}

sprout_status parse_handed_reading(const sprout_world *world, sprout_arena *arena, const sprout_reading *reading,
                                   parse_reading *out) {
  const sprout_verb *verb = reading->verb == NULL ? NULL : verb_of(world, reading->verb);
  size_t *roles, i, r;
  sprout_stored_bound *bounds;
  memset(out, 0, sizeof *out);
  if (verb == NULL || reading->actor == NULL) return SPROUT_BAD_INPUT;
  roles = (size_t *)sprout_arena_take(arena, (reading->filling_count + 1) * sizeof *roles);
  bounds = (sprout_stored_bound *)sprout_arena_take(arena, (reading->filling_count + 1) * sizeof *bounds);
  if (roles == NULL || bounds == NULL) return SPROUT_NO_MEMORY;
  out->verb = verb;
  out->actor = str_of(reading->actor);
  out->roles = roles;
  out->bounds = bounds;
  for (i = 0; i < reading->filling_count; i++) {
    const sprout_filling *filling = &reading->fillings[i];
    bool ok;
    for (r = 0; r < verb->role_count && (filling->role == NULL || strcmp(verb->roles[r].name, filling->role) != 0); r++)
      continue;
    if (r == verb->role_count) return SPROUT_BAD_INPUT;
    if (!bound_of(arena, filling, &bounds[out->count], &ok)) {
      if (!ok) return SPROUT_NO_MEMORY;
      continue;
    }
    roles[out->count++] = r;
  }
  return SPROUT_OK;
}
