/*
 * The effect pass (the spec's Verbs > The two passes, Acting; The runtime >
 * Effects). It runs every `do` of every participant in the consent pass's
 * order, and what a `do` says, and the refusal of a `move` it proposes,
 * reach the actor or, where the actor is an NPC, whoever would hear its
 * `tell`, from it. A refused `move` or `act` ends the `do` that ran it, not
 * the pass. A person's command is answered with the world's
 * `nothing_happens` when no participant said, told or refused anything to
 * them; an NPC's reading is not answered, nor is a reading performed by
 * `act`.
 */
#include <string.h>

#include "../engine-verbs.h"
#include "../expr/expr.h"
#include "reading.h"

/* The ids of the participants, which a plain `tell` leaves out. */
static sprout_eval_status ids_of(sprout_exec *x, const sprout_participant *participants, size_t count,
                                 const sprout_str **out) {
  sprout_str *ids = (sprout_str *)sprout_arena_take(x->turn, (count + 1) * sizeof *ids);
  size_t i;
  if (ids == NULL) return SPROUT_EVAL_NO_MEMORY;
  for (i = 0; i < count; i++) ids[i] = participants[i].id;
  *out = ids;
  return SPROUT_EVAL_OK;
}

/* Whether a line this reading recorded, from `from` on, answers `actor`: a place's notice of someone moved is no answer. */
static bool answered(const sprout_exec *x, size_t from, sprout_str actor) {
  size_t i, j;
  for (i = from; i < x->effect_count; i++) {
    if (x->effects[i].kind == SPROUT_EFFECT_NOTICE) continue;
    for (j = 0; j < x->effects[i].to_count; j++)
      if (sprout_str_same(x->effects[i].to[j], actor)) return true;
  }
  return false;
}

static sprout_eval_status nothing_happens(sprout_exec *x, const sprout_frame *frame, sprout_str actor) {
  sprout_effect effect;
  sprout_effect_binding *bound;
  sprout_str here;
  memset(&effect, 0, sizeof effect);
  EXPR_NEED(sprout_place_of(frame, actor, &here));
  effect.kind = SPROUT_EFFECT_SAID;
  EXPR_NEED(sprout_exec_hearers(x, frame, &effect.to, &effect.to_count));
  sprout_engine_said(frame, "nothing_happens", &actor, &here, &effect.by, &effect.said);
  effect.has_speaker = x->has_speaker;
  effect.speaker = x->speaker;
  bound = (sprout_effect_binding *)sprout_arena_take(frame->turn, 2 * sizeof *bound);
  if (bound == NULL) return SPROUT_EVAL_NO_MEMORY;
  bound[0].name = "actor";
  bound[0].bound = sprout_evaluated_object(actor);
  bound[1].name = "here";
  bound[1].bound = sprout_evaluated_object(here);
  effect.bindings = bound;
  effect.binding_count = 2;
  return sprout_exec_record(x, &effect);
}

/* Every `do` `who` plays, composed plays in order; a participant destroyed by one does nothing more. */
static sprout_eval_status run_does(sprout_exec *x, const sprout_resolved *reading, const sprout_participant *who) {
  const sprout_stored_instance *self = sprout_draft_instance(x->draft, who->id);
  sprout_plays plays;
  size_t g, p;
  if (self == NULL) return SPROUT_EVAL_OK;
  sprout_plays_for(reading, who, self->kind, &plays);
  for (g = 0; g < plays.count; g++) {
    for (p = 0; p < plays.groups[g]->count; p++) {
      const sprout_play *play = &plays.groups[g]->plays[p];
      const sprout_node *body = sprout_node_get(sprout_node_get(play->node, "declaration"), "do");
      sprout_frame inside;
      sprout_ended ended;
      if (body == NULL || body->kind == SPROUT_NODE_NULL) continue;
      /* `destroy self` takes effect as the `do` that ran it ends, so a composed play after it has no `self` to run for. */
      if (sprout_draft_instance(x->draft, who->id) == NULL) return SPROUT_EVAL_OK;
      EXPR_NEED(sprout_play_frame(x, reading, who, play, true, &inside));
      EXPR_NEED(sprout_exec_body(x, body, &inside, SPROUT_BODY_ACT, &ended));
    }
  }
  return SPROUT_EVAL_OK;
}

sprout_eval_status sprout_effect_pass(sprout_exec *x, const sprout_frame *frame, const sprout_resolved *reading) {
  const sprout_participant *participants;
  const sprout_str *ids;
  const sprout_stored_bound *way = sprout_exit_of(reading);
  sprout_hearing saved;
  sprout_went went = SPROUT_WENT_DONE;
  size_t count, i, from = x->effect_count;
  bool person = sprout_is_person(frame, reading->actor);
  sprout_eval_status status = SPROUT_EVAL_OK;
  EXPR_NEED(sprout_participants(x, reading, &participants, &count));
  EXPR_NEED(ids_of(x, participants, count, &ids));
  EXPR_NEED(sprout_hear_reading(x, frame, reading->actor, ids, count, &saved));
  /* `go` is the engine's: its move is the reading's first effect, and a refusal of it ends the pass. */
  if (way != NULL) status = sprout_go(x, frame, reading, way, person, &went);
  for (i = 0; status == SPROUT_EVAL_OK && i < count && !(way != NULL && went == SPROUT_WENT_REFUSED); i++)
    status = run_does(x, reading, &participants[i]);
  /* Only a person's own command is answered, and the engine answers what it answers itself. */
  if (status == SPROUT_EVAL_OK && person && x->acting == 0 && !(way != NULL && went == SPROUT_WENT_DONE) &&
      !sprout_answered_by_engine(reading->verb) && !answered(x, from, reading->actor))
    status = nothing_happens(x, frame, reading->actor);
  sprout_hearing_restore(x, &saved);
  return status;
}
