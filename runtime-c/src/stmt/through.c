/*
 * `move self north` and `move self along an exit` (the spec's Verbs > Moving
 * something): `self`, an actor, taken through a way out of its place as `go`
 * takes a visitor, the exit of a direction that applies or one drawn from
 * the turn's seed among those that apply and lead. Where none applies, the
 * exit refuses, a guard refuses the move, or there is no way to draw,
 * nothing moves, nothing is said to anyone, and the body ends there, as at a
 * refused `move`; a reading whose `do` it stood in is not refused by it.
 */
#include <string.h>

#include "stmt.h"
#include "../exits.h"

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
  sprout_move_refusal refusal;
  sprout_str place;
  bool went = false;
  EXPR_NEED(stmt_acting(run, frame, "`move`"));
  if (!sprout_surround_of(frame, frame->self, &place))
    return expr_unchecked(frame, "a way out taken by what stands in no place");
  EXPR_NEED(chosen(frame, place, direction, &way));
  if (way != NULL && !way->refuses)
    EXPR_NEED(sprout_take_way(run->x, frame, frame->self, place, way, sprout_is_person(frame, frame->self), &went,
                              &refusal));
  if (!went) run->stopped = SPROUT_STOPPED_REFUSED;
  return SPROUT_EVAL_OK;
}
