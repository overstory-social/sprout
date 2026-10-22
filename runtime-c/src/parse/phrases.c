/*
 * Every phrase of the world's and its intents' tried against a line's words (the spec's Parsing > Matching a line,
 * When nothing matches): each placement of each phrase a step, with what its slots' words fill their roles with, the
 * readings and partial readings it makes, and what a line no reading reads is answered by. Where nothing reads the
 * line whole, its first words are tried, the longest first, so words left over are dropped; never inside a noun that
 * names nothing in reach unless its words before the cut name something by a noun, never past such a noun in a slot
 * of its own, since a thing the visitor named that is not here is `not_here`, and
 * never past `and`, a comma or `except`, which join a run's items or two commands, or leave things out of `all`,
 * rather than trail.
 */
#include <string.h>

#include "../expr/expr.h"
#include "parse.h"

/* One slot's words, filled for one role, kept while its phrase is tried. */
typedef struct memo {
  size_t role, start, end;
  parse_filled filled;
} memo;

/* One walk of the phrases: the phrase tried now, its slots' fills, and where what it comes to is kept. */
typedef struct trying {
  const sprout_typed_phrase *phrase;        /* a verb's phrase, or NULL for an intent's */
  const sprout_typed_intent_phrase *intent; /* an intent's phrase, or NULL */
  parse_all_context all;
  sprout_exec *x;
  sprout_arena *keep; /* the turn's arena, where a reading made outlives its phrase */
  memo *memos;
  size_t memo_count, memo_capacity;
  const parse_filled **fills; /* the placement's, by span */
  parse_tried *out;
} trying;

static parse_words words_between(parse_words words, size_t start, size_t end) {
  parse_words part;
  part.words = words.words + start;
  part.count = end - start;
  return part;
}

/* The roles an intent's slot is given to, every step's in order. */
static sprout_eval_status slot_roles(const trying *t, size_t slot, const sprout_role ***roles, size_t *count) {
  const sprout_intent *intent = t->intent->intent;
  size_t s, f, r, room = 0;
  for (s = 0; s < intent->step_count; s++) room += intent->steps[s].filler_count;
  *count = 0;
  *roles = (const sprout_role **)sprout_arena_take(t->all.fill.nouns.frame->turn, (room + 1) * sizeof **roles);
  if (*roles == NULL) return SPROUT_EVAL_NO_MEMORY;
  for (s = 0; s < intent->step_count; s++) {
    const sprout_intent_step *step = &intent->steps[s];
    for (f = 0; f < step->filler_count; f++) {
      if (step->filler_slots[f] != slot) continue;
      for (r = 0; r < step->verb->role_count; r++)
        if (strcmp(step->verb->roles[r].name, step->filler_roles[f]) == 0) (*roles)[(*count)++] = &step->verb->roles[r];
    }
  }
  return SPROUT_EVAL_OK;
}

/* The memo of what the words of `span` fill its role with, `all` read first, filled once for the phrase: its index. */
static sprout_eval_status fill_of(trying *t, const parse_span *span, size_t *at) {
  parse_words words = words_between(t->out->words, span->start, span->end);
  memo *slot;
  parse_filled filled;
  for (*at = 0; *at < t->memo_count; (*at)++)
    if (t->memos[*at].role == span->role && t->memos[*at].start == span->start && t->memos[*at].end == span->end)
      return SPROUT_EVAL_OK;
  if (t->phrase != NULL) {
    const sprout_role *role = &t->phrase->verb->roles[span->role];
    bool all;
    EXPR_NEED(parse_all_in(&t->all, words, role, t->phrase->verb, &all, &filled));
    if (!all) EXPR_NEED(parse_fill_slot(&t->all.fill, role, words, &filled));
  } else {
    const sprout_role **roles;
    size_t count;
    EXPR_NEED(slot_roles(t, span->role, &roles, &count));
    EXPR_NEED(parse_fill_intent_slot(&t->all.fill, roles, count, words, &filled));
  }
  slot = (memo *)sprout_exec_grow(t->all.fill.nouns.frame->turn, (void **)&t->memos, &t->memo_count,
                                  &t->memo_capacity, sizeof *t->memos);
  if (slot == NULL) return SPROUT_EVAL_NO_MEMORY;
  slot->role = span->role;
  slot->start = span->start;
  slot->end = span->end;
  slot->filled = filled;
  *at = t->memo_count - 1;
  return SPROUT_EVAL_OK;
}

static bool any_fills(const parse_filled *const *fills, size_t count, parse_fills which) {
  size_t i;
  for (i = 0; i < count; i++)
    if (fills[i]->fills == which) return true;
  return false;
}

/*
 * Whether the visitor's hands hold nothing they can see and `fill`, `all` that left nothing, is in a role whose things
 * they carry: a carried role, or one the actor's own sure move takes away from them.
 */
static sprout_eval_status empty_handed_all(const trying *t, const parse_span *span, const parse_filled *fill, bool *out) {
  const sprout_role *role;
  size_t i;
  *out = false;
  if (t->phrase == NULL || !fill->all || (fill->fills != PARSE_FILLS_ALL && fill->fills != PARSE_FILLS_NOTHING))
    return SPROUT_EVAL_OK;
  if (fill->fills == PARSE_FILLS_NOTHING && (fill->start != 0 || fill->end != 1)) return SPROUT_EVAL_OK;
  for (i = 0; i < t->all.fill.candidate_count; i++)
    if (t->all.fill.candidates[i].carried) return SPROUT_EVAL_OK;
  role = &t->phrase->verb->roles[span->role];
  *out = role->carried;
  if (!*out) EXPR_NEED(sprout_moves_its_filler_away(t->all.fill.nouns.frame, t->phrase->verb, role, t->all.actor, out));
  return SPROUT_EVAL_OK;
}

/* `noun` added to `nouns`, in `arena`. */
static bool kept_noun(sprout_arena *arena, parse_stretch **nouns, size_t *count, size_t *capacity, parse_stretch noun) {
  parse_stretch *slot = (parse_stretch *)sprout_exec_grow(arena, (void **)nouns, count, capacity, sizeof **nouns);
  if (slot == NULL) return false;
  *slot = noun;
  return true;
}

/* The nouns of a placement that name nothing in reach, where they run in the line, kept in the turn's arena. */
static sprout_eval_status missing_in(trying *t, const parse_span *spans, const parse_filled *const *fills, size_t count) {
  parse_tried *out = t->out;
  size_t i;
  for (i = 0; i < count; i++) {
    parse_stretch noun;
    if (fills[i]->fills != PARSE_FILLS_NOTHING) continue;
    noun.start = spans[i].start + fills[i]->start;
    noun.end = spans[i].start + fills[i]->end;
    if (!out->missing || noun.start > out->missing_from) out->missing_from = noun.start;
    out->missing = true;
    if (!kept_noun(t->keep, &out->missing_nouns, &out->missing_count, &out->missing_capacity, noun))
      return SPROUT_EVAL_NO_MEMORY;
  }
  return SPROUT_EVAL_OK;
}

/* One placement of the phrase's slots: a step, its fills, what they come to, and the readings they make. */
static sprout_eval_status placed(void *context, const parse_span *spans, size_t count) {
  trying *t = (trying *)context;
  parse_tried *out = t->out;
  const sprout_frame *frame = t->all.fill.nouns.frame;
  const parse_filled **fills = t->fills;
  parse_placement placement;
  size_t i, at, several = 0;
  bool nothing = false, named, empty;
  EXPR_NEED(expr_spend(frame));
  for (i = 0; i < count; i++) EXPR_NEED(fill_of(t, &spans[i], &at));
  /* The memos may move as they grow, so each is found once they are all filled. */
  for (i = 0; i < count; i++) {
    EXPR_NEED(fill_of(t, &spans[i], &at));
    fills[i] = &t->memos[at].filled;
  }
  placement.phrase = t->phrase;
  placement.intent = t->intent;
  placement.words = out->words;
  placement.spans = spans;
  placement.count = count;
  placement.fills = fills;
  /* An object's synonym reads only where the object takes part, so what it names in part is not about it. */
  if (t->phrase == NULL || t->phrase->only == NULL) EXPR_NEED(parse_partials_of(frame, &placement, t->keep, &out->partials));
  if (any_fills(fills, count, PARSE_FILLS_UNFIT) || any_fills(fills, count, PARSE_FILLS_OUTWARD)) return SPROUT_EVAL_OK;
  for (i = 0; i < count; i++) {
    if (fills[i]->fills != PARSE_FILLS_REFUSED && fills[i]->fills != PARSE_FILLS_NO_WAY) continue;
    if (!out->has_going && t->phrase != NULL && t->phrase->only == NULL) {
      out->has_going = true;
      out->going = *fills[i];
    }
    return SPROUT_EVAL_OK;
  }
  for (i = 0; i < count; i++)
    if (fills[i]->narrowed && fills[i]->fills == PARSE_FILLS_NOTHING && fills[i]->start == 0 && fills[i]->end == 1)
      out->narrowed_nothing = true;
  for (i = 0; i < count && !out->empty_handed; i++)
    if (fills[i]->fills == PARSE_FILLS_NOTHING) {
      EXPR_NEED(empty_handed_all(t, &spans[i], fills[i], &empty));
      out->empty_handed = empty;
    }
  if (any_fills(fills, count, PARSE_FILLS_NOTHING)) {
    /* An object's synonym typed where the object is out of reach. */
    if (t->phrase != NULL && t->phrase->only != NULL) {
      EXPR_NEED(parse_offered_out_of_reach(&t->all.fill, &placement, &named));
    } else {
      named = true;
    }
    if (named) EXPR_NEED(missing_in(t, spans, fills, count));
    out->not_here = out->not_here || named;
    return SPROUT_EVAL_OK;
  }
  /* One role runs once for each of several things, never two. */
  for (i = 0; i < count; i++)
    if (fills[i]->fills == PARSE_FILLS_RUN || fills[i]->fills == PARSE_FILLS_ALL) several++;
  if (several > 1) return SPROUT_EVAL_OK;
  EXPR_NEED(parse_placement_readings(t->x, frame, t->all.actor, &placement, t->keep, &out->readings, &nothing));
  out->not_here = out->not_here || nothing;
  for (i = 0; i < count && nothing; i++) out->narrowed_nothing = out->narrowed_nothing || fills[i]->narrowed;
  for (i = 0; i < count && nothing && !out->empty_handed; i++) {
    EXPR_NEED(empty_handed_all(t, &spans[i], fills[i], &empty));
    out->empty_handed = empty;
  }
  return SPROUT_EVAL_OK;
}

sprout_eval_status parse_phrases_read(const parse_line *line, parse_words words, parse_tried *out) {
  const sprout_world *world = line->run->world;
  sprout_arena scratch, *turn = line->run->x.turn;
  sprout_frame frame = line->frame;
  size_t i, most = 0;
  sprout_eval_status status = SPROUT_EVAL_OK;
  trying t;
  for (i = 0; i < world->phrase_count; i++)
    if (world->phrases[i].part_count > most) most = world->phrases[i].part_count;
  for (i = 0; i < world->intent_phrase_count; i++)
    if (world->intent_phrases[i].part_count > most) most = world->intent_phrases[i].part_count;
  if (sprout_arena_init(&scratch, line->run->host) != SPROUT_OK) return SPROUT_EVAL_NO_MEMORY;
  /* What a consent pass builds is scratch too, so the exec takes it from the phrase's arena while the phrases are tried. */
  frame.turn = &scratch;
  line->run->x.turn = &scratch;
  memset(out, 0, sizeof *out);
  memset(&t, 0, sizeof t);
  out->words = words;
  t.out = out;
  t.x = &line->run->x;
  t.keep = turn;
  t.all.actor = line->actor;
  t.all.here = line->here;
  t.all.fill.nouns.frame = &frame;
  t.all.fill.nouns.referents = line->referents;
  t.all.fill.nouns.referent_count = line->referent_count;
  t.all.fill.candidates = line->candidates;
  t.all.fill.candidate_count = line->candidate_count;
  t.all.fill.ways = line->ways;
  t.all.fill.way_count = line->way_count;
  for (i = 0; status == SPROUT_EVAL_OK && i < world->phrase_count + world->intent_phrase_count; i++) {
    const sprout_typed_part *parts;
    size_t part_count;
    sprout_arena_rewind(&scratch);
    t.memos = NULL;
    t.memo_count = t.memo_capacity = 0;
    t.fills = (const parse_filled **)sprout_arena_take(&scratch, (most + 1) * sizeof *t.fills);
    if (t.fills == NULL) {
      status = SPROUT_EVAL_NO_MEMORY;
      break;
    }
    if (i < world->phrase_count) {
      t.phrase = &world->phrases[i];
      t.intent = NULL;
      parts = t.phrase->parts;
      part_count = t.phrase->part_count;
    } else {
      t.phrase = NULL;
      t.intent = &world->intent_phrases[i - world->phrase_count];
      parts = t.intent->parts;
      part_count = t.intent->part_count;
    }
    status = parse_slot_spans(&scratch, parts, part_count, words.words, words.count, placed, &t);
  }
  line->run->x.turn = turn;
  sprout_arena_reset(&scratch);
  return status;
}

/*
 * Whether every noun among `nouns` that `cut` falls inside keeps, before it, words that name something in reach by a
 * noun or its whole name, or a way out that applies: the noun at the front matches, so only what trails it is dropped,
 * and adjectives alone left of a name never stand for another thing.
 */
static sprout_eval_status front_named(const parse_line *line, parse_words words, const parse_stretch *nouns,
                                      size_t count, size_t cut, bool *named) {
  parse_noun_context context;
  size_t i;
  context.frame = &line->frame;
  context.referents = line->referents;
  context.referent_count = line->referent_count;
  *named = true;
  for (i = 0; i < count && *named; i++) {
    parse_words front = words_between(words, nouns[i].start, cut);
    if (nouns[i].start >= cut || cut >= nouns[i].end) continue;
    EXPR_NEED(parse_names_outright(&context, front, line->candidates, line->candidate_count, named));
    if (!*named) *named = parse_exit_named(&line->frame.world->graph, front, line->ways, line->way_count) != NULL;
  }
  return SPROUT_EVAL_OK;
}

sprout_eval_status parse_first_words_read(const parse_line *line, const parse_tried *whole, parse_tried *out,
                                          bool *read) {
  size_t cut = whole->words.count, past = whole->missing ? whole->missing_from : 0, i, count = 0, capacity = 0;
  parse_stretch *nouns = NULL;
  *read = false;
  for (i = 0; i < whole->missing_count; i++)
    if (!kept_noun(line->run->x.turn, &nouns, &count, &capacity, whole->missing_nouns[i])) return SPROUT_EVAL_NO_MEMORY;
  /* A run's later items, a command after `and` and what `except` leaves out are never words left over. */
  for (i = 0; i < whole->words.count; i++)
    if ((parse_is_connector(whole->words.words[i]) || parse_is(whole->words.words[i], "except")) && i > past) past = i;
  while (cut > 1 && cut - 1 > past) {
    bool named;
    cut--;
    EXPR_NEED(parse_phrases_read(line, words_between(whole->words, 0, cut), out));
    EXPR_NEED(front_named(line, whole->words, nouns, count, cut, &named));
    if (out->readings.count > 0 && named) {
      *read = true;
      return SPROUT_EVAL_OK;
    }
    if (out->missing && out->missing_from > past) past = out->missing_from;
    for (i = 0; i < out->missing_count; i++)
      if (!kept_noun(line->run->x.turn, &nouns, &count, &capacity, out->missing_nouns[i])) return SPROUT_EVAL_NO_MEMORY;
  }
  return SPROUT_EVAL_OK;
}
