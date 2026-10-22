/*
 * What a turn says, recorded (the spec's The runtime > Effects; Other people >
 * Who hears it; Prose > Engine lines). A line is kept unrendered, with the
 * names in scope where it was said, in the order it was said; rendering it
 * for each reader is the prose layer's. Who reads it is found here: `tell x`
 * reaches `x` where `x` is a person in the teller's range, and a plain,
 * `inside` or `outside` `tell` reaches the people around the teller that the
 * pass rules let its voice reach, its holder among them, less whom the reading
 * it stands in already addresses. Only a person reads: a line told to anything
 * else goes nowhere.
 */
#include <string.h>

#include "expr/expr.h"
#include "exec.h"

sprout_eval_status sprout_exec_record(sprout_exec *x, const sprout_effect *effect) {
  sprout_effect *slot = (sprout_effect *)sprout_exec_grow(x->turn, (void **)&x->effects, &x->effect_count,
                                                          &x->effect_capacity, sizeof *x->effects);
  if (slot == NULL) return SPROUT_EVAL_NO_MEMORY;
  *slot = *effect;
  return SPROUT_EVAL_OK;
}

sprout_eval_status sprout_effect_names(const sprout_frame *frame, const sprout_effect_binding **out, size_t *count) {
  const sprout_binding *bound;
  sprout_effect_binding *copy;
  size_t n = 0, i;
  for (bound = frame->bindings; bound != NULL; bound = bound->next) n++;
  copy = (sprout_effect_binding *)sprout_arena_take(frame->turn, (n + 1) * sizeof *copy);
  if (copy == NULL) return SPROUT_EVAL_NO_MEMORY;
  /* Oldest first, as the names were bound. */
  for (bound = frame->bindings, i = n; bound != NULL; bound = bound->next) {
    copy[--i].name = bound->name;
    copy[i].bound = bound->bound;
  }
  *out = copy;
  *count = n;
  return SPROUT_EVAL_OK;
}

bool sprout_is_person(const sprout_frame *frame, sprout_str id) {
  const sprout_stored_instance *instance = expr_instance(frame, id);
  return instance != NULL && instance->made == SPROUT_MADE_VISITOR;
}

static bool listed(const sprout_str *ids, size_t count, sprout_str id) {
  size_t i;
  for (i = 0; i < count; i++)
    if (sprout_str_same(ids[i], id)) return true;
  return false;
}

static sprout_eval_status children(const sprout_frame *frame, sprout_str id, const sprout_str **ids, size_t *count) {
  return sprout_draft_children(frame->draft, id, ids, count) == SPROUT_DRAFT_OK ? SPROUT_EVAL_OK : SPROUT_EVAL_NO_MEMORY;
}

/*
 * The people `place` holds, and those in whatever it holds wherever every container between passes, breadth-first
 * and in each container's order, less `skip` and whom the reading addresses: a voice said in a place crosses into a
 * place inside it as range does, and stops at a lid. No person is entered, since a person passes nothing.
 */
static sprout_eval_status people_within(const sprout_exec *x, const sprout_frame *frame, sprout_str place,
                                        const sprout_str *skip, sprout_str **heard, size_t *count, size_t *capacity) {
  sprout_str *frontier = NULL;
  size_t frontier_count = 0, frontier_capacity = 0, head, i, n;
  const sprout_str *held;
  sprout_str *slot = (sprout_str *)sprout_exec_grow(x->turn, (void **)&frontier, &frontier_count, &frontier_capacity,
                                                    sizeof *frontier);
  if (slot == NULL) return SPROUT_EVAL_NO_MEMORY;
  *slot = place;
  for (head = 0; head < frontier_count; head++) {
    if (head > 0) EXPR_NEED(expr_spend(frame));
    EXPR_NEED(children(frame, frontier[head], &held, &n));
    for (i = 0; i < n; i++) {
      const sprout_str *within;
      size_t within_count;
      bool open;
      if (skip != NULL && sprout_str_same(held[i], *skip)) continue;
      if (sprout_is_person(frame, held[i])) {
        if (listed(x->left_out, x->left_out_count, held[i]) || listed(*heard, *count, held[i])) continue;
        slot = (sprout_str *)sprout_exec_grow(x->turn, (void **)heard, count, capacity, sizeof **heard);
        if (slot == NULL) return SPROUT_EVAL_NO_MEMORY;
        *slot = held[i];
        continue;
      }
      /* Only what holds something is asked whether it passes: an empty thing has nobody to pass the voice to. */
      EXPR_NEED(children(frame, held[i], &within, &within_count));
      if (within_count == 0) continue;
      EXPR_NEED(expr_passes(frame, held[i], NULL, &open));
      if (!open) continue;
      slot = (sprout_str *)sprout_exec_grow(x->turn, (void **)&frontier, &frontier_count, &frontier_capacity,
                                            sizeof *frontier);
      if (slot == NULL) return SPROUT_EVAL_NO_MEMORY;
      *slot = held[i];
    }
  }
  return SPROUT_EVAL_OK;
}

/* `teller`'s own occupants, where its kind declares `contains actors`, and the people in what passes within it. */
static sprout_eval_status inside(const sprout_exec *x, const sprout_frame *frame, sprout_str teller,
                                 const sprout_str **out, size_t *count) {
  const sprout_stored_instance *instance = expr_instance(frame, teller);
  sprout_str *heard = NULL;
  size_t capacity = 0;
  *out = NULL;
  *count = 0;
  if (instance == NULL || !instance->kind->contains_actors) return SPROUT_EVAL_OK;
  EXPR_NEED(people_within(x, frame, teller, NULL, &heard, count, &capacity));
  *out = heard;
  return SPROUT_EVAL_OK;
}

/* The place around `id`: its nearest container, strictly outward, that holds actors. */
bool sprout_surround_of(const sprout_frame *frame, sprout_str id, sprout_str *surround) {
  const sprout_stored_instance *instance = expr_instance(frame, id);
  size_t guard = 0;
  while (instance != NULL && instance->has_container && guard++ < 1000000) {
    const sprout_stored_instance *container = expr_instance(frame, instance->container);
    if (container == NULL) return false;
    if (container->kind->contains_actors) {
      *surround = instance->container;
      return true;
    }
    instance = container;
  }
  return false;
}

/*
 * Who hears `teller` around it: each person on the way out to `surround` whom the walk reaches as a surface,
 * every container between passing, as a holder is reached from what is in their hands; and, where every
 * container on the way and `surround` pass, the people within `surround`, as `people_within` finds them, less the
 * teller and its own occupants. A person passes nothing, so a carried thing is heard by the hands that hold it and by
 * nobody past them.
 */
static sprout_eval_status outside(const sprout_exec *x, const sprout_frame *frame, sprout_str teller,
                                  const sprout_str **out, size_t *count) {
  sprout_str surround, at = teller;
  sprout_str *heard = NULL;
  size_t heard_count = 0, capacity = 0;
  bool open = true;
  *out = NULL;
  *count = 0;
  if (!sprout_surround_of(frame, teller, &surround)) return SPROUT_EVAL_OK;
  while (open) {
    const sprout_stored_instance *instance = expr_instance(frame, at);
    if (instance == NULL || !instance->has_container) return SPROUT_EVAL_OK;
    at = instance->container;
    EXPR_NEED(expr_spend(frame));
    if (sprout_is_person(frame, at) && !listed(x->left_out, x->left_out_count, at)) {
      sprout_str *slot = (sprout_str *)sprout_exec_grow(x->turn, (void **)&heard, &heard_count, &capacity, sizeof *heard);
      if (slot == NULL) return SPROUT_EVAL_NO_MEMORY;
      *slot = at;
    }
    EXPR_NEED(expr_passes(frame, at, NULL, &open));
    if (sprout_str_same(at, surround)) break;
  }
  if (open) EXPR_NEED(people_within(x, frame, surround, &teller, &heard, &heard_count, &capacity));
  *out = heard;
  *count = heard_count;
  return SPROUT_EVAL_OK;
}

sprout_eval_status sprout_told_to(const sprout_exec *x, const sprout_frame *frame, sprout_str teller,
                                  sprout_tell_scope scope, const sprout_str **out, size_t *count) {
  const sprout_str *in_ids, *out_ids;
  size_t in_count = 0, out_count = 0;
  sprout_str *both;
  if (scope == SPROUT_TELL_INSIDE) return inside(x, frame, teller, out, count);
  if (scope == SPROUT_TELL_OUTSIDE) return outside(x, frame, teller, out, count);
  EXPR_NEED(inside(x, frame, teller, &in_ids, &in_count));
  EXPR_NEED(outside(x, frame, teller, &out_ids, &out_count));
  both = (sprout_str *)sprout_arena_take(x->turn, (in_count + out_count + 1) * sizeof *both);
  if (both == NULL) return SPROUT_EVAL_NO_MEMORY;
  if (in_count > 0) memcpy(both, in_ids, in_count * sizeof *both);
  if (out_count > 0) memcpy(both + in_count, out_ids, out_count * sizeof *both);
  *out = both;
  *count = in_count + out_count;
  return SPROUT_EVAL_OK;
}

sprout_eval_status sprout_told_to_one(const sprout_exec *x, const sprout_frame *frame, sprout_str teller,
                                      sprout_str one, const sprout_str **out, size_t *count) {
  sprout_str *found = (sprout_str *)sprout_arena_take(x->turn, sizeof *found);
  bool reached = false;
  if (found == NULL) return SPROUT_EVAL_NO_MEMORY;
  *out = found;
  *count = 0;
  if (!sprout_is_person(frame, one) || !expr_live(frame, one)) return SPROUT_EVAL_OK;
  EXPR_NEED(expr_reaches(frame, teller, one, NULL, &reached));
  if (reached) {
    found[0] = one;
    *count = 1;
  }
  return SPROUT_EVAL_OK;
}

/* ---- the engine's lines ---- */

/* Which kind writes a line's default when nothing along the way writes it: a place's notices are the place's. */
static bool spoken_by_place(const char *name) { return strcmp(name, "arrives") == 0 || strcmp(name, "leaves") == 0; }

static const sprout_passage *passage_named(const sprout_kind_def *kind, const char *name) {
  size_t i;
  for (i = 0; i < kind->passage_count; i++)
    if (strcmp(kind->passages[i].name, name) == 0) return &kind->passages[i];
  return NULL;
}

void sprout_passage_speech(const sprout_graph *graph, const sprout_passage *passage, sprout_speech *out) {
  memset(out, 0, sizeof *out);
  out->kind = SPROUT_SPEECH_PASSAGE;
  out->name = passage->name;
  out->origin = sprout_node_text(graph, passage->node, "origin");
  out->node = passage->node;
}

bool sprout_passage_on(const sprout_graph *graph, const sprout_kind_def *kind, const char *name, sprout_speech *out) {
  const sprout_passage *passage = passage_named(kind, name);
  if (passage == NULL) return false;
  sprout_passage_speech(graph, passage, out);
  return true;
}

void sprout_engine_said(const sprout_frame *frame, const char *name, const sprout_str *about, const sprout_str *place,
                        sprout_str *by, sprout_speech *said) {
  sprout_str world = frame->draft->base->world;
  const sprout_str *candidates[3];
  const sprout_node *yielding_node = NULL;
  const sprout_passage *yielding = NULL;
  sprout_str yielding_by = world;
  size_t i;
  candidates[0] = about;
  candidates[1] = place;
  candidates[2] = &world;
  for (i = 0; i < 3; i++) {
    const sprout_stored_instance *instance;
    const sprout_passage *passage;
    if (candidates[i] == NULL) continue;
    instance = expr_instance(frame, *candidates[i]);
    passage = instance == NULL ? NULL : passage_named(instance->kind, name);
    if (passage == NULL) continue;
    yielding_node = sprout_node_get(&frame->world->graph, passage->node, "yields");
    if (yielding_node == NULL || !sprout_truth(yielding_node)) {
      *by = *candidates[i];
      sprout_passage_speech(&frame->world->graph, passage, said);
      return;
    }
    if (yielding == NULL) {
      yielding = passage;
      yielding_by = *candidates[i];
    }
  }
  if (yielding != NULL) {
    *by = yielding_by;
    sprout_passage_speech(&frame->world->graph, yielding, said);
    return;
  }
  memset(said, 0, sizeof *said);
  said->kind = SPROUT_SPEECH_ENGINE;
  said->name = name;
  *by = spoken_by_place(name) && place != NULL ? *place : world;
}
