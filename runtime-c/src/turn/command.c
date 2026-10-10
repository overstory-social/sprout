/*
 * A command turn (the spec's The runtime > Turns, Faults). Its order is fixed: the consent pass; the effect
 * pass, actor first and then roles in declared order; the queue, breadth-first in insertion order; what the
 * engine answers; then the views of everyone present are stale, as every write turn that commits makes them.
 * The one who typed the command is always told something: the consent pass's refusal, what the effect pass
 * said, what the engine answered or its `nothing_happens`, or, when the turn faults and is abandoned, the
 * engine's `fault`. What it says is one sequence of effects in that order: the effect pass's lines, then the
 * queue's, then the engine's answers; the place a move carried someone to is read among them where the body
 * that moved them ended.
 *
 * Reading typed words is the host's: the turn is handed the reading they make, with the verb, the actor and
 * what fills each role by id. A visitor standing in a place that is gone is displaced instead, and what they
 * typed is not read, since it was typed about where they no longer are (the spec's What absent means).
 */
#include <string.h>

#include "../expr/expr.h"
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

/* The lines the host's parser says before the reading's own, told to the actor where they stand. */
static sprout_eval_status asides_told(const sprout_frame *frame, sprout_str actor, const sprout_reading *reading,
                                      sprout_effect **out, size_t *count) {
  const sprout_stored_instance *standing = expr_instance(frame, actor);
  sprout_effect *made = (sprout_effect *)sprout_arena_take(frame->turn, (reading->aside_count + 2) * sizeof *made);
  size_t i;
  *out = made;
  *count = 0;
  if (made == NULL) return SPROUT_EVAL_NO_MEMORY;
  if (reading->aside_count == 0) return SPROUT_EVAL_OK;
  if (standing == NULL || !standing->has_container) return expr_engine(frame, "a visitor is told by the parser, and is away.");
  for (i = 0; i < reading->aside_count; i++) {
    const sprout_aside *aside = &reading->asides[i];
    sprout_effect *effect = &made[*count];
    sprout_effect_binding *bound;
    sprout_str *to = (sprout_str *)sprout_arena_take(frame->turn, sizeof *to);
    size_t n = 0;
    bound = (sprout_effect_binding *)sprout_arena_take(frame->turn, 4 * sizeof *bound);
    if (to == NULL || bound == NULL) return SPROUT_EVAL_NO_MEMORY;
    if (aside->line == NULL || aside->thing == NULL) return expr_engine(frame, "a line the parser says names no thing.");
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
    bound[n].name = "thing";
    bound[n++].bound = sprout_evaluated_object(expr_str(aside->thing));
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

/* What the host's parser drew while it read the line comes first on the turn's stream. */
static sprout_eval_status parse_draws(const sprout_frame *frame, turn_run *run, const sprout_reading *reading) {
  size_t i;
  for (i = 0; i < reading->draw_count; i++) {
    uint32_t drawn;
    if (!sprout_draws_below(run->draws, reading->draws[i], &drawn))
      return expr_engine(frame, "the parser drew below a bound that no draw takes.");
  }
  return SPROUT_EVAL_OK;
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
  sprout_resolved resolved;
  sprout_permit_refusal refusal;
  sprout_reading_end end = SPROUT_READING_ACTED;
  sprout_effect before[2], *asides = NULL;
  size_t before_count = 0, arrival_count = 0, answer_count = 0, aside_count = 0;
  const sprout_arrived *arrivals = NULL;
  const sprout_effect *engine = NULL;
  bool gone, refused_here = false;
  uint64_t seed;
  if (input->visit == NULL || input->reading == NULL) return turn_refuse(outcome, "a command names a visit and a reading.", "", "");
  record = turn_visitor(state, input->visit);
  if (record == NULL) return turn_refuse(outcome, "`", input->visit, "` has never visited this world.");
  instance = sprout_state_find(state, record->instance);
  if (instance == NULL || !instance->has_container)
    return turn_refuse(outcome, "`", input->visit, "` is not in this world, so cannot act in it.");
  if (input->reading->actor == NULL || strlen(input->reading->actor) != record->instance.length ||
      memcmp(input->reading->actor, record->instance.bytes, record->instance.length) != 0)
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
  frame = sprout_exec_frame(&run.x, actor, NULL, NULL);
  gone = !turn_stands_in_place(&frame, actor);
  memset(&refusal, 0, sizeof refusal);
  eval = SPROUT_EVAL_OK;
  if (gone) {
    /* What they typed is not read; they are told where they are instead. */
    eval = displaced(&run, visit, actor, &refused_here, before, &before_count, &arrivals, &arrival_count);
  } else {
    status = sprout_reading_resolve(world, &run.draft, &run.scratch, input->reading, &resolved, outcome->fault.text,
                                    sizeof outcome->fault.text);
    if (status != SPROUT_OK) {
      turn_drop(&run);
      return turn_abort(outcome, status);
    }
    eval = parse_draws(&frame, &run, input->reading);
    if (eval == SPROUT_EVAL_OK) eval = asides_told(&frame, actor, input->reading, &asides, &aside_count);
    if (eval == SPROUT_EVAL_OK) eval = sprout_reading_exits(&frame, &resolved);
    if (eval == SPROUT_EVAL_OK) eval = sprout_perform(&run.x, &frame, &resolved, &end, &refusal);
    if (eval == SPROUT_EVAL_OK) eval = remember(&run, visit, &resolved);
    if (eval == SPROUT_EVAL_OK && end == SPROUT_READING_REFUSED) {
      /* The refusal ends the turn: nothing was queued, and nothing is read in. */
      eval = refusal_told(&frame, actor, &refusal, &before[0]);
      before_count = 1;
    } else if (eval == SPROUT_EVAL_OK) {
      eval = sprout_exec_drain(&run.x);
      if (eval == SPROUT_EVAL_OK) eval = sprout_arrivals_read(&run.x, &frame, &arrivals, &arrival_count);
      if (eval == SPROUT_EVAL_OK) eval = sprout_engine_answers(&run.x, &frame, &resolved, &engine, &answer_count);
    }
  }
  if (eval == SPROUT_EVAL_OK) {
    if (gone) {
      eval = sprout_lines_assembled(&run.x, before, before_count, arrivals, arrival_count, NULL, 0);
    } else if (end == SPROUT_READING_REFUSED) {
      /* What the parser said, then the refusal. */
      sprout_effect *both = (sprout_effect *)sprout_arena_take(run.x.turn, (aside_count + 2) * sizeof *both);
      if (both == NULL) eval = SPROUT_EVAL_NO_MEMORY;
      else {
        memcpy(both, asides, aside_count * sizeof *both);
        both[aside_count] = before[0];
        eval = sprout_lines_assembled(&run.x, both, aside_count + 1, NULL, 0, NULL, 0);
      }
    } else {
      eval = sprout_lines_assembled(&run.x, asides, aside_count, arrivals, arrival_count, engine, answer_count);
    }
  }
  (void)refused_here;
  if (eval == SPROUT_EVAL_OK) eval = turn_render(&run, &actor, outcome);
  if (eval == SPROUT_EVAL_OK) {
    status = turn_commit(&run);
    if (status != SPROUT_OK) {
      turn_drop(&run);
      return turn_abort(outcome, status);
    }
    outcome->committed = outcome->state_changed = true;
    outcome->result = SPROUT_RESULT_DONE;
  } else if (eval == SPROUT_EVAL_NO_MEMORY) {
    turn_drop(&run);
    return turn_abort(outcome, SPROUT_NO_MEMORY);
  } else {
    turn_fault_of(&run, eval, outcome);
    outcome->line_count = outcome->effect_count = outcome->cut_count = 0;
    turn_drop(&run);
    status = tell_fault(world, state, host, seed, input->instant, actor, visit, outcome);
    if (status != SPROUT_OK) return turn_abort(outcome, status);
  }
  turn_drop(&run);
  status = turn_log(&run, outcome, visit.bytes, visit.length);
  if (status == SPROUT_OK && input->text != NULL) {
    sprout_str text;
    text.bytes = sprout_arena_copy(turn_keep(outcome), input->text, input->text_length);
    text.length = input->text_length;
    if (text.bytes == NULL) status = SPROUT_NO_MEMORY;
    else outcome->log.text = text;
  }
  if (status != SPROUT_OK) return turn_abort(outcome, status);
  return SPROUT_OK;
}
