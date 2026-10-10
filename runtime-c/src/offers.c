/*
 * What an actor can do where they stand (see offers.h). The verbs are taken in the order the parser
 * tries them, each at its first phrase; for each, every role lists the ways it can be filled, and
 * every combination of one way from each role is an offer, a step apiece, typed by the verb's first
 * phrase that fits.
 */
#include "offers.h"

#include <string.h>

#include "address.h"
#include "describe.h"
#include "expr/expr.h"

/* One way to fill one role: bound, with the words that type it, or left unbound. */
typedef struct filling {
  bool bound;
  sprout_filled filled;
  sprout_str words;
  sprout_str thing; /* a thing filling it, for telling whether one thing fills two roles */
  bool has_thing;
} filling;

typedef struct fillings {
  filling *items;
  size_t count, capacity;
} fillings;

/* What the offers read: the actor, their place, and the things in range they may be offered. */
typedef struct scene {
  sprout_exec *x;
  const sprout_frame *frame;
  sprout_str actor, here;
  const sprout_way *ways;
  size_t way_count;
  const sprout_stored_instance **things;
  bool *carried; /* one for each of `things` */
  size_t thing_count;
  sprout_offer *offers;
  size_t offer_count, offer_capacity;
} scene;

static bool holds_id(const sprout_str *ids, size_t count, sprout_str id) {
  size_t i;
  for (i = 0; i < count; i++)
    if (sprout_str_same(ids[i], id)) return true;
  return false;
}

/*
 * The things in range an actor is offered: all of them but the world and the actor, and in the dark only
 * those the actor carries, which are what they hold and what that holds wherever the walk crossed into it
 * (the spec's Verbs > Carried roles; Range > Sight).
 */
static sprout_eval_status gather(scene *s, const sprout_reached *reached, size_t count) {
  const sprout_frame *frame = s->frame;
  sprout_str *carrying = (sprout_str *)sprout_arena_take(frame->turn, (count + 1) * sizeof *carrying);
  size_t carrying_count = 0, i;
  bool dark;
  s->things = (const sprout_stored_instance **)sprout_arena_take(frame->turn, (count + 1) * sizeof *s->things);
  s->carried = (bool *)sprout_arena_take(frame->turn, (count + 1) * sizeof *s->carried);
  if (carrying == NULL || s->things == NULL || s->carried == NULL) return SPROUT_EVAL_NO_MEMORY;
  carrying[carrying_count++] = s->actor;
  EXPR_NEED(sprout_in_the_dark(frame, s->actor, &dark));
  for (i = 0; i < count; i++) {
    const sprout_stored_instance *instance = expr_instance(frame, reached[i].node);
    bool carried = false;
    if (reached[i].via != SPROUT_VIA_SELF && instance != NULL && instance->has_container &&
        holds_id(carrying, carrying_count, instance->container)) {
      carrying[carrying_count++] = reached[i].node;
      carried = true;
    }
    if (instance == NULL || sprout_str_same(reached[i].node, frame->draft->base->world) ||
        sprout_str_same(reached[i].node, s->actor) || (dark && !carried))
      continue;
    s->things[s->thing_count] = instance;
    s->carried[s->thing_count++] = carried;
  }
  return SPROUT_EVAL_OK;
}

static filling *grow(const sprout_frame *frame, fillings *list) {
  return (filling *)sprout_exec_grow(frame->turn, (void **)&list->items, &list->count, &list->capacity,
                                     sizeof *list->items);
}

/* Whether `instance` may fill `role`: any thing an open role, one composing its kind a kind's. */
static bool fits(const sprout_role *role, const sprout_stored_instance *instance) {
  if (role->filler == SPROUT_FILLER_OPEN) return true;
  if (role->filler == SPROUT_FILLER_KIND) return expr_composes(instance->kind, role->filler_kind->qualified);
  return false;
}

static bool is_value(const sprout_role *role) {
  return role->filler == SPROUT_FILLER_SYMBOL || role->filler == SPROUT_FILLER_INTEGER;
}

/* `go`'s way: each exit and link that applies, an exit by its direction and a link by its label's typed words. */
static sprout_eval_status ways_for(scene *s, fillings *out) {
  size_t i;
  for (i = 0; i < s->way_count; i++) {
    const sprout_way *way = &s->ways[i];
    const char *typed = way->direction;
    filling *slot = grow(s->frame, out);
    if (slot == NULL) return SPROUT_EVAL_NO_MEMORY;
    if (typed == NULL) typed = sprout_node_text(sprout_node_get(sprout_node_get(way->exit, "line"), "label"), "typed");
    if (typed == NULL) return expr_engine(s->frame, "a link's label reached the runtime without the words a visitor types for it.");
    slot->bound = true;
    slot->filled.filled = true;
    slot->filled.bound.kind = SPROUT_BOUND_EXIT;
    slot->filled.bound.has_direction = way->direction != NULL;
    if (way->direction != NULL) slot->filled.bound.direction = (sprout_str){way->direction, strlen(way->direction)};
    slot->filled.bound.label = (sprout_str){way->label, strlen(way->label)};
    slot->filled.bound.to = way->to;
    slot->words = (sprout_str){typed, strlen(typed)};
  }
  return SPROUT_EVAL_OK;
}

/*
 * Whether only the actor plays a part in `role` of `verb`: no kind a spawn may name plays it, each kind a
 * step. `all` never fills such a role with the actor's own place, nor does an offer where the actor's part
 * moves it.
 */
static sprout_eval_status only_the_actor_plays(const sprout_frame *frame, const sprout_verb *verb, const sprout_role *role,
                                               bool *only) {
  const sprout_world *world = frame->world;
  size_t i;
  *only = true;
  for (i = 0; i < world->kind_count; i++) {
    const sprout_play_group *group;
    if (!world->kinds[i]->spawnable) continue;
    EXPR_NEED(expr_spend(frame));
    group = sprout_own_plays(verb, role->name, world->kinds[i]);
    if (group != NULL && group->count > 0) {
      *only = false;
      return SPROUT_EVAL_OK;
    }
  }
  return SPROUT_EVAL_OK;
}

/* The things that fill a role the actor's own place does not: that place fills no role only the actor plays and their own part moves. */
static sprout_eval_status things_for(scene *s, const sprout_verb *verb, const sprout_role *role, fillings *out) {
  size_t i;
  bool own_place = false, here_fits = false;
  bool *fit = (bool *)sprout_arena_take(s->frame->turn, (s->thing_count + 1) * sizeof *fit);
  if (fit == NULL) return SPROUT_EVAL_NO_MEMORY;
  for (i = 0; i < s->thing_count; i++) {
    fit[i] = fits(role, s->things[i]) && (!role->carried || s->carried[i]);
    if (fit[i] && sprout_str_same(s->things[i]->id, s->here)) here_fits = true;
  }
  if (here_fits) {
    bool moves, only = false;
    EXPR_NEED(sprout_moves_its_filler(s->frame, verb, role, s->actor, &moves));
    if (moves) EXPR_NEED(only_the_actor_plays(s->frame, verb, role, &only));
    own_place = moves && only;
  }
  for (i = 0; i < s->thing_count; i++) {
    const sprout_stored_instance *thing = s->things[i];
    filling *slot;
    sprout_str name;
    if (!fit[i] || (own_place && sprout_str_same(thing->id, s->here))) continue;
    slot = grow(s->frame, out);
    if (slot == NULL) return SPROUT_EVAL_NO_MEMORY;
    EXPR_NEED(sprout_name_of(s->frame, thing, &name));
    slot->bound = true;
    slot->filled.filled = true;
    if (role->many) {
      sprout_str *set = (sprout_str *)sprout_arena_take(s->frame->turn, sizeof *set);
      if (set == NULL) return SPROUT_EVAL_NO_MEMORY;
      set[0] = thing->id;
      slot->filled.bound.kind = SPROUT_BOUND_SET;
      slot->filled.bound.set = set;
      slot->filled.bound.set_count = 1;
    } else {
      slot->filled.bound.kind = SPROUT_BOUND_OBJECT;
      slot->filled.bound.object = thing->id;
    }
    slot->words = name;
    slot->thing = thing->id;
    slot->has_thing = true;
  }
  return SPROUT_EVAL_OK;
}

/* The ways each role of `verb` can be filled; a role with none leaves the verb without an offer. */
static sprout_eval_status lists_for(scene *s, const sprout_verb *verb, fillings *lists) {
  size_t r;
  for (r = 0; r < verb->role_count; r++) {
    const sprout_role *role = &verb->roles[r];
    if (role->filler == SPROUT_FILLER_EXIT) {
      EXPR_NEED(ways_for(s, &lists[r]));
    } else if (role->optional || is_value(role)) {
      filling *slot = grow(s->frame, &lists[r]);
      if (slot == NULL) return SPROUT_EVAL_NO_MEMORY;
    } else {
      EXPR_NEED(things_for(s, verb, role, &lists[r]));
    }
  }
  return SPROUT_EVAL_OK;
}

/* Whether one thing fills two of an offer's roles. */
static bool fills_twice(const fillings *lists, const size_t *at, size_t role_count) {
  size_t i, j;
  for (i = 0; i < role_count; i++) {
    const filling *a = &lists[i].items[at[i]];
    if (!a->has_thing) continue;
    for (j = i + 1; j < role_count; j++) {
      const filling *b = &lists[j].items[at[j]];
      if (b->has_thing && sprout_str_same(a->thing, b->thing)) return true;
    }
  }
  return false;
}

/* Whether `phrase` types every role the combination binds, and has no slot for one it leaves unbound but a value role's. */
static bool types_all(const sprout_typed_phrase *phrase, const sprout_verb *verb, const fillings *lists, const size_t *at) {
  size_t r, p;
  for (r = 0; r < verb->role_count; r++) {
    bool slot = false;
    for (p = 0; p < phrase->part_count; p++)
      if (phrase->parts[p].is_slot && phrase->parts[p].role == r) slot = true;
    if (!lists[r].items[at[r]].bound ? !(is_value(&verb->roles[r]) || !slot) : !slot) return false;
  }
  return true;
}

/* The line a phrase types with the combination in its slots, a value role's written as `…`. */
static const char *typed_line(const sprout_frame *frame, const sprout_typed_phrase *phrase, const fillings *lists,
                              const size_t *at) {
  static const char ellipsis[] = "\xe2\x80\xa6";
  size_t length = 0, p, w, written = 0;
  char *out;
  for (p = 0; p < phrase->part_count; p++) {
    const sprout_typed_part *part = &phrase->parts[p];
    length += 1;
    if (part->is_slot) {
      const filling *held = &lists[part->role].items[at[part->role]];
      length += held->bound ? held->words.length : sizeof ellipsis - 1;
    } else {
      for (w = 0; w < part->word_count; w++) length += strlen(part->words[w]) + 1;
    }
  }
  out = (char *)sprout_arena_take(frame->turn, length + 1);
  if (out == NULL) return NULL;
  for (p = 0; p < phrase->part_count; p++) {
    const sprout_typed_part *part = &phrase->parts[p];
    if (p > 0) out[written++] = ' ';
    if (part->is_slot) {
      const filling *held = &lists[part->role].items[at[part->role]];
      const char *bytes = held->bound ? held->words.bytes : ellipsis;
      size_t n = held->bound ? held->words.length : sizeof ellipsis - 1;
      memcpy(out + written, bytes, n);
      written += n;
    } else {
      for (w = 0; w < part->word_count; w++) {
        size_t n = strlen(part->words[w]);
        if (w > 0) out[written++] = ' ';
        memcpy(out + written, part->words[w], n);
        written += n;
      }
    }
  }
  out[written] = '\0';
  return out;
}

/* The offer one combination makes, if a phrase of the verb types it; *made is false where none does. */
static sprout_eval_status offer_for(scene *s, const sprout_verb *verb, const fillings *lists, const size_t *at,
                                    bool *made) {
  const sprout_world *world = s->frame->world;
  const sprout_typed_phrase *phrase = NULL;
  sprout_filled *roles;
  sprout_offer *offer;
  size_t i, r;
  *made = false;
  for (i = 0; i < world->phrase_count && phrase == NULL; i++)
    if (world->phrases[i].verb == verb && types_all(&world->phrases[i], verb, lists, at)) phrase = &world->phrases[i];
  if (phrase == NULL) return SPROUT_EVAL_OK;
  roles = (sprout_filled *)sprout_arena_take(s->frame->turn, (verb->role_count + 1) * sizeof *roles);
  offer = (sprout_offer *)sprout_exec_grow(s->frame->turn, (void **)&s->offers, &s->offer_count, &s->offer_capacity,
                                           sizeof *offer);
  if (roles == NULL || offer == NULL) return SPROUT_EVAL_NO_MEMORY;
  for (r = 0; r < verb->role_count; r++) roles[r] = lists[r].items[at[r]].filled;
  offer->reading.verb = verb;
  offer->reading.actor = s->actor;
  offer->reading.roles = roles;
  offer->typed = typed_line(s->frame, phrase, lists, at);
  if (offer->typed == NULL) return SPROUT_EVAL_NO_MEMORY;
  EXPR_NEED(sprout_consent_pass(s->x, s->frame, &offer->reading, &offer->refused, &offer->refusal));
  if (!offer->refused) EXPR_NEED(sprout_inside_itself(s->x, s->frame, &offer->reading, &offer->refused, &offer->refusal));
  *made = true;
  return SPROUT_EVAL_OK;
}

/* Every offer of one verb: each combination of one way from each role, a step apiece. */
static sprout_eval_status offers_of(scene *s, const sprout_verb *verb) {
  size_t role_count = verb->role_count, r;
  fillings *lists = (fillings *)sprout_arena_take(s->frame->turn, (role_count + 1) * sizeof *lists);
  size_t *at = (size_t *)sprout_arena_take(s->frame->turn, (role_count + 1) * sizeof *at);
  if (lists == NULL || at == NULL) return SPROUT_EVAL_NO_MEMORY;
  EXPR_NEED(lists_for(s, verb, lists));
  for (r = 0; r < role_count; r++)
    if (lists[r].count == 0) return SPROUT_EVAL_OK;
  for (;;) {
    bool made;
    EXPR_NEED(expr_spend(s->frame));
    if (!fills_twice(lists, at, role_count)) EXPR_NEED(offer_for(s, verb, lists, at, &made));
    for (r = role_count; r > 0; r--) {
      if (++at[r - 1] < lists[r - 1].count) break;
      at[r - 1] = 0;
    }
    if (r == 0) return SPROUT_EVAL_OK;
  }
}

sprout_eval_status sprout_offers_to(sprout_exec *x, const sprout_frame *frame, sprout_str actor, const sprout_way *ways,
                                    size_t way_count, const sprout_reached *reached, size_t reached_count,
                                    const sprout_offer **out, size_t *count) {
  const sprout_world *world = frame->world;
  const sprout_stored_instance *self = expr_instance(frame, actor);
  scene s;
  bool *done;
  size_t i, j;
  *out = NULL;
  *count = 0;
  if (self == NULL || !self->has_container) return expr_engine(frame, "an away visitor can do nothing.");
  memset(&s, 0, sizeof s);
  s.x = x;
  s.frame = frame;
  s.actor = actor;
  s.here = self->container;
  s.ways = ways;
  s.way_count = way_count;
  EXPR_NEED(gather(&s, reached, reached_count));
  done = (bool *)sprout_arena_take(frame->turn, (world->phrase_count + 1) * sizeof *done);
  if (done == NULL) return SPROUT_EVAL_NO_MEMORY;
  for (i = 0; i < world->phrase_count; i++) {
    if (done[i]) continue;
    for (j = i; j < world->phrase_count; j++)
      if (world->phrases[j].verb == world->phrases[i].verb) done[j] = true;
    EXPR_NEED(offers_of(&s, world->phrases[i].verb));
  }
  *out = s.offers;
  *count = s.offer_count;
  return SPROUT_EVAL_OK;
}
