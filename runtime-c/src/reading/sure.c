/*
 * What an offer can tell of its move without running it (the spec's The runtime > The view;
 * Movement and consent > After the move). A poll runs no `do`, so it reads them: the first `move`
 * written directly in a `do`, between names that play's frame binds, is the move it is sure to
 * propose. Read across a reading's plays in the effect pass's order, it greys an offer that would put
 * a thing inside itself with the engine's `inside_itself`, and one that would move a thing declared in
 * several places, or a place it stands in, with its `fixed`, as the move would be refused; read in the actor's own plays, it says
 * which roles move their filler, which the view never fills with the actor's own place, and which move
 * it away from the actor, where `in` and `on` after `all` say where it goes. Each play
 * read is a step, and each container climbed another.
 */
#include <string.h>

#include "../expr/expr.h"
#include "reading.h"

/* The first `move` written directly in a play's `do`; NULL where there is none. */
static const sprout_node *sure_move(const sprout_graph *graph, const sprout_play *play) {
  const sprout_node *body = sprout_node_get(graph, sprout_node_get(graph, play->node, "declaration"), "do");
  const sprout_node *statements = sprout_node_get(graph, body, "statements");
  size_t i;
  for (i = 0; statements != NULL && i < statements->count; i++)
    if (sprout_node_is(graph, sprout_node_get(graph, sprout_item(graph, statements, i), "kind"), "move")) return sprout_item(graph, statements, i);
  return NULL;
}

/* The one name a path is, or NULL where it is dotted. */
static const char *lone_name(const sprout_graph *graph, const sprout_node *path) {
  const char *name = sprout_name(graph, path);
  return name != NULL && strchr(name, '.') == NULL ? name : NULL;
}

/* The object a one-word path names in `frame`: `self` or a name it binds to an object. */
static bool named(const sprout_frame *frame, const sprout_node *path, sprout_str *out) {
  const char *name = lone_name(frame->graph, path);
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
                                     const sprout_stored_instance *self, const char *line, sprout_str item,
                                     sprout_permit_refusal *out) {
  sprout_effect_binding *bound = (sprout_effect_binding *)sprout_arena_take(frame->turn, sizeof *bound);
  if (bound == NULL) return SPROUT_EVAL_NO_MEMORY;
  memset(out, 0, sizeof *out);
  sprout_engine_said(frame, line, &who->id, self->has_container ? &self->container : NULL,
                     &out->refusal.by, &out->refusal.said);
  out->role = who->role == NULL ? "actor" : who->role->name;
  bound->name = "item";
  bound->bound = sprout_evaluated_object(item);
  out->refusal.bindings = bound;
  out->refusal.binding_count = 1;
  return SPROUT_EVAL_OK;
}

sprout_eval_status sprout_sure_move_refused(sprout_exec *x, const sprout_frame *frame, const sprout_resolved *reading,
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
        move = sprout_play_runs(play, reading->verb) ? sure_move(&frame->world->graph, play) : NULL;
        if (move == NULL) continue;
        EXPR_NEED(sprout_play_frame(x, reading, &participants[i], play, false, &inside));
        if (!named(&inside, sprout_node_get(&frame->world->graph, move, "thing"), &item) ||
            !named(&inside, sprout_node_get(frame->graph, move, "destination"), &to) ||
            sprout_str_same(item, frame->draft->base->world))
          return SPROUT_EVAL_OK;
        {
          bool fixed;
          EXPR_NEED(sprout_move_fixed(frame, item, &fixed));
          if (fixed) {
            *refused = true;
            return refusal_of(frame, &participants[i], self, "fixed", item, out);
          }
        }
        EXPR_NEED(within(frame, to, item, &in));
        if (!in) return SPROUT_EVAL_OK;
        *refused = true;
        return refusal_of(frame, &participants[i], self, "inside_itself", item, out);
      }
    }
  }
  return SPROUT_EVAL_OK;
}

/* The first sure move of one of `actor`'s own plays in `verb` that moves what fills `role`; NULL where none does. */
static sprout_eval_status filler_move(const sprout_frame *frame, const sprout_verb *verb, const sprout_role *role,
                                      sprout_str actor, const sprout_node **out) {
  const sprout_graph *graph = &frame->world->graph;
  const sprout_stored_instance *self = expr_instance(frame, actor);
  const sprout_play_group *own = self == NULL ? NULL : sprout_own_plays(verb, "actor", self->kind);
  size_t i;
  *out = NULL;
  for (i = 0; own != NULL && i < own->count && *out == NULL; i++) {
    const sprout_node *move;
    const char *thing;
    EXPR_NEED(expr_spend(frame));
    move = sure_move(graph, &own->plays[i]);
    thing = move == NULL ? NULL : lone_name(graph, sprout_node_get(graph, move, "thing"));
    if (thing != NULL && strcmp(thing, role->name) == 0) *out = move;
  }
  return SPROUT_EVAL_OK;
}

sprout_eval_status sprout_moves_its_filler(const sprout_frame *frame, const sprout_verb *verb, const sprout_role *role,
                                           sprout_str actor, bool *moves) {
  const sprout_node *move;
  EXPR_NEED(filler_move(frame, verb, role, actor, &move));
  *moves = move != NULL;
  return SPROUT_EVAL_OK;
}

sprout_eval_status sprout_moves_its_filler_away(const sprout_frame *frame, const sprout_verb *verb,
                                                const sprout_role *role, sprout_str actor, bool *away) {
  const sprout_graph *graph = &frame->world->graph;
  const sprout_node *move;
  const char *to;
  EXPR_NEED(filler_move(frame, verb, role, actor, &move));
  to = move == NULL ? NULL : lone_name(graph, sprout_node_get(graph, move, "destination"));
  *away = to != NULL && strcmp(to, "self") != 0 && strcmp(to, "actor") != 0;
  return SPROUT_EVAL_OK;
}

/* A name the walk below reads as one of a set role's things: the role itself, or what an `each ... of` it binds. */
typedef struct role_names {
  const char *name;
  const struct role_names *outer;
} role_names;

static bool names_the_role(const role_names *names, const char *name) {
  for (; names != NULL && name != NULL; names = names->outer)
    if (strcmp(names->name, name) == 0) return true;
  return false;
}

/* The name a `binding` expression reads, or NULL where the expression is any other. */
static const char *bound_name(const sprout_graph *graph, const sprout_node *expression) {
  if (!sprout_node_is(graph, sprout_node_get(graph, expression, "kind"), "binding")) return NULL;
  return sprout_node_name(graph, expression, "name");
}

static sprout_eval_status block_takes(const sprout_frame *frame, const sprout_node *block, const role_names *names, bool *takes);

/* One statement of that walk: a `move` of the role's things to `self` or `actor`, or one inside an `if` or an `each`. */
static sprout_eval_status statement_takes(const sprout_frame *frame, const sprout_node *statement, const role_names *names,
                                          bool *takes) {
  const sprout_graph *graph = &frame->world->graph;
  const sprout_node *kind = sprout_node_get(graph, statement, "kind");
  EXPR_NEED(expr_spend(frame));
  if (sprout_node_is(graph, kind, "move")) {
    const char *to = lone_name(graph, sprout_node_get(graph, statement, "destination"));
    *takes = names_the_role(names, lone_name(graph, sprout_node_get(graph, statement, "thing"))) && to != NULL &&
             (strcmp(to, "self") == 0 || strcmp(to, "actor") == 0);
    return SPROUT_EVAL_OK;
  }
  if (sprout_node_is(graph, kind, "each")) {
    role_names inner;
    inner.name = sprout_node_name(graph, statement, "variable");
    inner.outer = names;
    if (inner.name == NULL || !sprout_node_is(graph, sprout_node_get(graph, statement, "walks"), "of") ||
        !names_the_role(names, bound_name(graph, sprout_node_get(graph, statement, "over"))))
      return block_takes(frame, sprout_node_get(graph, statement, "body"), names, takes);
    return block_takes(frame, sprout_node_get(graph, statement, "body"), &inner, takes);
  }
  while (sprout_node_is(graph, kind, "if")) {
    const sprout_node *otherwise = sprout_node_get(graph, statement, "otherwise");
    EXPR_NEED(block_takes(frame, sprout_node_get(graph, statement, "then"), names, takes));
    if (*takes || otherwise == NULL || otherwise->kind == SPROUT_NODE_NULL) return SPROUT_EVAL_OK;
    kind = sprout_node_get(graph, otherwise, "kind");
    if (sprout_node_is(graph, kind, "block")) return block_takes(frame, otherwise, names, takes);
    EXPR_NEED(expr_spend(frame));
    statement = otherwise;
  }
  return SPROUT_EVAL_OK;
}

static sprout_eval_status block_takes(const sprout_frame *frame, const sprout_node *block, const role_names *names,
                                      bool *takes) {
  const sprout_graph *graph = &frame->world->graph;
  const sprout_node *statements = sprout_node_get(graph, block, "statements");
  size_t i;
  for (i = 0; statements != NULL && i < statements->count && !*takes; i++)
    EXPR_NEED(statement_takes(frame, sprout_item(graph, statements, i), names, takes));
  return SPROUT_EVAL_OK;
}

sprout_eval_status sprout_takes_its_things(const sprout_frame *frame, const sprout_verb *verb, const sprout_role *role,
                                           sprout_str actor, bool *takes) {
  const sprout_graph *graph = &frame->world->graph;
  const sprout_stored_instance *self = expr_instance(frame, actor);
  const sprout_play_group *own = self == NULL ? NULL : sprout_own_plays(verb, "actor", self->kind);
  role_names names;
  size_t i;
  *takes = false;
  names.name = role->name;
  names.outer = NULL;
  for (i = 0; own != NULL && i < own->count && !*takes; i++) {
    const sprout_node *body = sprout_node_get(graph, sprout_node_get(graph, own->plays[i].node, "declaration"), "do");
    EXPR_NEED(block_takes(frame, body, &names, takes));
  }
  return SPROUT_EVAL_OK;
}
