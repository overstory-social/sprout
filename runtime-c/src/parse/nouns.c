/*
 * A noun a visitor typed, resolved against what they can reach (the spec's Names > Articles; Verbs > Slots, Set
 * roles; Parsing > Matching a line, Pronouns). An article or a determiner is optional before it, so the words are
 * tried as typed and then without their first word where that is one. A thing is named by one of its nouns, with
 * any of its adjectives before it, or by adjectives alone, which names it weakly: those words count as none
 * matched literally, and name it only where nothing that fits is named by a noun or its whole name. A relative
 * phrase narrows a name by what directly holds it: `the key in the cabinet`, `the key that is on the shelf`, `the
 * one in the cabinet`. A pronoun alone names what the visitor's own last command was done to, where it is in
 * reach. A role's kind narrows what may fill it and is never a source of refusal text: a thing that answers and is
 * not of the kind makes the phrase not match. Every candidate a noun is tried against is one step.
 */
#include <string.h>

#include "../expr/expr.h"
#include "parse.h"

/* How one candidate answers a name: how strongly (PARSE_BY_NONE for not at all), with how many words literally. */
typedef struct answer {
  parse_by by;
  size_t literal;
  parse_pronoun pronoun;
} answer;

static parse_words slice(parse_words words, size_t start, size_t end) {
  parse_words part;
  part.words = words.words + start;
  part.count = end - start;
  return part;
}

static bool same_words(parse_words a, parse_words b) {
  size_t i;
  if (a.count != b.count) return false;
  for (i = 0; i < a.count; i++)
    if (!sprout_str_same(a.words[i], b.words[i])) return false;
  return true;
}

size_t parse_forms(parse_words words, parse_words forms[2]) {
  forms[0] = words;
  if (words.count > 1 && parse_is_determiner(words.words[0])) {
    forms[1] = slice(words, 1, words.count);
    return 2;
  }
  return 1;
}

static bool all_adjectives(parse_words run, const parse_address *address) {
  size_t i, j;
  for (i = 0; i < run.count; i++) {
    for (j = 0; j < address->adjective_count && !sprout_str_same(run.words[i], address->adjectives[j]); j++) {}
    if (j == address->adjective_count) return false;
  }
  return true;
}

/* How `address` answers to `words`: a name or a noun, with any adjectives before it, matching all of them; adjectives alone, none. */
static answer answering(parse_words words, const parse_address *address) {
  parse_words forms[2];
  size_t form_count = parse_forms(words, forms), f, n;
  answer by_noun = {PARSE_BY_NONE, 0, PARSE_PRONOUN_NONE}, by_adjectives = {PARSE_BY_NONE, 0, PARSE_PRONOUN_NONE};
  for (f = 0; f < form_count; f++) {
    parse_words form = forms[f];
    if (address->noun_count > 0 && same_words(form, address->nouns[0])) {
      answer whole = {PARSE_BY_NAME, form.count, PARSE_PRONOUN_NONE};
      return whole;
    }
    for (n = 0; n < address->noun_count; n++) {
      parse_words noun = address->nouns[n];
      if (noun.count > form.count || !same_words(slice(form, form.count - noun.count, form.count), noun)) continue;
      if (by_noun.by == PARSE_BY_NONE && all_adjectives(slice(form, 0, form.count - noun.count), address)) {
        by_noun.by = PARSE_BY_NOUN;
        by_noun.literal = form.count;
      }
    }
    if (by_adjectives.by == PARSE_BY_NONE && all_adjectives(form, address)) by_adjectives.by = PARSE_BY_ADJECTIVE;
  }
  return by_noun.by != PARSE_BY_NONE ? by_noun : by_adjectives;
}

parse_by parse_answers_to(parse_words words, const parse_address *address) { return answering(words, address).by; }

/* Keeps `one` for a candidate where it is stronger than what is kept: by its way of answering, then by its words. */
static void keep(answer *kept, answer one) {
  if (kept->by == PARSE_BY_NONE || one.by < kept->by || (one.by == kept->by && one.literal > kept->literal)) *kept = one;
}

static bool is_referent(const parse_noun_context *context, sprout_str id) {
  size_t i;
  for (i = 0; i < context->referent_count; i++)
    if (sprout_str_same(context->referents[i], id)) return true;
  return false;
}

/* Whether `pronoun`, typed, names a thing the last command was done to: `it` and `they` always, `he` and `she` where it is a person or declares that pronoun. */
static bool pronoun_names(parse_pronoun pronoun, const parse_candidate *candidate) {
  if (pronoun == PARSE_PRONOUN_IT || pronoun == PARSE_PRONOUN_THEY) return true;
  return candidate->instance->kind->composes_actor || candidate->address.pronoun == pronoun;
}

static sprout_eval_status named(const parse_noun_context *context, parse_words words, const parse_candidate *candidates,
                                size_t count, answer *out);

/* The candidate whose instance is `id`, of those `found` names; `count` where none is. */
static size_t holder_of(const parse_candidate *candidates, size_t count, const answer *found, sprout_str id) {
  size_t i;
  for (i = 0; i < count; i++)
    if (found[i].by != PARSE_BY_NONE && sprout_str_same(candidates[i].instance->id, id)) return i;
  return count;
}

/*
 * What `words` name through a relative phrase, kept into `out`: at each `in` or `on`, the words before it, less a
 * `that is`, name what stands directly in what the words after it name, `one` anything that does.
 */
static sprout_eval_status relatives(const parse_noun_context *context, parse_words words,
                                    const parse_candidate *candidates, size_t count, answer *out) {
  size_t at, i;
  answer *holders = (answer *)sprout_arena_take(context->frame->turn, (count + 1) * sizeof *holders);
  answer *things = (answer *)sprout_arena_take(context->frame->turn, (count + 1) * sizeof *things);
  if (holders == NULL || things == NULL) return SPROUT_EVAL_NO_MEMORY;
  for (at = 1; at + 1 < words.count; at++) {
    bool that_is, any = false, held = false;
    parse_words inner, forms[2];
    size_t joining, form_count, f;
    if (!parse_is(words.words[at], "in") && !parse_is(words.words[at], "on")) continue;
    that_is = at >= 3 && parse_is(words.words[at - 2], "that") && parse_is(words.words[at - 1], "is");
    inner = slice(words, 0, that_is ? at - 2 : at);
    joining = that_is ? 3 : 1;
    EXPR_NEED(named(context, slice(words, at + 1, words.count), candidates, count, holders));
    for (i = 0; i < count && !held; i++) held = holders[i].by != PARSE_BY_NONE;
    if (!held) continue;
    form_count = parse_forms(inner, forms);
    for (f = 0; f < form_count; f++) any = any || (forms[f].count == 1 && parse_is(forms[f].words[0], "one"));
    if (any) {
      for (i = 0; i < count; i++) {
        things[i].by = PARSE_BY_NOUN;
        things[i].literal = 1;
        things[i].pronoun = PARSE_PRONOUN_NONE;
      }
    } else {
      EXPR_NEED(named(context, inner, candidates, count, things));
    }
    for (i = 0; i < count; i++) {
      const sprout_stored_instance *instance = candidates[i].instance;
      size_t holder;
      answer one;
      if (things[i].by == PARSE_BY_NONE || !instance->has_container) continue;
      holder = holder_of(candidates, count, holders, instance->container);
      if (holder == count) {
        /* One in several places stands directly in each. */
        const char *const *places;
        size_t place_count = sprout_world_also_in(context->frame->world, instance->id, &places), k;
        for (k = 0; k < place_count && holder == count; k++) {
          sprout_str place;
          place.bytes = places[k];
          place.length = strlen(places[k]);
          holder = holder_of(candidates, count, holders, place);
        }
      }
      if (holder == count) continue;
      one.by = things[i].by == PARSE_BY_NAME ? PARSE_BY_NOUN : things[i].by;
      one.literal = things[i].literal + joining + holders[holder].literal;
      one.pronoun = PARSE_PRONOUN_NONE;
      keep(&out[i], one);
    }
  }
  return SPROUT_EVAL_OK;
}

/* Every candidate `words` name, directly or through a relative phrase, each by its strongest reading, in `out` by candidate. */
static sprout_eval_status named(const parse_noun_context *context, parse_words words, const parse_candidate *candidates,
                                size_t count, answer *out) {
  parse_pronoun pronoun = words.count == 1 ? parse_pronoun_in(words.words[0]) : PARSE_PRONOUN_NONE;
  size_t i;
  for (i = 0; i < count; i++) {
    out[i].by = PARSE_BY_NONE;
    out[i].literal = 0;
    out[i].pronoun = PARSE_PRONOUN_NONE;
  }
  if (pronoun != PARSE_PRONOUN_NONE) {
    for (i = 0; i < count; i++) {
      EXPR_NEED(expr_spend(context->frame));
      if (is_referent(context, candidates[i].instance->id) && pronoun_names(pronoun, &candidates[i])) {
        out[i].by = PARSE_BY_NAME;
        out[i].literal = 1;
        out[i].pronoun = pronoun;
      }
    }
    return SPROUT_EVAL_OK;
  }
  for (i = 0; i < count; i++) {
    answer one;
    EXPR_NEED(expr_spend(context->frame));
    one = answering(words, &candidates[i].address);
    if (one.by != PARSE_BY_NONE) keep(&out[i], one);
  }
  return relatives(context, words, candidates, count, out);
}

bool parse_fits(const sprout_role *role, const sprout_stored_instance *instance) {
  if (role->filler == SPROUT_FILLER_OPEN) return true;
  if (role->filler == SPROUT_FILLER_KIND)
    return role->filler_kind != NULL && instance->kind != NULL && expr_composes(instance->kind, role->filler_kind->qualified);
  return false;
}

sprout_eval_status parse_things_in(const parse_noun_context *context, parse_words words, parse_fitting fitting,
                                   const void *fit, const parse_candidate *candidates, size_t count,
                                   parse_noun_found *out) {
  answer *answered = (answer *)sprout_arena_take(context->frame->turn, (count + 1) * sizeof *answered);
  bool *fits = (bool *)sprout_arena_take(context->frame->turn, count + 1);
  size_t i, answering_count = 0, fit_count = 0, outright = 0;
  memset(out, 0, sizeof *out);
  if (answered == NULL || fits == NULL) return SPROUT_EVAL_NO_MEMORY;
  EXPR_NEED(named(context, words, candidates, count, answered));
  for (i = 0; i < count; i++) {
    if (answered[i].by == PARSE_BY_NONE) continue;
    answering_count++;
    fits[i] = fitting(fit, candidates[i].instance);
    if (fits[i]) fit_count++;
  }
  if (answering_count == 0) {
    out->found = PARSE_FOUND_NOTHING;
    return SPROUT_EVAL_OK;
  }
  /* The pool is what fits, or what answers where nothing does; a name or a noun is preferred to adjectives alone. */
  for (i = 0; i < count; i++)
    if (answered[i].by != PARSE_BY_NONE && (fit_count == 0 || fits[i]) && answered[i].by != PARSE_BY_ADJECTIVE) outright++;
  out->things = (parse_named *)sprout_arena_take(context->frame->turn, (answering_count + 1) * sizeof *out->things);
  if (out->things == NULL) return SPROUT_EVAL_NO_MEMORY;
  for (i = 0; i < count; i++) {
    parse_named *thing;
    if (answered[i].by == PARSE_BY_NONE || (fit_count > 0 && !fits[i])) continue;
    if (outright > 0 && answered[i].by == PARSE_BY_ADJECTIVE) continue;
    thing = &out->things[out->count++];
    thing->candidate = &candidates[i];
    thing->near = candidates[i].near;
    thing->literal = answered[i].literal;
    thing->pronoun = answered[i].pronoun;
    thing->by_name = answered[i].by == PARSE_BY_NAME && answered[i].pronoun == PARSE_PRONOUN_NONE;
  }
  out->found = fit_count == 0 ? PARSE_FOUND_UNFIT : PARSE_FOUND_SOME;
  return SPROUT_EVAL_OK;
}

static bool fits_role(const void *role, const sprout_stored_instance *instance) {
  return parse_fits((const sprout_role *)role, instance);
}

size_t parse_nouns_of_run(parse_words words, parse_stretch *out) {
  size_t at, count = 1;
  out[0].start = out[0].end = 0;
  for (at = 0; at < words.count; at++) {
    parse_stretch *last = &out[count - 1];
    if (!parse_is_connector(words.words[at])) {
      last->end = at + 1;
    } else if (parse_is(words.words[at], "and") && at > 0 && parse_is(words.words[at - 1], ",")) {
      last->start = last->end = at + 1;
    } else {
      out[count].start = out[count].end = at + 1;
      count++;
    }
  }
  return count;
}

/* `set` with `thing` added: its things, each once in the order typed, and how they matched summed. */
static sprout_eval_status joined(sprout_arena *arena, const parse_named_set *set, const parse_named *thing,
                                 parse_named_set *out) {
  size_t i;
  bool held = false;
  *out = *set;
  for (i = 0; i < set->count; i++) held = held || set->things[i] == thing->candidate;
  if (!held) {
    const parse_candidate **things = (const parse_candidate **)sprout_arena_take(arena, (set->count + 1) * sizeof *things);
    if (things == NULL) return SPROUT_EVAL_NO_MEMORY;
    if (set->count > 0) memcpy(things, set->things, set->count * sizeof *things);
    things[set->count] = thing->candidate;
    out->things = things;
    out->count = set->count + 1;
  }
  out->near = set->near + thing->near;
  out->literal = set->literal + thing->literal;
  out->by_name = set->by_name + (thing->by_name ? 1 : 0);
  if (thing->pronoun != PARSE_PRONOUN_NONE) {
    parse_named *pronouns = (parse_named *)sprout_arena_take(arena, (set->pronoun_count + 1) * sizeof *pronouns);
    if (pronouns == NULL) return SPROUT_EVAL_NO_MEMORY;
    if (set->pronoun_count > 0) memcpy(pronouns, set->pronouns, set->pronoun_count * sizeof *pronouns);
    pronouns[set->pronoun_count] = *thing;
    out->pronouns = pronouns;
    out->pronoun_count = set->pronoun_count + 1;
  }
  return SPROUT_EVAL_OK;
}

sprout_eval_status parse_run_in(const parse_noun_context *context, parse_words words, const sprout_role *role,
                                const parse_candidate *candidates, size_t count, parse_run_found *out) {
  sprout_arena *arena = context->frame->turn;
  parse_stretch *nouns = (parse_stretch *)sprout_arena_take(arena, (words.count + 2) * sizeof *nouns);
  parse_named_set *sets = (parse_named_set *)sprout_arena_take(arena, sizeof *sets);
  size_t noun_count, n, set_count = 1;
  memset(out, 0, sizeof *out);
  if (nouns == NULL || sets == NULL) return SPROUT_EVAL_NO_MEMORY;
  noun_count = parse_nouns_of_run(words, nouns);
  for (n = 0; n < noun_count; n++) {
    parse_noun_found found;
    parse_named_set *made;
    size_t s, t, at = 0;
    if (nouns[n].start == nouns[n].end) {
      out->found = PARSE_FOUND_UNFIT;
      out->start = out->end = nouns[n].start;
      return SPROUT_EVAL_OK;
    }
    EXPR_NEED(parse_things_in(context, slice(words, nouns[n].start, nouns[n].end), fits_role, role, candidates, count,
                              &found));
    if (found.found != PARSE_FOUND_SOME) {
      out->found = found.found;
      out->start = nouns[n].start;
      out->end = nouns[n].end;
      return SPROUT_EVAL_OK;
    }
    made = (parse_named_set *)sprout_arena_take(arena, (set_count * found.count + 1) * sizeof *made);
    if (made == NULL) return SPROUT_EVAL_NO_MEMORY;
    for (s = 0; s < set_count; s++)
      for (t = 0; t < found.count; t++) {
        EXPR_NEED(expr_spend(context->frame));
        EXPR_NEED(joined(arena, &sets[s], &found.things[t], &made[at++]));
      }
    sets = made;
    set_count = at;
  }
  out->sets = true;
  out->found = PARSE_FOUND_SOME;
  out->named = sets;
  out->count = set_count;
  return SPROUT_EVAL_OK;
}
