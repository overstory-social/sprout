/*
 * A command turn (the spec's The runtime > Turns, Faults). Its order is fixed: the consent pass; the effect
 * pass, actor first and then roles in declared order; the queue, breadth-first in insertion order; what the
 * engine answers; every `after command` that follows the command, and the queue it fills; then the views of
 * everyone present are stale, as every write turn that commits makes them. A command refused, by its consent
 * pass, its exit or the move's guards, is followed too, once its refusal is said. The one who typed the command is
 * always told something: the consent pass's refusal, what the effect pass said, what the engine answered or
 * its `nothing_happens`, or, when the turn faults and is abandoned, the engine's `fault`. What it says is one
 * sequence of effects in that order; the place a move carried someone to is read among them where the body
 * that moved them ended.
 *
 * A command is a reading built from the view's chips, run as it is; or words typed, read first in the turn,
 * under its budget and on its stream (parse/command.c), as is a later turn a line planned. A line the parser
 * answers is answered; an intent's first step runs and the rest follow it; and the reading run is remembered as the
 * visitor's last, with what it was done to as what their pronouns name. A visitor standing in a place that is gone
 * is displaced instead, and what they typed is not read, since it was typed about where they no longer are (the
 * spec's What absent means).
 */
#include <string.h>

#include "../engine-verbs.h"
#include "../expr/expr.h"
#include "../intents.h"
#include "../line.h"
#include "../parse/parse.h"
#include "../prose/prose.h"
#include "../turn.h"

static sprout_eval_status drafted(sprout_draft_result result) {
  return result == SPROUT_DRAFT_OK ? SPROUT_EVAL_OK : SPROUT_EVAL_NO_MEMORY;
}

/*
 * Keeps `reading` as the visitor's last, which `again` runs again, and what it was done to as what their
 * pronouns name: the thing or set its first role binds, refused or not. A reading done to nothing leaves
 * their pronouns as they were.
 */
static sprout_eval_status remember(turn_run *run, sprout_str visit, const sprout_resolved *reading) {
  const sprout_stored_visitor *before = sprout_draft_visitor(&run->draft, visit);
  sprout_stored_visitor record;
  sprout_stored_binding *bindings;
  size_t i, n = 0;
  if (before == NULL) return SPROUT_EVAL_NO_MEMORY;
  record = *before;
  if (reading->verb->role_count > 0 && reading->roles[0].filled) {
    const sprout_stored_bound *first = &reading->roles[0].bound;
    if (first->kind == SPROUT_BOUND_OBJECT) {
      sprout_str *ids = (sprout_str *)sprout_arena_take(run->x.turn, sizeof *ids);
      if (ids == NULL) return SPROUT_EVAL_NO_MEMORY;
      *ids = first->object;
      record.referents = ids;
      record.referent_count = 1;
    } else if (first->kind == SPROUT_BOUND_SET && first->set_count > 0) {
      record.referents = first->set;
      record.referent_count = first->set_count;
    }
  }
  bindings = (sprout_stored_binding *)sprout_arena_take(run->x.turn, (reading->bound_count + 1) * sizeof *bindings);
  if (bindings == NULL) return SPROUT_EVAL_NO_MEMORY;
  /* Kept in the order the host bound the roles. */
  for (i = 0; i < reading->bound_count; i++) {
    size_t role = reading->bound_order[i];
    bindings[n].role = expr_str(reading->verb->roles[role].name);
    bindings[n].bound = reading->roles[role].bound;
    n++;
  }
  record.has_reading = true;
  record.reading.library = expr_str(reading->verb->library);
  record.reading.name = expr_str(reading->verb->name);
  record.reading.binding_count = n;
  record.reading.bindings = bindings;
  return drafted(sprout_draft_put_visitor(&run->draft, &record));
}

/* The consent pass's refusal, told to the actor. */
static sprout_eval_status refusal_told(const sprout_frame *frame, sprout_str actor, const sprout_permit_refusal *refusal,
                                       sprout_effect *out) {
  sprout_str *to = (sprout_str *)sprout_arena_take(frame->turn, sizeof *to);
  if (to == NULL) return SPROUT_EVAL_NO_MEMORY;
  *to = actor;
  memset(out, 0, sizeof *out);
  out->kind = SPROUT_EFFECT_REFUSED;
  out->to = to;
  out->to_count = 1;
  out->by = refusal->refusal.by;
  out->said = refusal->refusal.said;
  out->bindings = refusal->refusal.bindings;
  out->binding_count = refusal->refusal.binding_count;
  return SPROUT_EVAL_OK;
}

/* The direction a refused reading of `go` tried, where it named an exit; one with no bytes for any other reading. */
static sprout_str way_tried(const sprout_resolved *reading) {
  const sprout_stored_bound *way = sprout_exit_of(reading);
  sprout_str none = {NULL, 0};
  return way != NULL && way->has_direction ? way->direction : none;
}

/*
 * A refused command's end: its refusal said, then what follows the command, with `refused` bound (the spec's
 * Verbs > After a command), then the arrivals any move of theirs owes.
 */
static sprout_eval_status refusal_followed(turn_run *run, const sprout_frame *frame, sprout_str actor,
                                           const sprout_effect *refusal, sprout_str tried,
                                           const sprout_arrived **arrivals, size_t *arrival_count) {
  EXPR_NEED(sprout_exec_record(&run->x, refusal));
  sprout_after_owed(&run->x, true, tried);
  EXPR_NEED(sprout_command_over(&run->x, frame, actor, NULL));
  return sprout_arrivals_read(&run->x, frame, arrivals, arrival_count);
}

/* What a displaced visitor is told and where they come in: the world's `displaced`, then the arrival place. */
static sprout_eval_status displaced(turn_run *run, sprout_str visit, sprout_str actor, bool *refused,
                                    sprout_effect *lines, size_t *line_count, const sprout_arrived **arrivals,
                                    size_t *arrival_count) {
  sprout_frame frame = sprout_exec_frame(&run->x, actor, NULL, NULL);
  const sprout_stored_visitor *before = sprout_draft_visitor(&run->draft, visit);
  sprout_stored_visitor record;
  turn_entry entry;
  *refused = false;
  *line_count = 0;
  EXPR_NEED(turn_told(&frame, "displaced", actor, &lines[(*line_count)++]));
  if (before == NULL) return SPROUT_EVAL_NO_MEMORY;
  record = *before;
  if (turn_closed_reason(&frame) != NULL) return SPROUT_EVAL_OK;
  EXPR_NEED(turn_enter(run, actor, expr_str(run->world->arrival), &entry));
  if (entry.refused) {
    lines[(*line_count)++] = entry.refusal;
    *refused = true;
    return SPROUT_EVAL_OK;
  }
  record.has_last_place = true;
  record.last_place = entry.place;
  EXPR_NEED(drafted(sprout_draft_put_visitor(&run->draft, &record)));
  EXPR_NEED(sprout_exec_drain(&run->x));
  return sprout_arrivals_read(&run->x, &frame, arrivals, arrival_count);
}

/* The stock line for a fault, told without rendering: it names nothing, so a fault is never silent. */
static sprout_status stock_fault(sprout_outcome *outcome, const sprout_state *state, sprout_str actor, sprout_str visit) {
  sprout_arena *keep = turn_keep(outcome);
  sprout_line *line = (sprout_line *)sprout_arena_take(keep, sizeof *line);
  sprout_told_effect *effect = (sprout_told_effect *)sprout_arena_take(keep, sizeof *effect);
  const char *words = prose_stock_words("fault");
  if (line == NULL || effect == NULL || words == NULL) return SPROUT_NO_MEMORY;
  effect->kind = SPROUT_LINE_NOTICE;
  effect->from.bytes = sprout_arena_copy(keep, state->world.bytes, state->world.length);
  effect->from.length = state->world.length;
  effect->has_actor = true;
  effect->actor.bytes = sprout_arena_copy(keep, actor.bytes, actor.length);
  effect->actor.length = actor.length;
  effect->to = effect->actor;
  effect->visit.bytes = sprout_arena_copy(keep, visit.bytes, visit.length);
  effect->visit.length = visit.length;
  effect->line_first = 0;
  effect->line_count = 1;
  line->recipient = effect->visit.bytes;
  line->recipient_length = visit.length;
  line->text = sprout_arena_copy(keep, words, strlen(words));
  line->text_length = strlen(words);
  line->kind = SPROUT_LINE_NOTICE;
  line->effect = 0;
  if (effect->from.bytes == NULL || effect->actor.bytes == NULL || effect->visit.bytes == NULL || line->text == NULL)
    return SPROUT_NO_MEMORY;
  outcome->line_count = 1;
  outcome->lines = line;
  outcome->effect_count = 1;
  outcome->effects = effect;
  return SPROUT_OK;
}

/*
 * The world's `fault`, told to the actor over the committed state, rendered under a fresh budget and a
 * stream begun again from the turn's seed; where the world's own words cannot be rendered, the stock line.
 */
static sprout_status tell_fault(sprout_world *world, sprout_state *state, const sprout_host *host, uint64_t seed,
                                uint64_t instant, sprout_str actor, sprout_str visit, sprout_outcome *outcome) {
  turn_run run;
  sprout_frame frame;
  sprout_effect told;
  sprout_str *to, place = {NULL, 0};
  sprout_effect_binding *bound;
  const sprout_stored_instance *standing;
  sprout_eval_status eval;
  sprout_status status = turn_open(&run, world, state, host, SPROUT_TURN_COMMAND, seed, instant, NULL, NULL);
  bool gone;
  if (status != SPROUT_OK) return status;
  frame = sprout_exec_frame(&run.x, actor, NULL, NULL);
  standing = expr_instance(&frame, actor);
  gone = standing == NULL || !standing->has_container || expr_instance(&frame, standing->container) == NULL;
  if (!gone) place = standing->container;
  memset(&told, 0, sizeof told);
  to = (sprout_str *)sprout_arena_take(run.x.turn, sizeof *to);
  bound = (sprout_effect_binding *)sprout_arena_take(run.x.turn, 2 * sizeof *bound);
  if (to == NULL || bound == NULL) {
    turn_drop(&run);
    return SPROUT_NO_MEMORY;
  }
  *to = actor;
  told.kind = SPROUT_EFFECT_NOTICE;
  told.to = to;
  told.to_count = 1;
  bound[0].name = "actor";
  bound[0].bound = sprout_evaluated_object(actor);
  told.binding_count = 1;
  if (gone) {
    told.by = state->world;
    told.said.kind = SPROUT_SPEECH_ENGINE;
    told.said.name = "fault";
  } else {
    bound[1].name = "here";
    bound[1].bound = sprout_evaluated_object(place);
    told.binding_count = 2;
    sprout_engine_said(&frame, "fault", &actor, &place, &told.by, &told.said);
  }
  told.bindings = bound;
  eval = sprout_exec_record(&run.x, &told);
  if (eval == SPROUT_EVAL_OK) eval = turn_render(&run, &actor, outcome);
  turn_drop(&run);
  if (eval == SPROUT_EVAL_NO_MEMORY) return SPROUT_NO_MEMORY;
  if (eval != SPROUT_EVAL_OK) return stock_fault(outcome, state, actor, visit);
  return SPROUT_OK;
}

/* The lines the parser says before the reading's own, told to the actor where they stand. */
static sprout_eval_status asides_told(const sprout_frame *frame, sprout_str actor, size_t aside_count,
                                      const sprout_aside *asides, sprout_effect **out, size_t *count) {
  const sprout_stored_instance *standing = expr_instance(frame, actor);
  sprout_effect *made = (sprout_effect *)sprout_arena_take(frame->turn, (aside_count + 2) * sizeof *made);
  size_t i;
  *out = made;
  *count = 0;
  if (made == NULL) return SPROUT_EVAL_NO_MEMORY;
  if (aside_count == 0) return SPROUT_EVAL_OK;
  if (standing == NULL || !standing->has_container) return expr_engine(frame, "a visitor is told by the parser, and is away.");
  for (i = 0; i < aside_count; i++) {
    const sprout_aside *aside = &asides[i];
    sprout_effect *effect = &made[*count];
    sprout_effect_binding *bound;
    sprout_str *to = (sprout_str *)sprout_arena_take(frame->turn, sizeof *to);
    size_t n = 0;
    bound = (sprout_effect_binding *)sprout_arena_take(frame->turn, 5 * sizeof *bound);
    if (to == NULL || bound == NULL) return SPROUT_EVAL_NO_MEMORY;
    *to = actor;
    memset(effect, 0, sizeof *effect);
    effect->kind = SPROUT_EFFECT_NOTICE;
    effect->to = to;
    effect->to_count = 1;
    sprout_engine_said(frame, aside->line, &actor, &standing->container, &effect->by, &effect->said);
    bound[n].name = "actor";
    bound[n++].bound = sprout_evaluated_object(actor);
    bound[n].name = "here";
    bound[n++].bound = sprout_evaluated_object(standing->container);
    if (aside->thing != NULL) {
      bound[n].name = "thing";
      bound[n++].bound = sprout_evaluated_object(expr_str(aside->thing));
    }
    if (aside->reading != NULL) {
      sprout_value reading;
      if (!sprout_string(frame->turn, aside->reading, strlen(aside->reading), &reading)) return SPROUT_EVAL_NO_MEMORY;
      bound[n].name = "reading";
      bound[n++].bound = sprout_evaluated_value(reading);
    }
    if (aside->pronoun != NULL) {
      sprout_value pronoun;
      if (!sprout_string(frame->turn, aside->pronoun, strlen(aside->pronoun), &pronoun)) return SPROUT_EVAL_NO_MEMORY;
      bound[n].name = "pronoun";
      bound[n++].bound = sprout_evaluated_value(pronoun);
    }
    effect->bindings = bound;
    effect->binding_count = n;
    (*count)++;
  }
  return SPROUT_EVAL_OK;
}

/* What a command became before it runs: the reading to run, or the line said in its place, and what the line runs after it. */
typedef struct commanded {
  bool reads;               /* a reading runs */
  sprout_resolved reading;
  bool answered, stops;     /* no reading runs: a line is said in its place, which ends the line or does not */
  sprout_effect said;
  bool exit_refused;        /* what was said is an exit's refusal, which what follows a command follows */
  sprout_str tried;         /* the refusing exit's direction */
  size_t aside_count;
  const sprout_aside *asides;
  uint64_t drawn_among;
  bool several;             /* an intent's or a line's planned turns follow it */
  sprout_reading *read;     /* the reading as a host reads it */
  size_t next_count;
  const sprout_following *next;
} commanded;

#ifndef SPROUT_NO_PARSER

/* The parser's answer to a line it did not read as a reading, said to the actor: an exit's refusal as a refusal, every other as a notice. */
static sprout_eval_status answer_told(const sprout_frame *frame, sprout_str actor, const parse_answer *said,
                                      sprout_effect *out) {
  sprout_str *to = (sprout_str *)sprout_arena_take(frame->turn, sizeof *to);
  sprout_effect_binding *bound = (sprout_effect_binding *)sprout_arena_take(frame->turn, (said->binding_count + 1) * sizeof *bound);
  size_t i;
  if (to == NULL || bound == NULL) return SPROUT_EVAL_NO_MEMORY;
  *to = actor;
  memset(out, 0, sizeof *out);
  out->kind = strcmp(said->answer, "refused") == 0 ? SPROUT_EFFECT_REFUSED : SPROUT_EFFECT_NOTICE;
  out->to = to;
  out->to_count = 1;
  out->by = said->by;
  out->said = said->said;
  for (i = 0; i < said->binding_count; i++) {
    const sprout_said_binding *one = &said->bindings[i];
    bound[i].name = one->name;
    if (one->object) {
      bound[i].bound = sprout_evaluated_object(one->text);
    } else {
      sprout_value words;
      if (!sprout_string(frame->turn, one->text.bytes, one->text.length, &words)) return SPROUT_EVAL_NO_MEMORY;
      bound[i].bound = sprout_evaluated_value(words);
    }
  }
  out->bindings = bound;
  out->binding_count = said->binding_count;
  return SPROUT_EVAL_OK;
}

/* The engine's `nothing_happens`, said to the actor where they stand: a line whose intent planned no step to run. */
static sprout_eval_status nothing_happens(const sprout_frame *frame, sprout_str actor, sprout_effect *out) {
  const sprout_stored_instance *standing = expr_instance(frame, actor);
  sprout_str *to = (sprout_str *)sprout_arena_take(frame->turn, sizeof *to);
  sprout_effect_binding *bound = (sprout_effect_binding *)sprout_arena_take(frame->turn, 2 * sizeof *bound);
  if (to == NULL || bound == NULL) return SPROUT_EVAL_NO_MEMORY;
  if (standing == NULL || !standing->has_container) return expr_engine(frame, "a visitor's intent planned nothing, and they are away.");
  *to = actor;
  memset(out, 0, sizeof *out);
  out->kind = SPROUT_EFFECT_SAID;
  out->to = to;
  out->to_count = 1;
  sprout_engine_said(frame, "nothing_happens", &actor, &standing->container, &out->by, &out->said);
  bound[0].name = "actor";
  bound[0].bound = sprout_evaluated_object(actor);
  bound[1].name = "here";
  bound[1].bound = sprout_evaluated_object(standing->container);
  out->bindings = bound;
  out->binding_count = 2;
  return SPROUT_EVAL_OK;
}

/* `reading` as a host reads one, in `keep`, its roles in the order bound. */
static bool resolved_out(sprout_arena *keep, sprout_arena *turn, const sprout_resolved *reading, sprout_reading *out) {
  sprout_stored_bound *bounds = (sprout_stored_bound *)sprout_arena_take(turn, (reading->bound_count + 1) * sizeof *bounds);
  parse_reading read;
  size_t i;
  if (bounds == NULL) return false;
  for (i = 0; i < reading->bound_count; i++) bounds[i] = reading->roles[reading->bound_order[i]].bound;
  memset(&read, 0, sizeof read);
  read.verb = reading->verb;
  read.actor = reading->actor;
  read.count = reading->bound_count;
  read.roles = reading->bound_order;
  read.bounds = bounds;
  return parse_reading_out(keep, &read, out);
}


/*
 * An intent's steps planned (the spec's Parsing > Intents): the first is the reading this turn runs, and the rest
 * are planned turns before the line's own; with none to run, the line is answered `nothing_happens` and goes on.
 */
static sprout_eval_status intended(turn_run *run, const sprout_frame *frame, sprout_arena *keep, sprout_str actor,
                                   const parse_reading *reading, const sprout_parsed *parsed, commanded *out) {
  const sprout_intent *intent = reading->intent;
  sprout_filled *slots = (sprout_filled *)sprout_arena_take(run->x.turn, (intent->slot_count + 1) * sizeof *slots);
  const sprout_resolved *planned;
  sprout_intended meant;
  sprout_following *next;
  size_t count, i;
  if (slots == NULL) return SPROUT_EVAL_NO_MEMORY;
  for (i = 0; i < reading->count; i++) {
    slots[reading->roles[i]].filled = true;
    slots[reading->roles[i]].bound = reading->bounds[i];
  }
  meant.intent = intent;
  meant.actor = reading->actor;
  meant.slots = slots;
  EXPR_NEED(sprout_plan_intent(frame, &meant, &planned, &count));
  out->next = next = (sprout_following *)sprout_arena_take(keep, (count + parsed->rest_count + 1) * sizeof *next);
  if (next == NULL) return SPROUT_EVAL_NO_MEMORY;
  if (count == 0) {
    memcpy(next, parsed->rest, parsed->rest_count * sizeof *next);
    out->next_count = parsed->rest_count;
    out->answered = true;
    return nothing_happens(frame, actor, &out->said);
  }
  for (i = 1; i < count; i++) {
    sprout_reading *step = (sprout_reading *)sprout_arena_take(keep, sizeof *step);
    if (step == NULL || !resolved_out(keep, run->x.turn, &planned[i], step)) return SPROUT_EVAL_NO_MEMORY;
    next[out->next_count++].planned = step;
  }
  memcpy(next + out->next_count, parsed->rest, parsed->rest_count * sizeof *next);
  out->next_count += parsed->rest_count;
  out->reads = true;
  out->reading = planned[0];
  out->several = true;
  out->read = (sprout_reading *)sprout_arena_take(keep, sizeof *out->read);
  if (out->read == NULL || !resolved_out(keep, run->x.turn, &planned[0], out->read)) return SPROUT_EVAL_NO_MEMORY;
  return SPROUT_EVAL_OK;
}

#endif

/*
 * Reads what the visitor typed, or what a line handed the turn, in the turn (the spec's The runtime > Turns): the
 * reading to run, with what is said before it, or the parser's answer. A call the parser refuses is the host's
 * defect, its words in `words`; a parse that faulted is the turn's fault.
 */
static sprout_status read_command(turn_run *run, const sprout_frame *frame, const sprout_turn_input *input,
                                  sprout_arena *keep, sprout_str actor, commanded *out, sprout_eval_status *eval,
                                  sprout_fault *words) {
  sprout_handed handed;
  sprout_parsed parsed;
  parse_turned turned;
  sprout_str line = {"", 0};
  sprout_status status;
  size_t i;
  handed.planned = input->planned;
  handed.reread = input->reread;
  if (input->text != NULL) {
    line.bytes = input->text;
    line.length = input->text_length;
  }
  status = parse_command_turn(run, input->visit, line, input->planned == NULL ? NULL : &handed, keep, &parsed, &turned);
  if (status != SPROUT_OK) {
    memcpy(words->text, parsed.fault.text, sizeof words->text);
    return status;
  }
  *eval = SPROUT_EVAL_OK;
#ifdef SPROUT_NO_PARSER
  /* A runtime built without the parser refuses every typed line above, so no parse comes this far. */
  (void)frame, (void)keep, (void)actor, (void)out, (void)i, (void)turned;
  return SPROUT_BAD_INPUT;
#else
  switch (parsed.end) {
    case SPROUT_PARSED_FAULTED:
      *eval = turned.status;
      return SPROUT_OK;
    case SPROUT_PARSED_ANSWERED:
      out->answered = out->stops = true;
      if (turned.said.tried != NULL) {
        out->exit_refused = true;
        out->tried.bytes = turned.said.tried;
        out->tried.length = strlen(turned.said.tried);
      }
      *eval = answer_told(frame, actor, &turned.said, &out->said);
      return SPROUT_OK;
    case SPROUT_PARSED_INTENT:
      *eval = intended(run, frame, keep, actor, &turned.reading, &parsed, out);
      break;
    case SPROUT_PARSED_READING:
      out->reads = true;
      *eval = parse_resolved_of(frame, &turned.reading, &out->reading);
      out->next = parsed.rest;
      out->next_count = parsed.rest_count;
      out->read = (sprout_reading *)sprout_arena_take(keep, sizeof *out->read);
      if (out->read == NULL) *eval = SPROUT_EVAL_NO_MEMORY;
      else *out->read = parsed.reading;
      for (i = 0; i < parsed.rest_count; i++) out->several = out->several || parsed.rest[i].planned != NULL;
      break;
  }
  out->asides = parsed.asides;
  out->aside_count = parsed.aside_count;
  out->drawn_among = parsed.drawn ? parsed.drawn_among : 0;
  return SPROUT_OK;
#endif
}

/* What a command the parser answered was answered with, for its account: its line's passage name, or its words. */
static const char *answer_of(sprout_arena *keep, const sprout_graph *graph, const sprout_speech *said) {
  const sprout_node *value;
  switch (said->kind) {
    case SPROUT_SPEECH_TEXT:
      value = sprout_node_get(graph, said->node, "value");
      return sprout_arena_copy(keep, sprout_text(graph, value), sprout_text_length(graph, value));
    case SPROUT_SPEECH_RECORDED:
      return sprout_arena_copy(keep, said->transcript.bytes == NULL ? "" : said->transcript.bytes, said->transcript.length);
    default:
      return sprout_arena_copy(keep, said->name, strlen(said->name));
  }
}

/* Whether the effect pass said a refusal to the actor among the lines from `from` on, which stops a line's steps. */
static bool refused_actor(const sprout_exec *x, size_t from, sprout_str actor) {
  size_t i, j;
  for (i = from; i < x->effect_count; i++) {
    if (x->effects[i].kind != SPROUT_EFFECT_REFUSED) continue;
    for (j = 0; j < x->effects[i].to_count; j++)
      if (sprout_str_same(x->effects[i].to[j], actor)) return true;
  }
  return false;
}

/* The words a turn was handed, the step a line planned for it and the item it re-read, copied into the log entry. */
static sprout_status logged_command(sprout_outcome *outcome, const sprout_turn_input *input) {
  sprout_arena *keep = turn_keep(outcome);
  sprout_log_entry *log = &outcome->log;
  if (input->text != NULL) {
    log->text.bytes = sprout_arena_copy(keep, input->text, input->text_length);
    log->text.length = input->text_length;
    if (log->text.bytes == NULL) return SPROUT_NO_MEMORY;
  }
  if (input->planned != NULL && (log->planned = sprout_reading_copy(keep, input->planned)) == NULL) return SPROUT_NO_MEMORY;
  if (input->reread != NULL && (log->reread = sprout_reread_copy(keep, input->reread)) == NULL) return SPROUT_NO_MEMORY;
  log->drawn_among = outcome->drawn_among;
  return SPROUT_OK;
}

/* Words for a command the host should not have handed over, or NULL. */
static const char *misshapen(const sprout_turn_input *input) {
  if (input->visit == NULL) return "a command names the visit that typed it.";
  if (input->reading != NULL && input->planned != NULL) return "a command is a reading or a planned step, not both.";
  if (input->reread != NULL && input->planned == NULL) return "an item of a run is re-read only beside the reading planned for it.";
  if (input->reading == NULL && input->planned == NULL && input->text == NULL)
    return "a command is a reading built from chips, a typed line, or a step a line planned.";
  return NULL;
}

sprout_status turn_command(sprout_world *world, sprout_state *state, const sprout_host *host,
                           const sprout_turn_input *input, sprout_outcome *outcome) {
  const sprout_stored_visitor *record;
  const sprout_stored_instance *instance;
  sprout_str visit, actor;
  turn_run run;
  sprout_frame frame;
  sprout_status status;
  sprout_eval_status eval;
  sprout_permit_refusal refusal;
  sprout_reading_end end = SPROUT_READING_ACTED;
  sprout_effect before[2], *asides = NULL;
  size_t before_count = 0, arrival_count = 0, aside_count = 0, said_from = 0;
  const sprout_arrived *arrivals = NULL;
  const char *wrong = misshapen(input);
  commanded c;
  bool gone, refused_here = false;
  uint64_t seed;
  if (wrong != NULL) return turn_refuse(outcome, wrong, "", "");
  record = turn_visitor(state, input->visit);
  if (record == NULL) return turn_refuse(outcome, "`", input->visit, "` has never visited this world.");
  instance = sprout_state_find(state, record->instance);
  if (instance == NULL || !instance->has_container)
    return turn_refuse(outcome, "`", input->visit, "` is not in this world, so cannot act in it.");
  if (input->reading != NULL &&
      (input->reading->actor == NULL || strlen(input->reading->actor) != record->instance.length ||
       memcmp(input->reading->actor, record->instance.bytes, record->instance.length) != 0))
    return turn_refuse(outcome, "the reading is not `", input->visit, "`'s: its actor is not the visitor.");
  status = turn_outcome_begin(host, outcome);
  if (status != SPROUT_OK) return status;
  if (!sprout_state_copy_str(turn_keep(outcome), record->instance, &actor)) return turn_abort(outcome, SPROUT_NO_MEMORY);
  visit.bytes = sprout_arena_copy(turn_keep(outcome), input->visit, strlen(input->visit));
  visit.length = strlen(input->visit);
  if (visit.bytes == NULL) return turn_abort(outcome, SPROUT_NO_MEMORY);
  seed = host->seed(host->ctx);
  status = turn_open(&run, world, state, host, SPROUT_TURN_COMMAND, seed, input->instant, NULL, NULL);
  if (status != SPROUT_OK) return turn_abort(outcome, status);
  run.x.passes_time = true;
  frame = sprout_exec_frame(&run.x, actor, NULL, NULL);
  gone = !turn_stands_in_place(&frame, actor);
  memset(&refusal, 0, sizeof refusal);
  memset(&c, 0, sizeof c);
  eval = SPROUT_EVAL_OK;
  if (gone) {
    /* What they typed is not read; they are told where they are instead. */
    eval = displaced(&run, visit, actor, &refused_here, before, &before_count, &arrivals, &arrival_count);
  } else if (input->reading != NULL) {
    /* A reading built from chips is run as it is, once what it names is checked against the world. */
    status = sprout_reading_resolve(world, &run.draft, &run.scratch, input->reading, &c.reading, outcome->fault.text,
                                    sizeof outcome->fault.text);
    if (status != SPROUT_OK) {
      turn_drop(&run);
      return turn_abort(outcome, status);
    }
    c.reads = true;
    eval = sprout_reading_exits(&frame, &c.reading);
  } else {
    status = read_command(&run, &frame, input, turn_keep(outcome), actor, &c, &eval, &outcome->fault);
    if (status != SPROUT_OK) {
      turn_drop(&run);
      return turn_abort(outcome, status);
    }
  }
  if (eval == SPROUT_EVAL_OK && c.reads) {
    eval = asides_told(&frame, actor, c.aside_count, c.asides, &asides, &aside_count);
    said_from = run.x.effect_count;
    if (eval == SPROUT_EVAL_OK) eval = sprout_perform(&run.x, &frame, &c.reading, &end, &refusal);
    if (eval == SPROUT_EVAL_OK) eval = remember(&run, visit, &c.reading);
    if (eval == SPROUT_EVAL_OK && end == SPROUT_READING_REFUSED) {
      /* The refusal is the answer and ends the line: nothing was queued, and what follows the command follows it. */
      eval = refusal_told(&frame, actor, &refusal, &before[0]);
      if (eval == SPROUT_EVAL_OK)
        eval = refusal_followed(&run, &frame, actor, &before[0], way_tried(&c.reading), &arrivals, &arrival_count);
    } else if (eval == SPROUT_EVAL_OK) {
      outcome->goes_on = !refused_actor(&run.x, said_from, actor);
      eval = sprout_command_over(&run.x, &frame, actor, &c.reading);
      if (eval == SPROUT_EVAL_OK) eval = sprout_arrivals_read(&run.x, &frame, &arrivals, &arrival_count);
    }
  } else if (eval == SPROUT_EVAL_OK && c.exit_refused) {
    /* An exit's refusal is a refused `go`: what follows the command follows it. */
    eval = refusal_followed(&run, &frame, actor, &c.said, c.tried, &arrivals, &arrival_count);
  }
  if (eval == SPROUT_EVAL_OK) {
    if (gone) {
      eval = sprout_lines_assembled(&run.x, before, before_count, arrivals, arrival_count, NULL, 0);
    } else if (c.answered && !c.exit_refused) {
      /* The parser's answer, or an intent's `nothing_happens`, is all the turn says. */
      eval = sprout_lines_assembled(&run.x, &c.said, 1, NULL, 0, NULL, 0);
    } else {
      eval = sprout_lines_assembled(&run.x, asides, aside_count, arrivals, arrival_count, NULL, 0);
    }
  }
  (void)refused_here;
  if (eval == SPROUT_EVAL_OK) eval = turn_render(&run, &actor, outcome);
  if (eval == SPROUT_EVAL_OK) {
    status = turn_commit(&run, outcome);
    if (status != SPROUT_OK) {
      turn_drop(&run);
      return turn_abort(outcome, status);
    }
    outcome->committed = outcome->state_changed = true;
    outcome->result = SPROUT_RESULT_DONE;
    outcome->passes = sprout_pass_granted(&host->budgets, run.x.passed);
    /* A line goes on past a reading that refused its actor nothing, and past an answer that does not stop it. */
    outcome->answered = c.answered;
    if (c.answered) outcome->goes_on = !c.stops;
    if (c.reads) {
      outcome->drawn_among = c.drawn_among;
      /* A turn of a line of several readings planned at once, an intent's, `all`'s or a run's, is a step the host logs. */
      if (input->planned != NULL || c.several) outcome->step = c.read;
    }
    if (c.answered && host->accounts && (outcome->answer = answer_of(turn_keep(outcome), &world->graph, &c.said.said)) == NULL) {
      turn_drop(&run);
      return turn_abort(outcome, SPROUT_NO_MEMORY);
    }
    if (end == SPROUT_READING_REFUSED) {
      outcome->refused = true;
      outcome->goes_on = false;
    } else {
      outcome->next = c.next;
      outcome->next_count = c.next_count;
    }
  } else if (eval == SPROUT_EVAL_NO_MEMORY) {
    turn_drop(&run);
    return turn_abort(outcome, SPROUT_NO_MEMORY);
  } else {
    if (turn_fault_of(&run, eval, outcome) != SPROUT_OK) {
      turn_drop(&run);
      return turn_abort(outcome, SPROUT_NO_MEMORY);
    }
    outcome->line_count = outcome->effect_count = outcome->cut_count = 0;
    outcome->goes_on = false;
    turn_drop(&run);
    status = tell_fault(world, state, host, seed, input->instant, actor, visit, outcome);
    if (status != SPROUT_OK) return turn_abort(outcome, status);
  }
  turn_drop(&run);
  status = turn_log(&run, outcome, visit.bytes, visit.length);
  if (status == SPROUT_OK) status = logged_command(outcome, input);
  if (status != SPROUT_OK) return turn_abort(outcome, status);
  return SPROUT_OK;
}
