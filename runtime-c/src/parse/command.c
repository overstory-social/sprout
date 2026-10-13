/*
 * A typed line read as the command turn it begins reads it (the spec's Parsing > Matching a line, Choosing a reading,
 * Pronouns, When nothing matches; Verbs > Exits; The runtime > Turns): over a draft of the committed state that is
 * never committed, under a command turn's meter and the stream begun from the host's seed, so the steps it spends and
 * the draws it makes are the turn's own. The order is the TypeScript parser's, since every step is charged where it
 * is: the ways out of the actor's place, then the words, then what the actor can reach, then each placement of each
 * phrase, a step, with what its slots' words fill their roles with and the readings they make. The best reading is
 * the one understood, a tie drawn; a line no reading reads is answered (answers.c): read in part, with `cannot` or
 * `not_carrying`; naming a way that does not go, with `no_way` or the exit's words; naming nothing in reach in the
 * world's words, with `not_here`; and otherwise `unknown`. What this runtime does not read yet, a sequence's parts,
 * is refused in words naming it, never answered wrongly.
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

/* What every phrase tried against the line came to, and where the readings are kept. */
typedef struct trying {
  const sprout_typed_phrase *phrase;        /* a verb's phrase, or NULL for an intent's */
  const sprout_typed_intent_phrase *intent; /* an intent's phrase, or NULL */
  parse_words words;
  parse_all_context all;
  sprout_exec *x;
  sprout_arena *keep; /* the turn's arena, where a reading made outlives its phrase */
  memo *memos;
  size_t memo_count, memo_capacity;
  const parse_filled **fills; /* the placement's, by span */
  parse_readings readings;
  parse_partials partials;   /* the partial readings tied for best, which the line is answered by where nothing reads */
  bool has_going;            /* a way out named does not go */
  parse_filled going;        /* the first: an exit that refuses, or a direction none answers */
  bool not_here;             /* a placement's noun names nothing in reach in the world's words, or `all` leaves nothing */
  bool read_words;           /* the world's words are read, once for the line */
  parse_vocabulary vocabulary;
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
  parse_words words = words_between(t->words, span->start, span->end);
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
 * Whether every noun of a placement that names nothing in reach is made of the world's words, read once for the line;
 * a way out's label names nothing only by being one the world writes, so it is not asked.
 */
static sprout_eval_status named_in_world(trying *t, const parse_placement *placement, bool *named) {
  size_t i;
  *named = true;
  for (i = 0; i < placement->count && *named; i++) {
    const parse_filled *one = placement->fills[i];
    const parse_span *span = &placement->spans[i];
    if (one->fills != PARSE_FILLS_NOTHING) continue;
    if (t->phrase != NULL && t->phrase->verb->roles[span->role].filler == SPROUT_FILLER_EXIT) continue;
    if (!t->read_words) EXPR_NEED(parse_world_words(t->all.fill.nouns.frame, t->keep, &t->vocabulary));
    t->read_words = true;
    *named = parse_in_vocabulary(words_between(t->words, span->start + one->start, span->start + one->end),
                                 &t->vocabulary);
  }
  return SPROUT_EVAL_OK;
}

/* One placement of the phrase's slots: a step, its fills, what they come to, and the readings they make. */
static sprout_eval_status placed(void *context, const parse_span *spans, size_t count) {
  trying *t = (trying *)context;
  const sprout_frame *frame = t->all.fill.nouns.frame;
  const parse_filled **fills = t->fills;
  parse_placement placement;
  size_t i, at, several = 0;
  bool nothing = false, named;
  EXPR_NEED(expr_spend(frame));
  for (i = 0; i < count; i++) EXPR_NEED(fill_of(t, &spans[i], &at));
  /* The memos may move as they grow, so each is found once they are all filled. */
  for (i = 0; i < count; i++) {
    EXPR_NEED(fill_of(t, &spans[i], &at));
    fills[i] = &t->memos[at].filled;
  }
  placement.phrase = t->phrase;
  placement.intent = t->intent;
  placement.words = t->words;
  placement.spans = spans;
  placement.count = count;
  placement.fills = fills;
  /* An object's synonym reads only where the object takes part, so what it names in part is not about it. */
  if (t->phrase == NULL || t->phrase->only == NULL) EXPR_NEED(parse_partials_of(frame, &placement, t->keep, &t->partials));
  if (any_fills(fills, count, PARSE_FILLS_UNFIT) || any_fills(fills, count, PARSE_FILLS_OUTWARD)) return SPROUT_EVAL_OK;
  for (i = 0; i < count; i++) {
    if (fills[i]->fills != PARSE_FILLS_REFUSED && fills[i]->fills != PARSE_FILLS_NO_WAY) continue;
    if (!t->has_going && t->phrase != NULL && t->phrase->only == NULL) {
      t->has_going = true;
      t->going = *fills[i];
    }
    return SPROUT_EVAL_OK;
  }
  if (any_fills(fills, count, PARSE_FILLS_NOTHING)) {
    /* An object's synonym typed where the object is out of reach. */
    if (t->phrase != NULL && t->phrase->only != NULL)
      EXPR_NEED(parse_offered_out_of_reach(&t->all.fill, &placement, &named));
    else
      EXPR_NEED(named_in_world(t, &placement, &named));
    t->not_here = t->not_here || named;
    return SPROUT_EVAL_OK;
  }
  /* One role runs once for each of several things, never two. */
  for (i = 0; i < count; i++)
    if (fills[i]->fills == PARSE_FILLS_RUN || fills[i]->fills == PARSE_FILLS_ALL) several++;
  if (several > 1) return SPROUT_EVAL_OK;
  EXPR_NEED(parse_placement_readings(t->x, frame, t->all.actor, &placement, t->keep, &t->readings, &nothing));
  t->not_here = t->not_here || nothing;
  return SPROUT_EVAL_OK;
}

/*
 * Tries every phrase of the world's and its intents' against `words`, each with its fills in an arena rewound for the
 * next, the readings they make, the partial readings and the world's words kept in the turn's.
 */
static sprout_eval_status phrases_read(reader *r, parse_words words, const parse_candidate *candidates,
                                       size_t candidate_count, const sprout_way *ways, size_t way_count, trying *t) {
  const sprout_world *world = r->run.world;
  sprout_arena scratch, *turn = r->run.x.turn;
  sprout_frame frame = r->frame;
  size_t i, most = 0;
  sprout_eval_status status = SPROUT_EVAL_OK;
  for (i = 0; i < world->phrase_count; i++)
    if (world->phrases[i].part_count > most) most = world->phrases[i].part_count;
  for (i = 0; i < world->intent_phrase_count; i++)
    if (world->intent_phrases[i].part_count > most) most = world->intent_phrases[i].part_count;
  if (sprout_arena_init(&scratch, r->run.host) != SPROUT_OK) return SPROUT_EVAL_NO_MEMORY;
  /* What a consent pass builds is scratch too, so the exec takes it from the phrase's arena while the phrases are tried. */
  frame.turn = &scratch;
  r->run.x.turn = &scratch;
  memset(t, 0, sizeof *t);
  t->words = words;
  t->x = &r->run.x;
  t->keep = turn;
  t->all.actor = r->actor;
  t->all.here = r->here;
  t->all.fill.nouns.frame = &frame;
  t->all.fill.nouns.referents = r->referents;
  t->all.fill.nouns.referent_count = r->referent_count;
  t->all.fill.candidates = candidates;
  t->all.fill.candidate_count = candidate_count;
  t->all.fill.ways = ways;
  t->all.fill.way_count = way_count;
  for (i = 0; status == SPROUT_EVAL_OK && i < world->phrase_count + world->intent_phrase_count; i++) {
    const sprout_typed_part *parts;
    size_t part_count;
    sprout_arena_rewind(&scratch);
    t->memos = NULL;
    t->memo_count = t->memo_capacity = 0;
    t->fills = (const parse_filled **)sprout_arena_take(&scratch, (most + 1) * sizeof *t->fills);
    if (t->fills == NULL) {
      status = SPROUT_EVAL_NO_MEMORY;
      break;
    }
    if (i < world->phrase_count) {
      t->phrase = &world->phrases[i];
      t->intent = NULL;
      parts = t->phrase->parts;
      part_count = t->phrase->part_count;
    } else {
      t->phrase = NULL;
      t->intent = &world->intent_phrases[i - world->phrase_count];
      parts = t->intent->parts;
      part_count = t->intent->part_count;
    }
    status = parse_slot_spans(&scratch, parts, part_count, words.words, words.count, placed, t);
  }
  r->run.x.turn = turn;
  sprout_arena_reset(&scratch);
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

/* The line answered: which answer, who says it, the line or the words said, and what it binds, copied into `keep`. */
static sprout_status answered(reader *r, const parse_answer *answer) {
  sprout_parsed *out = r->out;
  const sprout_graph *graph = &r->run.world->graph;
  sprout_said_binding *bound = (sprout_said_binding *)sprout_arena_take(r->keep, answer->binding_count * sizeof *bound);
  size_t i;
  if (bound == NULL) return SPROUT_NO_MEMORY;
  out->end = SPROUT_PARSED_ANSWERED;
  out->answer = answer->answer;
  out->line = answer->said.name;
  out->absent = answer->said.kind == SPROUT_SPEECH_ABSENT;
  if (answer->said.kind == SPROUT_SPEECH_ENGINE) out->words = prose_stock_words(answer->said.name);
  if (answer->said.kind == SPROUT_SPEECH_TEXT) {
    const sprout_node *value = sprout_node_get(graph, answer->said.node, "value");
    if ((out->words = sprout_arena_copy(r->keep, sprout_text(graph, value), sprout_text_length(graph, value))) == NULL)
      return SPROUT_NO_MEMORY;
  }
  if (!kept(r->keep, answer->by, &out->by)) return SPROUT_NO_MEMORY;
  for (i = 0; i < answer->binding_count; i++) {
    bound[i] = answer->bindings[i];
    if (!kept(r->keep, answer->bindings[i].text, &bound[i].text)) return SPROUT_NO_MEMORY;
  }
  out->bindings = bound;
  out->binding_count = answer->binding_count;
  return SPROUT_OK;
}

/* The engine's line `name`, said to the actor where they stand, with `given` bound after `actor` and `here`. */
static sprout_status answer(reader *r, const char *name, const sprout_said_binding *given) {
  parse_answer said;
  parse_answer_of(&r->frame, name, r->actor, r->here, given, &said);
  return answered(r, &said);
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

static const char *kept_text(sprout_arena *keep, const char *text) {
  return text == NULL ? NULL : sprout_arena_copy(keep, text, strlen(text));
}

static const char *kept_id(sprout_arena *keep, sprout_str id) { return sprout_arena_copy(keep, id.bytes, id.length); }

/* A reading as the host reads one, in `keep`: its verb or intent by qualified name, its actor, and what it binds in order. */
static bool reading_out(sprout_arena *keep, const parse_reading *reading, sprout_reading *out) {
  const char *library = reading->verb != NULL ? reading->verb->library : reading->intent->library;
  const char *name = reading->verb != NULL ? reading->verb->name : reading->intent->name;
  size_t a = strlen(library), b = strlen(name), i, j;
  char *what = (char *)sprout_arena_take(keep, a + b + 2);
  sprout_filling *fillings = (sprout_filling *)sprout_arena_take(keep, (reading->count + 1) * sizeof *fillings);
  if (what == NULL || fillings == NULL) return false;
  memset(out, 0, sizeof *out);
  memcpy(what, library, a);
  what[a] = '.';
  memcpy(what + a + 1, name, b + 1);
  out->verb = what;
  out->actor = kept_id(keep, reading->actor);
  out->fillings = fillings;
  out->filling_count = reading->count;
  if (out->actor == NULL) return false;
  for (i = 0; i < reading->count; i++) {
    const sprout_stored_bound *bound = &reading->bounds[i];
    sprout_filling *one = &fillings[i];
    const char **ids;
    one->role = kept_text(keep, reading->verb != NULL ? reading->verb->roles[reading->roles[i]].name
                                                      : reading->intent->slots[reading->roles[i]]);
    if (one->role == NULL) return false;
    switch (bound->kind) {
      case SPROUT_BOUND_OBJECT:
        one->binds = SPROUT_FILL_OBJECT;
        if ((one->id = kept_id(keep, bound->object)) == NULL) return false;
        break;
      case SPROUT_BOUND_SET:
        one->binds = SPROUT_FILL_SET;
        ids = (const char **)sprout_arena_take(keep, (bound->set_count + 1) * sizeof *ids);
        if (ids == NULL) return false;
        for (j = 0; j < bound->set_count; j++)
          if ((ids[j] = kept_id(keep, bound->set[j])) == NULL) return false;
        one->ids = ids;
        one->id_count = bound->set_count;
        break;
      case SPROUT_BOUND_EXIT:
        one->binds = SPROUT_FILL_EXIT;
        one->direction = bound->has_direction ? kept_id(keep, bound->direction) : NULL;
        one->label = kept_id(keep, bound->label);
        one->id = kept_id(keep, bound->to);
        if (one->label == NULL || one->id == NULL || (bound->has_direction && one->direction == NULL)) return false;
        break;
      case SPROUT_BOUND_VALUE:
        if (bound->value_is_string) {
          one->binds = SPROUT_FILL_TEXT;
          if ((one->text = kept_id(keep, bound->value_string)) == NULL) return false;
        } else {
          one->binds = SPROUT_FILL_NUMBER;
          one->number = bound->value_number;
        }
        break;
    }
  }
  return true;
}

/*
 * The asides said before the reading, in order: the world's `pronoun_correction` for each thing a pronoun named that
 * declares another pronoun, each once (the spec's Parsing > Pronouns), then the engine's `meant` for a drawn reading.
 */
static sprout_eval_status asides_of(reader *r, const parse_chosen *chosen, sprout_aside **out, size_t *count) {
  const parse_ranked *ranked = chosen->ranked;
  sprout_aside *asides = (sprout_aside *)sprout_arena_take(r->keep, (ranked->pronoun_count + 2) * sizeof *asides);
  size_t i, j;
  *out = asides;
  *count = 0;
  if (asides == NULL) return SPROUT_EVAL_NO_MEMORY;
  for (i = 0; i < ranked->pronoun_count; i++) {
    const parse_pronoun_thing *named = &ranked->pronouns[i];
    const sprout_stored_instance *thing = expr_instance(&r->frame, named->id);
    parse_address address;
    bool corrected = false;
    if (thing == NULL) continue;
    for (j = 0; j < i; j++) corrected = corrected || sprout_str_same(ranked->pronouns[j].id, named->id);
    if (corrected) continue;
    EXPR_NEED(parse_address_of(&r->frame, thing, &address));
    if (address.pronoun == PARSE_PRONOUN_NONE || address.pronoun == named->pronoun) continue;
    asides[*count].line = "pronoun_correction";
    asides[*count].thing = kept_id(r->keep, named->id);
    asides[(*count)++].pronoun = parse_pronoun_text(address.pronoun);
  }
  if (chosen->meant != NULL) {
    asides[*count].line = "meant";
    asides[(*count)++].thing = kept_id(r->keep, *chosen->meant);
  }
  for (i = 0; i < *count; i++)
    if (asides[i].thing == NULL) return SPROUT_EVAL_NO_MEMORY;
  return SPROUT_EVAL_OK;
}

/* The line understood: the best of the readings it made, a tie drawn, with what it runs after it and what is said before it. */
static sprout_status understood(reader *r, const parse_readings *readings) {
  sprout_parsed *out = r->out;
  parse_chosen chosen;
  sprout_aside *asides;
  sprout_following *rest;
  uint64_t *draws;
  size_t aside_count, i;
  sprout_eval_status status = parse_choose(&r->frame, readings->ranked, readings->count, &chosen);
  if (status == SPROUT_EVAL_OK && chosen.ranked->runs)
    return refuse(out, "", "a run's items after its first", " are not read by this runtime yet.");
  if (status == SPROUT_EVAL_OK) status = asides_of(r, &chosen, &asides, &aside_count);
  if (status == SPROUT_EVAL_NO_MEMORY) return SPROUT_NO_MEMORY;
  if (status != SPROUT_EVAL_OK) {
    faulted(r);
    return SPROUT_OK;
  }
  draws = (uint64_t *)sprout_arena_take(r->keep, sizeof *draws);
  rest = (sprout_following *)sprout_arena_take(r->keep, (chosen.ranked->rest_count + 1) * sizeof *rest);
  if (draws == NULL || rest == NULL || !reading_out(r->keep, &chosen.ranked->reading, &out->reading)) return SPROUT_NO_MEMORY;
  for (i = 0; i < chosen.ranked->rest_count; i++) {
    sprout_reading *planned = (sprout_reading *)sprout_arena_take(r->keep, sizeof *planned);
    if (planned == NULL || !reading_out(r->keep, &chosen.ranked->rest[i], planned)) return SPROUT_NO_MEMORY;
    rest[i].planned = planned;
  }
  out->end = chosen.ranked->reading.verb != NULL ? SPROUT_PARSED_READING : SPROUT_PARSED_INTENT;
  out->rest = rest;
  out->rest_count = chosen.ranked->rest_count;
  out->drawn = chosen.among > 1;
  out->drawn_among = chosen.among > 1 ? chosen.among : 0;
  if (out->drawn) {
    draws[0] = chosen.among;
    out->draws = draws;
    out->draw_count = 1;
  }
  out->reading.draws = out->draws;
  out->reading.draw_count = out->draw_count;
  out->reading.asides = asides;
  out->reading.aside_count = aside_count;
  return SPROUT_OK;
}

/*
 * The world's answer to a line no reading reads: the partial reading chosen, a tie drawn, as `cannot` or
 * `not_carrying`; else the first way out named that does not go, `no_way` or the exit's own words; else `not_here`
 * where a noun names nothing in reach in the world's words, and `unknown` otherwise.
 */
static sprout_status unread(reader *r, const trying *t) {
  sprout_said_binding given;
  if (t->partials.count > 0) {
    const parse_partial *chosen;
    size_t among;
    sprout_eval_status status = parse_choose_partial(&r->frame, t->partials.best, t->partials.count, &chosen, &among);
    if (status == SPROUT_EVAL_NO_MEMORY) return SPROUT_NO_MEMORY;
    if (status != SPROUT_EVAL_OK) {
      faulted(r);
      return SPROUT_OK;
    }
    if (among > 1) {
      uint64_t *draws = (uint64_t *)sprout_arena_take(r->keep, sizeof *draws);
      if (draws == NULL) return SPROUT_NO_MEMORY;
      draws[0] = among;
      r->out->draws = draws;
      r->out->draw_count = 1;
    }
    given.object = chosen->uncarried.bytes != NULL;
    given.name = given.object ? "thing" : "reading";
    given.text = given.object ? chosen->uncarried : chosen->words;
    return answer(r, given.object ? "not_carrying" : "cannot", &given);
  }
  if (t->has_going && t->going.fills == PARSE_FILLS_REFUSED) {
    parse_answer said;
    parse_refused(t->going.way, r->actor, r->here, &said);
    return answered(r, &said);
  }
  if (t->has_going) {
    given.name = "way";
    given.object = false;
    given.text.bytes = t->going.direction;
    given.text.length = strlen(t->going.direction);
    return answer(r, "no_way", &given);
  }
  return answer(r, t->not_here ? "not_here" : "unknown", NULL);
}

/* Reads the words of a line typed by the actor, who stands in a place; anything but SPROUT_OK leaves `out` refused. */
static sprout_status read_line(reader *r, const sprout_stored_visitor *visitor, sprout_str line) {
  const sprout_way *ways;
  parse_candidate *candidates;
  sprout_str *words;
  size_t way_count, candidate_count, count;
  trying t;
  parse_words typed;
  sprout_eval_status status = sprout_ways_from(&r->frame, r->here, &ways, &way_count);
  if (status == SPROUT_EVAL_NO_MEMORY) return SPROUT_NO_MEMORY;
  if (status != SPROUT_EVAL_OK) {
    faulted(r);
    return SPROUT_OK;
  }
  if (typed_words(&r->run.scratch, parse_without_question(line), &words, &count) != SPROUT_OK) return SPROUT_NO_MEMORY;
  if (count == 0) return answer(r, "unknown", NULL);
  status = parse_reach_of(&r->frame, r->actor, &candidates, &candidate_count);
  if (status == SPROUT_EVAL_NO_MEMORY) return SPROUT_NO_MEMORY;
  if (status != SPROUT_EVAL_OK) {
    faulted(r);
    return SPROUT_OK;
  }
  if (count == 1 && (is_word(words[0], "again") || is_word(words[0], "g"))) {
    if (!visitor->has_reading) return answer(r, "unknown", NULL);
    return refuse(r->out, "", "`again` after a reading", " is not read by this runtime yet.");
  }
  if (may_chain(words, count))
    return refuse(r->out, "", "a line `and` or a comma may split", " is not read by this runtime yet.");
  typed.words = words;
  typed.count = count;
  status = phrases_read(r, typed, candidates, candidate_count, ways, way_count, &t);
  if (status == SPROUT_EVAL_NO_MEMORY) return SPROUT_NO_MEMORY;
  if (status != SPROUT_EVAL_OK) {
    faulted(r);
    return SPROUT_OK;
  }
  if (t.readings.count > 0) return understood(r, &t.readings);
  return unread(r, &t);
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
