/*
 * What an offer can tell of its move without running it (the spec's The runtime > The view;
 * Movement and consent > After the move). A poll runs no `do`, so it reads them: the first `move`
 * written directly in a `do`, between names that play's frame binds, is the move it is sure to
 * propose. Read across a reading's plays in the effect pass's order, it greys an offer that would put
 * a thing inside itself with the engine's `inside_itself`; read in the actor's own plays, it says
 * which roles move their filler, which the view never fills with the actor's own place. Each play
 * read is a step, and each container climbed another.
 */
#include <string.h>

#include "../expr/expr.h"
#include "reading.h"

/* The first `move` written directly in a play's `do`; NULL where there is none. */
static const sprout_node *sure_move(const sprout_play *play) {
  const sprout_node *body = sprout_node_get(sprout_node_get(play->node, "declaration"), "do");
  const sprout_node *statements = sprout_node_get(body, "statements");
  size_t i;
  for (i = 0; statements != NULL && i < statements->count; i++)
    if (sprout_node_is(sprout_node_get(statements->items[i], "kind"), "move")) return statements->items[i];
  return NULL;
}

/* The one name a path is, or NULL where it is dotted. */
static const char *lone_name(const sprout_node *path) {
  const sprout_node *parts = sprout_node_get(path, "parts");
  return parts != NULL && parts->count == 1 ? sprout_node_text(parts->items[0], "text") : NULL;
}

/* The object a one-word path names in `frame`: `self` or a name it binds to an object. */
static bool named(const sprout_frame *frame, const sprout_node *path, sprout_str *out) {
  const char *name = lone_name(path);
  const sprout_binding *held;
  if (name == NULL) return false;
  if (strcmp(name, "self") == 0) {
    *out = frame->self;
    return true;
  }
  held = expr_binding(frame, name);
  if (held == NULL || held->bound.binds != SPROUT_BINDS_OBJECT) return false;
  *out = held->bound.id;
  return true;
}

/* Whether `node` is `outer` or anywhere inside it, climbing containers, each a step. */
static sprout_eval_status within(const sprout_frame *frame, sprout_str node, sprout_str outer, bool *inside) {
  size_t limit = frame->draft->base->instance_count + frame->draft->written_count + 2, climbed = 0;
  sprout_str at = node;
  *inside = false;
  for (;;) {
    const sprout_stored_instance *instance;
    EXPR_NEED(expr_spend(frame));
    if (sprout_str_same(at, outer)) {
      *inside = true;
      return SPROUT_EVAL_OK;
    }
    instance = expr_instance(frame, at);
    if (instance == NULL || !instance->has_container || ++climbed > limit) return SPROUT_EVAL_OK;
    at = instance->container;
  }
}

static sprout_eval_status refusal_of(const sprout_frame *frame, const sprout_participant *who,
                                     const sprout_stored_instance *self, sprout_str item, sprout_permit_refusal *out) {
  sprout_effect_binding *bound = (sprout_effect_binding *)sprout_arena_take(frame->turn, sizeof *bound);
  if (bound == NULL) return SPROUT_EVAL_NO_MEMORY;
  memset(out, 0, sizeof *out);
  sprout_engine_said(frame, "inside_itself", &who->id, self->has_container ? &self->container : NULL,
                     &out->refusal.by, &out->refusal.said);
  out->role = who->role == NULL ? "actor" : who->role->name;
  bound->name = "item";
  bound->bound = sprout_evaluated_object(item);
  out->refusal.bindings = bound;
  out->refusal.binding_count = 1;
  return SPROUT_EVAL_OK;
}

sprout_eval_status sprout_inside_itself(sprout_exec *x, const sprout_frame *frame, const sprout_resolved *reading,
                                        bool *refused, sprout_permit_refusal *out) {
  const sprout_participant *participants;
  size_t count, i, g, p;
  *refused = false;
  EXPR_NEED(sprout_participants(x, reading, &participants, &count));
  for (i = 0; i < count; i++) {
    const sprout_stored_instance *self = expr_instance(frame, participants[i].id);
    sprout_plays plays;
    if (self == NULL) continue;
    sprout_plays_for(reading, &participants[i], self->kind, &plays);
    for (g = 0; g < plays.count; g++) {
      for (p = 0; p < plays.groups[g]->count; p++) {
        const sprout_play *play = &plays.groups[g]->plays[p];
        const sprout_node *move;
        sprout_frame inside;
        sprout_str item, to;
        bool in;
        EXPR_NEED(expr_spend(frame));
        move = sure_move(play);
        if (move == NULL) continue;
        EXPR_NEED(sprout_play_frame(x, reading, &participants[i], play, false, &inside));
        if (!named(&inside, sprout_node_get(move, "thing"), &item) ||
            !named(&inside, sprout_node_get(move, "destination"), &to) ||
            sprout_str_same(item, frame->draft->base->world))
          return SPROUT_EVAL_OK;
        EXPR_NEED(within(frame, to, item, &in));
        if (!in) return SPROUT_EVAL_OK;
        *refused = true;
        return refusal_of(frame, &participants[i], self, item, out);
      }
    }
  }
  return SPROUT_EVAL_OK;
}

sprout_eval_status sprout_moves_its_filler(const sprout_frame *frame, const sprout_verb *verb, const sprout_role *role,
                                           sprout_str actor, bool *moves) {
  const sprout_stored_instance *self = expr_instance(frame, actor);
  const sprout_play_group *own = self == NULL ? NULL : sprout_own_plays(verb, "actor", self->kind);
  size_t i;
  *moves = false;
  for (i = 0; own != NULL && i < own->count && !*moves; i++) {
    const sprout_node *move;
    EXPR_NEED(expr_spend(frame));
    move = sure_move(&own->plays[i]);
    *moves = move != NULL && lone_name(sprout_node_get(move, "thing")) != NULL &&
             strcmp(lone_name(sprout_node_get(move, "thing")), role->name) == 0;
  }
  return SPROUT_EVAL_OK;
}
