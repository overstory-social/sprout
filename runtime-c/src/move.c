/*
 * Moving a thing through consent (the spec's Movement and consent; The world
 * model > Places; Limits > Runtime budgets). The containment tree is the
 * engine's, so a move is the engine polling everyone with standing: the
 * thing's `depart`, then the source's `release`, then the destination's
 * `accept`, each list in its kind's run order, and the first refusal decides:
 * nothing after it is asked. This is the one place the tree changes.
 *
 * An actor's `move` reaches a place outside its range only as the
 * destination of an exit or a link of its own place that applies, so an NPC
 * walks the map as a visitor does; a move made through an exit asks no range
 * of its destination, since the exit joins the two places however far apart
 * they sit.
 *
 * Two invariants. Nothing is written until every party has allowed, so a
 * fault or a refusal leaves the draft as it was, and the one write is the
 * draft's `place`, which puts the thing last in its new container. And what
 * the engine then tells the world is queued rather than delivered here, and
 * the notices a place speaks are recorded rather than rendered. A move is
 * charged for what it runs, its range walks and its guards' bodies, and
 * nothing for itself: the statement that proposed it is its body's step.
 */
#include <string.h>

#include "exits.h"
#include "stmt/stmt.h"

/* Whether `node` is `outer` or anywhere inside it, climbing containers. */
static bool within(const sprout_frame *frame, sprout_str node, sprout_str outer) {
  sprout_str at = node;
  size_t guard = 0;
  for (;;) {
    const sprout_stored_instance *instance;
    if (sprout_str_same(at, outer)) return true;
    instance = expr_instance(frame, at);
    if (instance == NULL || !instance->has_container || ++guard > 1000000) return false;
    at = instance->container;
  }
}

/* The people already in `to`, other than `item`, as many as the host lets stand in one place. */
static bool turned_away(const sprout_frame *frame, sprout_str item, sprout_str to) {
  sprout_limit limit = frame->world->host.budgets.people_per_place;
  const sprout_str *held;
  size_t count, i, standing = 0;
  if (!limit.set || !sprout_is_person(frame, item)) return false;
  if (sprout_draft_children(frame->draft, to, &held, &count) != SPROUT_DRAFT_OK) return false;
  for (i = 0; i < count; i++)
    if (!sprout_str_same(held[i], item) && sprout_is_person(frame, held[i])) standing++;
  return standing >= limit.value;
}

static sprout_eval_status names_of(const sprout_frame *frame, const char *first, sprout_str a, const char *second,
                                   sprout_str b, sprout_move_refusal *refusal) {
  sprout_effect_binding *bound = (sprout_effect_binding *)sprout_arena_take(frame->turn, 2 * sizeof *bound);
  if (bound == NULL) return SPROUT_EVAL_NO_MEMORY;
  bound[0].name = first;
  bound[0].bound = sprout_evaluated_object(a);
  refusal->binding_count = 1;
  if (second != NULL) {
    bound[1].name = second;
    bound[1].bound = sprout_evaluated_object(b);
    refusal->binding_count = 2;
  }
  refusal->bindings = bound;
  return SPROUT_EVAL_OK;
}

/* One party's guards of this name, in the order they run: the first refusal decides. */
static sprout_eval_status ask(sprout_exec *x, const sprout_frame *frame, sprout_str party, const char *guard,
                              sprout_str mover, const sprout_str *parameters, size_t count, bool *allowed,
                              sprout_move_refusal *refusal) {
  const sprout_stored_instance *instance = expr_instance(frame, party);
  const sprout_node *guards = instance == NULL ? NULL : sprout_node_get(sprout_node_get(instance->kind->node, "guards"), guard);
  size_t i;
  *allowed = true;
  for (i = 0; guards != NULL && i < guards->count; i++) {
    EXPR_NEED(sprout_guard_run(x, guards->items[i], party, mover, parameters, count, allowed, refusal));
    if (!*allowed) return SPROUT_EVAL_OK;
  }
  return SPROUT_EVAL_OK;
}

/* Who is told that `actor` left or entered `place`: the visitors, who read the notice, and everything else, who is sent a message. */
typedef struct told {
  sprout_str *read, *sent;
  size_t read_count, sent_count;
} told;

static sprout_eval_status told_of(const sprout_frame *frame, sprout_str place, sprout_str actor, told *out) {
  const sprout_reached *walked;
  size_t count, i;
  memset(out, 0, sizeof *out);
  EXPR_NEED(sprout_range_of(frame, place, NULL, &walked, &count));
  out->read = (sprout_str *)sprout_arena_take(frame->turn, (count + 1) * sizeof *out->read);
  out->sent = (sprout_str *)sprout_arena_take(frame->turn, (count + 1) * sizeof *out->sent);
  if (out->read == NULL || out->sent == NULL) return SPROUT_EVAL_NO_MEMORY;
  for (i = 0; i < count; i++) {
    if (sprout_str_same(walked[i].node, actor)) continue;
    if (sprout_is_person(frame, walked[i].node)) out->read[out->read_count++] = walked[i].node;
    else out->sent[out->sent_count++] = walked[i].node;
  }
  return SPROUT_EVAL_OK;
}

/*
 * What `place` says and sends of `actor` leaving it for `to` or entering it
 * from `to`: the engine's `leaves` or `arrives` to the visitors in its range,
 * and `:departed (actor, to)` or `:arrived (actor, from)` to everything else
 * there. The other end is left unbound where it is the world, and the way
 * where the move went through no exit or link.
 */
sprout_eval_status sprout_move_spoken(sprout_exec *x, const sprout_frame *frame, bool leaving, sprout_str place,
                                      sprout_str actor, sprout_str other, const char *way) {
  told heard;
  sprout_send send;
  sprout_effect effect;
  sprout_effect_binding *bound;
  sprout_str by;
  size_t i, n = 0;
  bool world = sprout_str_same(other, x->draft->base->world);
  EXPR_NEED(told_of(frame, place, actor, &heard));
  for (i = 0; i < heard.sent_count; i++) {
    memset(&send, 0, sizeof send);
    send.message = leaving ? SPROUT_MSG_DEPARTED : SPROUT_MSG_ARRIVED;
    send.recipient = heard.sent[i];
    send.item = actor;
    if (leaving) {
      send.to = other;
    } else {
      send.has_from = true;
      send.from = other;
    }
    EXPR_NEED(sprout_exec_queue(x, &send));
  }
  memset(&effect, 0, sizeof effect);
  effect.kind = SPROUT_EFFECT_NOTICE;
  sprout_engine_said(frame, leaving ? "leaves" : "arrives", &actor, &place, &by, &effect.said);
  bound = (sprout_effect_binding *)sprout_arena_take(frame->turn, 3 * sizeof *bound);
  if (bound == NULL) return SPROUT_EVAL_NO_MEMORY;
  bound[n].name = "item";
  bound[n++].bound = sprout_evaluated_object(actor);
  if (!world) {
    bound[n].name = leaving ? "to" : "from";
    bound[n++].bound = sprout_evaluated_object(other);
  }
  if (way != NULL) {
    sprout_value label;
    if (!sprout_string(frame->turn, way, strlen(way), &label)) return SPROUT_EVAL_NO_MEMORY;
    bound[n].name = "way";
    bound[n++].bound = sprout_evaluated_value(label);
  }
  effect.by = by;
  effect.to = heard.read;
  effect.to_count = heard.read_count;
  effect.bindings = bound;
  effect.binding_count = n;
  /* A notice nobody is in range to read is not a line. */
  if (heard.read_count > 0) EXPR_NEED(sprout_exec_record(x, &effect));
  return SPROUT_EVAL_OK;
}

sprout_eval_status sprout_move_reaches(const sprout_frame *frame, sprout_str mover, sprout_str to, bool *reached) {
  const sprout_stored_instance *moving = sprout_draft_instance(frame->draft, mover);
  const sprout_way *leading;
  sprout_str place;
  size_t count, i;
  *reached = false;
  EXPR_NEED(expr_reaches(frame, mover, to, NULL, reached));
  if (*reached || moving == NULL || !moving->kind->composes_actor) return SPROUT_EVAL_OK;
  if (!sprout_surround_of(frame, mover, &place)) return SPROUT_EVAL_OK;
  EXPR_NEED(sprout_exits_from(frame, place, &leading, &count));
  for (i = 0; i < count; i++)
    if (sprout_str_same(leading[i].to, to)) *reached = true;
  return SPROUT_EVAL_OK;
}

sprout_eval_status sprout_move_instance(sprout_exec *x, const sprout_frame *frame, sprout_str mover, sprout_str item,
                                        sprout_str to, sprout_reach reach, const char *way, sprout_move_end *end,
                                        sprout_move_refusal *refusal) {
  sprout_str world = x->draft->base->world, from, standing = {NULL, 0};
  const sprout_stored_instance *moving = sprout_draft_instance(x->draft, item), *destination, *mover_instance;
  bool reached = false, actor, allowed;
  sprout_send send;
  sprout_str parameters[2];
  memset(refusal, 0, sizeof *refusal);
  *end = SPROUT_MOVE_DONE;
  if (sprout_str_same(item, world)) {
    expr_text text = expr_text_begin(frame);
    expr_put(&text, "the world is the root of the tree, and goes nowhere.");
    return expr_fail(frame, "MoveFault");
  }
  if (moving != NULL && moving->made == SPROUT_MADE_VISITOR && !moving->has_container) {
    expr_text text = expr_text_begin(frame);
    expr_put(&text, "`");
    expr_put_str(&text, item);
    expr_put(&text, "` is a visitor who is away, and is nowhere to be moved from.");
    return expr_fail(frame, "MoveFault");
  }
  if (moving != NULL && expr_live(frame, item)) EXPR_NEED(expr_reaches(frame, mover, item, NULL, &reached));
  if (!reached) {
    expr_text text = expr_text_begin(frame);
    expr_put(&text, "`");
    expr_put_str(&text, item);
    expr_put(&text, "` is out of range of `");
    expr_put_str(&text, mover);
    expr_put(&text, "`, so it could not be moved.");
    return expr_fail(frame, "MoveFault");
  }
  reached = false;
  if (sprout_draft_instance(x->draft, to) != NULL && expr_live(frame, to)) {
    if (reach == SPROUT_REACH_RANGE) EXPR_NEED(sprout_move_reaches(frame, mover, to, &reached));
    else reached = true;
  }
  if (!reached) {
    expr_text text = expr_text_begin(frame);
    expr_put(&text, "`");
    expr_put_str(&text, to);
    expr_put(&text, "` is out of range of `");
    expr_put_str(&text, mover);
    expr_put(&text, "`, so nothing could be moved into it.");
    return expr_fail(frame, "MoveFault");
  }
  destination = sprout_draft_instance(x->draft, to);
  if (!sprout_str_same(to, world) && (destination == NULL || !destination->kind->contains)) {
    expr_text text = expr_text_begin(frame);
    expr_put(&text, "`");
    expr_put_str(&text, to);
    expr_put(&text, "` holds nothing, so `");
    expr_put_str(&text, item);
    expr_put(&text, "` could not be moved into it.");
    return expr_fail(frame, "MoveFault");
  }
  /* Live and not the world, so it is somewhere. */
  from = moving->container;

  /* The engine's lines here are about the mover, where it stands somewhere. */
  mover_instance = expr_instance(frame, mover);
  if (mover_instance != NULL && mover_instance->has_container) standing = mover_instance->container;
  if (within(frame, to, item)) {
    sprout_str by;
    sprout_engine_said(frame, "inside_itself", &mover, standing.bytes == NULL ? NULL : &standing, &by, &refusal->said);
    refusal->by = by;
    *end = SPROUT_MOVE_REFUSED_BY_ENGINE;
    return names_of(frame, "item", item, NULL, item, refusal);
  }
  actor = moving->kind->composes_actor;
  if (actor && (destination == NULL || !destination->kind->contains_actors)) {
    refusal->by = world;
    refusal->said.kind = SPROUT_SPEECH_ENGINE;
    refusal->said.name = "not_a_place";
    *end = SPROUT_MOVE_REFUSED_BY_ENGINE;
    return names_of(frame, "item", item, "to", to, refusal);
  }
  if (turned_away(frame, item, to)) {
    sprout_str by;
    sprout_engine_said(frame, "crowded", &mover, standing.bytes == NULL ? NULL : &standing, &by, &refusal->said);
    refusal->by = by;
    *end = SPROUT_MOVE_REFUSED_BY_ENGINE;
    return names_of(frame, "item", item, "to", to, refusal);
  }

  parameters[0] = to;
  EXPR_NEED(ask(x, frame, item, "depart", mover, parameters, 1, &allowed, refusal));
  if (allowed) {
    parameters[0] = item;
    parameters[1] = to;
    EXPR_NEED(ask(x, frame, from, "release", mover, parameters, 2, &allowed, refusal));
  }
  if (allowed) {
    parameters[0] = item;
    parameters[1] = from;
    EXPR_NEED(ask(x, frame, to, "accept", mover, parameters, 2, &allowed, refusal));
  }
  if (!allowed) {
    *end = SPROUT_MOVE_REFUSED_BY_GUARD;
    return SPROUT_EVAL_OK;
  }

  if (sprout_draft_place(x->draft, item, &to) != SPROUT_DRAFT_OK) return SPROUT_EVAL_NO_MEMORY;

  memset(&send, 0, sizeof send);
  send.message = SPROUT_MSG_LEFT;
  send.recipient = from;
  send.item = item;
  send.to = to;
  EXPR_NEED(sprout_exec_queue(x, &send));
  memset(&send, 0, sizeof send);
  send.message = SPROUT_MSG_ENTERED;
  send.recipient = to;
  send.item = item;
  send.has_from = true;
  send.from = from;
  EXPR_NEED(sprout_exec_queue(x, &send));
  memset(&send, 0, sizeof send);
  send.message = SPROUT_MSG_MOVED;
  send.recipient = item;
  send.has_from = true;
  send.from = from;
  send.to = to;
  EXPR_NEED(sprout_exec_queue(x, &send));
  /* An actor is only ever in a place, so it has moved between two. */
  if (actor) {
    sprout_owed *owed;
    /* Both places are told as the tree stands after the move; the walks are asked in this order. */
    EXPR_NEED(sprout_move_spoken(x, frame, true, from, item, to, way));
    EXPR_NEED(sprout_move_spoken(x, frame, false, to, item, from, way));
    owed = (sprout_owed *)sprout_exec_grow(x->turn, (void **)&x->owed, &x->owed_count, &x->owed_capacity, sizeof *x->owed);
    if (owed == NULL) return SPROUT_EVAL_NO_MEMORY;
    owed->mover = item;
    owed->place = to;
    owed->after = SIZE_MAX;
  }
  return SPROUT_EVAL_OK;
}
