/*
 * The frame every write turn runs in (see turn.h) and the entry point that picks a kind (the spec's The
 * runtime > Turns; Limits > Runtime budgets). A turn that faults is dropped by resetting its scratch, which
 * is all the draft is, so the state it was opened on is exactly as it was.
 */
#include "turn.h"

#include <string.h>

#include "seeds.h"

static turn_held *held_of(const sprout_outcome *outcome) { return (turn_held *)outcome->held; }

sprout_arena *turn_keep(sprout_outcome *outcome) { return &held_of(outcome)->arena; }

sprout_status turn_outcome_begin(const sprout_host *host, sprout_outcome *outcome) {
  sprout_arena boot;
  turn_held *keep;
  sprout_status status;
  memset(outcome, 0, sizeof *outcome);
  status = sprout_arena_init(&boot, host);
  if (status != SPROUT_OK) return status;
  keep = (turn_held *)sprout_arena_take(&boot, sizeof *keep);
  if (keep == NULL) {
    sprout_arena_reset(&boot);
    return SPROUT_NO_MEMORY;
  }
  keep->host = *host;
  keep->anchor = boot;
  keep->anchor.host = &keep->host;
  sprout_arena_init(&keep->arena, &keep->host);
  outcome->held = keep;
  return SPROUT_OK;
}

void sprout_outcome_free(sprout_outcome *outcome) {
  turn_held *keep;
  sprout_arena anchor, data;
  sprout_host host;
  if (outcome == NULL || outcome->held == NULL) return;
  keep = held_of(outcome);
  host = keep->host;
  anchor = keep->anchor;
  data = keep->arena;
  anchor.host = &host;
  data.host = &host;
  sprout_arena_reset(&data);
  sprout_arena_reset(&anchor);
  memset(outcome, 0, sizeof *outcome);
}

sprout_status turn_open(turn_run *run, sprout_world *world, sprout_state *state, const sprout_host *host,
                        sprout_turn_kind kind, uint64_t seed, uint64_t instant, sprout_meter *shared_meter,
                        sprout_draws *shared_draws) {
  sprout_status status;
  memset(run, 0, sizeof *run);
  run->world = world;
  run->state = state;
  run->host = host;
  run->kind = kind;
  run->seed = seed;
  run->instant = instant;
  status = sprout_arena_init(&run->scratch, host);
  if (status != SPROUT_OK) return status;
  if (sprout_draft_open(&run->draft, &run->scratch, world, state) != SPROUT_DRAFT_OK) {
    sprout_arena_reset(&run->scratch);
    return SPROUT_NO_MEMORY;
  }
  if (shared_meter != NULL) {
    run->meter = shared_meter;
  } else {
    sprout_meter_begin(&run->own_meter, host, kind);
    run->meter = &run->own_meter;
  }
  if (shared_draws != NULL) {
    run->draws = shared_draws;
  } else {
    status = sprout_draws_begin(&run->own_draws, seed);
    if (status != SPROUT_OK) {
      sprout_arena_reset(&run->scratch);
      return status;
    }
    run->draws = &run->own_draws;
  }
  sprout_exec_begin(&run->x, world, &run->draft, &run->scratch, run->meter, run->draws, &run->fault, instant);
  return SPROUT_OK;
}

void turn_drop(turn_run *run) { sprout_arena_reset(&run->scratch); }

static void put_text(char *to, size_t size, const char *from) {
  size_t n = strlen(from);
  if (n > size - 1) n = size - 1;
  memcpy(to, from, n);
  to[n] = '\0';
}

void turn_fault_of(const turn_run *run, sprout_eval_status status, sprout_outcome *outcome) {
  (void)status;
  outcome->faulted = true;
  outcome->result = SPROUT_RESULT_FAULTED;
  memset(&outcome->fault, 0, sizeof outcome->fault);
  if (run->meter->faulted) {
    outcome->fault = run->meter->fault;
    outcome->fault_name = "BudgetExhausted";
    return;
  }
  outcome->fault.budget = run->fault.name == NULL ? "Error" : run->fault.name;
  outcome->fault.message = run->meter->message;
  put_text(outcome->fault.text, sizeof outcome->fault.text, run->fault.text);
  outcome->fault_name = outcome->fault.budget;
}

sprout_status turn_refuse(sprout_outcome *outcome, const char *before, const char *name, const char *after) {
  size_t room = sizeof outcome->fault.text, used = 0, i;
  const char *parts[3];
  parts[0] = before;
  parts[1] = name;
  parts[2] = after;
  for (i = 0; i < 3; i++) {
    size_t n = strlen(parts[i]);
    if (n > room - used - 1) n = room - used - 1;
    memcpy(outcome->fault.text + used, parts[i], n);
    used += n;
  }
  outcome->fault.text[used] = '\0';
  return SPROUT_BAD_INPUT;
}

static bool keep_str(sprout_arena *keep, sprout_str from, sprout_str *to) {
  char *copy = sprout_arena_copy(keep, from.bytes == NULL ? "" : from.bytes, from.length);
  if (copy == NULL) return false;
  to->bytes = copy;
  to->length = from.length;
  return true;
}

static sprout_line_kind line_kind_of(sprout_effect_kind kind) {
  switch (kind) {
    case SPROUT_EFFECT_SAID:
      return SPROUT_LINE_SAID;
    case SPROUT_EFFECT_TOLD:
      return SPROUT_LINE_TOLD;
    case SPROUT_EFFECT_REFUSED:
      return SPROUT_LINE_REFUSED;
    case SPROUT_EFFECT_NOTICE:
      return SPROUT_LINE_NOTICE;
    case SPROUT_EFFECT_EXTENSION:
      return SPROUT_LINE_EXTENSION;
    case SPROUT_EFFECT_DESCRIBED:
      break;
  }
  return SPROUT_LINE_DESCRIBED;
}

sprout_eval_status turn_handed(sprout_arena *keep, const sprout_draft *draft, const sprout_rendered *shown,
                             sprout_outcome *outcome) {
  const sprout_rendered rendered = *shown;
  sprout_line *lines;
  sprout_told_effect *effects;
  sprout_cut *cuts;
  size_t total = 0, at = 0, i, j;
  for (i = 0; i < rendered.told_count; i++) total += rendered.told[i].paragraph_count;
  lines = (sprout_line *)sprout_arena_take(keep, (total + 1) * sizeof *lines);
  effects = (sprout_told_effect *)sprout_arena_take(keep, (rendered.told_count + 1) * sizeof *effects);
  cuts = (sprout_cut *)sprout_arena_take(keep, (rendered.cut_count + 1) * sizeof *cuts);
  if (lines == NULL || effects == NULL || cuts == NULL) return SPROUT_EVAL_NO_MEMORY;
  for (i = 0; i < rendered.told_count; i++) {
    const sprout_told *told = &rendered.told[i];
    sprout_told_effect *effect = &effects[i];
    effect->kind = line_kind_of(told->kind);
    effect->has_actor = rendered.has_actor;
    if (!keep_str(keep, told->from, &effect->from) || !keep_str(keep, told->to, &effect->to) ||
        !keep_str(keep, told->visit, &effect->visit) || (rendered.has_actor && !keep_str(keep, rendered.actor, &effect->actor)))
      return SPROUT_EVAL_NO_MEMORY;
    effect->line_first = at;
    effect->line_count = told->paragraph_count;
    for (j = 0; j < told->paragraph_count; j++, at++) {
      sprout_str text;
      lines[at].recipient = effect->visit.bytes;
      lines[at].recipient_length = effect->visit.length;
      if (!keep_str(keep, told->paragraphs[j], &text)) return SPROUT_EVAL_NO_MEMORY;
      lines[at].text = text.bytes;
      lines[at].text_length = text.length;
      lines[at].kind = effect->kind;
      lines[at].effect = i;
    }
    effect->written_count = told->written_count;
    if (told->written_count > 0) {
      sprout_written *written = (sprout_written *)sprout_arena_take(keep, told->written_count * sizeof *written);
      if (written == NULL) return SPROUT_EVAL_NO_MEMORY;
      for (j = 0; j < told->written_count; j++) {
        const sprout_noted *noted = &told->written[j];
        written[j].passage = noted->passage;
        written[j].name = noted->name == NULL ? NULL : sprout_arena_copy(keep, noted->name, strlen(noted->name));
        written[j].origin = noted->origin == NULL ? NULL : sprout_arena_copy(keep, noted->origin, strlen(noted->origin));
        written[j].at = sprout_arena_copy(keep, noted->at, strlen(noted->at));
        if ((noted->name != NULL && written[j].name == NULL) || (noted->origin != NULL && written[j].origin == NULL) ||
            written[j].at == NULL)
          return SPROUT_EVAL_NO_MEMORY;
      }
      effect->written = written;
    }
  }
  for (i = 0; i < rendered.cut_count; i++) {
    const sprout_stored_visitor *visitor = sprout_visitor_of(draft, rendered.cut[i]);
    sprout_str visit;
    if (visitor == NULL || !keep_str(keep, visitor->visit, &visit)) return SPROUT_EVAL_NO_MEMORY;
    cuts[i].recipient = visit.bytes;
    cuts[i].recipient_length = visit.length;
  }
  outcome->line_count = total;
  outcome->lines = lines;
  outcome->effect_count = rendered.told_count;
  outcome->effects = effects;
  outcome->cut_count = rendered.cut_count;
  outcome->cuts = cuts;
  return SPROUT_EVAL_OK;
}

sprout_eval_status turn_render(turn_run *run, const sprout_str *actor, sprout_outcome *outcome) {
  sprout_rendered rendered;
  sprout_eval_status status = sprout_render_effects(&run->x, actor, &rendered);
  if (status != SPROUT_EVAL_OK) return status;
  return turn_handed(turn_keep(outcome), &run->draft, &rendered, outcome);
}

sprout_status turn_commit(turn_run *run) {
  sprout_changes changes;
  sprout_draft_result result = sprout_draft_commit(&run->draft, &changes);
  return result == SPROUT_DRAFT_OK ? SPROUT_OK : SPROUT_NO_MEMORY;
}

sprout_status turn_log(turn_run *run, sprout_outcome *outcome, const char *who, size_t who_length) {
  sprout_arena *keep = turn_keep(outcome);
  sprout_log_entry *entry = &outcome->log;
  memset(entry, 0, sizeof *entry);
  entry->kind = run->kind;
  entry->serial = run->state->serial;
  entry->seed = run->seed;
  entry->seconds = run->instant;
  if (who != NULL) {
    sprout_str copy;
    sprout_str from;
    from.bytes = who;
    from.length = who_length;
    if (!keep_str(keep, from, &copy)) return SPROUT_NO_MEMORY;
    entry->who = copy;
  }
  if (outcome->faulted) {
    sprout_str detail, text;
    text.bytes = outcome->fault.text;
    text.length = strlen(outcome->fault.text);
    if (!keep_str(keep, text, &detail)) return SPROUT_NO_MEMORY;
    entry->faulted = true;
    entry->fault_name = outcome->fault_name;
    entry->fault_detail = detail;
  }
  outcome->has_log = true;
  return SPROUT_OK;
}

sprout_status turn_abort(sprout_outcome *outcome, sprout_status status) {
  char text[sizeof outcome->fault.text];
  memcpy(text, outcome->fault.text, sizeof text);
  sprout_outcome_free(outcome);
  memcpy(outcome->fault.text, text, sizeof text);
  return status;
}

const sprout_stored_visitor *turn_visitor(const sprout_state *state, const char *visit) {
  sprout_str key;
  key.bytes = visit;
  key.length = strlen(visit);
  return sprout_state_find_visitor(state, key);
}

sprout_str sprout_path_of(const sprout_world *world, sprout_str id) {
  const char *name = world->header.name;
  size_t n = strlen(name), i;
  /* A declared object is the world's id, a period, and its path; a minted one has a `#`. */
  if (id.length <= n + 1 || memcmp(id.bytes, name, n) != 0 || id.bytes[n] != '.') return id;
  for (i = 0; i < id.length; i++)
    if (id.bytes[i] == '#') return id;
  id.bytes += n + 1;
  id.length -= n + 1;
  return id;
}

uint64_t turn_seed_under(const sprout_world *world, uint64_t seed, sprout_str id, uint64_t nth) {
  sprout_str path = sprout_path_of(world, id);
  return sprout_turn_seed(seed, path.bytes, path.length, nth);
}

sprout_status sprout_run_turn(sprout_world *world, sprout_state *state, const sprout_host *host,
                              const sprout_turn_input *input, sprout_outcome *outcome) {
  if (outcome == NULL) return SPROUT_BAD_HOST;
  memset(outcome, 0, sizeof *outcome);
  if (world == NULL || state == NULL || input == NULL) return SPROUT_BAD_INPUT;
  if (host == NULL || host->alloc == NULL || host->release == NULL || host->page_bytes == 0 || host->seed == NULL)
    return SPROUT_BAD_HOST;
  /* The budgets the host holds now are the ones the turn is charged to, wherever the runtime reads them. */
  world->host.budgets = host->budgets;
  switch (input->kind) {
    case SPROUT_TURN_COMMAND:
      return turn_command(world, state, host, input, outcome);
    case SPROUT_TURN_ARRIVAL:
      return turn_arrival(world, state, host, input, outcome);
    case SPROUT_TURN_DEPARTURE:
      return turn_departure(world, state, host, input, outcome);
    case SPROUT_TURN_TICK:
      return turn_tick(world, state, host, input, outcome);
    case SPROUT_TURN_WAKE:
      return turn_wake(world, state, host, input, outcome);
    case SPROUT_TURN_MAINTENANCE:
      return turn_maintenance(world, state, host, input, outcome);
    case SPROUT_TURN_POLL:
      break;
  }
  return turn_refuse(outcome, "a poll writes nothing and is not a turn: ask for the view with sprout_view.", "", "");
}
