/*
 * `all` and `except` in a slot (the spec's Parsing > Sequences, again and all): `take all`, `drop everything except
 * the lamp`. `all` fills a role with everything in reach it may take: a role of a kind what composes it; an engine
 * verb's open role, and an open role only the actor plays, every thing that is not a person and not the actor's own
 * place; any other open role what plays a part in the verb. `except` leaves out each thing a noun after it names
 * (only those whose whole name it is, where any is), and every thing of a kind it names. A set role takes them all at
 * once, capped at a set role's figure; a role that takes one thing takes each in turn, in the order reached, which
 * the readings cap once the refused are left out.
 */
#include <string.h>

#include "../address.h"
#include "../engine-verbs.h"
#include "../expr/expr.h"
#include "../offers.h"
#include "parse.h"

static parse_words slice(parse_words words, size_t start, size_t end) {
  parse_words part;
  part.words = words.words + start;
  part.count = end - start;
  return part;
}

static bool any_thing(const void *context, const sprout_stored_instance *instance) {
  (void)context, (void)instance;
  return true;
}

/* Whether a kind's name, humanised, is `written`: the words of a noun after `except`. */
static sprout_eval_status kind_is(const sprout_frame *frame, const char *qualified, sprout_str written, bool *is) {
  const char *dot = strrchr(qualified, '.');
  sprout_str name;
  if (!sprout_humanised_kind(frame->turn, dot == NULL ? qualified : dot + 1, &name)) return SPROUT_EVAL_NO_MEMORY;
  *is = sprout_str_same(name, written);
  return SPROUT_EVAL_OK;
}

/* `words` joined by single spaces, in the turn arena. */
static sprout_eval_status joined(const sprout_frame *frame, parse_words words, sprout_str *out) {
  size_t length = 0, i, at = 0;
  char *text;
  for (i = 0; i < words.count; i++) length += words.words[i].length + 1;
  text = (char *)sprout_arena_take(frame->turn, length + 1);
  if (text == NULL) return SPROUT_EVAL_NO_MEMORY;
  for (i = 0; i < words.count; i++) {
    if (i > 0) text[at++] = ' ';
    memcpy(text + at, words.words[i].bytes, words.words[i].length);
    at += words.words[i].length;
  }
  text[at] = '\0';
  out->bytes = text;
  out->length = at;
  return SPROUT_EVAL_OK;
}

/* Marks in `left` (one for each candidate) what a noun after `except` leaves out; `*any` false where it leaves out nothing. Each thing a step. */
static sprout_eval_status left_out(const parse_all_context *context, parse_words noun, bool *left, bool *any) {
  const parse_fill_context *fill = &context->fill;
  const sprout_frame *frame = fill->nouns.frame;
  parse_noun_found named;
  parse_words bare = noun;
  sprout_str written;
  size_t i, k, by_name = 0;
  bool *out = (bool *)sprout_arena_take(frame->turn, fill->candidate_count + 1);
  if (out == NULL) return SPROUT_EVAL_NO_MEMORY;
  EXPR_NEED(parse_things_in(&fill->nouns, noun, any_thing, NULL, fill->candidates, fill->candidate_count, &named));
  if (named.found != PARSE_FOUND_NOTHING) {
    for (i = 0; i < named.count; i++) by_name += named.things[i].by_name ? 1 : 0;
    for (i = 0; i < named.count; i++)
      if (by_name == 0 || named.things[i].by_name) out[named.things[i].candidate - fill->candidates] = true;
  }
  if (noun.count > 1 && parse_is_determiner(noun.words[0])) bare = slice(noun, 1, noun.count);
  EXPR_NEED(joined(frame, bare, &written));
  for (i = 0; i < fill->candidate_count; i++) {
    const sprout_kind_def *kind = fill->candidates[i].instance->kind;
    EXPR_NEED(expr_spend(frame));
    for (k = 0; kind != NULL && k < kind->order_count && !out[i]; k++) EXPR_NEED(kind_is(frame, kind->order[k], written, &out[i]));
  }
  *any = false;
  for (i = 0; i < fill->candidate_count; i++) {
    *any = *any || out[i];
    left[i] = left[i] || out[i];
  }
  return SPROUT_EVAL_OK;
}

/* Whether `all` takes `thing` for `role`: as the role's kind says; where it takes every thing, any not a person; or as the verb's plays do. */
static bool takes(const sprout_role *role, const sprout_verb *verb, const sprout_stored_instance *thing, bool every_thing) {
  size_t r;
  if (role->filler == SPROUT_FILLER_KIND) return parse_fits(role, thing);
  if (every_thing) return !thing->kind->composes_actor;
  for (r = 0; r < verb->role_count; r++) {
    const sprout_play_group *group = sprout_own_plays(verb, verb->roles[r].name, thing->kind);
    if (group != NULL && group->count > 0) return true;
  }
  return false;
}

sprout_eval_status parse_all_in(const parse_all_context *context, parse_words words, const sprout_role *role,
                                const sprout_verb *verb, bool *is_all, parse_filled *out) {
  const parse_fill_context *fill = &context->fill;
  const sprout_frame *frame = fill->nouns.frame;
  const sprout_limit *cap = &frame->meter->budgets->set_role_objects;
  size_t literal = 1, i, reached = 0;
  bool *left, every_thing = true;
  parse_named *things;
  memset(out, 0, sizeof *out);
  *is_all = words.count > 0 && parse_is_all(words.words[0]) &&
            (role->filler == SPROUT_FILLER_OPEN || role->filler == SPROUT_FILLER_KIND);
  if (!*is_all) return SPROUT_EVAL_OK;
  left = (bool *)sprout_arena_take(frame->turn, fill->candidate_count + 1);
  if (left == NULL) return SPROUT_EVAL_NO_MEMORY;
  if (words.count > 1) {
    parse_words named = slice(words, 2, words.count);
    parse_stretch *nouns;
    size_t noun_count, n;
    if (!parse_is(words.words[1], "except") || words.count == 2) {
      out->fills = PARSE_FILLS_UNFIT;
      return SPROUT_EVAL_OK;
    }
    literal++;
    nouns = (parse_stretch *)sprout_arena_take(frame->turn, (named.count + 2) * sizeof *nouns);
    if (nouns == NULL) return SPROUT_EVAL_NO_MEMORY;
    noun_count = parse_nouns_of_run(named, nouns);
    for (n = 0; n < noun_count; n++) {
      bool any;
      if (nouns[n].start == nouns[n].end) {
        out->fills = PARSE_FILLS_UNFIT;
        return SPROUT_EVAL_OK;
      }
      EXPR_NEED(left_out(context, slice(named, nouns[n].start, nouns[n].end), left, &any));
      if (!any) {
        out->fills = PARSE_FILLS_NOTHING;
        out->start = 2 + nouns[n].start;
        out->end = 2 + nouns[n].end;
        return SPROUT_EVAL_OK;
      }
      literal += nouns[n].end - nouns[n].start;
    }
  }
  if (!sprout_is_engine_verb(verb)) EXPR_NEED(sprout_only_the_actor_plays(frame, verb, role, &every_thing));
  things = (parse_named *)sprout_arena_take(frame->turn, (fill->candidate_count + 1) * sizeof *things);
  if (things == NULL) return SPROUT_EVAL_NO_MEMORY;
  for (i = 0; i < fill->candidate_count; i++) {
    const parse_candidate *candidate = &fill->candidates[i];
    EXPR_NEED(expr_spend(frame));
    if (left[i] || sprout_str_same(candidate->instance->id, context->actor) ||
        sprout_str_same(candidate->instance->id, context->here))
      continue;
    if (role->carried && !candidate->carried) continue;
    if (!takes(role, verb, candidate->instance, every_thing)) continue;
    things[reached].candidate = candidate;
    things[reached].near = candidate->near;
    things[reached].literal = literal;
    things[reached].by_name = false;
    things[reached].pronoun = PARSE_PRONOUN_NONE;
    reached++;
  }
  if (reached == 0) {
    out->fills = PARSE_FILLS_NOTHING;
    out->end = words.count;
    return SPROUT_EVAL_OK;
  }
  if (role->many) {
    parse_named_set *set = (parse_named_set *)sprout_arena_take(frame->turn, sizeof *set);
    const parse_candidate **members;
    if (cap->set && reached > cap->value) reached = (size_t)cap->value;
    members = (const parse_candidate **)sprout_arena_take(frame->turn, (reached + 1) * sizeof *members);
    if (set == NULL || members == NULL) return SPROUT_EVAL_NO_MEMORY;
    for (i = 0; i < reached; i++) {
      members[i] = things[i].candidate;
      set->near += things[i].near;
    }
    set->things = members;
    set->count = reached;
    set->literal = literal;
    out->fills = PARSE_FILLS_OPTIONS;
    out->sets = set;
    out->set_count = 1;
    return SPROUT_EVAL_OK;
  }
  out->fills = PARSE_FILLS_ALL;
  out->things = things;
  out->thing_count = reached;
  return SPROUT_EVAL_OK;
}
