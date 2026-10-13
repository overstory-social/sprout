/*
 * What the words a slot took fill its role with (the spec's Verbs > Slots, Set roles, Carried roles, Value roles, A
 * role-player narrows its own options, Exits; Parsing > Sequences, again and all): a thing role takes one noun, or a
 * run of them it runs once for each; a set role a run of them at once; an exit role a direction or a label, an exit
 * that refuses and a direction no exit answers being answered rather than read; a value role any words, which bind
 * once the reading's things are, and only a value some participant's `from` hears, so nothing typed reaches a body
 * unless a role-player declared it an option. A carried role takes only what the one typing carries: where what they
 * carry does not answer and something further out would fill the role, the slot is outward, and a carried thing the
 * noun names always wins over an outward one.
 */
#include <string.h>

#include "../expr/expr.h"
#include "../options.h"
#include "parse.h"

static parse_words slice(parse_words words, size_t start, size_t end) {
  parse_words part;
  part.words = words.words + start;
  part.count = end - start;
  return part;
}

/* What one noun found fills a slot with: a thing for each option, or for each thing that cannot fill it. */
static void thing_filled(const parse_noun_found *found, parse_words words, parse_filled *out) {
  memset(out, 0, sizeof *out);
  if (found->found == PARSE_FOUND_NOTHING) {
    out->fills = PARSE_FILLS_NOTHING;
    out->end = words.count;
    return;
  }
  out->fills = found->found == PARSE_FOUND_UNFIT ? PARSE_FILLS_UNFIT : PARSE_FILLS_OPTIONS;
  out->things = found->things;
  out->thing_count = found->count;
}

/* What the candidates the one typing carries are, copied in their order. */
static sprout_eval_status carried_of(const parse_fill_context *context, parse_candidate **held, size_t *count) {
  size_t i;
  *count = 0;
  *held = (parse_candidate *)sprout_arena_take(context->nouns.frame->turn, (context->candidate_count + 1) * sizeof **held);
  if (*held == NULL) return SPROUT_EVAL_NO_MEMORY;
  for (i = 0; i < context->candidate_count; i++)
    if (context->candidates[i].carried) (*held)[(*count)++] = context->candidates[i];
  return SPROUT_EVAL_OK;
}

/* Whether a thing fits the roles an intent's slot is given to: any one of them. */
typedef struct given {
  const sprout_role *const *roles;
  size_t count;
} given;

static bool fits_given(const void *context, const sprout_stored_instance *instance) {
  const given *g = (const given *)context;
  size_t i;
  for (i = 0; i < g->count; i++)
    if (parse_fits(g->roles[i], instance)) return true;
  return false;
}

static bool fits_role(const void *role, const sprout_stored_instance *instance) {
  return parse_fits((const sprout_role *)role, instance);
}

/*
 * What one noun fills a slot with, named among the candidates by what `fitting` says may fill it: in a carried
 * slot, among what is carried first, and outward where only something further out would fill it.
 */
static sprout_eval_status carried_filled(const parse_fill_context *context, parse_words words, bool carried,
                                         parse_fitting fitting, const void *fit, parse_filled *out) {
  parse_noun_found held, anywhere;
  parse_candidate *carried_ones;
  size_t carried_count;
  if (!carried) {
    EXPR_NEED(parse_things_in(&context->nouns, words, fitting, fit, context->candidates, context->candidate_count, &anywhere));
    thing_filled(&anywhere, words, out);
    return SPROUT_EVAL_OK;
  }
  EXPR_NEED(carried_of(context, &carried_ones, &carried_count));
  EXPR_NEED(parse_things_in(&context->nouns, words, fitting, fit, carried_ones, carried_count, &held));
  if (held.found == PARSE_FOUND_SOME) {
    thing_filled(&held, words, out);
    return SPROUT_EVAL_OK;
  }
  EXPR_NEED(parse_things_in(&context->nouns, words, fitting, fit, context->candidates, context->candidate_count, &anywhere));
  if (anywhere.found == PARSE_FOUND_SOME) {
    thing_filled(&anywhere, words, out);
    out->fills = PARSE_FILLS_OUTWARD;
    return SPROUT_EVAL_OK;
  }
  thing_filled(held.found == PARSE_FOUND_UNFIT ? &held : &anywhere, words, out);
  return SPROUT_EVAL_OK;
}

/* What a set role's run fills it with, each set an option; in a carried role, as carried_filled says. */
static sprout_eval_status set_filled(const parse_fill_context *context, const sprout_role *role, parse_words words,
                                     parse_filled *out) {
  parse_run_found found, anywhere;
  parse_candidate *carried_ones = NULL;
  size_t carried_count = 0;
  memset(out, 0, sizeof *out);
  if (role->carried) {
    EXPR_NEED(carried_of(context, &carried_ones, &carried_count));
    EXPR_NEED(parse_run_in(&context->nouns, words, role, carried_ones, carried_count, &found));
  } else {
    EXPR_NEED(parse_run_in(&context->nouns, words, role, context->candidates, context->candidate_count, &found));
  }
  if (found.sets) {
    out->fills = PARSE_FILLS_OPTIONS;
    out->sets = found.named;
    out->set_count = found.count;
    return SPROUT_EVAL_OK;
  }
  if (role->carried && found.found == PARSE_FOUND_NOTHING) {
    EXPR_NEED(parse_run_in(&context->nouns, words, role, context->candidates, context->candidate_count, &anywhere));
    if (anywhere.sets) {
      /* The nearest set's first thing not carried is the one the world names; the first of the nearest, as a stable sort leaves it. */
      const parse_named_set *nearest = &anywhere.named[0];
      parse_named *thing = (parse_named *)sprout_arena_take(context->nouns.frame->turn, sizeof *thing);
      size_t i, j;
      if (thing == NULL) return SPROUT_EVAL_NO_MEMORY;
      for (i = 1; i < anywhere.count; i++)
        if (anywhere.named[i].near < nearest->near) nearest = &anywhere.named[i];
      for (i = 0; i < nearest->count; i++) {
        bool held = false;
        for (j = 0; j < carried_count && !held; j++)
          held = sprout_str_same(carried_ones[j].instance->id, nearest->things[i]->instance->id);
        if (!held) break;
      }
      if (i == nearest->count) return expr_engine(context->nouns.frame, "a set named outward held only what is carried.");
      thing->candidate = nearest->things[i];
      thing->near = nearest->near;
      thing->literal = nearest->literal;
      thing->by_name = nearest->by_name > 0;
      thing->pronoun = PARSE_PRONOUN_NONE;
      out->fills = PARSE_FILLS_OUTWARD;
      out->things = thing;
      out->thing_count = 1;
      return SPROUT_EVAL_OK;
    }
  }
  if (found.found == PARSE_FOUND_NOTHING) {
    out->fills = PARSE_FILLS_NOTHING;
    out->start = found.start;
    out->end = found.end;
  } else {
    out->fills = PARSE_FILLS_UNFIT;
  }
  return SPROUT_EVAL_OK;
}

/* What an exit role's words name: a way out that applies, one that refuses, a direction none answers, a way out of reach, or no way at all. Asking is a step. */
static sprout_eval_status exit_filled(const parse_fill_context *context, parse_words words, parse_filled *out) {
  const sprout_frame *frame = context->nouns.frame;
  const sprout_way *way;
  memset(out, 0, sizeof *out);
  EXPR_NEED(expr_spend(frame));
  way = parse_exit_named(&frame->world->graph, words, context->ways, context->way_count);
  if (way == NULL) {
    const char *direction = words.count == 1 ? parse_direction_of(words.words[0]) : NULL;
    if (direction != NULL) {
      out->fills = PARSE_FILLS_NO_WAY;
      out->direction = direction;
    } else if (parse_way_label(frame->world, words)) {
      out->fills = PARSE_FILLS_NOTHING;
      out->end = words.count;
    } else {
      out->fills = PARSE_FILLS_UNFIT;
    }
    return SPROUT_EVAL_OK;
  }
  out->way = way;
  if (way->refuses) {
    out->fills = PARSE_FILLS_REFUSED;
    return SPROUT_EVAL_OK;
  }
  out->fills = PARSE_FILLS_OPTIONS;
  out->literal = parse_label_words(words).count;
  return SPROUT_EVAL_OK;
}

sprout_eval_status parse_fill_slot(const parse_fill_context *context, const sprout_role *role, parse_words words,
                                   parse_filled *out) {
  parse_stretch *items;
  parse_later *later;
  size_t item_count, i;
  memset(out, 0, sizeof *out);
  if (role->filler == SPROUT_FILLER_SYMBOL || role->filler == SPROUT_FILLER_INTEGER) {
    out->fills = PARSE_FILLS_WORDS;
    return SPROUT_EVAL_OK;
  }
  if (role->filler == SPROUT_FILLER_EXIT) return exit_filled(context, words, out);
  if (role->many) return set_filled(context, role, words, out);
  items = (parse_stretch *)sprout_arena_take(context->nouns.frame->turn, (words.count + 2) * sizeof *items);
  if (items == NULL) return SPROUT_EVAL_NO_MEMORY;
  /* `all` is no thing of a run, before it or after it. */
  if (parse_holds_all(words, items)) {
    out->fills = PARSE_FILLS_UNFIT;
    return SPROUT_EVAL_OK;
  }
  EXPR_NEED(parse_items_of_run(&context->nouns, words, role, context->candidates, context->candidate_count, items,
                               &item_count));
  if (item_count == 0) return carried_filled(context, words, role->carried, fits_role, role, out);
  EXPR_NEED(carried_filled(context, slice(words, items[0].start, items[0].end), role->carried, fits_role, role, out));
  if (out->fills == PARSE_FILLS_NOTHING) {
    out->start += items[0].start;
    out->end += items[0].start;
    return SPROUT_EVAL_OK;
  }
  if (out->fills != PARSE_FILLS_OPTIONS) return SPROUT_EVAL_OK;
  later = (parse_later *)sprout_arena_take(context->nouns.frame->turn, item_count * sizeof *later);
  if (later == NULL) return SPROUT_EVAL_NO_MEMORY;
  for (i = 1; i < item_count; i++) {
    later[i - 1].start = items[i].start;
    later[i - 1].end = items[i].end;
    EXPR_NEED(carried_filled(context, slice(words, items[i].start, items[i].end), role->carried, fits_role, role,
                             &later[i - 1].filled));
  }
  out->fills = PARSE_FILLS_RUN;
  out->later = later;
  out->later_count = item_count - 1;
  return SPROUT_EVAL_OK;
}

sprout_eval_status parse_fill_intent_slot(const parse_fill_context *context, const sprout_role *const *roles,
                                          size_t role_count, parse_words words, parse_filled *out) {
  given g;
  size_t i;
  bool carried = false;
  g.roles = roles;
  g.count = role_count;
  for (i = 0; i < role_count; i++) carried = carried || roles[i]->carried;
  return carried_filled(context, words, carried, fits_given, &g, out);
}

/* Whether `words` spell `role`'s value: an option's name, the words joined by `_`, or a whole number JavaScript holds exactly. */
static sprout_eval_status spelt(const sprout_frame *frame, const sprout_role *role, parse_words words, bool *spells,
                                sprout_stored_bound *value) {
  size_t i, at, length = 0;
  char *option;
  *spells = false;
  memset(value, 0, sizeof *value);
  value->kind = SPROUT_BOUND_VALUE;
  if (role->filler == SPROUT_FILLER_INTEGER) {
    const sprout_str word = words.words[0];
    bool negative;
    uint64_t number = 0;
    if (words.count != 1 || word.length == 0) return SPROUT_EVAL_OK;
    negative = word.bytes[0] == '-';
    at = negative ? 1 : 0;
    if (at == word.length) return SPROUT_EVAL_OK;
    for (i = at; i < word.length; i++)
      if (word.bytes[i] < '0' || word.bytes[i] > '9') return SPROUT_EVAL_OK;
    while (at + 1 < word.length && word.bytes[at] == '0') at++;
    if (word.length - at > 16) return SPROUT_EVAL_OK;
    for (i = at; i < word.length; i++) number = number * 10 + (uint64_t)(word.bytes[i] - '0');
    if (number > 9007199254740991u) return SPROUT_EVAL_OK;
    value->value_number = negative && number != 0 ? -(double)number : (double)number;
    *spells = true;
    return SPROUT_EVAL_OK;
  }
  for (i = 0; i < words.count; i++) length += words.words[i].length + 1;
  option = (char *)sprout_arena_take(frame->turn, length + 1);
  if (option == NULL) return SPROUT_EVAL_NO_MEMORY;
  for (i = 0, at = 0; i < words.count; i++) {
    if (i > 0) option[at++] = '_';
    memcpy(option + at, words.words[i].bytes, words.words[i].length);
    at += words.words[i].length;
  }
  option[at] = '\0';
  if (at == 0 || option[0] < 'a' || option[0] > 'z') return SPROUT_EVAL_OK;
  for (i = 1; i < at; i++) {
    char c = option[i];
    if (!((c >= 'a' && c <= 'z') || (c >= '0' && c <= '9') || c == '_')) return SPROUT_EVAL_OK;
  }
  value->value_is_string = true;
  value->value_string.bytes = option;
  value->value_string.length = at;
  *spells = true;
  return SPROUT_EVAL_OK;
}

sprout_eval_status parse_value_of(sprout_exec *x, const sprout_frame *frame, const sprout_resolved *reading,
                                  const sprout_role *role, parse_words words, bool *bound, sprout_stored_bound *value) {
  parse_words forms[2];
  size_t count = parse_forms(words, forms), i;
  *bound = false;
  for (i = 0; i < count && !*bound; i++) {
    bool spells;
    EXPR_NEED(spelt(frame, role, forms[i], &spells, value));
    if (spells) EXPR_NEED(sprout_value_heard(x, frame, reading, role, value, bound));
  }
  return SPROUT_EVAL_OK;
}
