/*
 * What an object can reach (the spec's The world model > Range; Events,
 * messages and the bus > Sending): the walk a broadcast makes and the one a
 * move's notices make. Every node reached is one step of the turn's budget
 * (Limits > Runtime budgets).
 *
 * Two invariants. The asker always reaches itself, its own contents and the
 * surface of every container out to the first that refuses, whatever that
 * one's rule says, because a lid stops others looking in, not the chest
 * looking down. And the walk is a loop over a queue, never recursion, since
 * nesting has no cap.
 */
#include "expr/expr.h"
#include "exec.h"

typedef struct walk {
  const sprout_frame *frame;
  const char *asking;
  sprout_reached *reached;
  size_t count, capacity;
} walk;

typedef struct ids {
  sprout_str *items;
  size_t count, capacity;
} ids;

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
    if (n == 0) continue;
    EXPR_NEED(expr_passes(w->frame, node, w->asking, &open));
    if (!open) continue;
    for (i = 0; i < n; i++) {
      EXPR_NEED(reach(w, held[i], SPROUT_VIA_PASSED));
      EXPR_NEED(push(w->frame, frontier, held[i]));
    }
  }
  return SPROUT_EVAL_OK;
}

sprout_eval_status sprout_range_of(const sprout_frame *frame, sprout_str asker, const char *asking,
                                   const sprout_reached **reached, size_t *count) {
  walk w = {frame, asking, NULL, 0, 0};
  ids own = {NULL, 0, 0}, ring = {NULL, 0, 0};
  const sprout_str *held;
  size_t n, i;
  sprout_str inner = asker, outer;
  bool has_outer;
  EXPR_NEED(reach(&w, asker, SPROUT_VIA_SELF));
  EXPR_NEED(contents(frame, asker, &held, &n));
  for (i = 0; i < n; i++) EXPR_NEED(push(frame, &own, held[i]));
  for (i = 0; i < n; i++) EXPR_NEED(reach(&w, held[i], SPROUT_VIA_HELD));
  EXPR_NEED(sweep(&w, &own));
  has_outer = container_of(frame, asker, &outer);
  while (has_outer) {
    bool open;
    EXPR_NEED(expr_passes(frame, outer, asking, &open));
    if (!open) {
      EXPR_NEED(reach(&w, outer, SPROUT_VIA_SURFACE));
      break;
    }
    EXPR_NEED(reach(&w, outer, SPROUT_VIA_PASSED));
    EXPR_NEED(contents(frame, outer, &held, &n));
    ring.count = 0;
    for (i = 0; i < n; i++)
      if (!sprout_str_same(held[i], inner)) EXPR_NEED(push(frame, &ring, held[i]));
    for (i = 0; i < ring.count; i++) EXPR_NEED(reach(&w, ring.items[i], SPROUT_VIA_PASSED));
    EXPR_NEED(sweep(&w, &ring));
    inner = outer;
    has_outer = container_of(frame, outer, &outer);
  }
  *reached = w.reached;
  *count = w.count;
  return SPROUT_EVAL_OK;
}
