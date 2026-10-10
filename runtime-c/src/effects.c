/*
 * What a turn says, recorded (the spec's The runtime > Effects; Other people >
 * Who hears it; Prose > Engine lines). A line is kept unrendered, with the
 * names in scope where it was said, in the order it was said; rendering it
 * for each reader is the prose layer's. Who reads it is found here: `tell x`
 * reaches `x` where `x` is a person in the teller's range, and a plain,
 * `inside` or `outside` `tell` reaches the people around the teller that the
 * pass rules let its voice reach, less whom the reading it stands in already
 * addresses. Only a person reads: a line told to anything else goes nowhere.
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

/* The people among `ids`, less everyone in the exec's left-out list. */
static sprout_eval_status persons_except(const sprout_exec *x, const sprout_frame *frame, const sprout_str *ids,
                                         size_t count, const sprout_str **out, size_t *kept) {
  sprout_str *found = (sprout_str *)sprout_arena_take(x->turn, (count + 1) * sizeof *found);
  size_t i, n = 0;
  if (found == NULL) return SPROUT_EVAL_NO_MEMORY;
  for (i = 0; i < count; i++)
    if (!listed(x->left_out, x->left_out_count, ids[i]) && sprout_is_person(frame, ids[i])) found[n++] = ids[i];
  *out = found;
  *kept = n;
  return SPROUT_EVAL_OK;
}

static sprout_eval_status children(const sprout_frame *frame, sprout_str id, const sprout_str **ids, size_t *count) {
  return sprout_draft_children(frame->draft, id, ids, count) == SPROUT_DRAFT_OK ? SPROUT_EVAL_OK : SPROUT_EVAL_NO_MEMORY;
}

/* `teller`'s own occupants, where its kind declares `contains actors`. */
static sprout_eval_status inside(const sprout_exec *x, const sprout_frame *frame, sprout_str teller,
                                 const sprout_str **out, size_t *count) {
  const sprout_stored_instance *instance = expr_instance(frame, teller);
  const sprout_str *held;
  size_t n;
  *out = NULL;
  *count = 0;
  if (instance == NULL || !instance->kind->contains_actors) return SPROUT_EVAL_OK;
  EXPR_NEED(children(frame, teller, &held, &n));
  return persons_except(x, frame, held, n, out, count);
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

/* Whether a voice from `teller` carries out to `surround`: every container between, and `surround`, must pass. */
static sprout_eval_status opens_outward(const sprout_frame *frame, sprout_str teller, sprout_str surround, bool *open) {
  sprout_str at = teller;
  *open = false;
  while (!sprout_str_same(at, surround)) {
    const sprout_stored_instance *instance = expr_instance(frame, at);
    if (instance == NULL || !instance->has_container) return SPROUT_EVAL_OK;
    at = instance->container;
    EXPR_NEED(expr_spend(frame));
    EXPR_NEED(expr_passes(frame, at, NULL, open));
    if (!*open) return SPROUT_EVAL_OK;
  }
  *open = true;
  return SPROUT_EVAL_OK;
}

static sprout_eval_status outside(const sprout_exec *x, const sprout_frame *frame, sprout_str teller,
                                  const sprout_str **out, size_t *count) {
  sprout_str surround;
  bool open;
  const sprout_str *held;
  size_t n;
  *out = NULL;
  *count = 0;
  if (!sprout_surround_of(frame, teller, &surround)) return SPROUT_EVAL_OK;
  EXPR_NEED(opens_outward(frame, teller, surround, &open));
  if (!open) return SPROUT_EVAL_OK;
  EXPR_NEED(children(frame, surround, &held, &n));
  return persons_except(x, frame, held, n, out, count);
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

void sprout_passage_speech(const sprout_passage *passage, sprout_speech *out) {
  memset(out, 0, sizeof *out);
  out->kind = SPROUT_SPEECH_PASSAGE;
  out->name = passage->name;
  out->origin = sprout_node_text(passage->node, "origin");
  out->node = passage->node;
}

bool sprout_passage_on(const sprout_kind_def *kind, const char *name, sprout_speech *out) {
  const sprout_passage *passage = passage_named(kind, name);
  if (passage == NULL) return false;
  sprout_passage_speech(passage, out);
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
    yielding_node = sprout_node_get(passage->node, "yields");
    if (yielding_node == NULL || !yielding_node->boolean) {
      *by = *candidates[i];
      sprout_passage_speech(passage, said);
      return;
    }
    if (yielding == NULL) {
      yielding = passage;
      yielding_by = *candidates[i];
    }
  }
  if (yielding != NULL) {
    *by = yielding_by;
    sprout_passage_speech(yielding, said);
    return;
  }
  memset(said, 0, sizeof *said);
  said->kind = SPROUT_SPEECH_ENGINE;
  said->name = name;
  *by = spoken_by_place(name) && place != NULL ? *place : world;
}
