/*
 * The queue, drained (the spec's Events, messages and the bus; The runtime >
 * Turns; The world model > Destroying; Limits > Runtime budgets). A message
 * is queued, never called: the body that sent it runs to its end, and then
 * the queue drains breadth-first, in insertion order, each handler's own
 * sends queued behind everything already waiting. A delivery runs every
 * handler the recipient's kind composes for the message, or every hook for
 * the property, in run order, and each delivery that runs a body is one event
 * against the turn's budget, one deeper than the event that sent it against
 * the cascade depth.
 *
 * Two invariants. A destroyed object has no effects: what is queued to it,
 * what it sent that is still waiting, and the engine's messages naming it as
 * their `from` are dropped, and what its destroying body sent goes with it.
 * And the queue is the one place those rules are kept: nothing else delivers.
 * Once it is empty, what `finally destroy self` marked is destroyed, in the
 * order marked, and that sends nothing.
 */
#include <string.h>

#include "stmt/stmt.h"

sprout_eval_status sprout_exec_queue(sprout_exec *x, const sprout_send *send) {
  sprout_send *slot = (sprout_send *)sprout_exec_grow(x->turn, (void **)&x->queued, &x->queued_count,
                                                      &x->queued_capacity, sizeof *x->queued);
  if (slot == NULL) return SPROUT_EVAL_NO_MEMORY;
  *slot = *send;
  slot->depth = x->depth;
  return SPROUT_EVAL_OK;
}

static bool is_gone(const sprout_exec *x, sprout_str id) {
  size_t i;
  for (i = 0; i < x->gone_count; i++)
    if (sprout_str_same(x->gone[i], id)) return true;
  return false;
}

/* Whether a destroyed object takes `send` with it: queued to it, sent by it, or naming it as its `from`. */
static bool touches_gone(const sprout_exec *x, const sprout_send *send) {
  return is_gone(x, send->recipient) || (send->has_from && is_gone(x, send->from));
}

/* Moves what bodies queued into the queue, behind everything waiting, leaving out what a destroyed object touches. */
static sprout_eval_status enqueue(sprout_exec *x) {
  size_t i;
  for (i = 0; i < x->queued_count; i++) {
    sprout_send *slot;
    if (touches_gone(x, &x->queued[i])) continue;
    slot = (sprout_send *)sprout_exec_grow(x->turn, (void **)&x->queue, &x->queue_count, &x->queue_capacity,
                                           sizeof *x->queue);
    if (slot == NULL) return SPROUT_EVAL_NO_MEMORY;
    *slot = x->queued[i];
  }
  x->queued_count = 0;
  return SPROUT_EVAL_OK;
}

/* What was destroyed is gone, and takes from the queue whatever it touched. */
static sprout_eval_status drop(sprout_exec *x) {
  size_t i, kept = x->queue_head;
  for (i = 0; i < x->destroyed_count; i++) {
    sprout_str *slot = (sprout_str *)sprout_exec_grow(x->turn, (void **)&x->gone, &x->gone_count, &x->gone_capacity,
                                                      sizeof *x->gone);
    if (slot == NULL) return SPROUT_EVAL_NO_MEMORY;
    *slot = x->destroyed[i];
  }
  if (x->destroyed_count == 0) return SPROUT_EVAL_OK;
  x->destroyed_count = 0;
  for (i = x->queue_head; i < x->queue_count; i++)
    if (!touches_gone(x, &x->queue[i])) x->queue[kept++] = x->queue[i];
  x->queue_count = kept;
  return SPROUT_EVAL_OK;
}

/* The objects a delivery passes its handler, positionally, as the spec's Receiving names them. */
static size_t passed(const sprout_send *send, sprout_evaluated out[2]) {
  switch (send->message) {
    case SPROUT_MSG_AUTHORED:
      out[0] = sprout_evaluated_object(send->from);
      if (send->has_value) {
        out[1] = sprout_evaluated_value(send->value);
        return 2;
      }
      return 1;
    case SPROUT_MSG_CHANGED:
      out[0] = sprout_evaluated_value(send->was);
      return 1;
    case SPROUT_MSG_ENTERED:
    case SPROUT_MSG_ARRIVED:
      out[0] = sprout_evaluated_object(send->item);
      out[1] = sprout_evaluated_object(send->from);
      return 2;
    case SPROUT_MSG_LEFT:
    case SPROUT_MSG_DEPARTED:
      out[0] = sprout_evaluated_object(send->item);
      out[1] = sprout_evaluated_object(send->to);
      return 2;
    case SPROUT_MSG_MOVED:
      out[0] = sprout_evaluated_object(send->from);
      out[1] = sprout_evaluated_object(send->to);
      return 2;
    case SPROUT_MSG_SPAWNED:
      out[0] = sprout_evaluated_object(send->from);
      return 1;
    case SPROUT_MSG_TICK:
    case SPROUT_MSG_WOKE:
      out[0] = sprout_evaluated_value(sprout_number(send->elapsed));
      return 1;
  }
  return 0;
}

static const char *engine_key(sprout_message_kind kind) {
  switch (kind) {
    case SPROUT_MSG_ENTERED:
      return "entered";
    case SPROUT_MSG_LEFT:
      return "left";
    case SPROUT_MSG_MOVED:
      return "moved";
    case SPROUT_MSG_ARRIVED:
      return "arrived";
    case SPROUT_MSG_DEPARTED:
      return "departed";
    case SPROUT_MSG_SPAWNED:
      return "spawned";
    case SPROUT_MSG_TICK:
      return "tick";
    case SPROUT_MSG_WOKE:
      return "woke";
    default:
      return NULL;
  }
}

/* The handlers or hooks a delivery runs on a recipient of `kind`, and the key they answer. */
static sprout_eval_status bodies_for(const sprout_exec *x, const sprout_send *send, const sprout_kind_def *kind,
                                     const sprout_node **bodies, const char **on) {
  const sprout_node *table;
  const char *key;
  *bodies = NULL;
  if (send->message == SPROUT_MSG_CHANGED) {
    size_t length = strlen(send->property);
    char *text = (char *)sprout_arena_take(x->turn, length + 10);
    if (text == NULL) return SPROUT_EVAL_NO_MEMORY;
    memcpy(text, "changed :", 9);
    memcpy(text + 9, send->property, length);
    *on = text;
    *bodies = sprout_node_map_find(sprout_node_get(kind->node, "hooks"), send->property);
    return SPROUT_EVAL_OK;
  }
  key = send->message == SPROUT_MSG_AUTHORED ? stmt_message_key(x, send->declared) : engine_key(send->message);
  if (key == NULL) return SPROUT_EVAL_NO_MEMORY;
  table = sprout_node_get(kind->node, "handlers");
  *on = key;
  *bodies = sprout_node_map_find(table, key);
  return SPROUT_EVAL_OK;
}

/* The frame a handler or a hook runs in: `self` the recipient, and each parameter it names bound. */
static sprout_eval_status frame_for(sprout_exec *x, const sprout_send *send, const sprout_node *body, sprout_frame *out) {
  const sprout_node *parameters = sprout_node_get(sprout_node_get(body, "declaration"), "parameters");
  const char *origin = sprout_node_text(body, "origin"), *dot = origin == NULL ? NULL : strchr(origin, '.');
  sprout_evaluated values[2];
  size_t given = passed(send, values), i;
  char *library;
  if (dot == NULL) return expr_unchecked(out, "a handler whose origin is not a qualified name");
  library = sprout_arena_copy(x->turn, origin, (size_t)(dot - origin));
  if (library == NULL) return SPROUT_EVAL_NO_MEMORY;
  *out = sprout_exec_frame(x, send->recipient, library, NULL);
  for (i = 0; parameters != NULL && i < parameters->count && i < given; i++) {
    const sprout_binding *bound;
    const char *name = parameters->items[i]->kind == SPROUT_NODE_NULL ? NULL : sprout_node_text(parameters->items[i], "text");
    if (name == NULL || strcmp(name, "_") == 0) continue;
    bound = sprout_bind(out, name, values[i]);
    if (bound == NULL) return SPROUT_EVAL_NO_MEMORY;
    out->bindings = bound;
  }
  return SPROUT_EVAL_OK;
}

/* Delivers one envelope: every body the recipient's kind has for it, one event. */
static sprout_eval_status deliver(sprout_exec *x, const sprout_send *send) {
  const sprout_stored_instance *recipient = sprout_draft_instance(x->draft, send->recipient);
  const sprout_node *bodies;
  const char *on;
  sprout_frame bare = sprout_exec_frame(x, send->recipient, NULL, NULL);
  size_t i;
  if (recipient == NULL || !expr_live(&bare, send->recipient)) return SPROUT_EVAL_OK;
  EXPR_NEED(bodies_for(x, send, recipient->kind, &bodies, &on));
  if (bodies == NULL || bodies->count == 0) return SPROUT_EVAL_OK;
  if (!sprout_meter_event(x->meter)) return expr_budget_fault(&bare);
  x->meter->cascade_depth = send->depth - 1;
  if (!sprout_meter_enter_cascade(x->meter)) return expr_budget_fault(&bare);
  x->events++;
  for (i = 0; i < bodies->count; i++) {
    sprout_frame frame;
    sprout_ended ended;
    sprout_ran *ran;
    const sprout_node *declaration = sprout_node_get(bodies->items[i], "declaration");
    /* `destroy self` takes effect as the body that ran it ends, so a composed handler after it has no `self`. */
    if (sprout_draft_instance(x->draft, send->recipient) == NULL) break;
    ran = (sprout_ran *)sprout_exec_grow(x->turn, (void **)&x->ran, &x->ran_count, &x->ran_capacity, sizeof *x->ran);
    if (ran == NULL) return SPROUT_EVAL_NO_MEMORY;
    ran->origin = sprout_node_text(bodies->items[i], "origin");
    ran->on = on;
    ran->at = declaration;
    EXPR_NEED(frame_for(x, send, bodies->items[i], &frame));
    x->depth = send->depth + 1;
    EXPR_NEED(sprout_exec_body(x, sprout_node_get(declaration, "body"), &frame, SPROUT_BODY_ACT, &ended));
    EXPR_NEED(drop(x));
    EXPR_NEED(enqueue(x));
  }
  return SPROUT_EVAL_OK;
}

sprout_eval_status sprout_exec_drain(sprout_exec *x) {
  size_t i;
  EXPR_NEED(drop(x));
  EXPR_NEED(enqueue(x));
  while (x->queue_head < x->queue_count) {
    sprout_send send = x->queue[x->queue_head++];
    EXPR_NEED(deliver(x, &send));
  }
  x->depth = 1;
  /* Once every message is handled, what was marked goes, as `destroy self` would. */
  for (i = 0; i < x->marked_count; i++) {
    sprout_frame bare = sprout_exec_frame(x, x->marked[i], NULL, NULL);
    if (is_gone(x, x->marked[i]) || sprout_draft_instance(x->draft, x->marked[i]) == NULL) continue;
    EXPR_NEED(stmt_remove(x, &bare, x->marked[i]));
    EXPR_NEED(drop(x));
  }
  x->marked_count = 0;
  return SPROUT_EVAL_OK;
}
