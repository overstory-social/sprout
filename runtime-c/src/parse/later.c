/*
 * A run's items after its first (the spec's Parsing > Sequences, again and all): `take sack, bottle and lamp` in a
 * role that takes one thing runs once for each, in the order written. Once the line's reading is chosen, each item
 * after the first is planned with every other role as the line binds it: the thing the item names best fills the
 * item's role, a value role's words bound against it; an item that names nothing it may fill, or ties between
 * things, is read afresh on its own turn (item.c), every other role keeping what it named when the line began.
 */
#include <string.h>

#include "../expr/expr.h"
#include "parse.h"

/* The words from `start` to `end` joined by single spaces, in `keep`. */
static const char *joined(sprout_arena *keep, parse_words words, size_t start, size_t end) {
  size_t length = 0, i, at = 0;
  char *out;
  for (i = start; i < end; i++) length += words.words[i].length + 1;
  out = (char *)sprout_arena_take_aligned(keep, length + 1, 1);
  if (out == NULL) return NULL;
  for (i = start; i < end; i++) {
    if (i > start) out[at++] = ' ';
    memcpy(out + at, words.words[i].bytes, words.words[i].length);
    at += words.words[i].length;
  }
  out[at] = '\0';
  return out;
}

static bool has_role(const size_t *roles, size_t count, size_t role) {
  size_t i;
  for (i = 0; i < count; i++)
    if (roles[i] == role) return true;
  return false;
}

/* `first` less the run's role and every value role, in the order it binds the rest. */
static bool within_of(sprout_arena *keep, const parse_run *run, const parse_reading *first, parse_reading *out) {
  size_t *kept = (size_t *)sprout_arena_take(keep, (run->count + 1) * sizeof *kept);
  size_t *roles = (size_t *)sprout_arena_take(keep, (first->count + 1) * sizeof *roles);
  sprout_stored_bound *bounds = (sprout_stored_bound *)sprout_arena_take(keep, (first->count + 1) * sizeof *bounds);
  size_t i, kept_count = 0;
  if (kept == NULL || roles == NULL || bounds == NULL) return false;
  kept[kept_count++] = run->spans[run->at].role;
  for (i = 0; i < run->count; i++)
    if (run->words[i]) kept[kept_count++] = run->spans[i].role;
  *out = *first;
  out->count = 0;
  out->roles = roles;
  out->bounds = bounds;
  for (i = 0; i < first->count; i++) {
    if (has_role(kept, kept_count, first->roles[i])) continue;
    roles[out->count] = first->roles[i];
    bounds[out->count++] = first->bounds[i];
  }
  return true;
}

/* The item's words, the role it fills, each value role's words and what the pronouns named, for its own turn. */
static const sprout_reread *reread_of(sprout_arena *keep, const parse_run *run, parse_words slot, const parse_later *item,
                                      parse_words line, const sprout_str *referents, size_t referent_count) {
  const sprout_role *roles = run->phrase->verb->roles;
  sprout_reread *reread = (sprout_reread *)sprout_arena_take(keep, sizeof *reread);
  sprout_reread_value *values = (sprout_reread_value *)sprout_arena_take(keep, (run->count + 1) * sizeof *values);
  const char **ids = (const char **)sprout_arena_take(keep, (referent_count + 1) * sizeof *ids);
  size_t i;
  if (reread == NULL || values == NULL || ids == NULL) return NULL;
  memset(reread, 0, sizeof *reread);
  reread->role = sprout_arena_copy(keep, roles[run->spans[run->at].role].name, strlen(roles[run->spans[run->at].role].name));
  reread->words = joined(keep, slot, item->start, item->end);
  if (reread->role == NULL || reread->words == NULL) return NULL;
  for (i = 0; i < run->count; i++) {
    const char *name = roles[run->spans[i].role].name;
    if (!run->words[i]) continue;
    values[reread->value_count].role = sprout_arena_copy(keep, name, strlen(name));
    values[reread->value_count].words = joined(keep, line, run->spans[i].start, run->spans[i].end);
    if (values[reread->value_count].role == NULL || values[reread->value_count].words == NULL) return NULL;
    reread->value_count++;
  }
  for (i = 0; i < referent_count; i++)
    if ((ids[i] = sprout_arena_copy(keep, referents[i].bytes, referents[i].length)) == NULL) return NULL;
  reread->values = values;
  reread->referents = ids;
  reread->referent_count = referent_count;
  return reread;
}

/*
 * The best reading an item names as the run's slot, each thing tried a step and its consent pass asked: `*best` NULL
 * where it names none, or where two rank alike.
 */
static sprout_eval_status best_of(sprout_exec *x, const sprout_frame *frame, sprout_str actor,
                                  const parse_placement *placement, const parse_run *run, sprout_stored_bound *bounds,
                                  const parse_filled *filled, parse_ranked *ranked, const parse_ranked **best) {
  size_t i, tied = 0;
  *best = NULL;
  for (i = 0; i < filled->thing_count; i++) {
    const parse_named *thing = &filled->things[i];
    parse_ranked *one = &ranked[i];
    EXPR_NEED(expr_spend(frame));
    memset(one, 0, sizeof *one);
    bounds[run->at].kind = SPROUT_BOUND_OBJECT;
    bounds[run->at].object = thing->candidate->instance->id;
    EXPR_NEED(parse_reading_of(x, frame, actor, placement, run->words, bounds, &one->reading));
    EXPR_NEED(parse_allows(x, frame, &one->reading, &one->allowed));
    one->literal = thing->literal;
    one->near = &thing->near;
    one->near_count = 1;
    one->by_name = thing->by_name ? 1 : 0;
    one->whole = true;
  }
  for (i = 0; i < filled->thing_count; i++)
    if (*best == NULL || parse_compare_ranked(&ranked[i], *best) < 0) *best = &ranked[i];
  for (i = 0; *best != NULL && i < filled->thing_count; i++)
    if (parse_compare_ranked(&ranked[i], *best) == 0) tied++;
  if (tied > 1) *best = NULL;
  return SPROUT_EVAL_OK;
}

sprout_eval_status parse_later_of(sprout_exec *x, const sprout_frame *frame, sprout_str actor, parse_words line,
                                  const parse_run *run, const sprout_str *referents, size_t referent_count,
                                  sprout_arena *keep, parse_following **out, size_t *count) {
  const parse_span *span = &run->spans[run->at];
  parse_placement placement;
  parse_reading first, within;
  parse_words slot;
  parse_following *following = (parse_following *)sprout_arena_take(keep, (run->later_count + 1) * sizeof *following);
  sprout_stored_bound *bounds = (sprout_stored_bound *)sprout_arena_take(frame->turn, (run->count + 1) * sizeof *bounds);
  size_t i, most = 0;
  parse_ranked *ranked;
  if (following == NULL || bounds == NULL) return SPROUT_EVAL_NO_MEMORY;
  for (i = 0; i < run->later_count; i++)
    if (run->later[i].filled.thing_count > most) most = run->later[i].filled.thing_count;
  ranked = (parse_ranked *)sprout_arena_take(frame->turn, (most + 1) * sizeof *ranked);
  if (ranked == NULL) return SPROUT_EVAL_NO_MEMORY;
  memset(&placement, 0, sizeof placement);
  placement.phrase = run->phrase;
  placement.words = line;
  placement.spans = run->spans;
  placement.count = run->count;
  slot.words = line.words + span->start;
  slot.count = span->end - span->start;
  memcpy(bounds, run->bounds, run->count * sizeof *bounds);
  EXPR_NEED(parse_reading_of(x, frame, actor, &placement, run->words, bounds, &first));
  if (!within_of(keep, run, &first, &within)) return SPROUT_EVAL_NO_MEMORY;
  for (i = 0; i < run->later_count; i++) {
    const parse_later *item = &run->later[i];
    const parse_ranked *best = NULL;
    if (item->filled.fills == PARSE_FILLS_OPTIONS)
      EXPR_NEED(best_of(x, frame, actor, &placement, run, bounds, &item->filled, ranked, &best));
    following[i].reread = NULL;
    if (best != NULL) {
      following[i].planned = best->reading;
      continue;
    }
    following[i].planned = within;
    following[i].reread = reread_of(keep, run, slot, item, line, referents, referent_count);
    if (following[i].reread == NULL) return SPROUT_EVAL_NO_MEMORY;
  }
  *out = following;
  *count = run->later_count;
  return SPROUT_EVAL_OK;
}
