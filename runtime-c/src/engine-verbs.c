/*
 * The engine's verbs in a reading (the spec's Verbs > Engine verbs, Exits).
 * `go` has no `do`: the engine takes the actor through the exit named, which
 * joins one place to another however far apart they sit. A person who went
 * reads what the exit says as it is taken, and the place they arrived in
 * once the queue is empty. `look`, `examine`, `inventory`, `wait` and `help`
 * are answered by the engine once the queue is empty, so a person's reading
 * of one is never answered with `nothing_happens`.
 */
#include <string.h>

#include "engine-verbs.h"
#include "exits.h"
#include "expr/expr.h"

static const char *const ENGINE_VERBS[] = {"go", "look", "examine", "inventory", "wait", "help"};
static const char *const ENGINE_ANSWERS[] = {"look", "examine", "inventory", "wait", "help"};

static bool listed(const char *const *names, size_t count, const char *name) {
  size_t i;
  for (i = 0; i < count; i++)
    if (strcmp(names[i], name) == 0) return true;
  return false;
}

bool sprout_is_engine_verb(const sprout_verb *verb) {
  return strcmp(verb->library, "sprout") == 0 &&
         listed(ENGINE_VERBS, sizeof ENGINE_VERBS / sizeof *ENGINE_VERBS, verb->name);
}

bool sprout_answered_by_engine(const sprout_verb *verb) {
  return strcmp(verb->library, "sprout") == 0 &&
         listed(ENGINE_ANSWERS, sizeof ENGINE_ANSWERS / sizeof *ENGINE_ANSWERS, verb->name);
}

const sprout_stored_bound *sprout_exit_of(const sprout_resolved *reading) {
  size_t i;
  for (i = 0; i < reading->verb->role_count; i++)
    if (reading->verb->roles[i].filler == SPROUT_FILLER_EXIT && reading->roles[i].filled &&
        reading->roles[i].bound.kind == SPROUT_BOUND_EXIT)
      return &reading->roles[i].bound;
  return NULL;
}

/* `actor` and `here`, the names a line said to the one acting renders with. */
static sprout_eval_status acting_names(const sprout_frame *frame, sprout_str actor, sprout_str here,
                                       const sprout_effect_binding **out, size_t *count) {
  sprout_effect_binding *bound = (sprout_effect_binding *)sprout_arena_take(frame->turn, 2 * sizeof *bound);
  if (bound == NULL) return SPROUT_EVAL_NO_MEMORY;
  bound[0].name = "actor";
  bound[0].bound = sprout_evaluated_object(actor);
  bound[1].name = "here";
  bound[1].bound = sprout_evaluated_object(here);
  *out = bound;
  *count = 2;
  return SPROUT_EVAL_OK;
}

sprout_eval_status sprout_go(sprout_exec *x, const sprout_frame *frame, const sprout_resolved *reading,
                             const sprout_stored_bound *way, bool person, sprout_went *went) {
  sprout_way taken;
  sprout_saying saying;
  sprout_effect said;
  sprout_move_end end;
  sprout_move_refusal refusal;
  sprout_str here, *to;
  memset(&saying, 0, sizeof saying);
  memset(&taken, 0, sizeof taken);
  taken.direction = way->has_direction ? way->direction.bytes : NULL;
  taken.label = way->label.bytes;
  taken.to = way->to;
  /* What the exit says is asked of the place before the move, and said to the one who went as the move is made. */
  if (person) {
    EXPR_NEED(sprout_place_of(frame, reading->actor, &here));
    EXPR_NEED(sprout_exit_saying(frame, here, &taken, &saying));
  }
  EXPR_NEED(sprout_move_instance(x, frame, reading->actor, reading->actor, way->to, SPROUT_REACH_EXIT,
                                 way->label.bytes, &end, &refusal));
  if (end != SPROUT_MOVE_DONE) {
    EXPR_NEED(sprout_record_refusal(x, frame, &refusal));
    *went = SPROUT_WENT_REFUSED;
    return SPROUT_EVAL_OK;
  }
  *went = SPROUT_WENT_DONE;
  if (!saying.says) return SPROUT_EVAL_OK;
  memset(&said, 0, sizeof said);
  to = (sprout_str *)sprout_arena_take(x->turn, sizeof *to);
  if (to == NULL) return SPROUT_EVAL_NO_MEMORY;
  *to = reading->actor;
  said.kind = SPROUT_EFFECT_SAID;
  said.to = to;
  said.to_count = 1;
  said.by = saying.by;
  said.said = saying.said;
  EXPR_NEED(acting_names(frame, reading->actor, here, &said.bindings, &said.binding_count));
  return sprout_exec_record(x, &said);
}
