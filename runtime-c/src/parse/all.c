/*
 * `all` and `except` in a slot (the spec's Parsing > Sequences, again and all): `take all`, `drop everything except
 * the lamp`, `take all cakes`, `take all from the table`. `all` fills a role with everything in reach it may take: a
 * role of a kind what composes it; an engine verb's open role, and an open role only the actor plays, every thing
 * that is not a person and not the actor's own place; any other open role what plays a part in the verb. A noun
 * after `all` keeps only what it names, by a noun or a kind's name, its last word read as a plural too; `from`,
 * `off`, `out of`, `in` or `on` and a noun keep only what a thing it names directly holds, though `in` and `on` are not
 * read so in a role whose things the visitor carries, a carried role or one the actor's own sure move takes from
 * them, where they say where the things go. `except` leaves out each
 * thing a noun after it names (only those whose whole name it is, where any is), and every thing of a kind it names.
 * A set role takes them all at once, capped at a set role's figure; a role that takes one thing takes each in turn,
 * in the order reached, which the readings cap once the refused are left out.
 */
#include <string.h>

#include "../address.h"
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

/* Marks in `marks` (one for each candidate) each thing of a kind whose name, humanised, is `noun`, less a determiner; `*any` where it marks one. Each thing a step. */
static sprout_eval_status of_kind_named(const parse_all_context *context, parse_words noun, bool *marks, bool *any) {
  const parse_fill_context *fill = &context->fill;
  const sprout_frame *frame = fill->nouns.frame;
  parse_words bare = noun;
  sprout_str written;
  size_t i, k;
  if (noun.count > 1 && parse_is_determiner(noun.words[0])) bare = slice(noun, 1, noun.count);
  EXPR_NEED(joined(frame, bare, &written));
  for (i = 0; i < fill->candidate_count; i++) {
    const sprout_kind_def *kind = fill->candidates[i].instance->kind;
    bool is = false;
    EXPR_NEED(expr_spend(frame));
    for (k = 0; kind != NULL && k < kind->order_count && !is; k++) EXPR_NEED(kind_is(frame, kind->order[k], written, &is));
    if (is) marks[i] = *any = true;
  }
  return SPROUT_EVAL_OK;
}

/* Marks in `left` (one for each candidate) what a noun after `except` leaves out; `*any` false where it leaves out nothing. Each thing a step. */
static sprout_eval_status left_out(const parse_all_context *context, parse_words noun, bool *left, bool *any) {
  const parse_fill_context *fill = &context->fill;
  const sprout_frame *frame = fill->nouns.frame;
  parse_noun_found named;
  size_t i, by_name = 0;
  bool *out = (bool *)sprout_arena_take(frame->turn, fill->candidate_count + 1), by_kind = false;
  if (out == NULL) return SPROUT_EVAL_NO_MEMORY;
  EXPR_NEED(parse_things_in(&fill->nouns, noun, any_thing, NULL, fill->candidates, fill->candidate_count, &named));
  if (named.found != PARSE_FOUND_NOTHING) {
    for (i = 0; i < named.count; i++) by_name += named.things[i].by_name ? 1 : 0;
    for (i = 0; i < named.count; i++)
      if (by_name == 0 || named.things[i].by_name) out[named.things[i].candidate - fill->candidates] = true;
  }
  EXPR_NEED(of_kind_named(context, noun, out, &by_kind));
  *any = false;
  for (i = 0; i < fill->candidate_count; i++) {
    *any = *any || out[i];
    left[i] = left[i] || out[i];
  }
  return SPROUT_EVAL_OK;
}

/* `words` with the last read as `singular`, in the turn arena. */
static sprout_eval_status with_last(const sprout_frame *frame, parse_words words, sprout_str singular, parse_words *out) {
  sprout_str *copy = (sprout_str *)sprout_arena_take(frame->turn, (words.count + 1) * sizeof *copy);
  if (copy == NULL) return SPROUT_EVAL_NO_MEMORY;
  memcpy(copy, words.words, words.count * sizeof *copy);
  copy[words.count - 1] = singular;
  out->words = copy;
  out->count = words.count;
  return SPROUT_EVAL_OK;
}

/*
 * Marks in `named` (one for each candidate) what the noun after `all` names, by a noun or its kind's name, as typed
 * or with its last word read as the singular of a plural; `*literal` the most words any matched by, 0 where it names
 * nothing.
 */
static sprout_eval_status plural_named(const parse_all_context *context, parse_words noun, bool *named, size_t *literal) {
  const parse_fill_context *fill = &context->fill;
  const sprout_frame *frame = fill->nouns.frame;
  sprout_str singulars[3];
  size_t form_count, f, i;
  if (!parse_singulars(frame->turn, noun.words[noun.count - 1], singulars, &form_count)) return SPROUT_EVAL_NO_MEMORY;
  *literal = 0;
  for (f = 0; f <= form_count; f++) {
    parse_words form = noun;
    parse_noun_found found;
    bool by_kind = false;
    if (f > 0) EXPR_NEED(with_last(frame, noun, singulars[f - 1], &form));
    EXPR_NEED(of_kind_named(context, form, named, &by_kind));
    if (by_kind && form.count > *literal) *literal = form.count;
    EXPR_NEED(parse_things_in(&fill->nouns, form, any_thing, NULL, fill->candidates, fill->candidate_count, &found));
    if (found.found == PARSE_FOUND_NOTHING) continue;
    for (i = 0; i < found.count; i++) {
      named[found.things[i].candidate - fill->candidates] = true;
      if (found.things[i].literal > *literal) *literal = found.things[i].literal;
    }
  }
  return SPROUT_EVAL_OK;
}

/* Marks in `held` (one for each candidate) what stands directly in a thing `holder` names; `*literal` as plural_named's. */
static sprout_eval_status held_by(const parse_all_context *context, parse_words holder, bool *held, size_t *literal) {
  const parse_fill_context *fill = &context->fill;
  const sprout_frame *frame = fill->nouns.frame;
  parse_noun_found found;
  size_t i, h;
  *literal = 0;
  EXPR_NEED(parse_things_in(&fill->nouns, holder, any_thing, NULL, fill->candidates, fill->candidate_count, &found));
  if (found.found == PARSE_FOUND_NOTHING) return SPROUT_EVAL_OK;
  for (h = 0; h < found.count; h++)
    if (found.things[h].literal > *literal) *literal = found.things[h].literal;
  for (i = 0; i < fill->candidate_count; i++) {
    const sprout_stored_instance *instance = fill->candidates[i].instance;
    EXPR_NEED(expr_spend(frame));
    for (h = 0; h < found.count && instance->has_container && !held[i]; h++)
      held[i] = sprout_str_same(instance->container, found.things[h].candidate->instance->id) ||
                sprout_world_also_stands_in(frame->world, instance->id, found.things[h].candidate->instance->id);
  }
  return SPROUT_EVAL_OK;
}

static bool holds_connector(parse_words words) {
  size_t i;
  for (i = 0; i < words.count; i++)
    if (parse_is_connector(words.words[i])) return true;
  return false;
}

/* Where nothing qualifies: the words from `start` to `end` name nothing in reach. */
static void named_nothing(parse_filled *out, size_t start, size_t end) {
  out->fills = PARSE_FILLS_NOTHING;
  out->start = start;
  out->end = end;
}

sprout_eval_status parse_all_in(const parse_all_context *context, parse_words words, const sprout_role *role,
                                const sprout_verb *verb, bool *is_all, parse_filled *out) {
  const parse_fill_context *fill = &context->fill;
  const sprout_frame *frame = fill->nouns.frame;
  const sprout_limit *cap = &frame->meter->budgets->set_role_objects;
  size_t literal = 1, i, reached = 0, except, holder, holder_words = 0, at;
  bool *left, *named = NULL, *held = NULL;
  sprout_all_rule rule;
  parse_named *things;
  memset(out, 0, sizeof *out);
  *is_all = words.count > 0 && parse_is_all(words.words[0]) &&
            (role->filler == SPROUT_FILLER_OPEN || role->filler == SPROUT_FILLER_KIND);
  if (!*is_all) return SPROUT_EVAL_OK;
  out->all = true;
  left = (bool *)sprout_arena_take(frame->turn, fill->candidate_count + 1);
  if (left == NULL) return SPROUT_EVAL_NO_MEMORY;
  /* `all`, a noun, what holds them, then `except`: each but `all` may be left out, and what stands between is the noun. */
  for (except = 1; except < words.count && !parse_is(words.words[except], "except"); except++) {}
  for (holder = 1; holder < except; holder++) {
    holder_words = parse_holder_word_at(words.words, except, holder);
    if (holder_words > 0) break;
  }
  /* In a role whose things the visitor carries, `in` or `on` says where they go, which this slot does not read. */
  if (holder < except && (parse_is(words.words[holder], "in") || parse_is(words.words[holder], "on"))) {
    bool away = role->carried;
    if (!away) EXPR_NEED(sprout_moves_its_filler_away(frame, verb, role, context->actor, &away));
    if (away) {
      out->fills = PARSE_FILLS_UNFIT;
      return SPROUT_EVAL_OK;
    }
  }
  if (holder > 1) {
    parse_words noun = slice(words, 1, holder);
    size_t matched;
    if (holds_connector(noun)) {
      out->fills = PARSE_FILLS_UNFIT;
      return SPROUT_EVAL_OK;
    }
    named = (bool *)sprout_arena_take(frame->turn, fill->candidate_count + 1);
    if (named == NULL) return SPROUT_EVAL_NO_MEMORY;
    EXPR_NEED(plural_named(context, noun, named, &matched));
    if (matched == 0) {
      named_nothing(out, 1, holder);
      return SPROUT_EVAL_OK;
    }
    literal += matched;
  }
  if (holder < except) {
    parse_words noun = slice(words, holder + holder_words, except);
    size_t matched;
    if (noun.count == 0 || holds_connector(noun)) {
      out->fills = PARSE_FILLS_UNFIT;
      return SPROUT_EVAL_OK;
    }
    held = (bool *)sprout_arena_take(frame->turn, fill->candidate_count + 1);
    if (held == NULL) return SPROUT_EVAL_NO_MEMORY;
    EXPR_NEED(held_by(context, noun, held, &matched));
    if (matched == 0) {
      named_nothing(out, holder + holder_words, except);
      return SPROUT_EVAL_OK;
    }
    literal += matched;
  }
  if (except < words.count) {
    parse_words after = slice(words, except + 1, words.count);
    parse_stretch *nouns;
    size_t noun_count, n;
    if (after.count == 0) {
      out->fills = PARSE_FILLS_UNFIT;
      return SPROUT_EVAL_OK;
    }
    literal++;
    nouns = (parse_stretch *)sprout_arena_take(frame->turn, (after.count + 2) * sizeof *nouns);
    if (nouns == NULL) return SPROUT_EVAL_NO_MEMORY;
    noun_count = parse_nouns_of_run(after, nouns);
    for (n = 0; n < noun_count; n++) {
      bool any;
      if (nouns[n].start == nouns[n].end) {
        out->fills = PARSE_FILLS_UNFIT;
        return SPROUT_EVAL_OK;
      }
      EXPR_NEED(left_out(context, slice(after, nouns[n].start, nouns[n].end), left, &any));
      if (!any) {
        named_nothing(out, except + 1 + nouns[n].start, except + 1 + nouns[n].end);
        return SPROUT_EVAL_OK;
      }
      literal += nouns[n].end - nouns[n].start;
    }
  }
  for (at = 0; at < fill->candidate_count; at++)
    left[at] = left[at] || (named != NULL && !named[at]) || (held != NULL && !held[at]);
  EXPR_NEED(sprout_all_rule_of(frame, verb, role, &rule));
  things = (parse_named *)sprout_arena_take(frame->turn, (fill->candidate_count + 1) * sizeof *things);
  if (things == NULL) return SPROUT_EVAL_NO_MEMORY;
  for (i = 0; i < fill->candidate_count; i++) {
    const parse_candidate *candidate = &fill->candidates[i];
    EXPR_NEED(expr_spend(frame));
    if (left[i] || !sprout_all_takes(&rule, candidate->instance, context->actor, context->here, candidate->carried)) continue;
    things[reached].candidate = candidate;
    things[reached].near = candidate->near;
    things[reached].literal = literal;
    things[reached].by_name = false;
    things[reached].pronoun = PARSE_PRONOUN_NONE;
    reached++;
  }
  out->narrowed = named != NULL || held != NULL;
  /* Nothing qualifies: `all` itself, a word the parser reads, is what names nothing. */
  if (reached == 0) {
    named_nothing(out, 0, 1);
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
