/*
 * `again`, or `g`, runs the actor's last reading again (the spec's Parsing > Sequences, again and all): the same verb
 * and the same things, not the same words, so a line whose nouns would now mean something else still means what it
 * meant. A reading kept from before may no longer be one its verb takes, where the world has changed since: each
 * binding must name a role of the verb and fill it with what the role takes, each thing still in the world and of
 * the role's kind, and every role a thing or a way out fills that is not optional must be bound. A value role is
 * bound only where a participant hears its value, so it may be unbound.
 */
#include <string.h>

#include "../draft.h"
#include "parse.h"

/* Whether `id` is a thing in the world that may fill `role`. */
static bool fitting_thing(const sprout_frame *frame, const sprout_role *role, sprout_str id) {
  const sprout_stored_instance *instance = sprout_draft_instance(frame->draft, id);
  return instance != NULL && parse_fits(role, instance);
}

/* Whether `bound` fills `role` with what it takes. */
static bool fills(const sprout_frame *frame, const sprout_role *role, const sprout_stored_bound *bound) {
  size_t i;
  if (role->filler == SPROUT_FILLER_NONE) return false;
  switch (bound->kind) {
    case SPROUT_BOUND_OBJECT:
      return !role->many && fitting_thing(frame, role, bound->object);
    case SPROUT_BOUND_SET:
      if (!role->many) return false;
      for (i = 0; i < bound->set_count; i++)
        if (!fitting_thing(frame, role, bound->set[i])) return false;
      return true;
    case SPROUT_BOUND_EXIT:
      return role->filler == SPROUT_FILLER_EXIT;
    case SPROUT_BOUND_VALUE:
      return bound->value_is_string ? role->filler == SPROUT_FILLER_SYMBOL : role->filler == SPROUT_FILLER_INTEGER;
  }
  return false;
}

static const sprout_verb *verb_of(const sprout_world *world, const sprout_stored_reading *last) {
  size_t i;
  for (i = 0; i < world->verb_count; i++)
    if (sprout_str_is(last->library, world->verbs[i]->library) && sprout_str_is(last->name, world->verbs[i]->name))
      return world->verbs[i];
  return NULL;
}

sprout_eval_status parse_again_reading(const sprout_frame *frame, const sprout_stored_reading *last, sprout_str actor,
                                       parse_reading *out, bool *fits) {
  const sprout_verb *verb = verb_of(frame->world, last);
  size_t *roles, i, r;
  sprout_stored_bound *bounds;
  memset(out, 0, sizeof *out);
  *fits = false;
  if (verb == NULL) return SPROUT_EVAL_OK;
  roles = (size_t *)sprout_arena_take(frame->turn, (last->binding_count + 1) * sizeof *roles);
  if (roles == NULL) return SPROUT_EVAL_NO_MEMORY;
  for (i = 0; i < last->binding_count; i++) {
    for (r = 0; r < verb->role_count && !sprout_str_is(last->bindings[i].role, verb->roles[r].name); r++) continue;
    if (r == verb->role_count || !fills(frame, &verb->roles[r], &last->bindings[i].bound)) return SPROUT_EVAL_OK;
    roles[i] = r;
  }
  for (r = 0; r < verb->role_count; r++) {
    const sprout_role *role = &verb->roles[r];
    bool value = role->filler == SPROUT_FILLER_SYMBOL || role->filler == SPROUT_FILLER_INTEGER, bound = false;
    for (i = 0; i < last->binding_count && !bound; i++) bound = roles[i] == r;
    if (!role->optional && !value && !bound) return SPROUT_EVAL_OK;
  }
  out->verb = verb;
  out->actor = actor;
  out->count = last->binding_count;
  out->roles = roles;
  bounds = (sprout_stored_bound *)sprout_arena_take(frame->turn, (last->binding_count + 1) * sizeof *bounds);
  if (bounds == NULL) return SPROUT_EVAL_NO_MEMORY;
  for (i = 0; i < last->binding_count; i++) bounds[i] = last->bindings[i].bound;
  out->bounds = bounds;
  *fits = true;
  return SPROUT_EVAL_OK;
}
