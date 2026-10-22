/*
 * After a command (the spec's Verbs > After a command). Once a person's own
 * reading has run its effect pass, the queue it filled has drained and the
 * engine has answered it, every `after command` that follows it runs, and
 * the queue its bodies fill drains after it; a command refused, by its
 * consent pass, its exit or the move's guards, is followed too, once its
 * refusal is said. What runs is what they carry,
 * nearest first and through what passes, then the person, then each
 * container that holds them, out to the world; each runs its kind's bodies
 * in composition order, with `actor` the person, `here` their place as
 * the hooks begin, `refused` whether the command was refused, and `way` the
 * direction a refused `go` tried, unbound for any other command. What a body says reaches the person and what it tells
 * leaves them out, as a `do`'s does. A thing gone before its turn runs
 * nothing. Each thing whose bodies run is one event; nothing is walked in a
 * world whose kinds write none.
 */
#include <string.h>

#include "../expr/expr.h"
#include "reading.h"

typedef struct ids {
  sprout_str *items;
  size_t count, capacity;
} ids;

static sprout_eval_status push(sprout_arena *turn, ids *list, sprout_str id) {
  sprout_str *slot = (sprout_str *)sprout_exec_grow(turn, (void **)&list->items, &list->count, &list->capacity,
                                                    sizeof *list->items);
  if (slot == NULL) return SPROUT_EVAL_NO_MEMORY;
  *slot = id;
  return SPROUT_EVAL_OK;
}

/* The bodies `kind` runs after a command, in composition order; NULL where it runs none. */
static const sprout_node *bodies_of(const sprout_world *world, const sprout_kind_def *kind) {
  const sprout_node *list = sprout_node_get(&world->graph, kind->node, "afterCommand");
  return list == NULL || list->count == 0 ? NULL : list;
}

static bool any_follows(const sprout_world *world) {
  size_t i;
  for (i = 0; i < world->kind_count; i++)
    if (bodies_of(world, world->kinds[i]) != NULL) return true;
  return false;
}

/* What `actor` carries, nearest first: their hands, then inside each thing that passes, every node a step. */
static sprout_eval_status carried(const sprout_frame *frame, sprout_str actor, ids *out) {
  size_t head = out->count;
  EXPR_NEED(push(frame->turn, out, actor));
  while (head < out->count) {
    sprout_str node = out->items[head++];
    const sprout_str *held;
    size_t count, i;
    bool open = true;
    if (!sprout_str_same(node, actor)) EXPR_NEED(expr_passes(frame, node, NULL, &open));
    if (!open || !expr_live(frame, node)) continue;
    if (sprout_draft_children(frame->draft, node, &held, &count) != SPROUT_DRAFT_OK) return SPROUT_EVAL_NO_MEMORY;
    for (i = 0; i < count; i++) {
      EXPR_NEED(expr_spend(frame));
      EXPR_NEED(push(frame->turn, out, held[i]));
    }
  }
  /* The actor came first only to start the walk; it follows what it carries. */
  memmove(out->items, out->items + 1, (out->count - 1) * sizeof *out->items);
  out->items[out->count - 1] = actor;
  return SPROUT_EVAL_OK;
}

/* Every container that holds `actor`, nearest first, out to the world. */
static sprout_eval_status holders(const sprout_frame *frame, sprout_str actor, ids *out) {
  const sprout_stored_instance *instance = expr_instance(frame, actor);
  while (instance != NULL && instance->has_container) {
    EXPR_NEED(expr_spend(frame));
    EXPR_NEED(push(frame->turn, out, instance->container));
    instance = expr_instance(frame, instance->container);
  }
  return SPROUT_EVAL_OK;
}

/* Binds `name` to `value` in `frame`. */
static sprout_eval_status bound_in(sprout_frame *frame, const char *name, sprout_evaluated value) {
  const sprout_binding *bound = sprout_bind(frame, name, value);
  if (bound == NULL) return SPROUT_EVAL_NO_MEMORY;
  frame->bindings = bound;
  return SPROUT_EVAL_OK;
}

/* The frame one body runs in: `self` the thing, read from the library that wrote it, `actor`, `here`, `refused` and any `way` bound. */
static sprout_eval_status frame_for(sprout_exec *x, const sprout_node *after, sprout_str self, sprout_str actor,
                                    sprout_str here, sprout_frame *out) {
  const char *origin = sprout_node_text(&x->world->graph, after, "origin"), *dot = origin == NULL ? NULL : strchr(origin, '.');
  char *library;
  sprout_frame bare = sprout_exec_frame(x, self, NULL, NULL);
  if (dot == NULL) return expr_unchecked(&bare, "an `after command` whose origin is not a qualified name");
  library = sprout_arena_copy(x->turn, origin, (size_t)(dot - origin));
  if (library == NULL) return SPROUT_EVAL_NO_MEMORY;
  *out = sprout_exec_frame(x, self, library, NULL);
  EXPR_NEED(bound_in(out, "actor", sprout_evaluated_object(actor)));
  EXPR_NEED(bound_in(out, "here", sprout_evaluated_object(here)));
  EXPR_NEED(bound_in(out, "refused", sprout_evaluated_value(sprout_bool(x->follows_refused))));
  if (x->follows_way.bytes != NULL) {
    sprout_value way;
    if (!sprout_string(x->turn, x->follows_way.bytes, x->follows_way.length, &way)) return SPROUT_EVAL_NO_MEMORY;
    EXPR_NEED(bound_in(out, "way", sprout_evaluated_value(way)));
  }
  return SPROUT_EVAL_OK;
}

/* Runs every body `self`'s kind follows a command with, as one event. */
static sprout_eval_status follow(sprout_exec *x, sprout_str self, sprout_str actor, sprout_str here) {
  const sprout_stored_instance *instance = sprout_draft_instance(x->draft, self);
  sprout_frame bare = sprout_exec_frame(x, self, NULL, NULL);
  const sprout_node *bodies;
  size_t i;
  if (instance == NULL || !expr_live(&bare, self)) return SPROUT_EVAL_OK;
  bodies = bodies_of(x->world, instance->kind);
  if (bodies == NULL) return SPROUT_EVAL_OK;
  if (!sprout_meter_event(x->meter)) return expr_budget_fault(&bare);
  for (i = 0; i < bodies->count; i++) {
    const sprout_node *after = sprout_item(&x->world->graph, bodies, i);
    const sprout_node *declaration = sprout_node_get(&x->world->graph, after, "declaration");
    sprout_frame frame;
    sprout_ended ended;
    /* `destroy self` takes effect as the body that ran it ends, so a composed body after it has no `self`. */
    if (sprout_draft_instance(x->draft, self) == NULL) break;
    if (x->accounts) {
      sprout_ran *ran = (sprout_ran *)sprout_exec_grow(x->turn, (void **)&x->ran, &x->ran_count, &x->ran_capacity,
                                                       sizeof *x->ran);
      if (ran == NULL) return SPROUT_EVAL_NO_MEMORY;
      ran->origin = sprout_node_text(&x->world->graph, after, "origin");
      ran->on = "after command";
      ran->at = sprout_place_text(&x->world->graph, sprout_node_get(&x->world->graph, declaration, "at"), x->turn);
      if (ran->at == NULL) return SPROUT_EVAL_NO_MEMORY;
    }
    EXPR_NEED(frame_for(x, after, self, actor, here, &frame));
    EXPR_NEED(sprout_exec_body(x, sprout_node_get(&x->world->graph, declaration, "body"), &frame, SPROUT_BODY_ACT, &ended));
  }
  return SPROUT_EVAL_OK;
}

void sprout_after_owed(sprout_exec *x, bool refused, sprout_str way) {
  x->follows = true;
  x->follows_refused = refused;
  x->follows_way = way;
  if (!refused) x->follows_way.bytes = NULL;
}

sprout_eval_status sprout_after_command(sprout_exec *x, const sprout_frame *frame, sprout_str actor) {
  ids order;
  sprout_str here;
  sprout_hearing saved;
  sprout_eval_status status = SPROUT_EVAL_OK;
  size_t i;
  if (!x->follows) return SPROUT_EVAL_OK;
  x->follows = false;
  if (!any_follows(x->world) || sprout_draft_instance(x->draft, actor) == NULL) return SPROUT_EVAL_OK;
  memset(&order, 0, sizeof order);
  EXPR_NEED(sprout_place_of(frame, actor, &here));
  EXPR_NEED(carried(frame, actor, &order));
  EXPR_NEED(holders(frame, actor, &order));
  EXPR_NEED(sprout_hear_reading(x, frame, actor, &actor, 1, &saved));
  for (i = 0; status == SPROUT_EVAL_OK && i < order.count; i++) status = follow(x, order.items[i], actor, here);
  sprout_hearing_restore(x, &saved);
  return status;
}
