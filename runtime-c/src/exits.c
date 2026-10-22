/*
 * The exits and links that apply on a place (the spec's Verbs > Exits, An
 * exit may be conditional, Links). What does not apply, rather than
 * faulting: an unset link; a guard that reads through a name out of the
 * place's range, or to a declared object destroyed; and a destination that
 * is absent, destroyed, gone or no longer a place; and a drawn way none of
 * whose places is one now. A guard only reads, and is charged to the turn's
 * steps as any reading is, so a guard too dear to ask faults as any work
 * does. Taking a way, as `go` and `move self north` do,
 * is the move through it and what it says as it is taken; a drawn way's
 * choice is drawn from the turn's seed as it is taken, among its places
 * that are places then and its refusal, and never as it is asked.
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
  const sprout_node *when = sprout_node_get(&frame->world->graph, line, "when");
  sprout_frame at = *frame;
  sprout_eval_status status;
  *out = true;
  if (when == NULL || when->kind == SPROUT_NODE_NULL) return SPROUT_EVAL_OK;
  EXPR_NEED(sprout_origin_library(frame, sprout_node_text(&frame->world->graph, exit, "origin"), &at.library));
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
  if (sprout_node_is(&frame->world->graph, sprout_node_get(&frame->world->graph, said, "kind"), "prose-literal")) {
    out->kind = SPROUT_SPEECH_TEXT;
    out->node = said;
    return sprout_origin_library(frame, origin, &out->library);
  }
  out->name = sprout_name(&frame->world->graph, said);
  if (place != NULL && sprout_passage_on(&frame->world->graph, place->kind, out->name, out)) return SPROUT_EVAL_OK;
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

/* Whether `to` is something an actor may stand in now: live, and holding actors. */
static bool standable(const sprout_frame *frame, sprout_str to) {
  const sprout_stored_instance *there;
  if (!expr_live(frame, to)) return false;
  there = expr_instance(frame, to);
  return there != NULL && there->kind->contains_actors;
}

/* Whether an exit's `leads` is a node of `kind`. */
static bool leads_is(const sprout_frame *frame, const sprout_node *leads, const char *kind) {
  return sprout_node_is(&frame->world->graph, sprout_node_get(&frame->world->graph, leads, "kind"), kind);
}

/* One choice of a drawn way as it stands now: a place it leads to, or its refusal's words. */
typedef struct choice {
  bool refuses;
  sprout_str to;
  const sprout_node *said;
} choice;

/*
 * The choices of `exit`, a drawn way out of `place`, open now, in the order
 * written: each place it names that is a place now, and its refusal.
 * *places counts the places among them.
 */
static sprout_eval_status choices_now(const sprout_frame *frame, const sprout_stored_instance *place,
                                      const sprout_node *exit, choice **out, size_t *count, size_t *places) {
  const sprout_graph *graph = &frame->world->graph;
  const sprout_node *choices = sprout_node_get(graph, sprout_node_get(graph, sprout_node_get(graph, exit, "line"), "leads"), "choices");
  choice *list;
  size_t i, n = 0;
  *out = NULL;
  *count = *places = 0;
  if (choices == NULL) return expr_engine(frame, "a drawn way reached the runtime with no choices; the checker refuses one.");
  list = (choice *)sprout_arena_take(frame->turn, (choices->count + 1) * sizeof *list);
  if (list == NULL) return SPROUT_EVAL_NO_MEMORY;
  for (i = 0; i < choices->count; i++) {
    const sprout_node *leads = sprout_node_get(graph, sprout_item(graph, choices, i), "leads");
    sprout_str to;
    bool found;
    memset(&list[n], 0, sizeof list[n]);
    if (leads_is(frame, leads, "grammar-refusal")) {
      list[n].refuses = true;
      list[n++].said = sprout_node_get(graph, leads, "said");
      continue;
    }
    EXPR_NEED(path_end(frame, place->id, leads, &to, &found));
    if (!found || !standable(frame, to)) continue;
    list[n++].to = to;
    (*places)++;
  }
  *out = list;
  *count = n;
  return SPROUT_EVAL_OK;
}

/* Where an exit leads from `place` now; *found is false where it does not apply. */
static sprout_eval_status destination_of(const sprout_frame *frame, const sprout_stored_instance *place,
                                         const sprout_node *exit, sprout_str *to, bool *found) {
  const sprout_node *line = sprout_node_get(&frame->world->graph, exit, "line");
  const char *kind = sprout_node_text(&frame->world->graph, exit, "kind");
  bool applies = true;
  size_t i;
  *found = false;
  if (strcmp(kind, "link") == 0) {
    const char *name = sprout_node_text(&frame->world->graph, exit, "name");
    for (i = 0; i < place->link_count; i++)
      if (sprout_str_is(place->links[i].name, name)) {
        *to = place->links[i].to;
        *found = true;
      }
  } else {
    const sprout_node *leads = sprout_node_get(&frame->world->graph, line, "leads");
    if (sprout_name(&frame->world->graph, leads) != NULL) EXPR_NEED(path_end(frame, place->id, leads, to, found));
  }
  if (!*found || !standable(frame, *to)) {
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
    const sprout_node *exit = exits[i], *line = sprout_node_get(&frame->world->graph, exit, "line"), *leads = sprout_node_get(&frame->world->graph, line, "leads");
    const char *kind = sprout_node_text(&frame->world->graph, exit, "kind"), *direction = NULL;
    sprout_way way;
    sprout_str to;
    bool found, applies;
    memset(&way, 0, sizeof way);
    way.exit = exit;
    way.label = sprout_node_text(&frame->world->graph, sprout_node_get(&frame->world->graph, line, "label"), "text");
    if (strcmp(kind, "exit") == 0) {
      direction = sprout_node_text(&frame->world->graph, exit, "direction");
      if (decided(seen, seen_count, direction)) continue;
    }
    EXPR_NEED(expr_spend(frame));
    if (direction != NULL && leads_is(frame, leads, "grammar-drawn")) {
      /* A drawn way applies while its guard holds and one of its places is one, and its choice waits until it is taken. */
      choice *choices;
      size_t choice_count, places;
      EXPR_NEED(holds(frame, place->id, exit, line, &applies));
      if (!applies) continue;
      EXPR_NEED(choices_now(frame, place, exit, &choices, &choice_count, &places));
      if (places == 0) continue;
      seen[seen_count++] = direction;
      way.direction = direction;
      way.drawn = true;
      EXPR_NEED(add(frame, out, &way));
      continue;
    }
    if (direction != NULL && leads_is(frame, leads, "grammar-refusal")) {
      EXPR_NEED(holds(frame, place->id, exit, line, &applies));
      if (!applies) continue;
      seen[seen_count++] = direction;
      way.direction = direction;
      way.refuses = true;
      way.by = place->id;
      EXPR_NEED(spoken_by(frame, sprout_node_get(&frame->world->graph, leads, "said"), sprout_node_text(&frame->world->graph, exit, "origin"), place, &way.said));
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
  const sprout_node *exits = instance == NULL ? NULL : sprout_node_get(&frame->world->graph, instance->kind->node, "exits");
  ways out = {NULL, 0, 0};
  const sprout_node **all;
  size_t i;
  *found = NULL;
  *count = 0;
  if (instance == NULL || exits == NULL) return SPROUT_EVAL_OK;
  all = (const sprout_node **)sprout_arena_take(frame->turn, (exits->count + 1) * sizeof *all);
  if (all == NULL) return SPROUT_EVAL_NO_MEMORY;
  for (i = 0; i < exits->count; i++) all[i] = sprout_item(&frame->world->graph, exits, i);
  EXPR_NEED(applying(frame, instance, all, exits->count, &out));
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

/* What `exit`, a way out of `place`, says as it is taken: its own `say`, or nothing. */
static sprout_eval_status own_saying(const sprout_frame *frame, const sprout_stored_instance *place,
                                     const sprout_node *exit, sprout_saying *out) {
  const sprout_node *says = sprout_node_get(&frame->world->graph, sprout_node_get(&frame->world->graph, exit, "line"), "says");
  memset(out, 0, sizeof *out);
  if (says == NULL || says->kind == SPROUT_NODE_NULL) return SPROUT_EVAL_OK;
  out->says = true;
  out->by = place->id;
  return spoken_by(frame, sprout_node_get(&frame->world->graph, says, "said"), sprout_node_text(&frame->world->graph, exit, "origin"), place,
                   &out->said);
}

sprout_eval_status sprout_exit_saying(const sprout_frame *frame, sprout_str place, const sprout_way *taken,
                                      sprout_saying *out) {
  const sprout_stored_instance *instance = expr_instance(frame, place);
  const sprout_node *exits = instance == NULL ? NULL : sprout_node_get(&frame->world->graph, instance->kind->node, "exits");
  const sprout_node **run;
  size_t run_count = 0, i;
  bool any_says = false;
  ways applied = {NULL, 0, 0};
  memset(out, 0, sizeof *out);
  if (instance == NULL || exits == NULL || taken->direction == NULL) return SPROUT_EVAL_OK;
  run = (const sprout_node **)sprout_arena_take(frame->turn, (exits->count + 1) * sizeof *run);
  if (run == NULL) return SPROUT_EVAL_NO_MEMORY;
  for (i = 0; i < exits->count; i++) {
    const sprout_node *exit = sprout_item(&frame->world->graph, exits, i), *line = sprout_node_get(&frame->world->graph, exit, "line"), *own;
    if (!sprout_node_is(&frame->world->graph, sprout_node_get(&frame->world->graph, exit, "kind"), "exit")) continue;
    if (strcmp(sprout_node_text(&frame->world->graph, exit, "direction"), taken->direction) != 0) continue;
    run[run_count++] = exit;
    own = sprout_node_get(&frame->world->graph, line, "says");
    if (own != NULL && own->kind != SPROUT_NODE_NULL) any_says = true;
  }
  if (!any_says) return SPROUT_EVAL_OK;
  EXPR_NEED(applying(frame, instance, run, run_count, &applied));
  if (applied.count == 0 || applied.items[0].refuses) return SPROUT_EVAL_OK;
  if (!sprout_str_same(applied.items[0].to, taken->to) || strcmp(applied.items[0].label, taken->label) != 0)
    return SPROUT_EVAL_OK;
  return own_saying(frame, instance, applied.items[0].exit, out);
}

/* `actor` and `here`, the names a line said to the one who went renders with. */
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

sprout_eval_status sprout_drawn_way(const sprout_frame *frame, sprout_str place, const sprout_str *direction,
                                    const char *label, const sprout_way **out) {
  const sprout_way *ways;
  size_t count, i;
  *out = NULL;
  EXPR_NEED(sprout_ways_from(frame, place, &ways, &count));
  for (i = 0; i < count; i++)
    if (ways[i].drawn && strcmp(ways[i].label, label) == 0 &&
        (ways[i].direction == NULL ? direction == NULL
                                   : direction != NULL && sprout_str_is(*direction, ways[i].direction)))
      *out = &ways[i];
  return SPROUT_EVAL_OK;
}

/*
 * The choice drawn for `taken`, a drawn way out of `place` that `actor`
 * takes: where it leads, or *refused with its refusal's words in `refusal`,
 * said by the place with `actor` and `here` bound.
 */
static sprout_eval_status draw_choice(const sprout_frame *frame, sprout_str actor, sprout_str place,
                                      const sprout_way *taken, sprout_str *to, bool *refused,
                                      sprout_move_refusal *refusal) {
  const sprout_stored_instance *instance = expr_instance(frame, place);
  choice *choices;
  size_t count, places;
  uint32_t drawn;
  *refused = false;
  if (instance == NULL) return expr_unchecked(frame, "a drawn way taken from no place");
  EXPR_NEED(choices_now(frame, instance, taken->exit, &choices, &count, &places));
  if (places == 0) return expr_engine(frame, "a drawn way was taken with none of its places a place; it applies only while one is.");
  if (frame->draws == NULL) return expr_unchecked(frame, "a way drawn where nothing draws");
  if (!sprout_draws_below(frame->draws, count, &drawn)) return expr_unchecked(frame, "a draw among more choices than 2^32");
  if (!choices[drawn].refuses) {
    *to = choices[drawn].to;
    return SPROUT_EVAL_OK;
  }
  *refused = true;
  memset(refusal, 0, sizeof *refusal);
  refusal->by = place;
  EXPR_NEED(spoken_by(frame, choices[drawn].said, sprout_node_text(&frame->world->graph, taken->exit, "origin"), instance,
                      &refusal->said));
  return acting_names(frame, actor, place, &refusal->bindings, &refusal->binding_count);
}

sprout_eval_status sprout_take_way(sprout_exec *x, const sprout_frame *frame, sprout_str actor, sprout_str place,
                                   const sprout_way *taken, bool person, bool *went, sprout_move_refusal *refusal) {
  sprout_saying saying;
  sprout_effect said;
  sprout_move_end end;
  sprout_str *to, toward = taken->to;
  memset(&saying, 0, sizeof saying);
  memset(refusal, 0, sizeof *refusal);
  *went = false;
  if (taken->drawn) {
    bool refused;
    EXPR_NEED(draw_choice(frame, actor, place, taken, &toward, &refused, refusal));
    if (refused) return SPROUT_EVAL_OK;
  }
  /* What the exit says is asked of the place before the move, and said to the one who went as the move is made. */
  if (person && taken->drawn) EXPR_NEED(own_saying(frame, expr_instance(frame, place), taken->exit, &saying));
  else if (person) EXPR_NEED(sprout_exit_saying(frame, place, taken, &saying));
  EXPR_NEED(sprout_move_instance(x, frame, actor, actor, toward, SPROUT_REACH_EXIT, taken->label, &end, refusal));
  if (end != SPROUT_MOVE_DONE) return SPROUT_EVAL_OK;
  *went = true;
  if (!saying.says) return SPROUT_EVAL_OK;
  memset(&said, 0, sizeof said);
  to = (sprout_str *)sprout_arena_take(x->turn, sizeof *to);
  if (to == NULL) return SPROUT_EVAL_NO_MEMORY;
  *to = actor;
  said.kind = SPROUT_EFFECT_SAID;
  said.to = to;
  said.to_count = 1;
  said.by = saying.by;
  said.said = saying.said;
  EXPR_NEED(acting_names(frame, actor, place, &said.bindings, &said.binding_count));
  return sprout_exec_record(x, &said);
}
