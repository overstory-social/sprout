/*
 * The options a reading's value roles offer (see options.h).
 */
#include "options.h"

#include <string.h>

#include "expr/expr.h"

typedef struct growing {
  sprout_str *options;
  size_t option_count, option_capacity;
  sprout_option_range *ranges;
  size_t range_count, range_capacity;
} growing;

static sprout_eval_status add_option(const sprout_frame *frame, growing *g, sprout_str option) {
  sprout_str *slot;
  size_t i;
  for (i = 0; i < g->option_count; i++)
    if (sprout_str_same(g->options[i], option)) return SPROUT_EVAL_OK;
  slot = (sprout_str *)sprout_exec_grow(frame->turn, (void **)&g->options, &g->option_count, &g->option_capacity,
                                        sizeof *slot);
  if (slot == NULL) return SPROUT_EVAL_NO_MEMORY;
  *slot = option;
  return SPROUT_EVAL_OK;
}

static sprout_eval_status add_range(const sprout_frame *frame, growing *g, double min, double max) {
  sprout_option_range *slot;
  size_t i;
  for (i = 0; i < g->range_count; i++)
    if (g->ranges[i].min == min && g->ranges[i].max == max) return SPROUT_EVAL_OK;
  slot = (sprout_option_range *)sprout_exec_grow(frame->turn, (void **)&g->ranges, &g->range_count,
                                                 &g->range_capacity, sizeof *slot);
  if (slot == NULL) return SPROUT_EVAL_NO_MEMORY;
  slot->min = min;
  slot->max = max;
  return SPROUT_EVAL_OK;
}

/* The range an integer role's `from` hears: its integer property's, or the one written out; none for a list. */
static void range_of(const sprout_node *narrowing, bool *has, double *min, double *max) {
  const sprout_node *type;
  *has = false;
  if (sprout_node_is(sprout_node_get(narrowing, "narrows"), "range")) {
    *has = true;
    *min = sprout_node_get(narrowing, "min")->number;
    *max = sprout_node_get(narrowing, "max")->number;
    return;
  }
  type = sprout_node_get(sprout_node_get(narrowing, "property"), "type");
  if (!sprout_node_is(sprout_node_get(type, "type"), "integer")) return;
  *has = true;
  *min = sprout_node_get(type, "min")->number;
  *max = sprout_node_get(type, "max")->number;
}

/* The options a symbol role's `from` hears: what its list property holds now, in order. */
static sprout_eval_status held_options(const sprout_frame *frame, growing *g, const sprout_node *narrowing,
                                       const sprout_stored_instance *self) {
  sprout_value held;
  size_t i;
  if (!sprout_node_is(sprout_node_get(narrowing, "narrows"), "property")) return SPROUT_EVAL_OK;
  EXPR_NEED(expr_get(frame, self, sprout_node_text(sprout_node_get(narrowing, "property"), "name"), &held));
  if (held.kind != SPROUT_LIST) return SPROUT_EVAL_OK;
  for (i = 0; i < held.as.list->count; i++) {
    const sprout_value *element = &held.as.list->items[i];
    if (element->kind != SPROUT_STRING) continue;
    EXPR_NEED(add_option(frame, g, (sprout_str){element->as.string.bytes, element->as.string.length}));
  }
  return SPROUT_EVAL_OK;
}

/* What one value role is offered by the plays of every participant. */
static sprout_eval_status options_of(const sprout_frame *frame, const sprout_verb *verb, const sprout_role *role,
                                     const sprout_participant *participants, size_t participant_count, growing *g) {
  bool integer = role->filler == SPROUT_FILLER_INTEGER;
  size_t j, p;
  for (j = 0; j < participant_count; j++) {
    const sprout_stored_instance *self = expr_instance(frame, participants[j].id);
    const sprout_play_group *own;
    if (self == NULL) continue;
    own = sprout_own_plays(verb, participants[j].role == NULL ? "actor" : participants[j].role->name, self->kind);
    for (p = 0; own != NULL && p < own->count; p++) {
      const sprout_node *narrowing = sprout_node_map_find(sprout_node_get(own->plays[p].node, "narrows"), role->name);
      if (narrowing == NULL) continue;
      EXPR_NEED(expr_spend(frame));
      if (integer) {
        bool has;
        double min = 0, max = 0;
        range_of(narrowing, &has, &min, &max);
        if (has) EXPR_NEED(add_range(frame, g, min, max));
      } else {
        EXPR_NEED(held_options(frame, g, narrowing, self));
      }
    }
  }
  return SPROUT_EVAL_OK;
}

sprout_eval_status sprout_value_options(sprout_exec *x, const sprout_frame *frame, const sprout_resolved *reading,
                                        const sprout_role_options **out, size_t *count) {
  const sprout_verb *verb = reading->verb;
  const sprout_participant *participants;
  size_t participant_count, i, n = 0;
  sprout_role_options *found;
  *out = NULL;
  *count = 0;
  EXPR_NEED(sprout_participants(x, reading, &participants, &participant_count));
  found = (sprout_role_options *)sprout_arena_take(frame->turn, (verb->role_count + 1) * sizeof *found);
  if (found == NULL) return SPROUT_EVAL_NO_MEMORY;
  for (i = 0; i < verb->role_count; i++) {
    const sprout_role *role = &verb->roles[i];
    growing g;
    if (role->filler != SPROUT_FILLER_INTEGER && role->filler != SPROUT_FILLER_SYMBOL) continue;
    memset(&g, 0, sizeof g);
    EXPR_NEED(options_of(frame, verb, role, participants, participant_count, &g));
    found[n].role = role->name;
    found[n].symbol = role->filler == SPROUT_FILLER_SYMBOL;
    found[n].option_count = g.option_count;
    found[n].options = g.options;
    found[n].range_count = g.range_count;
    found[n].ranges = g.ranges;
    n++;
  }
  *out = found;
  *count = n;
  return SPROUT_EVAL_OK;
}
