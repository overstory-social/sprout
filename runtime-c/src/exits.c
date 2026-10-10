/*
 * The exits and links that apply on a place (the spec's Verbs > Exits, An
 * exit may be conditional, Links). What does not apply, rather than
 * faulting: an unset link; a guard that reads through a name out of the
 * place's range, or to a declared object destroyed; and a destination that
 * is absent, destroyed, gone or no longer a place. A guard only reads, and is
 * charged to the turn's steps as any reading is, so a guard too dear to ask
 * faults as any work does.
 */
#include <string.h>

#include "exits.h"
#include "expr/expr.h"

typedef struct ways {
  sprout_way *items;
  size_t count, capacity;
} ways;

/* The library of a qualified name: what precedes its first `.`. */
sprout_eval_status sprout_origin_library(const sprout_frame *frame, const char *origin, const char **library) {
  const char *dot = origin == NULL ? NULL : strchr(origin, '.');
  char *copy;
  if (dot == NULL) return expr_unchecked(frame, "an exit whose origin is not a qualified name");
  copy = sprout_arena_copy(frame->turn, origin, (size_t)(dot - origin));
  if (copy == NULL) return SPROUT_EVAL_NO_MEMORY;
  *library = copy;
  return SPROUT_EVAL_OK;
}

/* A fault a guard reads through: a name out of range, or to something destroyed. */
bool sprout_reads_nothing(const sprout_frame *frame, sprout_eval_status status) {
  return status == SPROUT_EVAL_FAULT &&
         (strcmp(frame->fault->name, "NameOutOfRange") == 0 || strcmp(frame->fault->name, "DestroyedReference") == 0);
}

/* Whether an exit's `when` holds, asked of `place`; a read out of its range, or of a destroyed name, does not. */
static sprout_eval_status holds(const sprout_frame *frame, sprout_str place, const sprout_node *exit,
                                const sprout_node *line, bool *out) {
  const sprout_node *when = sprout_node_get(line, "when");
  sprout_frame at = *frame;
  sprout_eval_status status;
  *out = true;
  if (when == NULL || when->kind == SPROUT_NODE_NULL) return SPROUT_EVAL_OK;
  EXPR_NEED(sprout_origin_library(frame, sprout_node_text(exit, "origin"), &at.library));
  at.self = place;
  at.bindings = NULL;
  status = sprout_eval_condition(&at, when, out);
  if (sprout_reads_nothing(frame, status)) {
    *out = false;
    return SPROUT_EVAL_OK;
  }
  return status;
}

/* What an exit says, as `origin` wrote it: its words in quotes, or the passage of that name as `place`'s kind has it. */
static sprout_eval_status spoken_by(const sprout_frame *frame, const sprout_node *said, const char *origin,
                                    const sprout_stored_instance *place, sprout_speech *out) {
  memset(out, 0, sizeof *out);
  if (sprout_node_is(sprout_node_get(said, "kind"), "prose-literal")) {
    out->kind = SPROUT_SPEECH_TEXT;
    out->node = said;
    return sprout_origin_library(frame, origin, &out->library);
  }
  out->name = sprout_node_text(said, "text");
  if (place != NULL && sprout_passage_on(place->kind, out->name, out)) return SPROUT_EVAL_OK;
  out->kind = SPROUT_SPEECH_ABSENT;
  return SPROUT_EVAL_OK;
}

/* The place an exit's path names from `place`, or *found false where it reaches nothing now. */
static sprout_eval_status path_end(const sprout_frame *frame, sprout_str place, const sprout_node *path,
                                   sprout_str *to, bool *found) {
  const sprout_node *named = sprout_world_bound(frame->world, path);
  sprout_frame at = *frame;
  sprout_eval_status status;
  *found = false;
  if (named == NULL) return expr_engine(frame, "an exit's destination reached the runtime unresolved; the checker resolves it.");
  at.self = place;
  at.bindings = NULL;
  status = expr_named_identifier(&at, named, to, found);
  if (sprout_reads_nothing(frame, status)) {
    *found = false;
    return SPROUT_EVAL_OK;
  }
  return status;
}

/* Where an exit leads from `place` now; *found is false where it does not apply. */
static sprout_eval_status destination_of(const sprout_frame *frame, const sprout_stored_instance *place,
                                         const sprout_node *exit, sprout_str *to, bool *found) {
  const sprout_node *line = sprout_node_get(exit, "line");
  const char *kind = sprout_node_text(exit, "kind");
  const sprout_stored_instance *there;
  bool applies = true;
  size_t i;
  *found = false;
  if (strcmp(kind, "link") == 0) {
    const char *name = sprout_node_text(exit, "name");
    for (i = 0; i < place->link_count; i++)
      if (sprout_str_is(place->links[i].name, name)) {
        *to = place->links[i].to;
        *found = true;
      }
  } else {
    const sprout_node *leads = sprout_node_get(line, "leads");
    if (sprout_node_is(sprout_node_get(leads, "kind"), "path")) EXPR_NEED(path_end(frame, place->id, leads, to, found));
  }
  if (!*found || !expr_live(frame, *to)) {
    *found = false;
    return SPROUT_EVAL_OK;
  }
  there = expr_instance(frame, *to);
  if (there == NULL || !there->kind->contains_actors) {
    *found = false;
    return SPROUT_EVAL_OK;
  }
  if (strcmp(kind, "exit") == 0) {
    EXPR_NEED(holds(frame, place->id, exit, line, &applies));
    *found = applies;
  }
  return SPROUT_EVAL_OK;
}

static sprout_eval_status add(const sprout_frame *frame, ways *list, const sprout_way *way) {
  sprout_way *slot = (sprout_way *)sprout_exec_grow(frame->turn, (void **)&list->items, &list->count, &list->capacity,
                                                    sizeof *list->items);
  if (slot == NULL) return SPROUT_EVAL_NO_MEMORY;
  *slot = *way;
  return SPROUT_EVAL_OK;
}

static bool decided(const char *const *directions, size_t count, const char *direction) {
  size_t i;
  for (i = 0; i < count; i++)
    if (strcmp(directions[i], direction) == 0) return true;
  return false;
}

/*
 * Which of `exits`, written on `place`, apply: the first in each direction
 * whose guard holds and each link set; one step for each asked.
 */
static sprout_eval_status applying(const sprout_frame *frame, const sprout_stored_instance *place,
                                   const sprout_node *const *exits, size_t exit_count, ways *out) {
  const char **seen = (const char **)sprout_arena_take(frame->turn, (exit_count + 1) * sizeof *seen);
  size_t seen_count = 0, i;
  if (seen == NULL) return SPROUT_EVAL_NO_MEMORY;
  for (i = 0; i < exit_count; i++) {
    const sprout_node *exit = exits[i], *line = sprout_node_get(exit, "line"), *leads = sprout_node_get(line, "leads");
    const char *kind = sprout_node_text(exit, "kind"), *direction = NULL;
    sprout_way way;
    sprout_str to;
    bool found, applies;
    memset(&way, 0, sizeof way);
    way.exit = exit;
    way.label = sprout_node_text(sprout_node_get(line, "label"), "text");
    if (strcmp(kind, "exit") == 0) {
      direction = sprout_node_text(exit, "direction");
      if (decided(seen, seen_count, direction)) continue;
    }
    EXPR_NEED(expr_spend(frame));
    if (direction != NULL && sprout_node_is(sprout_node_get(leads, "kind"), "grammar-refusal")) {
      EXPR_NEED(holds(frame, place->id, exit, line, &applies));
      if (!applies) continue;
      seen[seen_count++] = direction;
      way.direction = direction;
      way.refuses = true;
      way.by = place->id;
      EXPR_NEED(spoken_by(frame, sprout_node_get(leads, "said"), sprout_node_text(exit, "origin"), place, &way.said));
      EXPR_NEED(add(frame, out, &way));
      continue;
    }
    EXPR_NEED(destination_of(frame, place, exit, &to, &found));
    if (!found) continue;
    if (direction != NULL) seen[seen_count++] = direction;
    way.direction = direction;
    way.to = to;
    EXPR_NEED(add(frame, out, &way));
  }
  return SPROUT_EVAL_OK;
}

sprout_eval_status sprout_ways_from(const sprout_frame *frame, sprout_str place, const sprout_way **found, size_t *count) {
  const sprout_stored_instance *instance = expr_instance(frame, place);
  const sprout_node *exits = instance == NULL ? NULL : sprout_node_get(instance->kind->node, "exits");
  ways out = {NULL, 0, 0};
  *found = NULL;
  *count = 0;
  if (instance == NULL || exits == NULL) return SPROUT_EVAL_OK;
  EXPR_NEED(applying(frame, instance, exits->items, exits->count, &out));
  *found = out.items;
  *count = out.count;
  return SPROUT_EVAL_OK;
}

sprout_eval_status sprout_exits_from(const sprout_frame *frame, sprout_str place, const sprout_way **found, size_t *count) {
  const sprout_way *all;
  size_t n, i, kept = 0;
  sprout_way *leading;
  EXPR_NEED(sprout_ways_from(frame, place, &all, &n));
  leading = (sprout_way *)sprout_arena_take(frame->turn, (n + 1) * sizeof *leading);
  if (leading == NULL) return SPROUT_EVAL_NO_MEMORY;
  for (i = 0; i < n; i++)
    if (!all[i].refuses) leading[kept++] = all[i];
  *found = leading;
  *count = kept;
  return SPROUT_EVAL_OK;
}

sprout_eval_status sprout_exit_saying(const sprout_frame *frame, sprout_str place, const sprout_way *taken,
                                      sprout_saying *out) {
  const sprout_stored_instance *instance = expr_instance(frame, place);
  const sprout_node *exits = instance == NULL ? NULL : sprout_node_get(instance->kind->node, "exits");
  const sprout_node **run;
  size_t run_count = 0, i;
  bool any_says = false;
  ways applied = {NULL, 0, 0};
  const sprout_node *says;
  memset(out, 0, sizeof *out);
  if (instance == NULL || exits == NULL || taken->direction == NULL) return SPROUT_EVAL_OK;
  run = (const sprout_node **)sprout_arena_take(frame->turn, (exits->count + 1) * sizeof *run);
  if (run == NULL) return SPROUT_EVAL_NO_MEMORY;
  for (i = 0; i < exits->count; i++) {
    const sprout_node *exit = exits->items[i], *line = sprout_node_get(exit, "line"), *own;
    if (!sprout_node_is(sprout_node_get(exit, "kind"), "exit")) continue;
    if (strcmp(sprout_node_text(exit, "direction"), taken->direction) != 0) continue;
    run[run_count++] = exit;
    own = sprout_node_get(line, "says");
    if (own != NULL && own->kind != SPROUT_NODE_NULL) any_says = true;
  }
  if (!any_says) return SPROUT_EVAL_OK;
  EXPR_NEED(applying(frame, instance, run, run_count, &applied));
  if (applied.count == 0 || applied.items[0].refuses) return SPROUT_EVAL_OK;
  if (!sprout_str_same(applied.items[0].to, taken->to) || strcmp(applied.items[0].label, taken->label) != 0)
    return SPROUT_EVAL_OK;
  says = sprout_node_get(sprout_node_get(applied.items[0].exit, "line"), "says");
  if (says == NULL || says->kind == SPROUT_NODE_NULL) return SPROUT_EVAL_OK;
  out->says = true;
  out->by = place;
  return spoken_by(frame, sprout_node_get(says, "said"), sprout_node_text(applied.items[0].exit, "origin"), instance,
                   &out->said);
}
