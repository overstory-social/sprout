/*
 * Spawning (the spec's The object model > Spawning; Limits > Runtime
 * budgets): an instance of a declared kind made in a container in range of
 * the object whose body ran the `spawn`, at the kind's defaults, with a copy
 * of everything its kinds' bodies hold. The turn's cap on spawns is charged
 * one for the instance and one for each of its contents, before anything is
 * written, so a fault leaves the draft as it was. The host's bound on the
 * instances a world holds (the spec's Limits > Runtime budgets) faults a spawn
 * that would pass it. The messages a spawn sends
 * are the bus's.
 */
#include "expr.h"

/* One content to make: what its kind's body gives, and the one of the others that holds it. */
typedef struct making {
  const sprout_content *content;
  size_t holder; /* an index into the list, or `NO_HOLDER` for the instance given them */
} making;

#define NO_HOLDER ((size_t)-1)

/* The kind a content is made of: its own anonymous kind. */
static const sprout_kind_def *kind_of(const sprout_content *content) { return content->kind; }

/* Appends `item` to a growing list in the turn arena. */
static bool grow(const sprout_frame *frame, void **items, size_t *count, size_t *capacity, size_t size) {
  if (*count == *capacity) {
    size_t wanted = *capacity == 0 ? 8 : *capacity * 2;
    char *bigger = (char *)sprout_arena_take(frame->turn, wanted * size);
    if (bigger == NULL) return false;
    if (*count > 0) memcpy(bigger, *items, *count * size);
    *items = bigger;
    *capacity = wanted;
  }
  return true;
}

/* Pushes what a holder of `kind` is given, then `own`, so that popping gives them in that order. */
static sprout_eval_status push_inside(const sprout_frame *frame, const sprout_kind_def *kind, size_t holder,
                                      const sprout_content *own, size_t own_count, making **stack, size_t *count,
                                      size_t *capacity) {
  size_t order, i, j, mark = *count;
  const sprout_world *world = frame->world;
  /* Pushed in the order given, then reversed in place. */
  for (order = 0; order < kind->order_count; order++)
    for (i = 0; i < world->content_list_count; i++) {
      if (strcmp(world->contents[i].kind, kind->order[order]) != 0) continue;
      for (j = 0; j < world->contents[i].count; j++) {
        if (!grow(frame, (void **)stack, count, capacity, sizeof **stack)) return SPROUT_EVAL_NO_MEMORY;
        (*stack)[*count].content = &world->contents[i].items[j];
        (*stack)[*count].holder = holder;
        (*count)++;
      }
    }
  for (i = 0; i < own_count; i++) {
    if (!grow(frame, (void **)stack, count, capacity, sizeof **stack)) return SPROUT_EVAL_NO_MEMORY;
    (*stack)[*count].content = &own[i];
    (*stack)[*count].holder = holder;
    (*count)++;
  }
  for (i = mark, j = *count; i + 1 < j; i++, j--) {
    making swap = (*stack)[i];
    (*stack)[i] = (*stack)[j - 1];
    (*stack)[j - 1] = swap;
  }
  return SPROUT_EVAL_OK;
}

/*
 * Everything an instance of `kind` is given, each after what holds it: what a
 * holder's kinds give before what its own body holds. A content whose kind is
 * absent is not made, and nor is what it holds.
 */
static sprout_eval_status contents_of(const sprout_frame *frame, const sprout_kind_def *kind, making **made,
                                      size_t *made_count) {
  making *stack = NULL;
  size_t stack_count = 0, stack_capacity = 0, capacity = 0;
  making *list = NULL;
  size_t count = 0;
  EXPR_NEED(push_inside(frame, kind, NO_HOLDER, NULL, 0, &stack, &stack_count, &stack_capacity));
  while (stack_count > 0) {
    making next = stack[--stack_count];
    if (kind_of(next.content) == NULL) continue;
    if (!grow(frame, (void **)&list, &count, &capacity, sizeof *list)) return SPROUT_EVAL_NO_MEMORY;
    list[count].content = next.content;
    list[count].holder = next.holder;
    count++;
    EXPR_NEED(push_inside(frame, kind_of(next.content), count - 1, next.content->held, next.content->held_count,
                          &stack, &stack_count, &stack_capacity));
  }
  *made = list;
  *made_count = count;
  return SPROUT_EVAL_OK;
}

/* A kind as a fault names it: its own name, as an author most often writes it. */
static const char *shown(const char *qualified) {
  const char *dot = strrchr(qualified, '.');
  return dot == NULL ? qualified : dot + 1;
}

/* Fault where an actor among `list` would stand in what holds no actors. */
static sprout_eval_status holds_each(const sprout_frame *frame, const making *list, size_t count,
                                     const sprout_kind_def *root, const char *spawned) {
  size_t i;
  for (i = 0; i < count; i++) {
    const sprout_kind_def *one = kind_of(list[i].content);
    const sprout_kind_def *holder = list[i].holder == NO_HOLDER ? root : kind_of(list[list[i].holder].content);
    if (one->composes_actor && !holder->contains_actors) {
      expr_text text = expr_text_begin(frame);
      expr_put(&text, "`");
      expr_put(&text, one->name);
      expr_put(&text, "`, an actor, would be inside `");
      expr_put(&text, holder->name);
      expr_put(&text, "`, which holds no actors, so ");
      expr_put(&text, "`");
      expr_put(&text, spawned);
      expr_put(&text, "` could not be spawned.");
      return expr_fail(frame, "LifecycleFault");
    }
  }
  return SPROUT_EVAL_OK;
}

static sprout_eval_status drafted(sprout_draft_result result) {
  return result == SPROUT_DRAFT_OK ? SPROUT_EVAL_OK : SPROUT_EVAL_NO_MEMORY;
}

/* Writes a new instance of `kind` into `container` under a minted id. */
static sprout_eval_status write_instance(const sprout_frame *frame, const sprout_kind_def *kind,
                                         sprout_made_from made, const sprout_content *given, sprout_str container,
                                         sprout_str *id) {
  sprout_stored_instance record;
  uint64_t arrival;
  size_t i;
  EXPR_NEED(drafted(sprout_draft_mint(frame->draft, id)));
  if (sprout_stored_instance_defaults(frame->turn, kind, &record) != SPROUT_OK) return SPROUT_EVAL_NO_MEMORY;
  record.id = *id;
  record.made = made;
  if (made == SPROUT_MADE_SPAWNED) {
    record.made_kind = expr_str(kind->qualified);
  } else {
    record.made_kind = expr_str(given->giver);
    record.path_count = given->path_count;
    record.path = (sprout_str *)sprout_arena_take(frame->turn, (given->path_count + 1) * sizeof *record.path);
    if (record.path == NULL) return SPROUT_EVAL_NO_MEMORY;
    for (i = 0; i < given->path_count; i++) record.path[i] = expr_str(given->path[i]);
  }
  record.has_container = true;
  record.container = container;
  EXPR_NEED(drafted(sprout_draft_next_serial(frame->draft, &arrival)));
  record.has_arrival = true;
  record.arrival = arrival;
  return drafted(sprout_draft_add(frame->draft, &record));
}

sprout_eval_status sprout_spawn(const sprout_frame *frame, const char *kind_name, sprout_str container,
                                sprout_spawned *out) {
  const sprout_kind_def *kind = sprout_world_kind(frame->world, kind_name);
  const sprout_stored_instance *holder;
  making *list;
  size_t count, i;
  sprout_str *ids;
  bool in_range = false;
  expr_text text;
  if (kind == NULL || !kind->spawnable) {
    text = expr_text_begin(frame);
    expr_put(&text, "`");
    expr_put(&text, shown(kind_name));
    expr_put(&text, "` is absent, so it could not be spawned.");
    return expr_fail(frame, "LifecycleFault");
  }
  EXPR_NEED(expr_reaches(frame, frame->self, container, NULL, &in_range));
  in_range = in_range && sprout_draft_instance(frame->draft, container) != NULL && expr_live(frame, container);
  if (!in_range) {
    text = expr_text_begin(frame);
    expr_put(&text, "`");
    expr_put_str(&text, container);
    expr_put(&text, "` is out of range of `");
    expr_put_str(&text, frame->self);
    expr_put(&text, "`, so nothing could be spawned in it.");
    return expr_fail(frame, "LifecycleFault");
  }
  holder = expr_instance(frame, container);
  if (!sprout_str_same(container, frame->draft->base->world) && (holder == NULL || !holder->kind->contains)) {
    text = expr_text_begin(frame);
    expr_put(&text, "`");
    expr_put_str(&text, container);
    expr_put(&text, "` holds nothing, so `");
    expr_put(&text, shown(kind_name));
    expr_put(&text, "` could not be spawned in it.");
    return expr_fail(frame, "LifecycleFault");
  }
  if (kind->composes_actor && (holder == NULL || !holder->kind->contains_actors)) {
    text = expr_text_begin(frame);
    expr_put(&text, "`");
    expr_put_str(&text, container);
    expr_put(&text, "` holds no actors, so `");
    expr_put(&text, shown(kind_name));
    expr_put(&text, "`, an actor, could not be spawned in it.");
    return expr_fail(frame, "LifecycleFault");
  }
  EXPR_NEED(contents_of(frame, kind, &list, &count));
  EXPR_NEED(holds_each(frame, list, count, kind, shown(kind_name)));
  for (i = 0; i < 1 + count; i++)
    if (!sprout_meter_spawn(frame->meter)) return expr_budget_fault(frame);
  {
    sprout_limit may_hold = frame->meter->budgets->instances;
    if (may_hold.set && (uint64_t)sprout_draft_held(frame->draft) + 1 + count > may_hold.value) {
      text = expr_text_begin(frame);
      expr_put(&text, "the host will hold no more instances in this world, so `");
      expr_put(&text, shown(kind_name));
      expr_put(&text, "` could not be spawned.");
      return expr_fail(frame, "LifecycleFault");
    }
  }
  ids = (sprout_str *)sprout_arena_take(frame->turn, (count + 1) * sizeof *ids);
  if (ids == NULL) return SPROUT_EVAL_NO_MEMORY;
  EXPR_NEED(write_instance(frame, kind, SPROUT_MADE_SPAWNED, NULL, container, &out->id));
  for (i = 0; i < count; i++) {
    sprout_str into = list[i].holder == NO_HOLDER ? out->id : ids[list[i].holder];
    EXPR_NEED(write_instance(frame, kind_of(list[i].content), SPROUT_MADE_GIVEN, list[i].content, into, &ids[i]));
  }
  out->count = count;
  out->contents = ids;
  return SPROUT_EVAL_OK;
}
