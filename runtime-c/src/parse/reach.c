/*
 * What a visitor may name (the spec's Range; Range > Sight, Unseen; Parsing > Choosing a reading): every live thing
 * the range walk the visitor sees reaches but the world, nearest first, each with its nearness and whether the one
 * typing carries it, so nothing unseen and nothing an unseen thing holds. In the dark a visitor names only
 * themselves and what they carry. Every object the walk visits is a step; the rest charges nothing.
 *
 * Nearness counts first the ring a thing is in, how far out the container is that it is reached through, then
 * how deep inside that container it lies, and two things are equally near only where both agree. The actor's own
 * place is further than everything it holds and nearer than the ring beyond it, so a place answers to its name
 * only where nothing in it answers as well.
 */

#include "../describe.h"
#include "../expr/expr.h"
#include "parse.h"

/* Where a reached thing stands: its ring, and its depth inside the container it is reached through. */
typedef struct standing {
  size_t ring, depth;
  bool deepest; /* the actor's own place: deeper than anything in its ring */
} standing;

static int compare(const standing *a, const standing *b) {
  if (a->ring != b->ring) return a->ring < b->ring ? -1 : 1;
  if (a->deepest != b->deepest) return a->deepest ? 1 : -1;
  if (a->deepest || a->depth == b->depth) return 0;
  return a->depth < b->depth ? -1 : 1;
}

/* What holds a node in the live tree, if anything does. */
static bool container_of(const sprout_frame *frame, sprout_str node, sprout_str *container) {
  const sprout_stored_instance *instance;
  if (!expr_live(frame, node)) return false;
  instance = expr_instance(frame, node);
  if (instance == NULL || !instance->has_container) return false;
  *container = instance->container;
  return true;
}

/* The reached node `node` is, before `before`; `before` where it is none of them. */
static size_t index_of(const sprout_reached *reached, size_t before, sprout_str node) {
  size_t i;
  for (i = 0; i < before; i++)
    if (sprout_str_same(reached[i].node, node)) return i;
  return before;
}

/* Each reached node's nearness, as a rank among the distinct standings. */
static sprout_eval_status nearness(const sprout_frame *frame, const sprout_reached *reached, size_t count,
                                   sprout_str place, size_t *near) {
  standing *where = (standing *)sprout_arena_take(frame->turn, (count + 1) * sizeof *where);
  standing *ordered = (standing *)sprout_arena_take(frame->turn, (count + 1) * sizeof *ordered);
  size_t i, outer = count, distinct = 0;
  if (where == NULL || ordered == NULL) return SPROUT_EVAL_NO_MEMORY;
  for (i = 0; i < count; i++) {
    sprout_str holder;
    bool held = container_of(frame, reached[i].node, &holder);
    sprout_str beyond;
    if (reached[i].via == SPROUT_VIA_SELF) {
      where[i].ring = where[i].depth = 0;
      outer = i;
    } else if (outer < count && container_of(frame, reached[outer].node, &beyond) &&
               sprout_str_same(reached[i].node, beyond)) {
      where[i].ring = where[outer].ring + 1;
      where[i].depth = 0;
      outer = i;
    } else {
      size_t inside = held ? index_of(reached, i, holder) : i;
      /* One in several places is reached through whichever of them the walk came to first. */
      const char *const *places;
      size_t place_count = held ? sprout_world_also_in(frame->world, reached[i].node, &places) : 0, k;
      for (k = 0; k < place_count && inside == i; k++) {
        sprout_str place;
        place.bytes = places[k];
        place.length = strlen(places[k]);
        inside = index_of(reached, i, place);
      }
      if (inside == i) return expr_engine(frame, "a thing in range was reached before what holds it.");
      where[i].ring = where[inside].ring;
      where[i].depth = where[inside].depth + 1;
    }
    where[i].deepest = false;
  }
  i = index_of(reached, count, place);
  if (i < count) where[i].deepest = true;
  /* Equal standings share a rank: the distinct ones, in order, inserted one by one, and each node's place among them. */
  for (i = 0; i < count; i++) {
    size_t at = 0, k;
    while (at < distinct && compare(&ordered[at], &where[i]) < 0) at++;
    if (at < distinct && compare(&ordered[at], &where[i]) == 0) continue;
    for (k = distinct; k > at; k--) ordered[k] = ordered[k - 1];
    ordered[at] = where[i];
    distinct++;
  }
  for (i = 0; i < count; i++) {
    size_t at = 0;
    while (compare(&ordered[at], &where[i]) != 0) at++;
    near[i] = at;
  }
  return SPROUT_EVAL_OK;
}

/* Which reached nodes the asker carries: what it holds, and what those hold that the walk reached, outward of none. */
static void carried_in(const sprout_frame *frame, const sprout_reached *reached, size_t count, bool *carried) {
  size_t i;
  for (i = 0; i < count; i++) {
    sprout_str holder;
    size_t at;
    carried[i] = false;
    if (reached[i].via == SPROUT_VIA_SELF || !container_of(frame, reached[i].node, &holder)) continue;
    at = index_of(reached, i, holder);
    /* The asker is reached first, as `self`, and carries what it holds. */
    carried[i] = at < i && (reached[at].via == SPROUT_VIA_SELF || carried[at]);
  }
}

sprout_eval_status parse_reach_of(const sprout_frame *frame, sprout_str actor, parse_candidate **out, size_t *count) {
  const sprout_reached *reached;
  const sprout_stored_instance *self = expr_instance(frame, actor);
  size_t reached_count, i, kept = 0, *near;
  bool *carried, dark;
  parse_candidate *candidates;
  *out = NULL;
  *count = 0;
  if (self == NULL || !self->has_container) return expr_engine(frame, "the one typing stands nowhere.");
  EXPR_NEED(sprout_range_seen(frame, actor, &reached, &reached_count));
  near = (size_t *)sprout_arena_take(frame->turn, (reached_count + 1) * sizeof *near);
  carried = (bool *)sprout_arena_take(frame->turn, reached_count + 1);
  candidates = (parse_candidate *)sprout_arena_take(frame->turn, (reached_count + 1) * sizeof *candidates);
  if (near == NULL || carried == NULL || candidates == NULL) return SPROUT_EVAL_NO_MEMORY;
  EXPR_NEED(nearness(frame, reached, reached_count, self->container, near));
  carried_in(frame, reached, reached_count, carried);
  EXPR_NEED(sprout_in_the_dark(frame, actor, &dark));
  for (i = 0; i < reached_count; i++) {
    const sprout_stored_instance *instance;
    instance = expr_instance(frame, reached[i].node);
    if (instance == NULL || instance->kind == NULL || instance->made == SPROUT_MADE_WORLD) continue;
    if (dark && !carried[i] && reached[i].via != SPROUT_VIA_SELF) continue;
    candidates[kept].instance = instance;
    candidates[kept].near = near[i];
    candidates[kept].carried = carried[i];
    EXPR_NEED(parse_address_of(frame, instance, &candidates[kept].address));
    kept++;
  }
  *out = candidates;
  *count = kept;
  return SPROUT_EVAL_OK;
}
