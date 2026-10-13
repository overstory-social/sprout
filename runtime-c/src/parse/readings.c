/*
 * The readings one placement of a phrase makes (the spec's Parsing > Matching a line, Choosing a reading; Verbs >
 * Value roles; Parsing > Sequences, again and all): every way of taking one option from each slot's, in order, the
 * last slot's turning fastest, each a step. A value role's words bind once the reading's things are bound, since who
 * hears a value depends on them. `all` in a role that takes one thing makes a reading for each thing it takes that no
 * other slot names and whose consent pass allows, at most a set role's figure; the first is ranked, the rest run
 * after it. One reading made two ways is one reading, the way that matched more words, kept where it was first made,
 * since the order readings tie in is the order they were made.
 */
#include <string.h>

#include "../expr/expr.h"
#include "parse.h"

/* One slot's part in one reading: what it binds and how near and literally, or a value role's words. */
typedef struct option {
  bool words;
  sprout_stored_bound bound;
  size_t near, literal, by_name;
  size_t pronoun_count;
  const parse_named *pronouns;
} option;

static parse_words slot_words(const parse_placement *p, size_t slot) {
  parse_words words;
  words.words = p->words.words + p->spans[slot].start;
  words.count = p->spans[slot].end - p->spans[slot].start;
  return words;
}

/* How many options a slot's fill gives: `all` and a value role's words one each. */
static size_t options_in(const parse_filled *filled) {
  switch (filled->fills) {
    case PARSE_FILLS_OPTIONS:
      return filled->way != NULL ? 1 : filled->set_count > 0 ? filled->set_count : filled->thing_count;
    case PARSE_FILLS_RUN:
      return filled->thing_count;
    case PARSE_FILLS_ALL:
    case PARSE_FILLS_WORDS:
      return 1;
    default:
      return 0;
  }
}

static void thing_option(const parse_named *thing, option *out) {
  out->bound.kind = SPROUT_BOUND_OBJECT;
  out->bound.object = thing->candidate->instance->id;
  out->near = thing->near;
  out->literal = thing->literal;
  out->by_name = thing->by_name ? 1 : 0;
  if (thing->pronoun != PARSE_PRONOUN_NONE) {
    out->pronouns = thing;
    out->pronoun_count = 1;
  }
}

/* The `index`th option of a slot; `all` gives its first thing. */
static sprout_eval_status option_at(const sprout_frame *frame, const parse_placement *p, size_t slot, size_t index,
                                    option *out) {
  const parse_filled *filled = p->fills[slot];
  memset(out, 0, sizeof *out);
  if (filled->fills == PARSE_FILLS_WORDS) {
    out->words = true;
    out->literal = slot_words(p, slot).count;
  } else if (filled->fills == PARSE_FILLS_OPTIONS && filled->way != NULL) {
    const sprout_way *way = filled->way;
    out->bound.kind = SPROUT_BOUND_EXIT;
    out->bound.has_direction = way->direction != NULL;
    if (way->direction != NULL) out->bound.direction = (sprout_str){way->direction, strlen(way->direction)};
    out->bound.label = (sprout_str){way->label, strlen(way->label)};
    out->bound.to = way->to;
    out->literal = filled->literal;
  } else if (filled->fills == PARSE_FILLS_OPTIONS && filled->set_count > 0) {
    const parse_named_set *set = &filled->sets[index];
    sprout_str *ids = (sprout_str *)sprout_arena_take(frame->turn, (set->count + 1) * sizeof *ids);
    size_t i;
    if (ids == NULL) return SPROUT_EVAL_NO_MEMORY;
    for (i = 0; i < set->count; i++) ids[i] = set->things[i]->instance->id;
    out->bound.kind = SPROUT_BOUND_SET;
    out->bound.set = ids;
    out->bound.set_count = set->count;
    out->near = set->near;
    out->literal = set->literal;
    out->by_name = set->by_name;
    out->pronouns = set->pronouns;
    out->pronoun_count = set->pronoun_count;
  } else {
    thing_option(&filled->things[filled->fills == PARSE_FILLS_ALL ? 0 : index], out);
  }
  return SPROUT_EVAL_OK;
}

sprout_eval_status parse_resolved_of(const sprout_frame *frame, const parse_reading *reading, sprout_resolved *out) {
  sprout_filled *roles = (sprout_filled *)sprout_arena_take(frame->turn, (reading->verb->role_count + 1) * sizeof *roles);
  size_t i;
  if (roles == NULL) return SPROUT_EVAL_NO_MEMORY;
  for (i = 0; i < reading->count; i++) {
    roles[reading->roles[i]].filled = true;
    roles[reading->roles[i]].bound = reading->bounds[i];
  }
  out->verb = reading->verb;
  out->actor = reading->actor;
  out->roles = roles;
  out->bound_count = reading->count;
  out->bound_order = reading->roles;
  return SPROUT_EVAL_OK;
}

sprout_eval_status parse_allows(sprout_exec *x, const sprout_frame *frame, const parse_reading *reading, bool *allowed) {
  sprout_resolved resolved;
  sprout_permit_refusal refusal;
  bool refused;
  EXPR_NEED(parse_resolved_of(frame, reading, &resolved));
  EXPR_NEED(sprout_consent_pass(x, frame, &resolved, &refused, &refusal));
  *allowed = !refused;
  return SPROUT_EVAL_OK;
}

sprout_eval_status parse_reading_of(sprout_exec *x, const sprout_frame *frame, sprout_str actor,
                                    const parse_placement *p, const bool *words, const sprout_stored_bound *given,
                                    parse_reading *out) {
  size_t *roles = (size_t *)sprout_arena_take(frame->turn, (p->count + 1) * sizeof *roles);
  sprout_stored_bound *bounds = (sprout_stored_bound *)sprout_arena_take(frame->turn, (p->count + 1) * sizeof *bounds);
  sprout_resolved things;
  size_t i;
  if (roles == NULL || bounds == NULL) return SPROUT_EVAL_NO_MEMORY;
  memset(out, 0, sizeof *out);
  out->verb = p->phrase->verb;
  out->actor = actor;
  out->roles = roles;
  out->bounds = bounds;
  for (i = 0; i < p->count; i++) {
    if (words[i]) continue;
    roles[out->count] = p->spans[i].role;
    bounds[out->count++] = given[i];
  }
  if (out->count == p->count) return SPROUT_EVAL_OK;
  EXPR_NEED(parse_resolved_of(frame, out, &things));
  for (i = 0; i < p->count; i++) {
    bool bound;
    if (!words[i]) continue;
    EXPR_NEED(parse_value_of(x, frame, &things, &out->verb->roles[p->spans[i].role], slot_words(p, i), &bound,
                             &bounds[out->count]));
    if (bound) roles[out->count++] = p->spans[i].role;
  }
  return SPROUT_EVAL_OK;
}

/* The reading a verb's placement makes with each slot filled by `options`. */
static sprout_eval_status reading_of(sprout_exec *x, const sprout_frame *frame, sprout_str actor, const parse_placement *p,
                                     const option *options, parse_reading *out) {
  bool *words = (bool *)sprout_arena_take(frame->turn, (p->count + 1) * sizeof *words);
  sprout_stored_bound *bounds = (sprout_stored_bound *)sprout_arena_take(frame->turn, (p->count + 1) * sizeof *bounds);
  size_t i;
  if (words == NULL || bounds == NULL) return SPROUT_EVAL_NO_MEMORY;
  for (i = 0; i < p->count; i++) {
    words[i] = options[i].words;
    bounds[i] = options[i].bound;
  }
  return parse_reading_of(x, frame, actor, p, words, bounds, out);
}

static bool names_object(const option *options, size_t count, size_t but, sprout_str id) {
  size_t i, j;
  for (i = 0; i < count; i++) {
    if (i == but || options[i].words) continue;
    if (options[i].bound.kind == SPROUT_BOUND_OBJECT && sprout_str_same(options[i].bound.object, id)) return true;
    if (options[i].bound.kind == SPROUT_BOUND_SET)
      for (j = 0; j < options[i].bound.set_count; j++)
        if (sprout_str_same(options[i].bound.set[j], id)) return true;
  }
  return false;
}

/*
 * The readings one choice makes: the one it fills every slot with, or, where a slot is `all`, one for each thing it
 * takes that no other slot names, each a step, of which those whose consent pass allows are kept, the first a set
 * role's figure of them, none asked past it.
 */
static sprout_eval_status each_of(sprout_exec *x, const sprout_frame *frame, sprout_str actor, const parse_placement *p,
                                  option *options, parse_reading **out, size_t *count) {
  const parse_filled *all = NULL;
  const sprout_limit *cap = &frame->meter->budgets->set_role_objects;
  parse_reading *made;
  size_t at, i, n = 0, kept = 0;
  option first;
  for (at = 0; at < p->count && all == NULL; at++)
    if (p->fills[at]->fills == PARSE_FILLS_ALL) all = p->fills[at];
  made = (parse_reading *)sprout_arena_take(frame->turn, ((all == NULL ? 1 : all->thing_count) + 1) * sizeof *made);
  if (made == NULL) return SPROUT_EVAL_NO_MEMORY;
  *out = made;
  if (all == NULL) {
    *count = 1;
    return reading_of(x, frame, actor, p, options, &made[0]);
  }
  at--;
  first = options[at];
  for (i = 0; i < all->thing_count; i++) {
    if (names_object(options, p->count, at, all->things[i].candidate->instance->id)) continue;
    EXPR_NEED(expr_spend(frame));
    thing_option(&all->things[i], &options[at]);
    EXPR_NEED(reading_of(x, frame, actor, p, options, &made[n++]));
  }
  options[at] = first;
  for (i = 0; i < n; i++) {
    bool allowed;
    if (cap->set && kept >= cap->value) break;
    EXPR_NEED(parse_allows(x, frame, &made[i], &allowed));
    if (allowed) made[kept++] = made[i];
  }
  *count = kept;
  return SPROUT_EVAL_OK;
}

static bool bound_same(const sprout_stored_bound *a, const sprout_stored_bound *b) {
  size_t i;
  if (a->kind != b->kind) return false;
  switch (a->kind) {
    case SPROUT_BOUND_OBJECT:
      return sprout_str_same(a->object, b->object);
    case SPROUT_BOUND_SET:
      if (a->set_count != b->set_count) return false;
      for (i = 0; i < a->set_count; i++)
        if (!sprout_str_same(a->set[i], b->set[i])) return false;
      return true;
    case SPROUT_BOUND_EXIT:
      return a->has_direction == b->has_direction && (!a->has_direction || sprout_str_same(a->direction, b->direction)) &&
             sprout_str_same(a->label, b->label) && sprout_str_same(a->to, b->to);
    case SPROUT_BOUND_VALUE:
      return a->value_is_string == b->value_is_string &&
             (a->value_is_string ? sprout_str_same(a->value_string, b->value_string) : a->value_number == b->value_number);
  }
  return false;
}

/* Whether two readings are one: the same verb or intent, binding the same roles to the same, in the same order. */
static bool same_reading(const parse_reading *a, const parse_reading *b) {
  size_t i;
  if (a->verb != b->verb || a->intent != b->intent || a->count != b->count) return false;
  for (i = 0; i < a->count; i++)
    if (a->roles[i] != b->roles[i] || !bound_same(&a->bounds[i], &b->bounds[i])) return false;
  return true;
}

/* `bound` with what it holds in the phrase's scratch, a set's ids and a value's words, copied into `keep`. */
static bool kept_bound(sprout_arena *keep, sprout_stored_bound *bound) {
  if (bound->kind == SPROUT_BOUND_SET) {
    sprout_str *set = (sprout_str *)sprout_arena_take(keep, (bound->set_count + 1) * sizeof *set);
    if (set == NULL) return false;
    if (bound->set_count > 0) memcpy(set, bound->set, bound->set_count * sizeof *set);
    bound->set = set;
  }
  if (bound->kind == SPROUT_BOUND_VALUE && bound->value_is_string) {
    bound->value_string.bytes = sprout_arena_copy(keep, bound->value_string.bytes, bound->value_string.length);
    if (bound->value_string.bytes == NULL) return false;
  }
  return true;
}

/* `reading` copied into `keep`, with what it binds that the phrase's scratch holds: a set's ids and an option's words. */
static bool kept_reading(sprout_arena *keep, const parse_reading *reading, parse_reading *out) {
  size_t *roles = (size_t *)sprout_arena_take(keep, (reading->count + 1) * sizeof *roles);
  sprout_stored_bound *bounds = (sprout_stored_bound *)sprout_arena_take(keep, (reading->count + 1) * sizeof *bounds);
  size_t i;
  if (roles == NULL || bounds == NULL) return false;
  *out = *reading;
  for (i = 0; i < reading->count; i++) {
    roles[i] = reading->roles[i];
    bounds[i] = reading->bounds[i];
    if (!kept_bound(keep, &bounds[i])) return false;
  }
  out->roles = roles;
  out->bounds = bounds;
  return true;
}

/* A run's plan copied out of the phrase's scratch into `keep`: its slots, and each later item's things. */
static const parse_run *kept_run(sprout_arena *keep, const parse_run *run) {
  parse_run *made = (parse_run *)sprout_arena_take(keep, sizeof *made);
  parse_span *spans = (parse_span *)sprout_arena_take(keep, (run->count + 1) * sizeof *spans);
  bool *words = (bool *)sprout_arena_take(keep, (run->count + 1) * sizeof *words);
  sprout_stored_bound *bounds = (sprout_stored_bound *)sprout_arena_take(keep, (run->count + 1) * sizeof *bounds);
  parse_later *later = (parse_later *)sprout_arena_take(keep, (run->later_count + 1) * sizeof *later);
  size_t i;
  if (made == NULL || spans == NULL || words == NULL || bounds == NULL || later == NULL) return NULL;
  *made = *run;
  for (i = 0; i < run->count; i++) {
    spans[i] = run->spans[i];
    words[i] = run->words[i];
    bounds[i] = run->bounds[i];
    if (!words[i] && !kept_bound(keep, &bounds[i])) return NULL;
  }
  for (i = 0; i < run->later_count; i++) {
    parse_named *things = (parse_named *)sprout_arena_take(keep, (run->later[i].filled.thing_count + 1) * sizeof *things);
    if (things == NULL) return NULL;
    later[i] = run->later[i];
    if (later[i].filled.thing_count > 0)
      memcpy(things, later[i].filled.things, later[i].filled.thing_count * sizeof *things);
    /* An item of a run in a role that takes one thing fills it with things, or not at all. */
    later[i].filled.things = things;
    later[i].filled.sets = NULL;
    later[i].filled.set_count = 0;
    later[i].filled.later = NULL;
    later[i].filled.later_count = 0;
  }
  made->spans = spans;
  made->words = words;
  made->bounds = bounds;
  made->later = later;
  return made;
}

/* `ranked`, made in scratch, kept: added where its reading is new, or in place of the same one matched by fewer words. */
static sprout_eval_status keep_ranked(sprout_arena *keep, const parse_ranked *ranked, parse_readings *readings) {
  parse_ranked *slot = NULL, made = *ranked;
  size_t *near, i;
  parse_pronoun_thing *pronouns;
  parse_reading *rest;
  for (i = 0; i < readings->count && slot == NULL; i++)
    if (same_reading(&readings->ranked[i].reading, &ranked->reading)) slot = &readings->ranked[i];
  if (slot != NULL && ranked->literal <= slot->literal) return SPROUT_EVAL_OK;
  near = (size_t *)sprout_arena_take(keep, (ranked->near_count + 1) * sizeof *near);
  pronouns = (parse_pronoun_thing *)sprout_arena_take(keep, (ranked->pronoun_count + 1) * sizeof *pronouns);
  rest = (parse_reading *)sprout_arena_take(keep, (ranked->rest_count + 1) * sizeof *rest);
  if (near == NULL || pronouns == NULL || rest == NULL || !kept_reading(keep, &ranked->reading, &made.reading))
    return SPROUT_EVAL_NO_MEMORY;
  if (ranked->near_count > 0) memcpy(near, ranked->near, ranked->near_count * sizeof *near);
  if (ranked->pronoun_count > 0) memcpy(pronouns, ranked->pronouns, ranked->pronoun_count * sizeof *pronouns);
  for (i = 0; i < ranked->rest_count; i++)
    if (!kept_reading(keep, &ranked->rest[i], &rest[i])) return SPROUT_EVAL_NO_MEMORY;
  made.near = near;
  made.pronouns = pronouns;
  made.rest = rest;
  if (ranked->run != NULL && (made.run = kept_run(keep, ranked->run)) == NULL) return SPROUT_EVAL_NO_MEMORY;
  if (slot == NULL) {
    slot = (parse_ranked *)sprout_exec_grow(keep, (void **)&readings->ranked, &readings->count, &readings->capacity,
                                            sizeof *slot);
    if (slot == NULL) return SPROUT_EVAL_NO_MEMORY;
  }
  *slot = made;
  return SPROUT_EVAL_OK;
}

/* How many of the line's words a phrase writes, each matched literally wherever it reads. */
static size_t phrase_literal(const sprout_typed_part *parts, size_t count) {
  size_t i, sum = 0;
  for (i = 0; i < count; i++)
    if (!parts[i].is_slot) sum += parts[i].word_count;
  return sum;
}

/* How many words a run's later items matched literally, each by the best thing it names. */
static size_t later_literal(const parse_filled *filled) {
  size_t i, j, sum = 0;
  if (filled->fills != PARSE_FILLS_RUN) return 0;
  for (i = 0; i < filled->later_count; i++) {
    const parse_filled *item = &filled->later[i].filled;
    size_t best = 0;
    if (item->fills != PARSE_FILLS_OPTIONS) continue;
    for (j = 0; j < item->thing_count; j++)
      if (item->things[j].literal > best) best = item->things[j].literal;
    sum += best;
  }
  return sum;
}

static bool binds_role(const parse_reading *reading, size_t role) {
  size_t i;
  for (i = 0; i < reading->count; i++)
    if (reading->roles[i] == role) return true;
  return false;
}

/* Whether `object` is the reading's actor or fills one of its roles. */
static bool takes_part(const parse_reading *reading, const char *object) {
  size_t i, j;
  if (sprout_str_is(reading->actor, object)) return true;
  for (i = 0; i < reading->count; i++) {
    const sprout_stored_bound *bound = &reading->bounds[i];
    if (bound->kind == SPROUT_BOUND_OBJECT && sprout_str_is(bound->object, object)) return true;
    if (bound->kind == SPROUT_BOUND_SET)
      for (j = 0; j < bound->set_count; j++)
        if (sprout_str_is(bound->set[j], object)) return true;
  }
  return false;
}

/* What planning the run in slot `at` needs once its reading is chosen, in the turn arena, which is the phrase's scratch. */
static sprout_eval_status run_of(const sprout_frame *frame, const parse_placement *p, const option *options, size_t at,
                                 const parse_run **out) {
  parse_run *run = (parse_run *)sprout_arena_take(frame->turn, sizeof *run);
  bool *words = (bool *)sprout_arena_take(frame->turn, (p->count + 1) * sizeof *words);
  sprout_stored_bound *bounds = (sprout_stored_bound *)sprout_arena_take(frame->turn, (p->count + 1) * sizeof *bounds);
  size_t i;
  if (run == NULL || words == NULL || bounds == NULL) return SPROUT_EVAL_NO_MEMORY;
  for (i = 0; i < p->count; i++) {
    words[i] = options[i].words;
    bounds[i] = options[i].bound;
  }
  run->phrase = p->phrase;
  run->count = p->count;
  run->spans = p->spans;
  run->words = words;
  run->bounds = bounds;
  run->at = at;
  run->later_count = p->fills[at]->later_count;
  run->later = p->fills[at]->later;
  *out = run;
  return SPROUT_EVAL_OK;
}

/* What the choice is ranked by but its reading and whether it is allowed: literal words, nearness, names and pronouns. */
static sprout_eval_status ranked_by(const sprout_frame *frame, const parse_placement *p, const option *options,
                                    size_t role_count, parse_ranked *out) {
  size_t *near = (size_t *)sprout_arena_take(frame->turn, (role_count + 1) * sizeof *near);
  parse_pronoun_thing *pronouns;
  size_t i, j, count = 0;
  const sprout_typed_part *parts = p->phrase != NULL ? p->phrase->parts : p->intent->parts;
  size_t part_count = p->phrase != NULL ? p->phrase->part_count : p->intent->part_count;
  if (near == NULL) return SPROUT_EVAL_NO_MEMORY;
  for (i = 0; i < p->count; i++) count += options[i].words ? 0 : options[i].pronoun_count;
  pronouns = (parse_pronoun_thing *)sprout_arena_take(frame->turn, (count + 1) * sizeof *pronouns);
  if (pronouns == NULL) return SPROUT_EVAL_NO_MEMORY;
  out->literal = phrase_literal(parts, part_count);
  out->near = near;
  out->near_count = role_count;
  out->pronouns = pronouns;
  out->pronoun_count = 0;
  out->whole = true;
  for (i = 0; i < role_count; i++)
    for (j = 0; j < p->count; j++)
      if (p->spans[j].role == i) {
        near[i] = options[j].near;
        break;
      }
  for (i = 0; i < p->count; i++) {
    if (options[i].words) {
      bool bound = binds_role(&out->reading, p->spans[i].role);
      if (bound) out->literal += options[i].literal;
      out->whole = out->whole && bound;
      continue;
    }
    out->literal += options[i].literal + later_literal(p->fills[i]);
    out->by_name += options[i].by_name;
    for (j = 0; j < options[i].pronoun_count; j++) {
      pronouns[out->pronoun_count].id = options[i].pronouns[j].candidate->instance->id;
      pronouns[out->pronoun_count++].pronoun = options[i].pronouns[j].pronoun;
    }
    if (p->fills[i]->fills == PARSE_FILLS_RUN) {
      if (out->run == NULL) EXPR_NEED(run_of(frame, p, options, i, &out->run));
      for (j = 0; j < p->fills[i]->later_count; j++)
        out->whole = out->whole && p->fills[i]->later[j].filled.fills == PARSE_FILLS_OPTIONS;
    }
  }
  return SPROUT_EVAL_OK;
}

/* The ranked reading one choice of an intent's placement makes: its slots bound by name, asking no consent. */
static sprout_eval_status intent_ranked(const sprout_frame *frame, sprout_str actor, const parse_placement *p,
                                        const option *options, parse_ranked *out) {
  size_t *roles = (size_t *)sprout_arena_take(frame->turn, (p->count + 1) * sizeof *roles);
  sprout_stored_bound *bounds = (sprout_stored_bound *)sprout_arena_take(frame->turn, (p->count + 1) * sizeof *bounds);
  size_t i;
  if (roles == NULL || bounds == NULL) return SPROUT_EVAL_NO_MEMORY;
  memset(out, 0, sizeof *out);
  out->reading.intent = p->intent->intent;
  out->reading.actor = actor;
  out->reading.roles = roles;
  out->reading.bounds = bounds;
  for (i = 0; i < p->count; i++) {
    roles[out->reading.count] = p->spans[i].role;
    bounds[out->reading.count++] = options[i].bound;
  }
  out->allowed = true;
  return ranked_by(frame, p, options, p->intent->intent->slot_count, out);
}

/* The ranked reading one choice of a verb's placement makes, where it makes one; `*nothing` where `all` leaves nothing. */
static sprout_eval_status verb_ranked(sprout_exec *x, const sprout_frame *frame, sprout_str actor,
                                      const parse_placement *p, option *options, parse_ranked *out, bool *made,
                                      bool *nothing) {
  parse_reading *each;
  size_t count;
  *made = false;
  memset(out, 0, sizeof *out);
  EXPR_NEED(each_of(x, frame, actor, p, options, &each, &count));
  if (count == 0) {
    *nothing = true;
    return SPROUT_EVAL_OK;
  }
  if (p->phrase->only != NULL && !takes_part(&each[0], p->phrase->only)) return SPROUT_EVAL_OK;
  out->reading = each[0];
  out->rest = each + 1;
  out->rest_count = count - 1;
  EXPR_NEED(parse_allows(x, frame, &out->reading, &out->allowed));
  EXPR_NEED(ranked_by(frame, p, options, p->phrase->verb->role_count, out));
  *made = true;
  return SPROUT_EVAL_OK;
}

sprout_eval_status parse_placement_readings(sprout_exec *x, const sprout_frame *frame, sprout_str actor,
                                            const parse_placement *placement, sprout_arena *keep,
                                            parse_readings *readings, bool *nothing) {
  size_t *at = (size_t *)sprout_arena_take(frame->turn, (placement->count + 1) * sizeof *at);
  option *options = (option *)sprout_arena_take(frame->turn, (placement->count + 1) * sizeof *options);
  size_t i;
  if (at == NULL || options == NULL) return SPROUT_EVAL_NO_MEMORY;
  for (i = 0; i < placement->count; i++)
    if (options_in(placement->fills[i]) == 0) return SPROUT_EVAL_OK;
  for (;;) {
    parse_ranked ranked;
    bool made = true;
    EXPR_NEED(expr_spend(frame));
    for (i = 0; i < placement->count; i++) EXPR_NEED(option_at(frame, placement, i, at[i], &options[i]));
    if (placement->phrase != NULL)
      EXPR_NEED(verb_ranked(x, frame, actor, placement, options, &ranked, &made, nothing));
    else
      EXPR_NEED(intent_ranked(frame, actor, placement, options, &ranked));
    if (made) EXPR_NEED(keep_ranked(keep, &ranked, readings));
    for (i = placement->count; i > 0; i--) {
      if (++at[i - 1] < options_in(placement->fills[i - 1])) break;
      at[i - 1] = 0;
    }
    if (i == 0) return SPROUT_EVAL_OK;
  }
}
