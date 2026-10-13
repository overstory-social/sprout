/*
 * A typed line read as the command turn it begins reads it (the spec's Parsing > Matching a line, When nothing
 * matches; Verbs > Exits; The runtime > Turns): over a draft of the committed state that is never committed, under a
 * command turn's meter and the stream begun from the host's seed, so the steps it spends and the draws it makes are
 * the turn's own. The order is the TypeScript parser's, since every step is charged where it is: the ways out of the
 * actor's place, then the words, then what the actor can reach, then each placement of each phrase, a step, with
 * what its slots' words fill their roles with. A line no placement reads, where none names a thing it cannot take,
 * is `not_here` where a placement's way out is one the world writes elsewhere, and otherwise `unknown`; what this
 * runtime does not read yet is refused in words naming it.
 */
#include <string.h>

#include "../exec.h"
#include "../exits.h"
#include "../expr/expr.h"
#include "../prose/prose.h"
#include "../turn.h"
#include "../typed.h"
#include "parse.h"

sprout_str parse_without_question(sprout_str line) {
  size_t at = 0, width, end = 0;
  bool before = false;
  sprout_str rest;
  while (at < line.length) {
    if (!prose_is_space(prose_decode(line.bytes, line.length, at, &width))) end = at + width;
    at += width;
  }
  if (end == 0 || line.bytes[end - 1] != '?') return line;
  for (at = 0; at < end - 1 && !before; at += width)
    before = !prose_is_space(prose_decode(line.bytes, end - 1, at, &width));
  if (!before) return line;
  rest.bytes = line.bytes;
  rest.length = end - 1;
  return rest;
}

#ifdef SPROUT_NO_PARSER

sprout_status sprout_parse(sprout_world *world, sprout_state *state, const sprout_host *host, const char *visit,
                           const char *line, size_t length, const sprout_handed *handed, sprout_arena *keep,
                           sprout_parsed *out) {
  static const char words[] = "this runtime was built without the parser, so it reads no typed line.";
  (void)world, (void)state, (void)host, (void)visit, (void)line, (void)length, (void)handed, (void)keep;
  if (out == NULL) return SPROUT_BAD_HOST;
  memset(out, 0, sizeof *out);
  memcpy(out->fault.text, words, sizeof words);
  return SPROUT_BAD_INPUT;
}

#else

/* One read of a line: the turn it is read under, who typed it, where they stand, and where the outcome goes. */
typedef struct reader {
  turn_run run;
  sprout_frame frame;
  sprout_str actor, here;
  const sprout_str *referents; /* what the actor's pronouns name */
  size_t referent_count;
  sprout_arena *keep;
  sprout_parsed *out;
} reader;

/* Words for a call the runtime will not read, in the outcome's fault text; SPROUT_BAD_INPUT. */
static sprout_status refuse(sprout_parsed *out, const char *before, const char *name, const char *after) {
  size_t room = sizeof out->fault.text, used = 0, i;
  const char *parts[3];
  parts[0] = before;
  parts[1] = name;
  parts[2] = after;
  for (i = 0; i < 3; i++) {
    size_t n = strlen(parts[i]);
    if (n > room - used - 1) n = room - used - 1;
    memcpy(out->fault.text + used, parts[i], n);
    used += n;
  }
  out->fault.text[used] = '\0';
  return SPROUT_BAD_INPUT;
}

static bool kept(sprout_arena *keep, sprout_str from, sprout_str *to) {
  to->bytes = sprout_arena_copy(keep, from.bytes, from.length);
  to->length = from.length;
  return to->bytes != NULL;
}

/* One slot's words, filled for one role, kept while its phrase is tried. */
typedef struct memo {
  size_t role, start, end;
  parse_filled filled;
} memo;

/* One phrase tried against the line: the fills its placements share, and what they came to. */
typedef struct trying {
  const sprout_typed_phrase *phrase;        /* a verb's phrase, or NULL for an intent's */
  const sprout_typed_intent_phrase *intent; /* an intent's phrase, or NULL */
  parse_words words;
  parse_fill_context fill;
  memo *memos;
  size_t memo_count, memo_capacity;
  const parse_filled **fills; /* the placement's, by span */
  const char *owner;          /* what this runtime does not read yet, which the line came to; NULL while it reads on */
  bool not_here;              /* a placement's way out is one the world writes, not here */
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
  *roles = (const sprout_role **)sprout_arena_take(t->fill.nouns.frame->turn, (room + 1) * sizeof **roles);
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

/*
 * The memo of what the words of `span` fill its role with, filled once for the phrase: its index, or `memo_count`
 * where `all` stands there, which the readings own.
 */
static sprout_eval_status fill_of(trying *t, const parse_span *span, size_t *at) {
  parse_words words = words_between(t->words, span->start, span->end);
  memo *slot;
  parse_filled filled;
  for (*at = 0; *at < t->memo_count; (*at)++)
    if (t->memos[*at].role == span->role && t->memos[*at].start == span->start && t->memos[*at].end == span->end)
      return SPROUT_EVAL_OK;
  if (t->phrase != NULL) {
    const sprout_role *role = &t->phrase->verb->roles[span->role];
    if (parse_is_all(words.words[0]) && (role->filler == SPROUT_FILLER_OPEN || role->filler == SPROUT_FILLER_KIND))
      return SPROUT_EVAL_OK;
    EXPR_NEED(parse_fill_slot(&t->fill, role, words, &filled));
  } else {
    const sprout_role **roles;
    size_t count;
    EXPR_NEED(slot_roles(t, span->role, &roles, &count));
    EXPR_NEED(parse_fill_intent_slot(&t->fill, roles, count, words, &filled));
  }
  slot = (memo *)sprout_exec_grow(t->fill.nouns.frame->turn, (void **)&t->memos, &t->memo_count, &t->memo_capacity,
                                  sizeof *t->memos);
  if (slot == NULL) return SPROUT_EVAL_NO_MEMORY;
  slot->role = span->role;
  slot->start = span->start;
  slot->end = span->end;
  slot->filled = filled;
  *at = t->memo_count - 1;
  return SPROUT_EVAL_OK;
}

/* Whether a placement's fills make a partial reading: a slot names what it cannot take, or only what is not carried, and every slot fills. */
static bool reads_in_part(const parse_filled *const *fills, size_t count) {
  size_t i;
  bool unfit = false, outward = false;
  for (i = 0; i < count; i++) {
    unfit = unfit || fills[i]->fills == PARSE_FILLS_UNFIT;
    outward = outward || fills[i]->fills == PARSE_FILLS_OUTWARD;
  }
  if (!unfit && !outward) return false;
  for (i = 0; i < count; i++) {
    const parse_filled *one = fills[i];
    size_t options;
    switch (one->fills) {
      case PARSE_FILLS_NOTHING:
      case PARSE_FILLS_REFUSED:
      case PARSE_FILLS_NO_WAY:
        return false;
      case PARSE_FILLS_WORDS:
        continue;
      case PARSE_FILLS_OPTIONS:
        options = one->way != NULL ? 1 : one->thing_count + one->set_count;
        break;
      default:
        options = one->thing_count;
        break;
    }
    if (options == 0) return false;
  }
  return true;
}

static bool any_fills(const parse_filled *const *fills, size_t count, parse_fills which) {
  size_t i;
  for (i = 0; i < count; i++)
    if (fills[i]->fills == which) return true;
  return false;
}

/* One placement of the phrase's slots: a step, its fills, and what they come to. */
static sprout_eval_status placed(void *context, const parse_span *spans, size_t count) {
  trying *t = (trying *)context;
  const parse_filled **fills = t->fills;
  size_t i, at, runs = 0;
  if (t->owner != NULL) return SPROUT_EVAL_OK;
  EXPR_NEED(expr_spend(t->fill.nouns.frame));
  for (i = 0; i < count; i++) {
    EXPR_NEED(fill_of(t, &spans[i], &at));
    if (at == t->memo_count) {
      t->owner = "`all` in a slot";
      return SPROUT_EVAL_OK;
    }
  }
  /* The memos may move as they grow, so each is found once they are all filled. */
  for (i = 0; i < count; i++) {
    EXPR_NEED(fill_of(t, &spans[i], &at));
    fills[i] = &t->memos[at].filled;
  }
  if ((t->phrase == NULL || t->phrase->only == NULL) && reads_in_part(fills, count)) {
    t->owner = "a line some phrase reads in part";
    return SPROUT_EVAL_OK;
  }
  if (any_fills(fills, count, PARSE_FILLS_UNFIT) || any_fills(fills, count, PARSE_FILLS_OUTWARD)) return SPROUT_EVAL_OK;
  if (t->phrase != NULL && (any_fills(fills, count, PARSE_FILLS_REFUSED) || any_fills(fills, count, PARSE_FILLS_NO_WAY))) {
    t->owner = "a way out that refuses, or a direction no way out answers,";
    return SPROUT_EVAL_OK;
  }
  if (any_fills(fills, count, PARSE_FILLS_NOTHING)) {
    if (t->phrase == NULL || t->phrase->only != NULL) {
      t->owner = t->phrase == NULL ? "a noun that names nothing in reach" : "an object's synonym out of reach";
      return SPROUT_EVAL_OK;
    }
    /* A way out's label names nothing only by being one the world writes; a noun's words are asked of the world's. */
    for (i = 0; i < count; i++)
      if (fills[i]->fills == PARSE_FILLS_NOTHING && t->phrase->verb->roles[spans[i].role].filler != SPROUT_FILLER_EXIT) {
        t->owner = "a noun that names nothing in reach";
        return SPROUT_EVAL_OK;
      }
    t->not_here = true;
    return SPROUT_EVAL_OK;
  }
  /* One role runs once for each of several things, never two. */
  for (i = 0; i < count; i++)
    if (fills[i]->fills == PARSE_FILLS_RUN) runs++;
  if (runs > 1) return SPROUT_EVAL_OK;
  t->owner = "a line a phrase reads";
  return SPROUT_EVAL_OK;
}

/*
 * Tries every phrase of the world's and its intents' against `words`, each with its fills in an arena rewound for the
 * next; `owner` is set where the line comes to what this runtime does not read yet.
 */
static sprout_eval_status phrases_read(reader *r, parse_words words, const parse_candidate *candidates,
                                       size_t candidate_count, const sprout_way *ways, size_t way_count,
                                       const char **owner, bool *not_here) {
  const sprout_world *world = r->run.world;
  sprout_arena scratch;
  sprout_frame frame = r->frame;
  trying t;
  size_t i, most = 0;
  sprout_eval_status status = SPROUT_EVAL_OK;
  *owner = NULL;
  *not_here = false;
  for (i = 0; i < world->phrase_count; i++)
    if (world->phrases[i].part_count > most) most = world->phrases[i].part_count;
  for (i = 0; i < world->intent_phrase_count; i++)
    if (world->intent_phrases[i].part_count > most) most = world->intent_phrases[i].part_count;
  if (sprout_arena_init(&scratch, r->run.host) != SPROUT_OK) return SPROUT_EVAL_NO_MEMORY;
  frame.turn = &scratch;
  memset(&t, 0, sizeof t);
  t.words = words;
  t.fill.nouns.frame = &frame;
  t.fill.nouns.referents = r->referents;
  t.fill.nouns.referent_count = r->referent_count;
  t.fill.candidates = candidates;
  t.fill.candidate_count = candidate_count;
  t.fill.ways = ways;
  t.fill.way_count = way_count;
  for (i = 0; status == SPROUT_EVAL_OK && t.owner == NULL && i < world->phrase_count + world->intent_phrase_count; i++) {
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
  sprout_arena_reset(&scratch);
  *owner = t.owner;
  *not_here = t.not_here;
  return status;
}

static bool is_word(sprout_str word, const char *text) {
  return word.length == strlen(text) && memcmp(word.bytes, text, word.length) == 0;
}

/*
 * Whether an `and` or a comma might join two commands: one with words after it and a word not a comma before it
 * (the spec's Parsing > Sequences, again and all). Which of them do is decided by the words after each.
 */
static bool may_chain(const sprout_str *words, size_t count) {
  size_t at;
  bool before = false;
  for (at = 0; at + 1 < count; at++) {
    bool connector = is_word(words[at], "and") || is_word(words[at], ",");
    if (connector && before) return true;
    if (!is_word(words[at], ",")) before = true;
  }
  return false;
}

/* The answer `name`, said to the actor where they stand, with `actor` and `here` bound. */
static sprout_status answer(reader *r, const char *name) {
  sprout_parsed *out = r->out;
  sprout_speech said;
  sprout_str by;
  sprout_said_binding *bound = (sprout_said_binding *)sprout_arena_take(r->keep, 2 * sizeof *bound);
  if (bound == NULL) return SPROUT_NO_MEMORY;
  sprout_engine_said(&r->frame, name, &r->actor, &r->here, &by, &said);
  out->end = SPROUT_PARSED_ANSWERED;
  out->line = said.name;
  if (said.kind == SPROUT_SPEECH_ENGINE) out->words = prose_stock_words(said.name);
  out->absent = said.kind == SPROUT_SPEECH_ABSENT;
  bound[0].name = "actor";
  bound[0].object = true;
  bound[1].name = "here";
  bound[1].object = true;
  if (!kept(r->keep, by, &out->by) || !kept(r->keep, r->actor, &bound[0].text) || !kept(r->keep, r->here, &bound[1].text))
    return SPROUT_NO_MEMORY;
  out->bindings = bound;
  out->binding_count = 2;
  return SPROUT_OK;
}

/* A read that faulted: the turn it begins is abandoned, as one whose parse spends its budget is. */
static void faulted(reader *r) {
  sprout_parsed *out = r->out;
  out->end = SPROUT_PARSED_FAULTED;
  if (r->run.meter->faulted) {
    out->fault = r->run.meter->fault;
    out->fault_name = "BudgetExhausted";
    return;
  }
  out->fault_name = r->run.fault.name == NULL ? "Error" : r->run.fault.name;
  out->fault.budget = out->fault_name;
  memcpy(out->fault.text, r->run.fault.text, sizeof out->fault.text - 1);
  out->fault.text[sizeof out->fault.text - 1] = '\0';
}

/* Reads the words of a line typed by the actor, who stands in a place; anything but SPROUT_OK leaves `out` refused. */
static sprout_status read_line(reader *r, const sprout_stored_visitor *visitor, sprout_str line) {
  const sprout_way *ways;
  parse_candidate *candidates;
  sprout_str *words;
  size_t way_count, candidate_count, count;
  const char *owner;
  bool not_here;
  parse_words typed;
  sprout_eval_status status = sprout_ways_from(&r->frame, r->here, &ways, &way_count);
  if (status == SPROUT_EVAL_NO_MEMORY) return SPROUT_NO_MEMORY;
  if (status != SPROUT_EVAL_OK) {
    faulted(r);
    return SPROUT_OK;
  }
  if (typed_words(&r->run.scratch, parse_without_question(line), &words, &count) != SPROUT_OK) return SPROUT_NO_MEMORY;
  if (count == 0) return answer(r, "unknown");
  status = parse_reach_of(&r->frame, r->actor, &candidates, &candidate_count);
  if (status == SPROUT_EVAL_NO_MEMORY) return SPROUT_NO_MEMORY;
  if (status != SPROUT_EVAL_OK) {
    faulted(r);
    return SPROUT_OK;
  }
  if (count == 1 && (is_word(words[0], "again") || is_word(words[0], "g"))) {
    if (!visitor->has_reading) return answer(r, "unknown");
    return refuse(r->out, "", "`again` after a reading", " is not read by this runtime yet.");
  }
  if (may_chain(words, count))
    return refuse(r->out, "", "a line `and` or a comma may split", " is not read by this runtime yet.");
  typed.words = words;
  typed.count = count;
  status = phrases_read(r, typed, candidates, candidate_count, ways, way_count, &owner, &not_here);
  if (status == SPROUT_EVAL_NO_MEMORY) return SPROUT_NO_MEMORY;
  if (status != SPROUT_EVAL_OK) {
    faulted(r);
    return SPROUT_OK;
  }
  if (owner != NULL) return refuse(r->out, "", owner, " is not read by this runtime yet.");
  return answer(r, not_here ? "not_here" : "unknown");
}

sprout_status sprout_parse(sprout_world *world, sprout_state *state, const sprout_host *host, const char *visit,
                           const char *line, size_t length, const sprout_handed *handed, sprout_arena *keep,
                           sprout_parsed *out) {
  reader r;
  const sprout_stored_visitor *visitor;
  const sprout_stored_instance *instance;
  sprout_status status;
  if (out == NULL || keep == NULL) return SPROUT_BAD_HOST;
  memset(out, 0, sizeof *out);
  if (world == NULL || state == NULL || host == NULL || host->seed == NULL || visit == NULL || line == NULL)
    return refuse(out, "a parse names a world, a state, a host with a seed, a visit and a line.", "", "");
  if (handed != NULL) return refuse(out, "", "a turn a line handed", " is not read by this runtime yet.");
  memset(&r, 0, sizeof r);
  r.keep = keep;
  r.out = out;
  status = turn_open(&r.run, world, state, host, SPROUT_TURN_COMMAND, host->seed(host->ctx), 0, NULL, NULL);
  if (status != SPROUT_OK) return status;
  visitor = sprout_draft_visitor(&r.run.draft, (sprout_str){visit, strlen(visit)});
  instance = visitor == NULL ? NULL : sprout_draft_instance(&r.run.draft, visitor->instance);
  if (visitor == NULL) {
    status = refuse(out, "`", visit, "` has never visited this world.");
  } else if (instance == NULL || !instance->has_container) {
    status = refuse(out, "`", visit, "` is not in this world, so cannot type in it.");
  } else {
    r.actor = visitor->instance;
    r.here = instance->container;
    r.referents = visitor->referents;
    r.referent_count = visitor->referent_count;
    r.frame = sprout_exec_frame(&r.run.x, r.actor, NULL, NULL);
    if (!turn_stands_in_place(&r.frame, r.actor))
      status = refuse(out, "`", visit, "` stands in a place that is gone: the turn moves them, and reads nothing.");
    else
      status = read_line(&r, visitor, (sprout_str){line, length});
  }
  out->steps = r.run.meter->steps;
  turn_drop(&r.run);
  if (status != SPROUT_OK) {
    char text[sizeof out->fault.text];
    memcpy(text, out->fault.text, sizeof text);
    memset(out, 0, sizeof *out);
    memcpy(out->fault.text, text, sizeof text);
  }
  return status;
}

#endif
