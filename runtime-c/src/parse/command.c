/*
 * A typed line read as the command turn it begins reads it (the spec's Parsing > Matching a line, Choosing a reading,
 * Pronouns, When nothing matches; Verbs > Exits; The runtime > Turns): inside that turn, over its draft, its meter and
 * its stream (parse_command_turn), or, for a host's preview, over a draft that is never committed under a command
 * turn's meter and the stream begun from the host's seed (sprout_parse), so the steps it spends and the draws it
 * makes are the turn's own. The order is fixed, since every step is charged where it
 * is: the ways out of the actor's place, then the words, then what the actor can reach, then each placement of each
 * phrase, a step, with what its slots' words fill their roles with and the readings they make. The best reading is
 * the one understood, a tie drawn; a line no reading reads is answered (answers.c): read in part, with `cannot` or
 * `not_carrying`; naming a way that does not go, with `no_way` or the exit's words; naming nothing in reach, with
 * `not_here`; and otherwise `unknown`. A line `and` or a comma splits is read up to the split, the command after it
 * handed on as words; `again` runs the last reading again; and a later turn of a line is read as it was handed, a
 * planned reading or an item of a run to read afresh (the spec's Parsing > Sequences, again and all).
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

static const char *kept_text(sprout_arena *keep, const char *text) {
  return text == NULL ? NULL : sprout_arena_copy(keep, text, strlen(text));
}

static const char *kept_id(sprout_arena *keep, sprout_str id) { return sprout_arena_copy(keep, id.bytes, id.length); }

bool parse_reading_out(sprout_arena *keep, const parse_reading *reading, sprout_reading *out) {
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

#ifdef SPROUT_NO_PARSER

static const char without[] = "this runtime was built without the parser, so it reads no typed line.";

sprout_status parse_command_turn(turn_run *run, const char *visit, sprout_str line, const sprout_handed *handed,
                                 sprout_arena *keep, sprout_parsed *out, parse_turned *turned) {
  (void)run, (void)visit, (void)line, (void)handed, (void)keep;
  memset(out, 0, sizeof *out);
  memset(turned, 0, sizeof *turned);
  memcpy(out->fault.text, without, sizeof without);
  return SPROUT_BAD_INPUT;
}

sprout_status sprout_parse(sprout_world *world, sprout_state *state, const sprout_host *host, const char *visit,
                           const char *line, size_t length, const sprout_handed *handed, sprout_arena *keep,
                           sprout_parsed *out) {
  (void)world, (void)state, (void)host, (void)visit, (void)line, (void)length, (void)handed, (void)keep;
  if (out == NULL) return SPROUT_BAD_HOST;
  memset(out, 0, sizeof *out);
  memcpy(out->fault.text, without, sizeof without);
  return SPROUT_BAD_INPUT;
}

#else

/* One read of a line: the turn it is read under, who typed it, where they stand, and where the outcome goes. */
typedef struct reader {
  turn_run *run;
  sprout_frame frame;
  sprout_str actor, here;
  const sprout_str *referents; /* what the actor's pronouns name */
  size_t referent_count;
  sprout_arena *keep;
  sprout_parsed *out;
  parse_turned *turned; /* what the command turn reads of it, beside the outcome */
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
  bool not_here;             /* a placement's noun names nothing in reach, or `all` leaves nothing */
  bool narrowed_nothing;     /* every slot of a placement read, and `all` narrowed by a noun or a holder leaves nothing */
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
  for (i = 0; i < count; i++)
    if (fills[i]->narrowed && fills[i]->fills == PARSE_FILLS_NOTHING && fills[i]->start == 0 && fills[i]->end == 1)
      t->narrowed_nothing = true;
  if (any_fills(fills, count, PARSE_FILLS_NOTHING)) {
    /* An object's synonym typed where the object is out of reach. */
    if (t->phrase != NULL && t->phrase->only != NULL) {
      EXPR_NEED(parse_offered_out_of_reach(&t->all.fill, &placement, &named));
      t->not_here = t->not_here || named;
    } else {
      t->not_here = true;
    }
    return SPROUT_EVAL_OK;
  }
  /* One role runs once for each of several things, never two. */
  for (i = 0; i < count; i++)
    if (fills[i]->fills == PARSE_FILLS_RUN || fills[i]->fills == PARSE_FILLS_ALL) several++;
  if (several > 1) return SPROUT_EVAL_OK;
  EXPR_NEED(parse_placement_readings(t->x, frame, t->all.actor, &placement, t->keep, &t->readings, &nothing));
  t->not_here = t->not_here || nothing;
  for (i = 0; i < count && nothing; i++) t->narrowed_nothing = t->narrowed_nothing || fills[i]->narrowed;
  return SPROUT_EVAL_OK;
}

/*
 * Tries every phrase of the world's and its intents' against `words`, each with its fills in an arena rewound for the
 * next, the readings they make, and the partial readings kept in the turn's.
 */
static sprout_eval_status phrases_read(reader *r, parse_words words, const parse_candidate *candidates,
                                       size_t candidate_count, const sprout_way *ways, size_t way_count, trying *t) {
  const sprout_world *world = r->run->world;
  sprout_arena scratch, *turn = r->run->x.turn;
  sprout_frame frame = r->frame;
  size_t i, most = 0;
  sprout_eval_status status = SPROUT_EVAL_OK;
  for (i = 0; i < world->phrase_count; i++)
    if (world->phrases[i].part_count > most) most = world->phrases[i].part_count;
  for (i = 0; i < world->intent_phrase_count; i++)
    if (world->intent_phrases[i].part_count > most) most = world->intent_phrases[i].part_count;
  if (sprout_arena_init(&scratch, r->run->host) != SPROUT_OK) return SPROUT_EVAL_NO_MEMORY;
  /* What a consent pass builds is scratch too, so the exec takes it from the phrase's arena while the phrases are tried. */
  frame.turn = &scratch;
  r->run->x.turn = &scratch;
  memset(t, 0, sizeof *t);
  t->words = words;
  t->x = &r->run->x;
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
  r->run->x.turn = turn;
  sprout_arena_reset(&scratch);
  return status;
}

static bool is_word(sprout_str word, const char *text) {
  return word.length == strlen(text) && memcmp(word.bytes, text, word.length) == 0;
}

/* The line answered: which answer, who says it, the line or the words said, and what it binds, copied into `keep`. */
static sprout_status answered(reader *r, const parse_answer *answer) {
  sprout_parsed *out = r->out;
  r->turned->said = *answer;
  const sprout_graph *graph = &r->run->world->graph;
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

/* A read stopped by `status`, a fault: the turn it begins is abandoned, as one whose parse spends its budget is. */
static void faulted(reader *r, sprout_eval_status status) {
  sprout_parsed *out = r->out;
  r->turned->status = status;
  out->end = SPROUT_PARSED_FAULTED;
  if (r->run->meter->faulted) {
    out->fault = r->run->meter->fault;
    out->fault_name = "BudgetExhausted";
    return;
  }
  out->fault_name = r->run->fault.name == NULL ? "Error" : r->run->fault.name;
  out->fault.budget = out->fault_name;
  memcpy(out->fault.text, r->run->fault.text, sizeof out->fault.text - 1);
  out->fault.text[sizeof out->fault.text - 1] = '\0';
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

/* The reading out, with no draw, no aside and nothing after it: the last reading run again, or one a line planned. */
static sprout_status read_as(reader *r, const parse_reading *reading) {
  r->turned->reading = *reading;
  if (!parse_reading_out(r->keep, reading, &r->out->reading)) return SPROUT_NO_MEMORY;
  r->out->end = SPROUT_PARSED_READING;
  return SPROUT_OK;
}

/* The turns the chosen reading runs after it, in order: `all`'s, a run's later items, then the command `after`, or NULL. */
static sprout_eval_status rest_of(reader *r, const parse_ranked *chosen, parse_words words, const char *after) {
  sprout_parsed *out = r->out;
  sprout_following *rest;
  parse_following *later = NULL;
  size_t later_count = 0, i, n = 0;
  if (chosen->run != NULL)
    EXPR_NEED(parse_later_of(&r->run->x, &r->frame, r->actor, words, chosen->run, r->referents, r->referent_count, r->keep,
                             &later, &later_count));
  rest = (sprout_following *)sprout_arena_take(r->keep, (chosen->rest_count + later_count + 2) * sizeof *rest);
  if (rest == NULL) return SPROUT_EVAL_NO_MEMORY;
  memset(rest, 0, (chosen->rest_count + later_count + 2) * sizeof *rest);
  for (i = 0; i < chosen->rest_count + later_count; i++) {
    sprout_reading *planned = (sprout_reading *)sprout_arena_take(r->keep, sizeof *planned);
    const parse_reading *reading = i < chosen->rest_count ? &chosen->rest[i] : &later[i - chosen->rest_count].planned;
    if (planned == NULL || !parse_reading_out(r->keep, reading, planned)) return SPROUT_EVAL_NO_MEMORY;
    rest[n].planned = planned;
    rest[n++].reread = i < chosen->rest_count ? NULL : later[i - chosen->rest_count].reread;
  }
  if (after != NULL) rest[n++].text = after;
  out->rest = rest;
  out->rest_count = n;
  return SPROUT_EVAL_OK;
}

/*
 * The line understood: the best of the readings it made of `words`, a tie drawn, with what it runs after it, the
 * command `after` last where a line split, and what is said before it.
 */
static sprout_status understood(reader *r, const parse_readings *readings, parse_words words, const char *after) {
  sprout_parsed *out = r->out;
  parse_chosen chosen;
  sprout_aside *asides;
  uint64_t *draws = (uint64_t *)sprout_arena_take(r->keep, sizeof *draws);
  size_t aside_count;
  sprout_eval_status status;
  if (draws == NULL) return SPROUT_NO_MEMORY;
  status = parse_choose(&r->frame, readings->ranked, readings->count, &chosen);
  if (status == SPROUT_EVAL_OK && chosen.among > 1) {
    draws[0] = chosen.among;
    out->draws = draws;
    out->draw_count = 1;
  }
  if (status == SPROUT_EVAL_OK) status = rest_of(r, chosen.ranked, words, after);
  if (status == SPROUT_EVAL_OK) status = asides_of(r, &chosen, &asides, &aside_count);
  if (status == SPROUT_EVAL_NO_MEMORY) return SPROUT_NO_MEMORY;
  if (status != SPROUT_EVAL_OK) {
    faulted(r, status);
    return SPROUT_OK;
  }
  r->turned->reading = chosen.ranked->reading;
  if (!parse_reading_out(r->keep, &chosen.ranked->reading, &out->reading)) return SPROUT_NO_MEMORY;
  out->end = chosen.ranked->reading.verb != NULL ? SPROUT_PARSED_READING : SPROUT_PARSED_INTENT;
  out->drawn = chosen.among > 1;
  out->drawn_among = chosen.among > 1 ? chosen.among : 0;
  out->asides = asides;
  out->aside_count = aside_count;
  return SPROUT_OK;
}

/*
 * The world's answer to a line no reading reads: `not_here` where `all` narrowed by a noun or a holder leaves
 * nothing; else the partial reading chosen, a tie drawn, as `cannot` or
 * `not_carrying`; else the first way out named that does not go, `no_way` or the exit's own words; else `not_here`
 * where a noun names nothing in reach, and `unknown` otherwise.
 */
static sprout_status unread(reader *r, const trying *t) {
  sprout_said_binding given;
  /* A line read whole, `all` narrowed to what is in reach, is owed `not_here` rather than another phrase's part. */
  if (t->narrowed_nothing) return answer(r, "not_here", NULL);
  if (t->partials.count > 0) {
    const parse_partial *chosen;
    size_t among;
    sprout_eval_status status = parse_choose_partial(&r->frame, t->partials.best, t->partials.count, &chosen, &among);
    if (status == SPROUT_EVAL_NO_MEMORY) return SPROUT_NO_MEMORY;
    if (status != SPROUT_EVAL_OK) {
      faulted(r, status);
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

/* A read stopped by `status`, which is not SPROUT_EVAL_OK: a fault ends it as faulted, and memory is the host's to give. */
static sprout_status stopped(reader *r, sprout_eval_status status) {
  if (status == SPROUT_EVAL_NO_MEMORY) return SPROUT_NO_MEMORY;
  faulted(r, status);
  return SPROUT_OK;
}

/* One command's words read: understood where they make a reading, the command `after` run after it, else answered. */
static sprout_status answering(reader *r, const trying *t, const char *after) {
  if (t->readings.count > 0) return understood(r, &t->readings, t->words, after);
  return unread(r, t);
}

/* The readings that read every word the line holds, in the order made, in the turn arena. */
static bool whole_of(sprout_arena *turn, const parse_readings *readings, parse_readings *out) {
  size_t i;
  memset(out, 0, sizeof *out);
  out->ranked = (parse_ranked *)sprout_arena_take(turn, (readings->count + 1) * sizeof *out->ranked);
  if (out->ranked == NULL) return false;
  for (i = 0; i < readings->count; i++)
    if (readings->ranked[i].whole) out->ranked[out->count++] = readings->ranked[i];
  out->capacity = out->count;
  return true;
}

/*
 * Where `and` or a comma may join two commands (the spec's Parsing > Sequences, again and all), the line is one
 * command where a reading reads all of it; otherwise it splits at the first such `and` or comma whose words after it,
 * up to the next, name nothing outright, so a name that begins with a verb stays whole, and what follows is read on a
 * turn of its own. A turn reads its line at most twice, so a long chain costs each turn no more than its own line.
 */
static sprout_status read_words(reader *r, parse_words typed, const parse_candidate *candidates, size_t candidate_count,
                                const sprout_way *ways, size_t way_count) {
  size_t *points = (size_t *)sprout_arena_take(r->run->x.turn, (typed.count + 1) * sizeof *points);
  size_t point_count, i;
  trying whole, before;
  parse_readings reads;
  parse_noun_context nouns;
  sprout_eval_status status;
  if (points == NULL) return SPROUT_NO_MEMORY;
  point_count = parse_chain_points(r->run->world, typed, points);
  status = phrases_read(r, typed, candidates, candidate_count, ways, way_count, &whole);
  if (status != SPROUT_EVAL_OK) return stopped(r, status);
  if (point_count == 0) return answering(r, &whole, NULL);
  if (!whole_of(r->run->x.turn, &whole.readings, &reads)) return SPROUT_NO_MEMORY;
  if (reads.count > 0) return understood(r, &reads, typed, NULL);
  nouns.frame = &r->frame;
  nouns.referents = r->referents;
  nouns.referent_count = r->referent_count;
  for (i = 0; i < point_count; i++) {
    bool named;
    status = parse_names_outright(&nouns, parse_stretch_after(typed, points[i]), candidates, candidate_count, &named);
    if (status != SPROUT_EVAL_OK) return stopped(r, status);
    if (!named) break;
  }
  if (i == point_count) return answering(r, &whole, NULL);
  status = phrases_read(r, parse_command_before(typed, points[i]), candidates, candidate_count, ways, way_count, &before);
  if (status != SPROUT_EVAL_OK) return stopped(r, status);
  return answering(r, &before, parse_command_after(r->keep, typed, points[i]));
}

/*
 * `again` or `g` alone: the actor's last reading run again, the same verb and the same things, where it is still one
 * its verb takes, `unknown` where it is not or there is none, and `not_here` where what it binds is out of reach.
 */
static sprout_status read_again(reader *r, const sprout_stored_visitor *visitor, const parse_candidate *candidates,
                                size_t candidate_count, const sprout_way *ways, size_t way_count) {
  parse_reading last;
  bool fits = false;
  if (visitor->has_reading) {
    sprout_eval_status status = parse_again_reading(&r->frame, &visitor->reading, r->actor, &last, &fits);
    if (status != SPROUT_EVAL_OK) return stopped(r, status);
  }
  if (!fits) return answer(r, "unknown", NULL);
  if (!parse_in_reach(&last, candidates, candidate_count, ways, way_count)) return answer(r, "not_here", NULL);
  return read_as(r, &last);
}

/* Reads the words of a line typed by the actor, who stands in a place; anything but SPROUT_OK leaves `out` refused. */
static sprout_status read_line(reader *r, const sprout_stored_visitor *visitor, sprout_str line, const sprout_way *ways,
                               size_t way_count) {
  parse_candidate *candidates;
  sprout_str *words;
  size_t candidate_count, count;
  parse_words typed;
  sprout_eval_status status;
  if (typed_words(&r->run->scratch, parse_without_question(line), &words, &count) != SPROUT_OK) return SPROUT_NO_MEMORY;
  if (count == 0) return answer(r, "unknown", NULL);
  status = parse_reach_of(&r->frame, r->actor, &candidates, &candidate_count);
  if (status != SPROUT_EVAL_OK) return stopped(r, status);
  if (count == 1 && (is_word(words[0], "again") || is_word(words[0], "g")))
    return read_again(r, visitor, candidates, candidate_count, ways, way_count);
  typed.words = words;
  typed.count = count;
  return read_words(r, typed, candidates, candidate_count, ways, way_count);
}

/*
 * A later turn of a line, read as it was handed (the spec's Parsing > Sequences, again and all): the reading planned
 * for it, run where what it binds is still in reach and `not_here` where it is not; or the item of a run it re-reads.
 */
static sprout_status read_handed(reader *r, const sprout_handed *handed, const sprout_way *ways, size_t way_count) {
  parse_reading planned;
  parse_candidate *candidates;
  size_t candidate_count;
  sprout_eval_status status;
  sprout_status made = parse_handed_reading(r->run->world, r->run->x.turn, handed->planned, &planned);
  if (made == SPROUT_BAD_INPUT)
    return refuse(r->out, "the reading a turn was handed, `", handed->planned->verb,
                  "`, names a verb or a role this world does not have.");
  if (made != SPROUT_OK) return made;
  if (handed->reread != NULL) {
    parse_item_read item;
    parse_words none;
    status = parse_read_item(&r->run->x, &r->frame, r->actor, &planned, handed->reread, ways, way_count, &item);
    if (status != SPROUT_EVAL_OK) return stopped(r, status);
    if (item.answer != NULL) return answer(r, item.answer, item.given ? &item.binding : NULL);
    memset(&none, 0, sizeof none);
    return understood(r, &item.readings, none, NULL);
  }
  status = parse_reach_of(&r->frame, r->actor, &candidates, &candidate_count);
  if (status != SPROUT_EVAL_OK) return stopped(r, status);
  if (!parse_in_reach(&planned, candidates, candidate_count, ways, way_count)) return answer(r, "not_here", NULL);
  return read_as(r, &planned);
}

/* The ways out of the actor's place, and then the line's words or what the turn was handed. */
static sprout_status read_turn(reader *r, const sprout_stored_visitor *visitor, sprout_str line,
                               const sprout_handed *handed) {
  const sprout_way *ways;
  size_t way_count;
  sprout_eval_status status = sprout_ways_from(&r->frame, r->here, &ways, &way_count);
  if (status != SPROUT_EVAL_OK) return stopped(r, status);
  if (handed != NULL) return read_handed(r, handed, ways, way_count);
  return read_line(r, visitor, line, ways, way_count);
}

/* Reads `line`, or what was handed, as `visit` typed it, over `run`'s draft, meter and stream. */
static sprout_status read_in(turn_run *run, const char *visit, sprout_str line, const sprout_handed *handed,
                             sprout_arena *keep, sprout_parsed *out, parse_turned *turned) {
  reader r;
  const sprout_stored_visitor *visitor;
  const sprout_stored_instance *instance;
  memset(out, 0, sizeof *out);
  memset(turned, 0, sizeof *turned);
  if (handed != NULL && (handed->planned == NULL || handed->planned->verb == NULL ||
                         (handed->reread != NULL && (handed->reread->role == NULL || handed->reread->words == NULL))))
    return refuse(out, "a turn a line handed names the reading planned for it, and an item's role and words.", "", "");
  memset(&r, 0, sizeof r);
  r.run = run;
  r.keep = keep;
  r.out = out;
  r.turned = turned;
  visitor = sprout_draft_visitor(&run->draft, (sprout_str){visit, strlen(visit)});
  instance = visitor == NULL ? NULL : sprout_draft_instance(&run->draft, visitor->instance);
  if (visitor == NULL) return refuse(out, "`", visit, "` has never visited this world.");
  if (instance == NULL || !instance->has_container) return refuse(out, "`", visit, "` is not in this world, so cannot type in it.");
  r.actor = visitor->instance;
  r.here = instance->container;
  r.referents = visitor->referents;
  r.referent_count = visitor->referent_count;
  r.frame = sprout_exec_frame(&run->x, r.actor, NULL, NULL);
  if (!turn_stands_in_place(&r.frame, r.actor))
    return refuse(out, "`", visit, "` stands in a place that is gone: the turn moves them, and reads nothing.");
  return read_turn(&r, visitor, line, handed);
}

sprout_status parse_command_turn(turn_run *run, const char *visit, sprout_str line, const sprout_handed *handed,
                                 sprout_arena *keep, sprout_parsed *out, parse_turned *turned) {
  return read_in(run, visit, line, handed, keep, out, turned);
}

sprout_status sprout_parse(sprout_world *world, sprout_state *state, const sprout_host *host, const char *visit,
                           const char *line, size_t length, const sprout_handed *handed, sprout_arena *keep,
                           sprout_parsed *out) {
  turn_run run;
  parse_turned turned;
  sprout_status status;
  if (out == NULL || keep == NULL) return SPROUT_BAD_HOST;
  memset(out, 0, sizeof *out);
  if (world == NULL || state == NULL || host == NULL || host->seed == NULL || visit == NULL || line == NULL)
    return refuse(out, "a parse names a world, a state, a host with a seed, a visit and a line.", "", "");
  status = turn_open(&run, world, state, host, SPROUT_TURN_COMMAND, host->seed(host->ctx), 0, NULL, NULL);
  if (status != SPROUT_OK) return status;
  status = read_in(&run, visit, (sprout_str){line, length}, handed, keep, out, &turned);
  out->steps = run.meter->steps;
  turn_drop(&run);
  if (status != SPROUT_OK) {
    char text[sizeof out->fault.text];
    memcpy(text, out->fault.text, sizeof text);
    memset(out, 0, sizeof *out);
    memcpy(out->fault.text, text, sizeof text);
  }
  return status;
}

#endif
