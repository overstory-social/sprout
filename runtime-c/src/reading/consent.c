/*
 * The consent pass (the spec's Verbs > The two passes, Playing a role, The
 * actor's own part, Roles compose, Set roles, Optional tools, Value roles, A
 * role-player narrows its own options). It runs every `permit` of every
 * participant, only reading, and the first refusal is the reading's whole
 * outcome. The same frame is built for a `do`: `self` the participant,
 * `actor` and `here`, and each other role as the play sees it.
 */
#include <string.h>

#include "../expr/expr.h"
#include "reading.h"

/* The engine's defect, told with the id it is about. */
static sprout_eval_status defect(const sprout_frame *frame, const char *before, sprout_str id, const char *after) {
  expr_text text = expr_text_begin(frame);
  expr_put(&text, "`");
  expr_put_str(&text, id);
  expr_put(&text, "` ");
  expr_put(&text, before);
  expr_put(&text, after);
  frame->fault->name = "Error";
  return SPROUT_EVAL_ENGINE;
}

sprout_eval_status sprout_place_of(const sprout_frame *frame, sprout_str actor, sprout_str *place) {
  const sprout_stored_instance *instance = expr_instance(frame, actor), *container;
  if (instance == NULL) return defect(frame, "takes part in a reading, and is not an instance.", actor, "");
  if (!instance->has_container) return defect(frame, "is away, and an away visitor reads nothing.", actor, "");
  container = expr_instance(frame, instance->container);
  if (container == NULL) return defect(frame, "takes part in a reading, and is not an instance.", instance->container, "");
  if (!container->kind->contains_actors) {
    expr_text text = expr_text_begin(frame);
    expr_put(&text, "`");
    expr_put_str(&text, actor);
    expr_put(&text, "` is in `");
    expr_put_str(&text, instance->container);
    expr_put(&text, "`, which holds no actors.");
    frame->fault->name = "Error";
    return SPROUT_EVAL_ENGINE;
  }
  *place = instance->container;
  return SPROUT_EVAL_OK;
}

sprout_eval_status sprout_participants(sprout_exec *x, const sprout_resolved *reading, const sprout_participant **out,
                                       size_t *count) {
  const sprout_verb *verb = reading->verb;
  sprout_participant *found;
  size_t i, j, n = 1;
  for (i = 0; i < verb->role_count; i++) {
    const sprout_filled *held = &reading->roles[i];
    if (!held->filled) continue;
    if (held->bound.kind == SPROUT_BOUND_OBJECT) n++;
    else if (held->bound.kind == SPROUT_BOUND_SET) n += held->bound.set_count;
  }
  found = (sprout_participant *)sprout_arena_take(x->turn, n * sizeof *found);
  if (found == NULL) return SPROUT_EVAL_NO_MEMORY;
  n = 0;
  found[n].id = reading->actor;
  found[n++].role = NULL;
  for (i = 0; i < verb->role_count; i++) {
    const sprout_filled *held = &reading->roles[i];
    if (!held->filled) continue;
    if (held->bound.kind == SPROUT_BOUND_OBJECT) {
      found[n].id = held->bound.object;
      found[n++].role = &verb->roles[i];
    } else if (held->bound.kind == SPROUT_BOUND_SET) {
      for (j = 0; j < held->bound.set_count; j++) {
        found[n].id = held->bound.set[j];
        found[n++].role = &verb->roles[i];
      }
    }
  }
  *out = found;
  *count = n;
  return SPROUT_EVAL_OK;
}

/*
 * Whether a play's `from` hears a value (the spec's A role-player narrows its
 * own options): an option its list property holds now, or a number within
 * its integer property's range or the range written out.
 */
static sprout_eval_status hears(const sprout_frame *frame, const sprout_node *narrowing, const sprout_value *value,
                                const sprout_stored_instance *self, bool *heard) {
  *heard = false;
  if (sprout_node_is(sprout_node_get(narrowing, "narrows"), "range")) {
    *heard = value->kind == SPROUT_NUMBER && value->as.number >= sprout_node_get(narrowing, "min")->number &&
             value->as.number <= sprout_node_get(narrowing, "max")->number;
    return SPROUT_EVAL_OK;
  }
  {
    const sprout_node *property = sprout_node_get(narrowing, "property"), *type = sprout_node_get(property, "type");
    sprout_value held;
    size_t i;
    if (sprout_node_is(sprout_node_get(type, "type"), "integer")) {
      *heard = value->kind == SPROUT_NUMBER && value->as.number >= sprout_node_get(type, "min")->number &&
               value->as.number <= sprout_node_get(type, "max")->number;
      return SPROUT_EVAL_OK;
    }
    EXPR_NEED(expr_get(frame, self, sprout_node_text(property, "name"), &held));
    if (held.kind != SPROUT_LIST || value->kind != SPROUT_STRING) return SPROUT_EVAL_OK;
    for (i = 0; i < held.as.list->count; i++)
      if (sprout_value_same(&held.as.list->items[i], value)) *heard = true;
  }
  return SPROUT_EVAL_OK;
}

/* The value a stored bound holds, as the evaluator holds it. */
static sprout_eval_status value_of(const sprout_frame *frame, const sprout_stored_bound *bound, sprout_value *out) {
  if (!bound->value_is_string) {
    *out = sprout_number(bound->value_number);
    return SPROUT_EVAL_OK;
  }
  return sprout_string(frame->turn, bound->value_string.bytes, bound->value_string.length, out) ? SPROUT_EVAL_OK
                                                                                                  : SPROUT_EVAL_NO_MEMORY;
}

/*
 * One role as a play sees it: a set role is always bound, the empty set
 * where nothing filled it; the role played is `self`; a tool left out is
 * unbound; and a value is bound only among the options this play's `from`
 * hears, read from its role-player now. An exit is the engine's to take,
 * and binds nothing in a play.
 */
static sprout_eval_status role_in(const sprout_frame *frame, const sprout_resolved *reading, size_t index,
                                  const sprout_participant *who, const sprout_play *play,
                                  const sprout_stored_instance *self, bool *bound, sprout_evaluated *out) {
  const sprout_role *role = &reading->verb->roles[index];
  const sprout_filled *held = &reading->roles[index];
  *bound = false;
  if (role->filler == SPROUT_FILLER_EXIT) return SPROUT_EVAL_OK;
  if (role->many) {
    out->binds = SPROUT_BINDS_SET;
    out->items = held->filled && held->bound.kind == SPROUT_BOUND_SET ? held->bound.set : NULL;
    out->count = held->filled && held->bound.kind == SPROUT_BOUND_SET ? held->bound.set_count : 0;
    *bound = true;
    return SPROUT_EVAL_OK;
  }
  if (who->role == role || !held->filled) return SPROUT_EVAL_OK;
  if (held->bound.kind == SPROUT_BOUND_OBJECT) {
    *out = sprout_evaluated_object(held->bound.object);
    *bound = true;
    return SPROUT_EVAL_OK;
  }
  if (held->bound.kind == SPROUT_BOUND_VALUE) {
    const sprout_node *narrowing = sprout_node_map_find(sprout_node_get(play->node, "narrows"), role->name);
    sprout_value value;
    bool heard;
    if (narrowing == NULL) return SPROUT_EVAL_OK;
    EXPR_NEED(value_of(frame, &held->bound, &value));
    EXPR_NEED(hears(frame, narrowing, &value, self, &heard));
    if (!heard) return SPROUT_EVAL_OK;
    *out = sprout_evaluated_value(value);
    *bound = true;
  }
  return SPROUT_EVAL_OK;
}

sprout_eval_status sprout_play_frame(sprout_exec *x, const sprout_resolved *reading, const sprout_participant *who,
                                     const sprout_play *play, bool draws, sprout_frame *out) {
  const char *dot = strchr(play->origin, '.');
  const sprout_stored_instance *self;
  sprout_frame bare = sprout_exec_frame(x, who->id, NULL, NULL);
  const sprout_binding *bound;
  sprout_str here;
  char *library;
  size_t i;
  if (dot == NULL) return expr_unchecked(&bare, "a play whose origin is not a qualified name");
  library = sprout_arena_copy(x->turn, play->origin, (size_t)(dot - play->origin));
  if (library == NULL) return SPROUT_EVAL_NO_MEMORY;
  self = expr_instance(&bare, who->id);
  if (self == NULL) return defect(&bare, "takes part in a reading, and is not an instance.", who->id, "");
  *out = sprout_exec_frame(x, who->id, library, NULL);
  if (!draws) out->draws = NULL;
  EXPR_NEED(sprout_place_of(out, reading->actor, &here));
  bound = sprout_bind(out, "actor", sprout_evaluated_object(reading->actor));
  if (bound == NULL) return SPROUT_EVAL_NO_MEMORY;
  out->bindings = bound;
  bound = sprout_bind(out, "here", sprout_evaluated_object(here));
  if (bound == NULL) return SPROUT_EVAL_NO_MEMORY;
  out->bindings = bound;
  for (i = 0; i < reading->verb->role_count; i++) {
    sprout_evaluated evaluated;
    bool has;
    EXPR_NEED(role_in(out, reading, i, who, play, self, &has, &evaluated));
    if (!has) continue;
    bound = sprout_bind(out, reading->verb->roles[i].name, evaluated);
    if (bound == NULL) return SPROUT_EVAL_NO_MEMORY;
    out->bindings = bound;
  }
  return SPROUT_EVAL_OK;
}

sprout_eval_status sprout_consent_pass(sprout_exec *x, const sprout_frame *frame, const sprout_resolved *reading,
                                       bool *refused, sprout_permit_refusal *out) {
  const sprout_participant *participants;
  size_t count, i, g, p;
  EXPR_NEED(sprout_uncarried(x, frame, reading, refused, out));
  if (*refused) return SPROUT_EVAL_OK;
  EXPR_NEED(sprout_participants(x, reading, &participants, &count));
  for (i = 0; i < count; i++) {
    const sprout_stored_instance *self = expr_instance(frame, participants[i].id);
    sprout_plays plays;
    if (self == NULL) return defect(frame, "takes part in a reading, and is not an instance.", participants[i].id, "");
    sprout_plays_for(reading, &participants[i], self->kind, &plays);
    for (g = 0; g < plays.count; g++) {
      for (p = 0; p < plays.groups[g]->count; p++) {
        const sprout_play *play = &plays.groups[g]->plays[p];
        const sprout_node *permit = sprout_node_get(sprout_node_get(play->node, "declaration"), "permit");
        sprout_frame inside;
        sprout_ended ended;
        if (permit == NULL || permit->kind == SPROUT_NODE_NULL) continue;
        EXPR_NEED(sprout_play_frame(x, reading, &participants[i], play, false, &inside));
        EXPR_NEED(sprout_exec_body(x, permit, &inside, SPROUT_BODY_DECIDE, &ended));
        if (ended.how != SPROUT_END_REFUSE) continue;
        memset(out, 0, sizeof *out);
        out->refusal.by = participants[i].id;
        out->refusal.origin = play->origin;
        out->refusal.said = ended.refused;
        out->role = participants[i].role == NULL ? "actor" : participants[i].role->name;
        *refused = true;
        return sprout_effect_names(&inside, &out->refusal.bindings, &out->refusal.binding_count);
      }
    }
  }
  return SPROUT_EVAL_OK;
}
