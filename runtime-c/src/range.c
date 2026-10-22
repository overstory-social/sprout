/*
 * What an object can reach (the spec's The world model > Range; Events,
 * messages and the bus > Sending): the walk a broadcast makes and the one a
 * move's notices make, and the same walk as a visitor sees it, passing over
 * what is unseen and what it holds (Range > Unseen). Every node reached is
 * one step of the turn's budget (Limits > Runtime budgets).
 *
 * Two invariants. The asker always reaches itself, its own contents and the
 * surface of every container out to the first that refuses, whatever that
 * one's rule says, because a lid stops others looking in, not the chest
 * looking down; and it reaches what is shut in with it in the first
 * container out that refuses, since a lid divides the inside from the
 * outside, not the inside from itself, though never across a place. And
 * the walk is a loop over a queue, never recursion, since nesting has no cap.
 *
 * An object declared in several places walks out from each in turn, its
 * first first, as though it stood there, and what one walk reached the next
 * passes over (The world model > One thing in several places).
 */
#include "expr/expr.h"
#include "exec.h"

typedef struct walk {
  const sprout_frame *frame;
  const char *asking;
  bool sight;   /* what is unseen, and what it holds, is passed over */
  bool walled;  /* a place's contents are passed over, as they are past a container that refuses */
  bool again;   /* a later walk out of an object in several places: what is reached already is passed over */
  sprout_reached *reached;
  size_t count, capacity;
} walk;

typedef struct ids {
  sprout_str *items;
  size_t count, capacity;
} ids;

/*
 * Whether `node` is reached already: by an earlier walk out of an object in several places, or, being one, through
 * another of its places.
 */
static bool reached_already(const walk *w, sprout_str node) {
  const char *const *places;
  size_t i;
  if (!w->again && sprout_world_also_in(w->frame->world, node, &places) == 0) return false;
  for (i = 0; i < w->count; i++)
    if (sprout_str_same(w->reached[i].node, node)) return true;
  return false;
}

static sprout_eval_status reach(walk *w, sprout_str node, sprout_via via) {
  sprout_reached *slot;
  EXPR_NEED(expr_spend(w->frame));
  slot = (sprout_reached *)sprout_exec_grow(w->frame->turn, (void **)&w->reached, &w->count, &w->capacity,
                                            sizeof *w->reached);
  if (slot == NULL) return SPROUT_EVAL_NO_MEMORY;
  slot->node = node;
  slot->via = via;
  return SPROUT_EVAL_OK;
}

static sprout_eval_status push(const sprout_frame *frame, ids *list, sprout_str id) {
  sprout_str *slot = (sprout_str *)sprout_exec_grow(frame->turn, (void **)&list->items, &list->count, &list->capacity,
                                                    sizeof *list->items);
  if (slot == NULL) return SPROUT_EVAL_NO_MEMORY;
  *slot = id;
  return SPROUT_EVAL_OK;
}

/* What a node holds in the live tree, in the container's order: nothing where it is not live. */
static sprout_eval_status contents(const sprout_frame *frame, sprout_str node, const sprout_str **held, size_t *count) {
  *held = NULL;
  *count = 0;
  if (!expr_live(frame, node)) return SPROUT_EVAL_OK;
  return sprout_draft_children(frame->draft, node, held, count) == SPROUT_DRAFT_OK ? SPROUT_EVAL_OK
                                                                                 : SPROUT_EVAL_NO_MEMORY;
}

/* What holds a node in the live tree, if anything does. */
static bool container_of(const sprout_frame *frame, sprout_str node, sprout_str *container) {
  const sprout_stored_instance *instance;
  if (!expr_live(frame, node)) return false;
  instance = expr_instance(frame, node);
  if (instance == NULL || !instance->has_container) return false;
  *container = instance->container;
  return true;
}

/* Crosses inward from every node in `frontier`, breadth-first; `frontier` grows as it is read. */
static sprout_eval_status sweep(walk *w, ids *frontier) {
  size_t head, i;
  for (head = 0; head < frontier->count; head++) {
    sprout_str node = frontier->items[head];
    const sprout_str *held;
    size_t n;
    bool open;
    EXPR_NEED(contents(w->frame, node, &held, &n));
    if (n == 0 || (w->walled && expr_holds_actors(w->frame, node))) continue;
    EXPR_NEED(expr_passes(w->frame, node, w->asking, &open));
    if (!open) continue;
    for (i = 0; i < n; i++) {
      if ((w->sight && expr_unseen(w->frame, held[i])) || reached_already(w, held[i])) continue;
      EXPR_NEED(reach(w, held[i], SPROUT_VIA_PASSED));
      EXPR_NEED(push(w->frame, frontier, held[i]));
    }
  }
  return SPROUT_EVAL_OK;
}

/* Walks out from `asker` through `outer`, its container or another place it stands in, a ring at a time. */
static sprout_eval_status outward(walk *w, sprout_str asker, sprout_str outer) {
  const sprout_frame *frame = w->frame;
  const char *asking = w->asking;
  bool sight = w->sight;
  ids ring = {NULL, 0, 0};
  const sprout_str *held;
  size_t n, i;
  sprout_str inner = asker;
  bool has_outer = true, inside;
  /* Whether no place stands between the asker and the container out it has come to: inside a lid, not across one. */
  inside = !expr_holds_actors(frame, asker);
  while (has_outer) {
    bool open;
    EXPR_NEED(expr_passes(frame, outer, asking, &open));
    if (!reached_already(w, outer)) EXPR_NEED(reach(w, outer, open ? SPROUT_VIA_PASSED : SPROUT_VIA_SURFACE));
    /* A container that refuses is a wall to what is outside it, not between two things inside it; a place is a wall
     * of its own, so nothing is reached across one (Range). */
    if (!open && (!inside || sprout_str_same(outer, frame->draft->base->world))) break;
    EXPR_NEED(contents(frame, outer, &held, &n));
    ring.count = 0;
    for (i = 0; i < n; i++)
      if (!sprout_str_same(held[i], inner) && (!sight || !expr_unseen(frame, held[i])) &&
          !reached_already(w, held[i]))
        EXPR_NEED(push(frame, &ring, held[i]));
    for (i = 0; i < ring.count; i++) EXPR_NEED(reach(w, ring.items[i], open ? SPROUT_VIA_PASSED : SPROUT_VIA_BESIDE));
    w->walled = !open;
    EXPR_NEED(sweep(w, &ring));
    if (!open) break;
    inside = inside && !expr_holds_actors(frame, outer);
    inner = outer;
    has_outer = container_of(frame, outer, &outer);
  }
  return SPROUT_EVAL_OK;
}

static sprout_eval_status walk_from(const sprout_frame *frame, sprout_str asker, const char *asking, bool sight,
                                    const sprout_reached **reached, size_t *count) {
  walk w = {frame, asking, sight, false, false, NULL, 0, 0};
  ids own = {NULL, 0, 0};
  const sprout_str *held;
  const char *const *places;
  size_t n, i, place_count;
  sprout_str outer;
  EXPR_NEED(reach(&w, asker, SPROUT_VIA_SELF));
  EXPR_NEED(contents(frame, asker, &held, &n));
  for (i = 0; i < n; i++)
    if (!sight || !expr_unseen(frame, held[i])) EXPR_NEED(push(frame, &own, held[i]));
  for (i = 0; i < own.count; i++) EXPR_NEED(reach(&w, own.items[i], SPROUT_VIA_HELD));
  EXPR_NEED(sweep(&w, &own));
  if (container_of(frame, asker, &outer)) EXPR_NEED(outward(&w, asker, outer));
  place_count = expr_live(frame, asker) ? sprout_world_also_in(frame->world, asker, &places) : 0;
  w.again = true;
  for (i = 0; i < place_count; i++) {
    outer.bytes = places[i];
    outer.length = strlen(places[i]);
    w.walled = false;
    if (expr_live(frame, outer)) EXPR_NEED(outward(&w, asker, outer));
  }
  *reached = w.reached;
  *count = w.count;
  return SPROUT_EVAL_OK;
}

sprout_eval_status sprout_range_of(const sprout_frame *frame, sprout_str asker, const char *asking,
                                   const sprout_reached **reached, size_t *count) {
  return walk_from(frame, asker, asking, false, reached, count);
}

sprout_eval_status sprout_range_seen(const sprout_frame *frame, sprout_str asker, const sprout_reached **reached,
                                     size_t *count) {
  return walk_from(frame, asker, NULL, true, reached, count);
}
