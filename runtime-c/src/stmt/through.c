/*
 * `move self north` and `move self along an exit` (the spec's Verbs > Moving
 * something): `self`, an actor, taken through a way out of its place as `go`
 * takes a visitor, the exit of a direction that applies or one drawn from
 * the turn's seed among those that apply and lead. Where the exit refuses
 * its words are the refusal; where none applies, or none leads to draw, the
 * world's `no_way` is. A refusal is said to whoever the body speaks to, which
 * in a handler is nobody, and ends the body as a refused `move` does.
 */
#include <string.h>

#include "stmt.h"
#include "../exits.h"

/* A refusal of `self` going nowhere, by `by` in `said`, with `actor`, `here` and, for `no_way`, `way` bound. */
static sprout_eval_status refused(sprout_run *run, const sprout_frame *frame, sprout_str place, sprout_str by,
                                  sprout_speech said, const char *way) {
  sprout_move_refusal refusal;
  sprout_effect_binding *bound = (sprout_effect_binding *)sprout_arena_take(frame->turn, 3 * sizeof *bound);
  sprout_value written;
  if (bound == NULL) return SPROUT_EVAL_NO_MEMORY;
  memset(&refusal, 0, sizeof refusal);
  bound[0].name = "actor";
  bound[0].bound = sprout_evaluated_object(frame->self);
  bound[1].name = "here";
  bound[1].bound = sprout_evaluated_object(place);
  refusal.binding_count = 2;
  if (way != NULL) {
    if (!sprout_string(frame->turn, way, strlen(way), &written)) return SPROUT_EVAL_NO_MEMORY;
    bound[2].name = "way";
    bound[2].bound = sprout_evaluated_value(written);
    refusal.binding_count = 3;
  }
  refusal.by = by;
  refusal.said = said;
  refusal.bindings = bound;
  EXPR_NEED(sprout_record_refusal(run->x, frame, &refusal));
  run->stopped = SPROUT_STOPPED_REFUSED;
  return SPROUT_EVAL_OK;
}

/* The world's `no_way`, said of `self` in `place`, given `way`. */
static sprout_eval_status no_way(sprout_run *run, const sprout_frame *frame, sprout_str place, const char *way) {
  sprout_str by;
  sprout_speech said;
  sprout_engine_said(frame, "no_way", &frame->self, &place, &by, &said);
  return refused(run, frame, place, by, said, way);
}

/* The way out of `place` the statement names, or NULL where none applies: by its direction, or drawn. */
static sprout_eval_status chosen(const sprout_frame *frame, sprout_str place, const char *direction,
                                 const sprout_way **out) {
  const sprout_way *ways;
  size_t count, i;
  uint32_t drawn;
  *out = NULL;
  if (direction != NULL) {
    EXPR_NEED(sprout_ways_from(frame, place, &ways, &count));
    for (i = 0; i < count; i++)
      if (ways[i].direction != NULL && strcmp(ways[i].direction, direction) == 0) *out = &ways[i];
    return SPROUT_EVAL_OK;
  }
  EXPR_NEED(sprout_exits_from(frame, place, &ways, &count));
  if (count == 0) return SPROUT_EVAL_OK;
  if (frame->draws == NULL) return expr_unchecked(frame, "a way drawn where nothing draws");
  if (!sprout_draws_below(frame->draws, count, &drawn)) return expr_unchecked(frame, "a draw among more ways than 2^32");
  *out = &ways[drawn];
  return SPROUT_EVAL_OK;
}

sprout_eval_status stmt_move_through(sprout_run *run, const sprout_frame *frame, const sprout_node *statement) {
  const char *direction = sprout_node_name(frame->graph, statement, "direction");
  const sprout_way *way;
  sprout_str place;
  bool went;
  EXPR_NEED(stmt_acting(run, frame, "`move`"));
  if (!sprout_surround_of(frame, frame->self, &place))
    return expr_unchecked(frame, "a way out taken by what stands in no place");
  EXPR_NEED(chosen(frame, place, direction, &way));
  if (way == NULL) return no_way(run, frame, place, direction == NULL ? "" : direction);
  if (way->refuses) return refused(run, frame, place, way->by, way->said, NULL);
  EXPR_NEED(sprout_take_way(run->x, frame, frame->self, place, way, sprout_is_person(frame, frame->self), &went));
  if (!went) run->stopped = SPROUT_STOPPED_REFUSED;
  return SPROUT_EVAL_OK;
}
