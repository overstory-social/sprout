/*
 * An item of a run read on its own turn (the spec's Parsing > Sequences, again and all): where an item named nothing
 * in reach, or named things that tie, the line planned its reading with every other role filled as the line began,
 * and only the item's words are read afresh, against the world as this turn finds it. So a pronoun in another role
 * still names what it named when the line was typed, and the item's own answer, draw and `meant` belong to its own
 * turn. A value role's words bind against what the item names. What the line bound must still be in reach, or the
 * turn is `not_here`, as a planned turn's is. The item is answered as any line's noun is: `not_here` where it names
 * nothing in reach, `not_carrying` where a carried role names only what the actor does not carry, and `cannot` where
 * what it names cannot fill the role, written through a phrase of the verb as the visitor would type it.
 */
#include <string.h>

#include "../expr/expr.h"
#include "../typed.h"
#include "../values.h"
#include "parse.h"

/* What reading the item reads besides its words: the turn, who typed it, the reading the line planned, and the item. */
typedef struct item {
  sprout_exec *x;
  const sprout_frame *frame;
  sprout_str actor;
  const parse_reading *within;
  const sprout_reread *reread;
  size_t role;
} item;

/* Sets `role` to `bound` in `reading`, in place where it binds the role already, else after what it binds. */
static void bind(parse_reading *reading, size_t *roles, sprout_stored_bound *bounds, size_t role,
                 const sprout_stored_bound *bound) {
  size_t i;
  for (i = 0; i < reading->count && roles[i] != role; i++) continue;
  roles[i] = role;
  bounds[i] = *bound;
  if (i == reading->count) reading->count++;
}

/* `within` with the item's role bound to `bound`, then each value role bound from its words against what that names. */
static sprout_eval_status filled_with(const item *it, const sprout_stored_bound *bound, parse_reading *out) {
  const parse_reading *within = it->within;
  const sprout_verb *verb = within->verb;
  size_t room = within->count + 1 + it->reread->value_count, i, r;
  size_t *roles = (size_t *)sprout_arena_take(it->frame->turn, (room + 1) * sizeof *roles);
  sprout_stored_bound *bounds = (sprout_stored_bound *)sprout_arena_take(it->frame->turn, (room + 1) * sizeof *bounds);
  sprout_resolved things;
  if (roles == NULL || bounds == NULL) return SPROUT_EVAL_NO_MEMORY;
  *out = *within;
  out->actor = it->actor;
  out->roles = roles;
  out->bounds = bounds;
  for (i = 0; i < within->count; i++) {
    roles[i] = within->roles[i];
    bounds[i] = within->bounds[i];
  }
  bind(out, roles, bounds, it->role, bound);
  EXPR_NEED(parse_resolved_of(it->frame, out, &things));
  for (i = 0; i < it->reread->value_count; i++) {
    const sprout_reread_value *value = &it->reread->values[i];
    sprout_str *typed;
    size_t count;
    parse_words words;
    sprout_stored_bound heard;
    bool is_heard;
    for (r = 0; r < verb->role_count && strcmp(verb->roles[r].name, value->role) != 0; r++) continue;
    if (r == verb->role_count) continue;
    if (typed_words(it->frame->turn, (sprout_str){value->words, strlen(value->words)}, &typed, &count) != SPROUT_OK)
      return SPROUT_EVAL_NO_MEMORY;
    words.words = typed;
    words.count = count;
    EXPR_NEED(parse_value_of(it->x, it->frame, &things, &verb->roles[r], words, &is_heard, &heard));
    if (is_heard) bind(out, roles, bounds, r, &heard);
  }
  return SPROUT_EVAL_OK;
}

/* One way the item's words fill its role, ranked as a line's reading is, its consent pass asked; a step. */
static sprout_eval_status ranked_of(const item *it, const parse_filled *filled, size_t at, parse_ranked *out) {
  sprout_stored_bound bound;
  parse_pronoun_thing *pronouns;
  size_t *near = (size_t *)sprout_arena_take(it->frame->turn, sizeof *near);
  size_t i, count = 0;
  const parse_named *named = NULL;
  const parse_named_set *set = NULL;
  if (near == NULL) return SPROUT_EVAL_NO_MEMORY;
  EXPR_NEED(expr_spend(it->frame));
  memset(out, 0, sizeof *out);
  memset(&bound, 0, sizeof bound);
  if (filled->way != NULL) {
    const sprout_way *way = filled->way;
    bound.kind = SPROUT_BOUND_EXIT;
    bound.has_direction = way->direction != NULL;
    if (way->direction != NULL) bound.direction = (sprout_str){way->direction, strlen(way->direction)};
    bound.label = (sprout_str){way->label, strlen(way->label)};
    bound.to = way->to;
    out->literal = filled->literal;
    *near = 0;
  } else if (filled->set_count > 0) {
    set = &filled->sets[at];
    bound.kind = SPROUT_BOUND_SET;
    bound.set = (sprout_str *)sprout_arena_take(it->frame->turn, (set->count + 1) * sizeof *bound.set);
    if (bound.set == NULL) return SPROUT_EVAL_NO_MEMORY;
    for (i = 0; i < set->count; i++) bound.set[i] = set->things[i]->instance->id;
    bound.set_count = set->count;
    out->literal = set->literal;
    out->by_name = set->by_name;
    *near = set->near;
    count = set->pronoun_count;
  } else {
    named = &filled->things[at];
    bound.kind = SPROUT_BOUND_OBJECT;
    bound.object = named->candidate->instance->id;
    out->literal = named->literal;
    out->by_name = named->by_name ? 1 : 0;
    *near = named->near;
    count = named->pronoun != PARSE_PRONOUN_NONE ? 1 : 0;
  }
  pronouns = (parse_pronoun_thing *)sprout_arena_take(it->frame->turn, (count + 1) * sizeof *pronouns);
  if (pronouns == NULL) return SPROUT_EVAL_NO_MEMORY;
  for (i = 0; i < count; i++) {
    const parse_named *one = set != NULL ? &set->pronouns[i] : named;
    pronouns[i].id = one->candidate->instance->id;
    pronouns[i].pronoun = one->pronoun;
  }
  EXPR_NEED(filled_with(it, &bound, &out->reading));
  EXPR_NEED(parse_allows(it->x, it->frame, &out->reading, &out->allowed));
  out->near = near;
  out->near_count = 1;
  out->pronouns = pronouns;
  out->pronoun_count = count;
  out->whole = true;
  return SPROUT_EVAL_OK;
}

/* A growing run of bytes in the turn arena. */
typedef struct text {
  sprout_arena *arena;
  char *bytes;
  size_t length, capacity;
} text;

static bool put(text *t, const char *bytes, size_t length) {
  if (t->length + length + 1 > t->capacity) {
    size_t capacity = (t->length + length + 1) * 2;
    char *grown = (char *)sprout_arena_take_aligned(t->arena, capacity, 1);
    if (grown == NULL) return false;
    if (t->length > 0) memcpy(grown, t->bytes, t->length);
    t->bytes = grown;
    t->capacity = capacity;
  }
  memcpy(t->bytes + t->length, bytes, length);
  t->length += length;
  t->bytes[t->length] = '\0';
  return true;
}

/* A thing as a visitor names it in a line. */
static sprout_eval_status definite(const sprout_frame *frame, text *t, sprout_str id) {
  const sprout_stored_instance *instance = expr_instance(frame, id);
  parse_address address;
  sprout_str named;
  if (instance == NULL) return expr_engine(frame, "an item's reading names what is not an instance.");
  EXPR_NEED(parse_address_of(frame, instance, &address));
  if (!parse_definite(frame->turn, &address, &named) || !put(t, named.bytes, named.length)) return SPROUT_EVAL_NO_MEMORY;
  return SPROUT_EVAL_OK;
}

/* What `bound` fills a slot with, as a visitor types it: a value humanised, a thing, a set's things joined by `and`, a way out by its direction or label. */
static sprout_eval_status bound_words(const sprout_frame *frame, text *t, const sprout_stored_bound *bound) {
  size_t i;
  char number[64];
  size_t length;
  switch (bound->kind) {
    case SPROUT_BOUND_VALUE:
      if (!bound->value_is_string) {
        if (!sprout_number_text(bound->value_number, number, sizeof number, &length) || !put(t, number, length))
          return SPROUT_EVAL_NO_MEMORY;
        return SPROUT_EVAL_OK;
      }
      for (i = 0; i < bound->value_string.length; i++) {
        char c = bound->value_string.bytes[i] == '_' ? ' ' : bound->value_string.bytes[i];
        if (!put(t, &c, 1)) return SPROUT_EVAL_NO_MEMORY;
      }
      return SPROUT_EVAL_OK;
    case SPROUT_BOUND_OBJECT:
      return definite(frame, t, bound->object);
    case SPROUT_BOUND_SET:
      for (i = 0; i < bound->set_count; i++) {
        if (i > 0 && !put(t, " and ", 5)) return SPROUT_EVAL_NO_MEMORY;
        EXPR_NEED(definite(frame, t, bound->set[i]));
      }
      return SPROUT_EVAL_OK;
    case SPROUT_BOUND_EXIT: {
      sprout_str way = bound->has_direction ? bound->direction : bound->label;
      return put(t, way.bytes, way.length) ? SPROUT_EVAL_OK : SPROUT_EVAL_NO_MEMORY;
    }
  }
  return SPROUT_EVAL_OK;
}

static const sprout_stored_bound *bound_in(const parse_reading *reading, size_t role) {
  size_t i;
  for (i = 0; i < reading->count; i++)
    if (reading->roles[i] == role) return &reading->bounds[i];
  return NULL;
}

/* `reading` written through `phrase`, its slots' words in order, a slot it leaves unbound left out. */
static sprout_eval_status written_through(const sprout_frame *frame, const sprout_typed_phrase *phrase,
                                          const parse_reading *reading, text *t) {
  size_t p, w;
  for (p = 0; p < phrase->part_count; p++) {
    const sprout_typed_part *part = &phrase->parts[p];
    const sprout_stored_bound *bound = part->is_slot ? bound_in(reading, part->role) : NULL;
    if (part->is_slot && bound == NULL) continue;
    if (t->length > 0 && !put(t, " ", 1)) return SPROUT_EVAL_NO_MEMORY;
    if (part->is_slot) {
      size_t before = t->length;
      EXPR_NEED(bound_words(frame, t, bound));
      /* A slot whose words are none adds no word, and no space before it. */
      if (t->length == before && before > 0) t->bytes[--t->length] = '\0';
      continue;
    }
    for (w = 0; w < part->word_count; w++)
      if ((w > 0 && !put(t, " ", 1)) || !put(t, part->words[w], strlen(part->words[w]))) return SPROUT_EVAL_NO_MEMORY;
  }
  return SPROUT_EVAL_OK;
}

/*
 * `reading` as a visitor would type it, through the first phrase of its verb that writes the item's role and leaves
 * the fewest of its slots unfilled, each phrase a step; the verb's name where none does.
 */
static sprout_eval_status written(const item *it, const parse_reading *reading, sprout_str *out) {
  const sprout_world *world = it->frame->world;
  const sprout_typed_phrase *best = NULL;
  size_t i, p, fewest = 0;
  text t;
  for (i = 0; i < world->phrase_count; i++) {
    const sprout_typed_phrase *phrase = &world->phrases[i];
    size_t unfilled = 0;
    bool writes = false;
    EXPR_NEED(expr_spend(it->frame));
    if (phrase->only != NULL || phrase->verb != reading->verb) continue;
    for (p = 0; p < phrase->part_count; p++) {
      if (!phrase->parts[p].is_slot) continue;
      if (phrase->parts[p].role == it->role) writes = true;
      if (bound_in(reading, phrase->parts[p].role) == NULL) unfilled++;
    }
    if (!writes || (best != NULL && fewest <= unfilled)) continue;
    best = phrase;
    fewest = unfilled;
  }
  memset(&t, 0, sizeof t);
  t.arena = it->frame->turn;
  if (best == NULL) {
    if (!put(&t, reading->verb->name, strlen(reading->verb->name))) return SPROUT_EVAL_NO_MEMORY;
  } else {
    EXPR_NEED(written_through(it->frame, best, reading, &t));
  }
  out->bytes = t.bytes == NULL ? "" : t.bytes;
  out->length = t.length;
  return SPROUT_EVAL_OK;
}

sprout_eval_status parse_read_item(sprout_exec *x, const sprout_frame *frame, sprout_str actor,
                                   const parse_reading *within, const sprout_reread *reread, const sprout_way *ways,
                                   size_t way_count, parse_item_read *out) {
  const sprout_verb *verb = within->verb;
  item it;
  sprout_str *typed, *referents;
  size_t count, candidate_count, i;
  parse_candidate *candidates;
  parse_fill_context fill;
  parse_filled filled;
  parse_words words;
  sprout_stored_bound first;
  parse_reading reading;
  memset(out, 0, sizeof *out);
  it.x = x;
  it.frame = frame;
  it.actor = actor;
  it.within = within;
  it.reread = reread;
  for (it.role = 0; it.role < verb->role_count && strcmp(verb->roles[it.role].name, reread->role) != 0; it.role++)
    continue;
  if (typed_words(frame->turn, (sprout_str){reread->words, strlen(reread->words)}, &typed, &count) != SPROUT_OK)
    return SPROUT_EVAL_NO_MEMORY;
  if (it.role == verb->role_count || count == 0) {
    out->answer = "unknown";
    return SPROUT_EVAL_OK;
  }
  EXPR_NEED(parse_reach_of(frame, actor, &candidates, &candidate_count));
  /* What the line bound must still be in reach, as a planned turn's must. */
  if (!parse_in_reach(within, candidates, candidate_count, ways, way_count)) {
    out->answer = "not_here";
    return SPROUT_EVAL_OK;
  }
  referents = (sprout_str *)sprout_arena_take(frame->turn, (reread->referent_count + 1) * sizeof *referents);
  if (referents == NULL) return SPROUT_EVAL_NO_MEMORY;
  for (i = 0; i < reread->referent_count; i++)
    referents[i] = (sprout_str){reread->referents[i], strlen(reread->referents[i])};
  fill.nouns.frame = frame;
  fill.nouns.referents = referents;
  fill.nouns.referent_count = reread->referent_count;
  fill.candidates = candidates;
  fill.candidate_count = candidate_count;
  fill.ways = ways;
  fill.way_count = way_count;
  words.words = typed;
  words.count = count;
  EXPR_NEED(parse_fill_slot(&fill, &verb->roles[it.role], words, &filled));
  if (filled.fills == PARSE_FILLS_OPTIONS) {
    size_t options = filled.way != NULL ? 1 : filled.set_count > 0 ? filled.set_count : filled.thing_count;
    out->readings.ranked = (parse_ranked *)sprout_arena_take(frame->turn, (options + 1) * sizeof *out->readings.ranked);
    if (out->readings.ranked == NULL) return SPROUT_EVAL_NO_MEMORY;
    for (i = 0; i < options; i++) EXPR_NEED(ranked_of(&it, &filled, i, &out->readings.ranked[i]));
    out->readings.count = out->readings.capacity = options;
    return SPROUT_EVAL_OK;
  }
  if ((filled.fills != PARSE_FILLS_OUTWARD && filled.fills != PARSE_FILLS_UNFIT) || filled.thing_count == 0) {
    out->answer = "not_here";
    return SPROUT_EVAL_OK;
  }
  out->given = true;
  if (filled.fills == PARSE_FILLS_OUTWARD) {
    out->answer = "not_carrying";
    out->binding.name = "thing";
    out->binding.object = true;
    out->binding.text = filled.things[0].candidate->instance->id;
    return SPROUT_EVAL_OK;
  }
  memset(&first, 0, sizeof first);
  first.kind = SPROUT_BOUND_OBJECT;
  first.object = filled.things[0].candidate->instance->id;
  EXPR_NEED(filled_with(&it, &first, &reading));
  out->answer = "cannot";
  out->binding.name = "reading";
  return written(&it, &reading, &out->binding.text);
}
