/*
 * A visitor's arrival (the spec's The host contract > Admission and identity; The world model > Actors
 * and visitors; The compiler > What absent means). A new visitor is an instance of the visitor kind, made
 * as they arrive the way a spawn is, with its own copy of each object its kind's body holds, of which
 * nothing is sent; a returning one comes back with what they carried away, where they last stood if that
 * place still exists and accepts them, and otherwise where the world says visitors arrive, told through the
 * engine's `displaced` when the place they stood in is gone. Entry is a move from outside the tree: the
 * host's bound on a crowd is asked, then the place's `accept`, with the world as `from`; then the place is
 * sent `:entered`, the visitor `:moved`, the place's range `arrives` and `:arrived`, and the visitor reads
 * the place they came in to, derived once the queue is empty.
 *
 * An arrival is a write turn, so a fault abandons all of it; a visitor the place refuses, or a world that
 * admits no one, writes nothing either, and each is told in words. Catch-up is not this turn's: the host
 * runs the maintenance turn first.
 */
#include <string.h>

#include "../expr/expr.h"
#include "../nickname.h"
#include "../turn.h"

bool turn_is_place(const sprout_frame *frame, sprout_str id) {
  const sprout_stored_instance *instance;
  if (sprout_str_same(id, frame->draft->base->world) || !expr_live(frame, id)) return false;
  instance = expr_instance(frame, id);
  return instance != NULL && instance->kind->contains_actors;
}

bool turn_stands_in_place(const sprout_frame *frame, sprout_str actor) {
  const sprout_stored_instance *instance = expr_instance(frame, actor);
  return instance != NULL && instance->has_container && turn_is_place(frame, instance->container);
}

const char *turn_closed_reason(const sprout_frame *frame) {
  const sprout_world *world = frame->world;
  if (world->world_kind == NULL) return "no-world";
  if (world->visitor_kind == NULL) return "no-visitor-kind";
  if (world->arrival == NULL) return "no-arrival-place";
  return turn_is_place(frame, expr_str(world->arrival)) ? NULL : "arrival-place-gone";
}

static sprout_eval_status refusal_to(const sprout_frame *frame, sprout_str visitor, sprout_str by,
                                     const sprout_speech *said, const sprout_effect_binding *bindings, size_t count,
                                     sprout_effect *out) {
  sprout_str *to = (sprout_str *)sprout_arena_take(frame->turn, sizeof *to);
  if (to == NULL) return SPROUT_EVAL_NO_MEMORY;
  *to = visitor;
  memset(out, 0, sizeof *out);
  out->kind = SPROUT_EFFECT_REFUSED;
  out->to = to;
  out->to_count = 1;
  out->by = by;
  out->said = *said;
  out->bindings = bindings;
  out->binding_count = count;
  return SPROUT_EVAL_OK;
}

/* The host's bound on a crowd: whether `place` holds as many other people as it allows. */
static sprout_eval_status turned_away(const sprout_frame *frame, sprout_str visitor, sprout_str place, bool *away) {
  sprout_limit limit = frame->world->host.budgets.people_per_place;
  const sprout_str *held;
  size_t count, i, standing = 0;
  *away = false;
  if (!limit.set) return SPROUT_EVAL_OK;
  if (sprout_draft_children(frame->draft, place, &held, &count) != SPROUT_DRAFT_OK) return SPROUT_EVAL_NO_MEMORY;
  for (i = 0; i < count; i++)
    if (!sprout_str_same(held[i], visitor) && sprout_is_person(frame, held[i])) standing++;
  *away = standing >= limit.value;
  return SPROUT_EVAL_OK;
}

static sprout_eval_status send_to(sprout_exec *x, sprout_message_kind message, sprout_str recipient, sprout_str item,
                                  bool has_from, sprout_str from, sprout_str to) {
  sprout_send send;
  memset(&send, 0, sizeof send);
  send.message = message;
  send.recipient = recipient;
  send.item = item;
  send.has_from = has_from;
  send.from = from;
  send.to = to;
  return sprout_exec_queue(x, &send);
}

sprout_eval_status turn_enter(turn_run *run, sprout_str visitor, sprout_str place, turn_entry *out) {
  sprout_exec *x = &run->x;
  sprout_frame frame = sprout_exec_frame(x, visitor, NULL, NULL);
  sprout_str world = run->draft.base->world, parameters[2];
  const sprout_stored_instance *destination = sprout_draft_instance(&run->draft, place);
  const sprout_node *guards;
  sprout_owed *owed;
  bool away;
  size_t i;
  memset(out, 0, sizeof *out);
  EXPR_NEED(turned_away(&frame, visitor, place, &away));
  if (away) {
    sprout_effect_binding *bound;
    sprout_speech said;
    sprout_str by;
    /* Not yet anywhere, so the line is about the visitor, and then the world's. */
    sprout_engine_said(&frame, "crowded", &visitor, NULL, &by, &said);
    bound = (sprout_effect_binding *)sprout_arena_take(x->turn, 2 * sizeof *bound);
    if (bound == NULL) return SPROUT_EVAL_NO_MEMORY;
    bound[0].name = "item";
    bound[0].bound = sprout_evaluated_object(visitor);
    bound[1].name = "to";
    bound[1].bound = sprout_evaluated_object(place);
    out->refused = true;
    return refusal_to(&frame, visitor, by, &said, bound, 2, &out->refusal);
  }
  guards = destination == NULL ? NULL : sprout_node_get(sprout_node_get(destination->kind->node, "guards"), "accept");
  parameters[0] = visitor;
  parameters[1] = world;
  for (i = 0; guards != NULL && i < guards->count; i++) {
    sprout_move_refusal refusal;
    bool allowed = true;
    EXPR_NEED(sprout_guard_run(x, guards->items[i], place, visitor, parameters, 2, &allowed, &refusal));
    if (allowed) continue;
    out->refused = true;
    return refusal_to(&frame, visitor, refusal.by, &refusal.said, refusal.bindings, refusal.binding_count,
                      &out->refusal);
  }
  if (sprout_draft_place(&run->draft, visitor, &place) != SPROUT_DRAFT_OK) return SPROUT_EVAL_NO_MEMORY;
  EXPR_NEED(send_to(x, SPROUT_MSG_ENTERED, place, visitor, true, world, place));
  {
    sprout_send moved;
    memset(&moved, 0, sizeof moved);
    moved.message = SPROUT_MSG_MOVED;
    moved.recipient = visitor;
    moved.has_from = true;
    moved.from = world;
    moved.to = place;
    EXPR_NEED(sprout_exec_queue(x, &moved));
  }
  EXPR_NEED(sprout_move_spoken(x, &frame, false, place, visitor, world, NULL));
  owed = (sprout_owed *)sprout_exec_grow(x->turn, (void **)&x->owed, &x->owed_count, &x->owed_capacity, sizeof *x->owed);
  if (owed == NULL) return SPROUT_EVAL_NO_MEMORY;
  owed->mover = visitor;
  owed->place = place;
  owed->after = x->effect_count;
  out->place = place;
  return SPROUT_EVAL_OK;
}

sprout_eval_status turn_told(const sprout_frame *frame, const char *name, sprout_str visitor, sprout_effect *out) {
  const sprout_stored_instance *standing = expr_instance(frame, visitor);
  sprout_str place = {NULL, 0}, *to;
  bool there = standing != NULL && standing->has_container && expr_instance(frame, standing->container) != NULL;
  memset(out, 0, sizeof *out);
  if (there) place = standing->container;
  to = (sprout_str *)sprout_arena_take(frame->turn, sizeof *to);
  if (to == NULL) return SPROUT_EVAL_NO_MEMORY;
  *to = visitor;
  out->kind = SPROUT_EFFECT_NOTICE;
  out->to = to;
  out->to_count = 1;
  sprout_engine_said(frame, name, &visitor, there ? &place : NULL, &out->by, &out->said);
  return SPROUT_EVAL_OK;
}

/* A visitor's record with the fields a turn changes replaced. */
static sprout_stored_visitor visitor_record(sprout_str visit, sprout_str nickname, sprout_str instance,
                                            const sprout_stored_visitor *before) {
  sprout_stored_visitor record;
  memset(&record, 0, sizeof record);
  if (before != NULL) record = *before;
  record.visit = visit;
  record.nickname = nickname;
  record.instance = instance;
  return record;
}

static sprout_eval_status drafted(sprout_draft_result result) {
  return result == SPROUT_DRAFT_OK ? SPROUT_EVAL_OK : SPROUT_EVAL_NO_MEMORY;
}

/* A visitor new to the world: an instance of the visitor kind, given what its kind holds. */
static sprout_eval_status made_visitor(turn_run *run, sprout_str *id) {
  sprout_stored_instance record;
  sprout_spawned given;
  sprout_frame frame;
  EXPR_NEED(drafted(sprout_draft_mint(&run->draft, id)));
  if (sprout_stored_instance_defaults(&run->scratch, run->world->visitor_kind, &record) != SPROUT_OK)
    return SPROUT_EVAL_NO_MEMORY;
  record.id = *id;
  record.made = SPROUT_MADE_VISITOR;
  EXPR_NEED(drafted(sprout_draft_add(&run->draft, &record)));
  frame = sprout_exec_frame(&run->x, *id, NULL, NULL);
  return sprout_give_contents(&frame, *id, &given);
}

/* What admitting a visitor made: who, whether they had been, and where they came in or what refused them. */
typedef struct arrived {
  sprout_str instance;
  bool returning;
  turn_entry entry;
} arrived;

/*
 * The body of an arrival: the visitor made or found, their record kept, the entry (a last place that
 * refuses is passed over for the arrival place, as one gone is), the queue drained, and the lines the engine
 * tells before the place's own: the world's `missing` and `displaced`.
 */
static sprout_eval_status admit(turn_run *run, sprout_str visit, sprout_str nickname,
                                const sprout_stored_visitor *record, arrived *out, sprout_effect *lines,
                                size_t *line_count, const sprout_arrived **arrivals, size_t *arrival_count) {
  sprout_exec *x = &run->x;
  sprout_str id;
  sprout_frame frame;
  sprout_stored_visitor put;
  bool gone, entered = false;
  turn_entry entry;
  memset(&entry, 0, sizeof entry);
  memset(out, 0, sizeof *out);
  *line_count = 0;
  if (record == NULL) EXPR_NEED(made_visitor(run, &id));
  else id = record->instance;
  out->returning = record != NULL;
  out->instance = id;
  put = visitor_record(visit, nickname, id, record);
  EXPR_NEED(drafted(sprout_draft_put_visitor(&run->draft, &put)));
  frame = sprout_exec_frame(x, id, NULL, NULL);
  gone = put.has_last_place && !turn_is_place(&frame, put.last_place);
  if (put.has_last_place && !gone) {
    EXPR_NEED(turn_enter(run, id, put.last_place, &entry));
    entered = !entry.refused;
  }
  if (!entered) EXPR_NEED(turn_enter(run, id, expr_str(run->world->arrival), &entry));
  out->entry = entry;
  if (entry.refused) return SPROUT_EVAL_OK;
  put.has_last_place = true;
  put.last_place = entry.place;
  EXPR_NEED(drafted(sprout_draft_put_visitor(&run->draft, &put)));
  EXPR_NEED(sprout_exec_drain(x));
  EXPR_NEED(sprout_arrivals_read(x, &frame, arrivals, arrival_count));
  if (run->world->extension_count > 0) EXPR_NEED(turn_told(&frame, "missing", id, &lines[(*line_count)++]));
  if (gone) EXPR_NEED(turn_told(&frame, "displaced", id, &lines[(*line_count)++]));
  return SPROUT_EVAL_OK;
}

/* Checks the nickname the host admitted and the visit's standing; the nickname as kept is copied into the state's arena. */
static sprout_status validate(sprout_world *world, sprout_state *state, const sprout_host *host,
                              const sprout_turn_input *input, sprout_outcome *outcome, sprout_str *kept) {
  sprout_arena scratch;
  nickname_check checked;
  const sprout_stored_visitor *record;
  sprout_str visit, nickname;
  sprout_status status;
  if (input->visit == NULL || input->nickname == NULL)
    return turn_refuse(outcome, "an arrival names a visit and a nickname.", "", "");
  visit.bytes = input->visit;
  visit.length = strlen(input->visit);
  nickname.bytes = input->nickname;
  nickname.length = input->nickname_length;
  status = sprout_arena_init(&scratch, host);
  if (status != SPROUT_OK) return status;
  status = nickname_check_for(&scratch, world, state, &host->budgets, visit, nickname, &checked);
  if (status == SPROUT_OK && checked.reason != SPROUT_NICKNAME_OK) {
    size_t used, n = checked.words.length;
    turn_refuse(outcome, "`", input->visit, "` arrives with a nickname the host did not admit: ");
    used = strlen(outcome->fault.text);
    if (n > sizeof outcome->fault.text - 1 - used) n = sizeof outcome->fault.text - 1 - used;
    memcpy(outcome->fault.text + used, checked.words.bytes, n);
    outcome->fault.text[used + n] = '\0';
    status = SPROUT_BAD_INPUT;
  }
  if (status == SPROUT_OK) {
    *kept = checked.kept;
    record = turn_visitor(state, input->visit);
    if (record != NULL) {
      const sprout_stored_instance *instance = sprout_state_find(state, record->instance);
      if (instance == NULL && world->world_kind != NULL && world->visitor_kind != NULL && world->arrival != NULL)
        status = turn_refuse(outcome, "`", input->visit, "`'s instance is not in this world.");
      else if (instance != NULL && instance->has_container)
        status = turn_refuse(outcome, "`", input->visit, "` is already in this world.");
    }
  }
  /* The nickname as kept lives in the scratch only until the outcome's arena can take it. */
  if (status == SPROUT_OK) {
    sprout_str copy;
    status = turn_outcome_begin(host, outcome);
    if (status == SPROUT_OK) {
      if (sprout_state_copy_str(turn_keep(outcome), *kept, &copy)) *kept = copy;
      else status = turn_abort(outcome, SPROUT_NO_MEMORY);
    }
  }
  sprout_arena_reset(&scratch);
  return status;
}

sprout_status turn_arrival(sprout_world *world, sprout_state *state, const sprout_host *host,
                           const sprout_turn_input *input, sprout_outcome *outcome) {
  sprout_str visit, kept, actor;
  turn_run run;
  sprout_frame frame;
  sprout_status status;
  sprout_eval_status eval;
  arrived result;
  sprout_effect lines[2];
  size_t line_count = 0, arrival_count = 0;
  const sprout_arrived *arrivals = NULL;
  sprout_turn_result ended = SPROUT_RESULT_DONE;
  status = validate(world, state, host, input, outcome, &kept);
  if (status != SPROUT_OK) return status;
  visit.bytes = input->visit;
  visit.length = strlen(input->visit);
  status = turn_open(&run, world, state, host, SPROUT_TURN_ARRIVAL, host->seed(host->ctx), input->instant, NULL, NULL);
  if (status != SPROUT_OK) return turn_abort(outcome, status);
  frame = sprout_exec_frame(&run.x, visit, NULL, NULL);
  if (turn_closed_reason(&frame) != NULL) {
    turn_drop(&run);
    outcome->result = SPROUT_RESULT_CLOSED;
    outcome->words = TURN_NOT_ADMITTING;
    return SPROUT_OK;
  }
  eval = admit(&run, visit, kept, turn_visitor(state, input->visit), &result, lines, &line_count, &arrivals,
               &arrival_count);
  actor = result.instance;
  if (eval == SPROUT_EVAL_OK && result.entry.refused) {
    /* The place only decided: its words are rendered against the world as the refusal found the visitor, and nothing is written. */
    run.x.effects = &result.entry.refusal;
    run.x.effect_count = 1;
    run.x.effect_capacity = 1;
    eval = turn_render(&run, &actor, outcome);
    ended = SPROUT_RESULT_REFUSED;
  } else if (eval == SPROUT_EVAL_OK) {
    eval = sprout_lines_assembled(&run.x, lines, line_count, arrivals, arrival_count, NULL, 0);
    if (eval == SPROUT_EVAL_OK) eval = turn_render(&run, &actor, outcome);
    if (eval == SPROUT_EVAL_OK) {
      status = turn_commit(&run);
      if (status != SPROUT_OK) return turn_abort(outcome, status);
      outcome->committed = outcome->state_changed = true;
    }
  }
  if (eval == SPROUT_EVAL_NO_MEMORY) {
    turn_drop(&run);
    return turn_abort(outcome, SPROUT_NO_MEMORY);
  }
  if (eval != SPROUT_EVAL_OK) {
    /* A fault abandons the arrival: the visitor is not admitted, and nobody is told in the world. */
    turn_fault_of(&run, eval, outcome);
    outcome->line_count = outcome->effect_count = outcome->cut_count = 0;
    outcome->lines = NULL;
    outcome->effects = NULL;
    outcome->cuts = NULL;
    outcome->words = TURN_ENTRY_FAILED;
    ended = SPROUT_RESULT_FAULTED;
  }
  turn_drop(&run);
  status = turn_log(&run, outcome, visit.bytes, visit.length);
  if (status != SPROUT_OK) return turn_abort(outcome, status);
  outcome->log.nickname = kept;
  outcome->result = ended;
  return SPROUT_OK;
}
