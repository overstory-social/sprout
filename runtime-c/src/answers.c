/*
 * What the engine adds to a turn's lines (see answers.h). Every answer is found as every engine line is:
 * on the person, the place they stand in, and the world, the first that writes it.
 */
#include "answers.h"

#include <string.h>

#include "engine-verbs.h"
#include "exits.h"
#include "expr/expr.h"
#include "offers.h"

/* The effect a description is, to the one looking. */
static sprout_eval_status described(const sprout_frame *frame, sprout_str thing, sprout_str actor, const char *seen,
                                    sprout_effect *out) {
  sprout_description *description = (sprout_description *)sprout_arena_take(frame->turn, sizeof *description);
  if (description == NULL) return SPROUT_EVAL_NO_MEMORY;
  EXPR_NEED(sprout_describe(frame, thing, actor, seen, description));
  memset(out, 0, sizeof *out);
  out->kind = SPROUT_EFFECT_DESCRIBED;
  out->description = description;
  out->to = &description->to;
  out->to_count = 1;
  out->by = description->of;
  return SPROUT_EVAL_OK;
}

sprout_eval_status sprout_arrivals_read(sprout_exec *x, const sprout_frame *frame, const sprout_arrived **out,
                                        size_t *count) {
  sprout_arrived *found = (sprout_arrived *)sprout_arena_take(x->turn, (x->owed_count + 1) * sizeof *found);
  size_t n = 0, i, j;
  if (found == NULL) return SPROUT_EVAL_NO_MEMORY;
  /* Walked from the last, so that a later move's arrival at a place is the one that stays. */
  for (i = x->owed_count; i > 0; i--) {
    const sprout_owed *owed = &x->owed[i - 1];
    const sprout_stored_instance *standing = expr_instance(frame, owed->mover);
    bool later = false;
    if (!sprout_is_person(frame, owed->mover) || standing == NULL || !standing->has_container ||
        !sprout_str_same(standing->container, owed->place))
      continue;
    for (j = 0; j < n && !later; j++)
      later = sprout_str_same(found[j].effect.by, owed->place) && sprout_str_same(found[j].effect.description->to, owed->mover);
    if (later) continue;
    EXPR_NEED(described(frame, owed->place, owed->mover, "arrival", &found[n].effect));
    found[n].after = owed->after;
    n++;
  }
  /* Collected last first; they are read first first. */
  for (i = 0; i < n / 2; i++) {
    sprout_arrived swap = found[i];
    found[i] = found[n - 1 - i];
    found[n - 1 - i] = swap;
  }
  *out = found;
  *count = n;
  return SPROUT_EVAL_OK;
}

/* `actor` and `here`, as the engine binds them for a line said to the one acting. */
static sprout_eval_status acting(const sprout_frame *frame, sprout_str actor, sprout_str here, size_t extra,
                                 sprout_effect_binding **out) {
  sprout_effect_binding *bound = (sprout_effect_binding *)sprout_arena_take(frame->turn, (2 + extra) * sizeof *bound);
  if (bound == NULL) return SPROUT_EVAL_NO_MEMORY;
  bound[0].name = "actor";
  bound[0].bound = sprout_evaluated_object(actor);
  bound[1].name = "here";
  bound[1].bound = sprout_evaluated_object(here);
  *out = bound;
  return SPROUT_EVAL_OK;
}

static sprout_eval_status to_actor(const sprout_frame *frame, sprout_str actor, sprout_effect *effect) {
  sprout_str *to = (sprout_str *)sprout_arena_take(frame->turn, sizeof *to);
  if (to == NULL) return SPROUT_EVAL_NO_MEMORY;
  *to = actor;
  effect->to = to;
  effect->to_count = 1;
  return SPROUT_EVAL_OK;
}

/* The thing's own `contents`, where its kinds write one, said after its description. */
static sprout_eval_status contents_of(const sprout_frame *frame, sprout_str thing, sprout_str actor, sprout_str here,
                                      sprout_effect *out, bool *has) {
  const sprout_stored_instance *instance = expr_instance(frame, thing);
  sprout_effect_binding *bound;
  memset(out, 0, sizeof *out);
  *has = false;
  if (instance == NULL || !sprout_passage_on(instance->kind, "contents", &out->said)) return SPROUT_EVAL_OK;
  out->kind = SPROUT_EFFECT_DESCRIBED;
  out->by = thing;
  EXPR_NEED(to_actor(frame, actor, out));
  EXPR_NEED(acting(frame, actor, here, 0, &bound));
  out->bindings = bound;
  out->binding_count = 2;
  *has = true;
  return SPROUT_EVAL_OK;
}

/* Whether some participant of `reading` plays a part in it: a `permit` or a `do` written for the role they fill. */
static sprout_eval_status someone_plays(sprout_exec *x, const sprout_frame *frame, const sprout_resolved *reading,
                                        bool *plays) {
  const sprout_participant *participants;
  size_t count, i;
  *plays = false;
  if (sprout_is_engine_verb(reading->verb)) {
    *plays = true;
    return SPROUT_EVAL_OK;
  }
  EXPR_NEED(sprout_participants(x, reading, &participants, &count));
  for (i = 0; i < count && !*plays; i++) {
    const sprout_stored_instance *self = expr_instance(frame, participants[i].id);
    const sprout_play_group *own;
    if (self == NULL) continue;
    own = sprout_own_plays(reading->verb, participants[i].role == NULL ? "actor" : participants[i].role->name, self->kind);
    *plays = own != NULL && own->count > 0;
  }
  return SPROUT_EVAL_OK;
}

/*
 * What `actor` can do where they stand, through the world's `help`: each reading whose consent pass allows
 * and some participant plays a part in, once however many are written alike.
 */
static sprout_eval_status help_for(sprout_exec *x, const sprout_frame *frame, sprout_str actor, sprout_str here,
                                   sprout_effect *out) {
  const sprout_way *ways;
  const sprout_reached *reached;
  const sprout_offer *offers;
  sprout_str *typed;
  sprout_effect_binding *bound;
  size_t way_count, reached_count, offer_count, i, j, kept = 0;
  EXPR_NEED(sprout_exits_from(frame, here, &ways, &way_count));
  EXPR_NEED(sprout_range_of(frame, actor, NULL, &reached, &reached_count));
  EXPR_NEED(sprout_offers_to(x, frame, actor, ways, way_count, reached, reached_count, &offers, &offer_count));
  typed = (sprout_str *)sprout_arena_take(frame->turn, (offer_count + 1) * sizeof *typed);
  if (typed == NULL) return SPROUT_EVAL_NO_MEMORY;
  for (i = 0; i < offer_count; i++) {
    bool plays, again = false;
    if (offers[i].refused) continue;
    EXPR_NEED(someone_plays(x, frame, &offers[i].reading, &plays));
    if (!plays) continue;
    for (j = 0; j < kept && !again; j++) again = typed[j].length == strlen(offers[i].typed) && memcmp(typed[j].bytes, offers[i].typed, typed[j].length) == 0;
    if (again) continue;
    typed[kept].bytes = offers[i].typed;
    typed[kept].length = strlen(offers[i].typed);
    kept++;
  }
  memset(out, 0, sizeof *out);
  out->kind = SPROUT_EFFECT_NOTICE;
  EXPR_NEED(to_actor(frame, actor, out));
  sprout_engine_said(frame, "help", &actor, &here, &out->by, &out->said);
  EXPR_NEED(acting(frame, actor, here, 1, &bound));
  bound[2].name = "readings";
  bound[2].bound.binds = SPROUT_BINDS_READINGS;
  bound[2].bound.count = kept;
  bound[2].bound.items = typed;
  out->bindings = bound;
  out->binding_count = 3;
  return SPROUT_EVAL_OK;
}

sprout_eval_status sprout_engine_answers(sprout_exec *x, const sprout_frame *frame, const sprout_resolved *reading,
                                         const sprout_effect **out, size_t *count) {
  sprout_effect *answers = (sprout_effect *)sprout_arena_take(x->turn, 2 * sizeof *answers);
  const sprout_stored_instance *standing = expr_instance(frame, reading->actor);
  const char *name = reading->verb->name;
  sprout_str here;
  size_t n = 0, i;
  if (answers == NULL) return SPROUT_EVAL_NO_MEMORY;
  *out = answers;
  *count = 0;
  if (!sprout_answered_by_engine(reading->verb) || !sprout_is_person(frame, reading->actor) || standing == NULL ||
      !standing->has_container)
    return SPROUT_EVAL_OK;
  here = standing->container;
  if (strcmp(name, "look") == 0) {
    EXPR_NEED(described(frame, here, reading->actor, "look", &answers[n++]));
  } else if (strcmp(name, "examine") == 0) {
    bool has;
    for (i = 0; i < reading->verb->role_count; i++) {
      const sprout_filled *held = &reading->roles[i];
      if (!held->filled || held->bound.kind != SPROUT_BOUND_OBJECT) continue;
      EXPR_NEED(described(frame, held->bound.object, reading->actor, "look", &answers[n++]));
      EXPR_NEED(contents_of(frame, held->bound.object, reading->actor, here, &answers[n], &has));
      if (has) n++;
      break;
    }
    if (n == 0) return expr_engine(frame, "a reading of `examine` names nothing to examine.");
  } else if (strcmp(name, "inventory") == 0) {
    memset(&answers[n], 0, sizeof answers[n]);
    answers[n].kind = SPROUT_EFFECT_SAID;
    EXPR_NEED(to_actor(frame, reading->actor, &answers[n]));
    sprout_engine_said(frame, "inventory", &reading->actor, &here, &answers[n].by, &answers[n].said);
    {
      sprout_effect_binding *bound;
      EXPR_NEED(acting(frame, reading->actor, here, 0, &bound));
      answers[n].bindings = bound;
      answers[n].binding_count = 2;
    }
    n++;
  } else if (strcmp(name, "wait") == 0) {
    memset(&answers[n], 0, sizeof answers[n]);
    answers[n].kind = SPROUT_EFFECT_SAID;
    EXPR_NEED(to_actor(frame, reading->actor, &answers[n]));
    sprout_engine_said(frame, "waited", &reading->actor, &here, &answers[n].by, &answers[n].said);
    n++;
  } else if (strcmp(name, "help") == 0) {
    EXPR_NEED(help_for(x, frame, reading->actor, here, &answers[n]));
    n++;
  }
  *count = n;
  return SPROUT_EVAL_OK;
}

sprout_eval_status sprout_lines_assembled(sprout_exec *x, const sprout_effect *before, size_t before_count,
                                          const sprout_arrived *arrived, size_t arrived_count,
                                          const sprout_effect *later, size_t later_count) {
  size_t total = before_count + x->effect_count + arrived_count + later_count, n = 0, next = 0, at, i;
  sprout_effect *lines = (sprout_effect *)sprout_arena_take(x->turn, (total + 1) * sizeof *lines);
  if (lines == NULL) return SPROUT_EVAL_NO_MEMORY;
  for (i = 0; i < before_count; i++) lines[n++] = before[i];
  for (at = 0; at < x->effect_count; at++) {
    while (next < arrived_count && arrived[next].after <= at) lines[n++] = arrived[next++].effect;
    lines[n++] = x->effects[at];
  }
  while (next < arrived_count) lines[n++] = arrived[next++].effect;
  for (i = 0; i < later_count; i++) lines[n++] = later[i];
  x->effects = lines;
  x->effect_count = n;
  x->effect_capacity = total + 1;
  return SPROUT_EVAL_OK;
}
