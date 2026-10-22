/*
 * What is in range of what (the spec's Range; Range > Sight): the live
 * containment tree, whether a target is reached by the path between it and
 * an asker with every container strictly between letting it through, save
 * the first that refuses, which never stands between two things shut in it
 * where no place does on either side; and the walk outward from an asker that a place's `lit` makes. Sight
 * passes over what is unseen and what it holds (Range > Unseen), and what an
 * object can reach does not. Every node touched costs a step, as the rules count them.
 */
#include "expr.h"

/* A growing list of ids in the turn arena. */
typedef struct ids {
  sprout_str *items;
  size_t count, capacity;
} ids;

static bool push(const sprout_frame *frame, ids *list, sprout_str id) {
  if (list->count == list->capacity) {
    size_t wanted = list->capacity == 0 ? 8 : list->capacity * 2;
    sprout_str *bigger = (sprout_str *)sprout_arena_take(frame->turn, wanted * sizeof *bigger);
    if (bigger == NULL) return false;
    if (list->count > 0) memcpy(bigger, list->items, list->count * sizeof *bigger);
    list->items = bigger;
    list->capacity = wanted;
  }
  list->items[list->count++] = id;
  return true;
}

static sprout_str world_of(const sprout_frame *frame) { return frame->draft->base->world; }

bool expr_live(const sprout_frame *frame, sprout_str id) {
  sprout_str at = id;
  size_t guard = 0, limit = frame->draft->base->instance_count + frame->draft->written_count + 2;
  while (!sprout_str_same(at, world_of(frame))) {
    const sprout_stored_instance *instance = expr_instance(frame, at);
    if (instance == NULL || !instance->has_container || ++guard > limit) return false;
    at = instance->container;
  }
  return true;
}

bool expr_holds_actors(const sprout_frame *frame, sprout_str id) {
  const sprout_stored_instance *instance = expr_instance(frame, id);
  return sprout_str_same(id, world_of(frame)) || (instance != NULL && instance->kind != NULL && instance->kind->contains_actors);
}

/* What holds `node`: nothing for the world, and for anything not live. */
static bool container_of(const sprout_frame *frame, sprout_str node, sprout_str *container) {
  const sprout_stored_instance *instance;
  if (!expr_live(frame, node)) return false;
  instance = expr_instance(frame, node);
  if (instance == NULL || !instance->has_container) return false;
  *container = instance->container;
  return true;
}

static sprout_eval_status children_of(const sprout_frame *frame, sprout_str node, const sprout_str **held,
                                      size_t *count) {
  sprout_draft_result result = sprout_draft_children(frame->draft, node, held, count);
  return result == SPROUT_DRAFT_OK ? SPROUT_EVAL_OK : SPROUT_EVAL_NO_MEMORY;
}

/* What a node holds in the live tree: nothing where it is not live. */
static sprout_eval_status contents_of(const sprout_frame *frame, sprout_str node, const sprout_str **held,
                                      size_t *count) {
  *held = NULL;
  *count = 0;
  if (!expr_live(frame, node)) return SPROUT_EVAL_OK;
  return children_of(frame, node, held, count);
}

/* Whether `container` lets the question through: the acting visitor's open hands do, where a refusal's words ask. */
static sprout_eval_status passes_with_hands(const sprout_frame *frame, sprout_str container, const char *asking,
                                            bool hands, bool *open) {
  if (hands && frame->hands.bytes != NULL && sprout_str_same(container, frame->hands)) {
    *open = true;
    return SPROUT_EVAL_OK;
  }
  return expr_passes(frame, container, asking, open);
}

/*
 * Whether anything in `below`, the target and what holds it short of the path to the asker, is unseen to it (the
 * spec's Range > Unseen): an unseen thing hides itself and what it holds, save inside the acting visitor's open hands.
 */
static bool hidden_below(const sprout_frame *frame, const ids *chain, size_t meet, const ids *below, bool hands) {
  size_t at, from = 0;
  if (hands && frame->hands.bytes != NULL) {
    for (at = meet; at < chain->count; at++)
      if (sprout_str_same(chain->items[at], frame->hands)) return false;
    for (at = 0; at < below->count; at++)
      if (sprout_str_same(below->items[at], frame->hands)) from = at + 1;
  }
  for (at = from; at < below->count; at++)
    if (expr_unseen(frame, below->items[at])) return true;
  return false;
}

/* Whether the asker, `chain`'s first, is inside its `at`th container rather than across a place from it, and that
 * container is not the world, which is a wall between its places. */
static bool inside_of(const sprout_frame *frame, const ids *chain, size_t at) {
  size_t below;
  if (sprout_str_same(chain->items[at], world_of(frame))) return false;
  for (below = 0; below < at; below++)
    if (expr_holds_actors(frame, chain->items[below])) return false;
  return true;
}

static sprout_eval_status reaches(const sprout_frame *frame, sprout_str asker, sprout_str target, const char *asking,
                                  bool hands, bool sight, bool *out) {
  ids chain = {NULL, 0, 0}, below = {NULL, 0, 0};
  sprout_str node;
  size_t meet = 0, at;
  bool open, have;
  *out = false;
  for (node = asker, have = true; have;) {
    EXPR_NEED(expr_spend(frame));
    if (!push(frame, &chain, node)) return SPROUT_EVAL_NO_MEMORY;
    have = container_of(frame, node, &node);
  }
  node = target;
  for (have = true; have;) {
    size_t i;
    bool known = false;
    for (i = 0; i < chain.count && !known; i++)
      if (sprout_str_same(chain.items[i], node)) {
        known = true;
        meet = i;
      }
    if (known) break;
    EXPR_NEED(expr_spend(frame));
    if (!push(frame, &below, node)) return SPROUT_EVAL_NO_MEMORY;
    have = container_of(frame, node, &node);
  }
  if (!have) return SPROUT_EVAL_OK;
  if (sight && hidden_below(frame, &chain, meet, &below, hands)) return SPROUT_EVAL_OK;
  if (below.count == 0) {
    for (at = 1; at < meet; at++) {
      EXPR_NEED(passes_with_hands(frame, chain.items[at], asking, hands, &open));
      if (!open) return SPROUT_EVAL_OK;
    }
    *out = true;
    return SPROUT_EVAL_OK;
  }
  /* The first container out that refuses, where no place stands below it, does not stand between two things inside. */
  for (at = 1; at <= meet; at++) {
    EXPR_NEED(passes_with_hands(frame, chain.items[at], asking, hands, &open));
    if (!open && (at < meet || !inside_of(frame, &chain, meet))) return SPROUT_EVAL_OK;
    /* Reached only past a lid, the target is not behind a place of its own either. */
    if (!open) {
      size_t past;
      for (past = 1; past < below.count; past++)
        if (expr_holds_actors(frame, below.items[past])) return SPROUT_EVAL_OK;
    }
  }
  for (at = below.count - 1; at >= 1; at--) {
    EXPR_NEED(passes_with_hands(frame, below.items[at], asking, hands, &open));
    if (!open) return SPROUT_EVAL_OK;
  }
  *out = true;
  return SPROUT_EVAL_OK;
}

sprout_eval_status expr_reaches(const sprout_frame *frame, sprout_str asker, sprout_str target, const char *asking,
                                bool *out) {
  return reaches(frame, asker, target, asking, false, false, out);
}

sprout_eval_status expr_seen_by(const sprout_frame *frame, sprout_str id, bool *out) {
  *out = false;
  if (!expr_live(frame, id)) return SPROUT_EVAL_OK;
  return reaches(frame, frame->self, id, NULL, true, true, out);
}

sprout_eval_status expr_contents_seen(const sprout_frame *frame, sprout_str container, const sprout_str **seen,
                                      size_t *count) {
  const sprout_str *held;
  size_t n, i, kept = 0;
  sprout_str *found;
  EXPR_NEED(children_of(frame, container, &held, &n));
  found = (sprout_str *)sprout_arena_take(frame->turn, (n + 1) * sizeof *found);
  if (found == NULL) return SPROUT_EVAL_NO_MEMORY;
  for (i = 0; i < n; i++) {
    bool in_range;
    EXPR_NEED(expr_seen_by(frame, held[i], &in_range));
    if (in_range) found[kept++] = held[i];
  }
  *seen = found;
  *count = kept;
  return SPROUT_EVAL_OK;
}

/* A container lets sight through if it holds actors, as a place does, or its rule passes. */
static sprout_eval_status sight_passes(const sprout_frame *frame, sprout_str container, bool *open) {
  const sprout_stored_instance *instance = expr_instance(frame, container);
  if (instance != NULL && instance->kind->composes_actor) {
    *open = true;
    return SPROUT_EVAL_OK;
  }
  return expr_passes(frame, container, NULL, open);
}

sprout_eval_status expr_seen_from(const sprout_frame *frame, sprout_str from, const sprout_str **seen,
                                  size_t *count) {
  ids reached = {NULL, 0, 0}, own = {NULL, 0, 0}, ring = {NULL, 0, 0};
  const sprout_str *held;
  size_t n, i, head;
  sprout_str inner = from, outer;
  bool has_outer, open, inside, walled = false;
#define REACH(id)                                       \
  do {                                                  \
    EXPR_NEED(expr_spend(frame));                       \
    if (!push(frame, &reached, (id))) return SPROUT_EVAL_NO_MEMORY; \
  } while (0)
#define SWEEP(frontier)                                                              \
  do {                                                                               \
    for (head = 0; head < (frontier).count; head++) {                                \
      sprout_str node_ = (frontier).items[head];                                     \
      EXPR_NEED(contents_of(frame, node_, &held, &n));                               \
      if (n == 0 || (walled && expr_holds_actors(frame, node_))) continue;          \
      EXPR_NEED(sight_passes(frame, node_, &open));                                  \
      if (!open) continue;                                                           \
      for (i = 0; i < n; i++) {                                                      \
        if (expr_unseen(frame, held[i])) continue;                                   \
        REACH(held[i]);                                                              \
        if (!push(frame, &(frontier), held[i])) return SPROUT_EVAL_NO_MEMORY;        \
      }                                                                              \
    }                                                                                \
  } while (0)
  REACH(from);
  EXPR_NEED(contents_of(frame, from, &held, &n));
  for (i = 0; i < n; i++) {
    if (expr_unseen(frame, held[i])) continue;
    if (!push(frame, &own, held[i])) return SPROUT_EVAL_NO_MEMORY;
  }
  for (i = 0; i < own.count; i++) REACH(own.items[i]);
  SWEEP(own);
  /* Whether no place stands between `from` and the container out it has come to: inside a lid, not across one. */
  inside = !expr_holds_actors(frame, from);
  has_outer = container_of(frame, from, &outer);
  while (has_outer) {
    bool outer_open;
    EXPR_NEED(sight_passes(frame, outer, &outer_open));
    REACH(outer);
    if (!outer_open && (!inside || sprout_str_same(outer, world_of(frame)))) break;
    EXPR_NEED(contents_of(frame, outer, &held, &n));
    ring.count = 0;
    for (i = 0; i < n; i++) {
      if (sprout_str_same(held[i], inner) || expr_unseen(frame, held[i])) continue;
      if (!push(frame, &ring, held[i])) return SPROUT_EVAL_NO_MEMORY;
    }
    for (i = 0; i < ring.count; i++) REACH(ring.items[i]);
    walled = !outer_open;
    SWEEP(ring);
    if (!outer_open) break;
    inside = inside && !expr_holds_actors(frame, outer);
    inner = outer;
    has_outer = container_of(frame, outer, &outer);
  }
#undef SWEEP
#undef REACH
  *seen = reached.items;
  *count = reached.count;
  return SPROUT_EVAL_OK;
}
