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

sprout_eval_status sprout_go(sprout_exec *x, const sprout_frame *frame, const sprout_resolved *reading,
                             const sprout_stored_bound *way, bool person, sprout_went *went) {
  sprout_way taken;
  sprout_str here;
  bool moved;
  memset(&taken, 0, sizeof taken);
  memset(&here, 0, sizeof here);
  taken.direction = way->has_direction ? way->direction.bytes : NULL;
  taken.label = way->label.bytes;
  taken.to = way->to;
  if (person) EXPR_NEED(sprout_place_of(frame, reading->actor, &here));
  EXPR_NEED(sprout_take_way(x, frame, reading->actor, here, &taken, person, &moved));
  *went = moved ? SPROUT_WENT_DONE : SPROUT_WENT_REFUSED;
  return SPROUT_EVAL_OK;
}
