/*
 * Choosing a reading (the spec's Parsing > Choosing a reading; the working notes' Holes 461). Every reading a line
 * makes is ranked whole: one whose consent pass allows before one it refuses, then the one that matched more of the
 * line's words literally, then the one whose things are nearer, role by role in declared order, and among those
 * still tied the one that names more things by their whole name. Readings still tied are drawn from the turn's
 * stream, a step. The ranking is a lexicographic order, so the readings tied for best are found in one pass, in the
 * order they were made, as a stable sort leaves them; the C library's sort is neither stable nor in the
 * WebAssembly build.
 */
#include <string.h>

#include "../expr/expr.h"
#include "parse.h"

int parse_compare_ranked(const parse_ranked *a, const parse_ranked *b) {
  size_t at, most = a->near_count > b->near_count ? a->near_count : b->near_count;
  if (a->allowed != b->allowed) return a->allowed ? -1 : 1;
  if (a->literal != b->literal) return a->literal > b->literal ? -1 : 1;
  for (at = 0; at < most; at++) {
    size_t mine = at < a->near_count ? a->near[at] : 0, theirs = at < b->near_count ? b->near[at] : 0;
    if (mine != theirs) return mine < theirs ? -1 : 1;
  }
  if (a->by_name != b->by_name) return a->by_name > b->by_name ? -1 : 1;
  return 0;
}

/* The one thing `reading` binds the role or slot `index` to, or NULL where it binds none, or a set, an exit or a value. */
static const sprout_str *object_of(const parse_reading *reading, size_t index) {
  size_t i;
  for (i = 0; i < reading->count; i++)
    if (reading->roles[i] == index) return reading->bounds[i].kind == SPROUT_BOUND_OBJECT ? &reading->bounds[i].object : NULL;
  return NULL;
}

/* How the engine writes the thing `id`: all a visitor could tell two apart by. */
static sprout_eval_status written_of(const sprout_frame *frame, sprout_str id, sprout_str *out) {
  const sprout_stored_instance *instance = expr_instance(frame, id);
  parse_address address;
  if (instance == NULL) return expr_engine(frame, "a reading drawn from a tie names what is not an instance.");
  EXPR_NEED(parse_address_of(frame, instance, &address));
  return parse_written_as(frame, &address, out);
}

/* The verb's role names or the intent's slot names: how a role of one reading is matched with a rival's. */
static const char *slot_name(const parse_reading *reading, size_t index) {
  return reading->verb != NULL ? reading->verb->roles[index].name : reading->intent->slots[index];
}

static size_t slot_count(const parse_reading *reading) {
  return reading->verb != NULL ? reading->verb->role_count : reading->intent->slot_count;
}

/* The index of the role or slot named `name` in `reading`, or its count where it has none. */
static size_t slot_named(const parse_reading *reading, const char *name) {
  size_t i, count = slot_count(reading);
  for (i = 0; i < count; i++)
    if (strcmp(slot_name(reading, i), name) == 0) return i;
  return count;
}

/*
 * The first thing the drawn reading binds, in declared order, that a rival binds another thing in place of and that
 * is written otherwise; NULL where there is none.
 */
static sprout_eval_status meant_in(const sprout_frame *frame, const parse_ranked *ranked, size_t count,
                                   const parse_ranked *drawn, const sprout_str **out) {
  size_t role, i;
  *out = NULL;
  for (role = 0; role < slot_count(&drawn->reading); role++) {
    const sprout_str *mine = object_of(&drawn->reading, role);
    if (mine == NULL) continue;
    for (i = 0; i < count; i++) {
      const parse_ranked *rival = &ranked[i];
      const sprout_str *theirs;
      sprout_str a, b;
      if (rival == drawn || parse_compare_ranked(rival, drawn) != 0) continue;
      theirs = object_of(&rival->reading, slot_named(&rival->reading, slot_name(&drawn->reading, role)));
      if (theirs == NULL || sprout_str_same(*theirs, *mine)) continue;
      EXPR_NEED(written_of(frame, *theirs, &a));
      EXPR_NEED(written_of(frame, *mine, &b));
      if (!sprout_str_same(a, b)) {
        *out = mine;
        return SPROUT_EVAL_OK;
      }
    }
  }
  return SPROUT_EVAL_OK;
}

sprout_eval_status parse_choose(const sprout_frame *frame, const parse_ranked *ranked, size_t count,
                                parse_chosen *out) {
  const parse_ranked *best = &ranked[0];
  size_t i, tied = 0;
  uint32_t drawn;
  memset(out, 0, sizeof *out);
  for (i = 1; i < count; i++)
    if (parse_compare_ranked(&ranked[i], best) < 0) best = &ranked[i];
  for (i = 0; i < count; i++)
    if (parse_compare_ranked(&ranked[i], best) == 0) tied++;
  out->among = tied;
  out->ranked = best;
  if (tied == 1) return SPROUT_EVAL_OK;
  EXPR_NEED(expr_spend(frame));
  if (frame->draws == NULL || !sprout_draws_below(frame->draws, tied, &drawn))
    return expr_engine(frame, "a tie among readings is drawn without the turn's draws.");
  for (i = 0; i < count; i++)
    if (parse_compare_ranked(&ranked[i], best) == 0 && drawn-- == 0) break;
  out->ranked = &ranked[i];
  return meant_in(frame, ranked, count, out->ranked, &out->meant);
}
