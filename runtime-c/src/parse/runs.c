/*
 * A run of things in a role that takes one thing (the spec's Parsing > Sequences, again and all): `take sack and
 * bottle`, `take sack, bottle and lamp`, a comma before `and` or not. The words split at `and` and commas, and each
 * noun is one item, in the order written. A name that holds a connector is still read whole: a stretch of the run
 * is one item where it names something by a noun or its whole name, the longest such stretch first. A stretch holds
 * no more connectors than some name in reach does, so a run costs no more than its length times that. As `all`
 * does, a run takes at most as many items as a set role may bind, the host's figure. Every stretch tried is a noun
 * tried, charged as one.
 */
#include <string.h>

#include "../expr/expr.h"
#include "parse.h"

static parse_words slice(parse_words words, size_t start, size_t end) {
  parse_words part;
  part.words = words.words + start;
  part.count = end - start;
  return part;
}

static size_t connectors_in(const sprout_str *words, size_t count) {
  size_t i, found = 0;
  for (i = 0; i < count; i++)
    if (parse_is_connector(words[i])) found++;
  return found;
}

/* The most connectors a name in reach may hold: those in its longest noun, and one more where its adjectives hold one. Each thing is a step. */
static sprout_eval_status widest(const parse_noun_context *context, const parse_candidate *candidates, size_t count,
                                 size_t *most) {
  size_t i, n;
  *most = 0;
  for (i = 0; i < count; i++) {
    const parse_address *address = &candidates[i].address;
    size_t nouns = 0;
    EXPR_NEED(expr_spend(context->frame));
    for (n = 0; n < address->noun_count; n++) {
      size_t held = connectors_in(address->nouns[n].words, address->nouns[n].count);
      if (held > nouns) nouns = held;
    }
    if (connectors_in(address->adjectives, address->adjective_count) > 0) nouns++;
    if (nouns > *most) *most = nouns;
  }
  return SPROUT_EVAL_OK;
}

static bool always(const void *context, const sprout_stored_instance *instance) {
  (void)context, (void)instance;
  return true;
}

sprout_eval_status parse_names_outright(const parse_noun_context *context, parse_words words,
                                        const parse_candidate *candidates, size_t count, bool *named) {
  parse_noun_found found;
  size_t i;
  *named = false;
  EXPR_NEED(parse_things_in(context, words, always, NULL, candidates, count, &found));
  for (i = 0; found.found != PARSE_FOUND_NOTHING && i < found.count; i++)
    if (found.things[i].literal > 0) *named = true;
  return SPROUT_EVAL_OK;
}

bool parse_holds_all(parse_words words, parse_stretch *scratch) {
  size_t count = parse_nouns_of_run(words, scratch), i;
  if (count < 2) return false;
  for (i = 0; i < count; i++)
    if (scratch[i].start < words.count && parse_is_all(words.words[scratch[i].start])) return true;
  return false;
}

sprout_eval_status parse_items_of_run(const parse_noun_context *context, parse_words words, const sprout_role *role,
                                      const parse_candidate *candidates, size_t count, parse_stretch *out,
                                      size_t *items) {
  parse_stretch *nouns;
  size_t noun_count, i, at, most, made = 0;
  const sprout_limit *cap = &context->frame->meter->budgets->set_role_objects;
  *items = 0;
  if (role->many || (role->filler != SPROUT_FILLER_OPEN && role->filler != SPROUT_FILLER_KIND)) return SPROUT_EVAL_OK;
  nouns = (parse_stretch *)sprout_arena_take(context->frame->turn, (words.count + 2) * sizeof *nouns);
  if (nouns == NULL) return SPROUT_EVAL_NO_MEMORY;
  noun_count = parse_nouns_of_run(words, nouns);
  if (noun_count < 2) return SPROUT_EVAL_OK;
  for (i = 0; i < noun_count; i++)
    if (nouns[i].start == nouns[i].end) return SPROUT_EVAL_OK;
  EXPR_NEED(widest(context, candidates, count, &most));
  for (at = 0; at < noun_count;) {
    size_t to = at, last = noun_count - 1 < at + most ? noun_count - 1 : at + most;
    for (; last > at; last--) {
      bool named;
      EXPR_NEED(parse_names_outright(context, slice(words, nouns[at].start, nouns[last].end), candidates, count, &named));
      if (named) {
        to = last;
        break;
      }
    }
    out[made].start = nouns[at].start;
    out[made].end = nouns[to].end;
    made++;
    at = to + 1;
  }
  if (made < 2) return SPROUT_EVAL_OK;
  /* As `all`, a run takes no more than a set role may bind. */
  *items = cap->set && cap->value < made ? (size_t)cap->value : made;
  return SPROUT_EVAL_OK;
}
