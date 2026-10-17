/*
 * The write turns this host runs (the spec's The runtime > Turns; The host contract > Admission
 * and identity, Time): arrival, preceded by the catch-up that tells nothing, a command from a
 * reading the sentence builder made, the ticks and due wakes the reader asks for, and departure.
 * Every turn but a later step of one input's line waits for what is owed to be written, runs at
 * the host's seconds under a seed drawn from the clock when it begins, is written to the log tail
 * with that seed, and marks the state to be saved, and the view kept stale, when it committed or
 * changed the state.
 */
#include <string.h>

#include "seeds.h"
#include "session_internal.h"

#define WAKES_PER_TICK 64
#define WOKEN_KEPT 16

/* ---- running a turn ---- */

/*
 * Runs one turn under a seed drawn now; a tick or a wake, for `thing` its `nth` this call, takes its own from
 * that seed and the thing's path, as every host makes one (seeds.h), so adding a clock leaves every other
 * object's draws as they were. `settle` false leaves what earlier steps of the same line owe unwritten.
 */
static sprout_status run_for(player_session *session, sprout_turn_input *input, const char *thing, uint64_t nth,
                             bool settle, sprout_outcome *outcome) {
  sprout_status status;
  /* What is owed is written out first, and always a save under way: the state must not change under the writer. */
  if (settle || session->writer.live) session_save_finish(session);
  input->instant = player_host_seconds(&session->host);
  player_host_begin_step(&session->host);
  if (thing != NULL) {
    sprout_str path = sprout_path_of(session->world, (sprout_str){thing, strlen(thing)});
    session->host.step_seed = sprout_turn_seed(session->host.step_seed, path.bytes, path.length, nth);
  }
  memset(outcome, 0, sizeof *outcome);
  status = sprout_run_turn(session->world, session->state, &session->host.record, input, outcome);
  if (status != SPROUT_OK) return status;
  savelog_turn(session, input, outcome);
  if (outcome->committed || outcome->state_changed) {
    session->dirty = true;
    session->seen_stale = true;
  }
  return status;
}

sprout_status turns_run(player_session *session, sprout_turn_input *input, sprout_outcome *outcome) {
  return run_for(session, input, NULL, 0, true, outcome);
}

/* Ends a call's answer: whether the state changed under it, read before `save` takes what it owes, and whether that could be. */
static void owe(player_session *session, player_told *answer, bool (*save)(player_session *)) {
  answer->changed = session->dirty;
  answer->saved = save(session);
}

bool turns_depart(player_session *session, sprout_outcome *outcome) {
  sprout_turn_input input;
  const sprout_stored_visitor *visitor = session_visitor(session);
  if (visitor == NULL || !session_visitor_present(session, visitor)) return false;
  memset(&input, 0, sizeof input);
  input.kind = SPROUT_TURN_DEPARTURE;
  input.visit = PLAYER_VISIT;
  if (turns_run(session, &input, outcome) != SPROUT_OK) {
    sprout_outcome_free(outcome);
    return false;
  }
  return true;
}

/* Nothing could be run, and the words say why. */
static player_told cannot(const char *words) {
  player_told answer;
  memset(&answer, 0, sizeof answer);
  answer.result = SPROUT_RESULT_REFUSED;
  answer.words = words;
  return answer;
}

/* Whether the visitor stands in the world, which a command and a tick need. */
static bool in_world(const player_session *session) {
  const sprout_stored_visitor *visitor = session_visitor(session);
  return session->state != NULL && visitor != NULL && session_visitor_present(session, visitor);
}

/* ---- arrival ---- */

player_told player_admit(player_session *session, const char *nickname) {
  player_told answer;
  sprout_arena *arena = session_answer(session);
  sprout_admission admission;
  sprout_outcome outcome;
  sprout_turn_input input;
  sprout_status status;
  if (session->state == NULL) return cannot("No world is open.");
  status = sprout_admit(session->world, session->state, &session->host.record, PLAYER_VISIT, nickname,
                        strlen(nickname), &admission);
  if (status != SPROUT_OK) return cannot(sprout_status_text(status));
  memset(&answer, 0, sizeof answer);
  answer.ok = true;
  answer.result = SPROUT_RESULT_REFUSED;
  answer.words = "";
  if (admission.reason != SPROUT_NICKNAME_OK) {
    answer.words = session_keep(session, admission.words.bytes);
  } else {
    /* Catch-up first, so nobody walks into a place about to rearrange itself; it tells nothing. */
    memset(&input, 0, sizeof input);
    input.kind = SPROUT_TURN_MAINTENANCE;
    turns_run(session, &input, &outcome);
    sprout_outcome_free(&outcome);
    memset(&input, 0, sizeof input);
    input.kind = SPROUT_TURN_ARRIVAL;
    input.visit = PLAYER_VISIT;
    input.nickname = admission.kept.bytes;
    input.nickname_length = admission.kept.length;
    status = turns_run(session, &input, &outcome);
    if (status != SPROUT_OK) {
      answer.words = session_keep(session, outcome.fault.text);
    } else {
      answer.admitted = outcome.result == SPROUT_RESULT_DONE;
      answer.result = outcome.result;
      if (outcome.words != NULL) answer.words = session_keep(session, outcome.words);
      told_collect(arena, &answer.lines, &outcome, PLAYER_VISIT);
    }
    sprout_outcome_free(&outcome);
  }
  owe(session, &answer, session_save_soon);
  sprout_admission_free(&admission);
  return answer;
}

/* ---- a command ---- */

player_told player_turn(player_session *session, const sprout_reading *reading, const char *text, bool continues) {
  player_told answer;
  sprout_arena *arena = session_answer(session);
  sprout_outcome outcome;
  sprout_turn_input input;
  sprout_reading read;
  sprout_status status;
  const sprout_stored_visitor *visitor = session_visitor(session);
  if (!in_world(session)) return cannot("You are not in a world.");
  memset(&answer, 0, sizeof answer);
  answer.ok = true;
  answer.result = SPROUT_RESULT_REFUSED;
  /* The actor's id is copied: a committed turn replaces the memory the state's records live in. */
  read = *reading;
  read.actor = sprout_arena_copy(arena, visitor->instance.bytes, visitor->instance.length);
  if (read.actor == NULL) return player_misread(session, "The player ran out of memory reading that.");
  memset(&input, 0, sizeof input);
  input.kind = SPROUT_TURN_COMMAND;
  input.visit = PLAYER_VISIT;
  input.reading = &read;
  input.text = text;
  input.text_length = text == NULL ? 0 : strlen(text);
  status = run_for(session, &input, NULL, 0, !continues, &outcome);
  if (status != SPROUT_OK) {
    /* A reading the world cannot take: said in words, and nothing was written. */
    answer.words = session_keep(session, status == SPROUT_BAD_INPUT ? outcome.fault.text : sprout_status_text(status));
    told_add(arena, &answer.lines, PLAYER_VISIT, "notice", answer.words);
  } else {
    answer.committed = outcome.committed;
    answer.goes_on = outcome.goes_on;
    answer.result = outcome.result;
    told_collect(arena, &answer.lines, &outcome, PLAYER_VISIT);
  }
  sprout_outcome_free(&outcome);
  owe(session, &answer, session_save_soon);
  return answer;
}

player_told player_misread(player_session *session, const char *why) {
  player_told answer;
  sprout_arena *arena = session_answer(session);
  if (!in_world(session)) return cannot("You are not in a world.");
  memset(&answer, 0, sizeof answer);
  answer.ok = true;
  answer.result = SPROUT_RESULT_REFUSED;
  answer.words = session_keep(session, why);
  told_add(arena, &answer.lines, PLAYER_VISIT, "notice", answer.words);
  owe(session, &answer, session_save_soon);
  return answer;
}

/* ---- time passing ---- */

/* How many times each object has woken in this call: its seed is made from the count. */
typedef struct woken {
  const char *object;
  uint64_t count;
} woken;

static uint64_t woken_count(sprout_arena *arena, woken *table, size_t *kept, const char *object) {
  size_t i;
  for (i = 0; i < *kept; i++)
    if (strcmp(table[i].object, object) == 0) return table[i].count++;
  if (*kept < WOKEN_KEPT) {
    table[*kept].object = sprout_arena_copy(arena, object, strlen(object));
    table[*kept].count = 1;
    if (table[*kept].object != NULL) (*kept)++;
  }
  return 0;
}

/* Delivers the wakes that have fallen due, oldest first; returns whether any turn ran. */
static bool wake_due(player_session *session, sprout_arena *arena, told_list *lines, uint64_t now) {
  woken table[WOKEN_KEPT];
  size_t kept = 0, rounds;
  bool ran = false;
  for (rounds = 0; rounds < WAKES_PER_TICK; rounds++) {
    sprout_wakes due;
    sprout_turn_input input;
    sprout_outcome outcome;
    char *object;
    if (sprout_wakes_due(session->world, session->state, &session->host.record, now, &due) != SPROUT_OK) break;
    if (due.count == 0) {
      sprout_wakes_free(&due);
      break;
    }
    object = sprout_arena_copy(arena, due.wakes[0].object.bytes, due.wakes[0].object.length);
    memset(&input, 0, sizeof input);
    input.kind = SPROUT_TURN_WAKE;
    input.object = object;
    input.serial = due.wakes[0].serial;
    sprout_wakes_free(&due);
    if (object == NULL) break;
    if (run_for(session, &input, object, woken_count(arena, table, &kept, object), true, &outcome) == SPROUT_OK) {
      ran = ran || outcome.result != SPROUT_RESULT_IDLE;
      told_collect(arena, lines, &outcome, PLAYER_VISIT);
    }
    sprout_outcome_free(&outcome);
  }
  return ran;
}

/* Ticks each place that holds a visitor. */
static bool tick_places(player_session *session, sprout_arena *arena, told_list *lines) {
  sprout_places places;
  size_t i;
  bool ran = false;
  if (sprout_places_occupied(session->world, session->state, &session->host.record, &places) != SPROUT_OK) return false;
  for (i = 0; i < places.count; i++) {
    sprout_turn_input input;
    sprout_outcome outcome;
    char *place = sprout_arena_copy(arena, places.ids[i].bytes, places.ids[i].length);
    if (place == NULL) break;
    memset(&input, 0, sizeof input);
    input.kind = SPROUT_TURN_TICK;
    input.place = place;
    if (run_for(session, &input, place, 0, true, &outcome) == SPROUT_OK) {
      ran = ran || outcome.result != SPROUT_RESULT_IDLE;
      told_collect(arena, lines, &outcome, PLAYER_VISIT);
    }
    sprout_outcome_free(&outcome);
  }
  sprout_places_free(&places);
  return ran;
}

player_told player_tick(player_session *session) {
  player_told answer;
  sprout_arena *arena = session_answer(session);
  if (!in_world(session)) return cannot("You are not in a world.");
  memset(&answer, 0, sizeof answer);
  answer.ok = true;
  answer.result = SPROUT_RESULT_DONE;
  answer.words = "";
  answer.ran = wake_due(session, arena, &answer.lines, player_host_seconds(&session->host));
  answer.ran = tick_places(session, arena, &answer.lines) || answer.ran;
  owe(session, &answer, session_save_later);
  return answer;
}
