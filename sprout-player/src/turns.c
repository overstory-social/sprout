/*
 * The write turns this host runs (the spec's The runtime > Turns; The host contract > Admission
 * and identity, Time): arrival, preceded by the catch-up that tells nothing, a command from a
 * reading the sentence builder made, the ticks and due wakes the reader asks for, and departure.
 * Every turn runs at the host's seconds under a seed drawn from the clock when it begins, is
 * written to the log tail with that seed, and marks the state to be saved when it committed.
 */
#include <string.h>

#include "reading_json.h"
#include "session_internal.h"

#define WAKES_PER_TICK 64
#define WOKEN_KEPT 16

/* ---- the log entry ---- */

/* The entry the log tail keeps of a turn that ran: kind, seed, seconds, who, how it ended, and the line typed. */
static void log_turn(player_session *session, const sprout_turn_input *input, const sprout_outcome *outcome) {
  sprout_arena arena;
  jb builder;
  sprout_json *entry;
  const sprout_log_entry *log = &outcome->log;
  const char *bytes;
  size_t length;
  if (!outcome->has_log || sprout_arena_init(&arena, &session->host.record) != SPROUT_OK) return;
  jb_begin(&builder, &arena);
  entry = jb_object(&builder, 8);
  jb_set(&builder, entry, "kind", jb_string(&builder, turn_kind_name(log->kind)));
  jb_set(&builder, entry, "seed", jb_number(&builder, (double)log->seed));
  jb_set(&builder, entry, "seconds", jb_number(&builder, (double)log->seconds));
  jb_set(&builder, entry, "who", log->who.length == 0 ? jb_null(&builder) : jb_str(&builder, log->who));
  jb_set(&builder, entry, "outcome", jb_string(&builder, result_name(outcome->result)));
  jb_set(&builder, entry, "fault", log->faulted ? jb_string(&builder, log->fault_name) : jb_null(&builder));
  jb_set(&builder, entry, "serial", jb_number(&builder, (double)log->serial));
  jb_set(&builder, entry, "text", input->text != NULL ? jb_text(&builder, input->text, input->text_length) : jb_null(&builder));
  if (builder.ok && sprout_json_write(&arena, entry, &bytes, &length) == SPROUT_OK) savelog_add(session, bytes, length);
  sprout_arena_reset(&arena);
}

/* ---- running a turn ---- */

sprout_status turns_run(player_session *session, sprout_turn_input *input, sprout_outcome *outcome) {
  sprout_status status;
  input->instant = player_host_seconds(&session->host);
  player_host_begin_step(&session->host);
  memset(outcome, 0, sizeof *outcome);
  status = sprout_run_turn(session->world, session->state, &session->host.record, input, outcome);
  if (status != SPROUT_OK) return status;
  log_turn(session, input, outcome);
  if (outcome->committed || outcome->state_changed) session->dirty = true;
  return status;
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

/* A reply with the given members all false or empty: nothing could be done, and the words say why. */
static const char *cannot(player_session *session, const char *flag, const char *words) {
  sprout_arena arena;
  jb builder;
  sprout_json *root;
  if (!session_reply_begin(session, &arena, &builder)) return session_reply_end(session, &arena, &builder, NULL);
  root = jb_object(&builder, 4);
  jb_set(&builder, root, flag, jb_bool(&builder, false));
  jb_set(&builder, root, "committed", jb_bool(&builder, false));
  jb_set(&builder, root, "words", jb_string(&builder, words));
  jb_set(&builder, root, "lines", jb_array(&builder, 0));
  return session_reply_end(session, &arena, &builder, root);
}

/* ---- arrival ---- */

const char *player_admit(player_session *session, const char *nickname) {
  sprout_arena arena;
  jb builder;
  sprout_json *root;
  sprout_admission admission;
  sprout_outcome outcome;
  sprout_turn_input input;
  sprout_status status;
  told_list lines;
  const char *words = "", *reply;
  bool admitted = false;
  if (session->state == NULL) return cannot(session, "admitted", "No world is open.");
  status = sprout_admit(session->world, session->state, &session->host.record, PLAYER_VISIT, nickname,
                        strlen(nickname), &admission);
  if (status != SPROUT_OK) return cannot(session, "admitted", sprout_status_text(status));
  if (!session_reply_begin(session, &arena, &builder)) {
    sprout_admission_free(&admission);
    return session_reply_end(session, &arena, &builder, NULL);
  }
  memset(&lines, 0, sizeof lines);
  if (admission.reason != SPROUT_NICKNAME_OK) {
    words = admission.words.bytes;
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
      words = outcome.fault.text;
    } else {
      admitted = outcome.result == SPROUT_RESULT_DONE;
      if (outcome.words != NULL) words = outcome.words;
      told_collect(&arena, &lines, &outcome, PLAYER_VISIT);
    }
  }
  session_save_if_dirty(session);
  root = jb_object(&builder, 4);
  jb_set(&builder, root, "admitted", jb_bool(&builder, admitted));
  jb_set(&builder, root, "words", jb_string(&builder, words));
  jb_set(&builder, root, "visit", jb_string(&builder, PLAYER_VISIT));
  jb_set(&builder, root, "lines", jb_told(&builder, &lines));
  reply = session_reply_end(session, &arena, &builder, root);
  if (admission.reason == SPROUT_NICKNAME_OK) sprout_outcome_free(&outcome);
  sprout_admission_free(&admission);
  return reply;
}

/* ---- a command ---- */

const char *player_turn(player_session *session, const char *reading) {
  sprout_arena arena;
  jb builder;
  sprout_json *root;
  sprout_outcome outcome;
  sprout_turn_input input;
  sprout_reading read;
  sprout_status status;
  const sprout_stored_visitor *visitor = session_visitor(session);
  told_list lines;
  const char *why, *text, *actor, *words = NULL, *reply;
  bool committed = false;
  const char *result = "refused";
  if (session->state == NULL || visitor == NULL || !session_visitor_present(session, visitor))
    return cannot(session, "ran", "You are not in a world.");
  if (!session_reply_begin(session, &arena, &builder)) return session_reply_end(session, &arena, &builder, NULL);
  /* The actor's id is copied: a committed turn replaces the memory the state's records live in. */
  actor = sprout_arena_copy(&arena, visitor->instance.bytes, visitor->instance.length);
  why = actor == NULL ? "The player ran out of memory reading that."
                      : reading_parse(&arena, reading, strlen(reading), actor, &read, &text);
  memset(&lines, 0, sizeof lines);
  memset(&outcome, 0, sizeof outcome);
  if (why != NULL) {
    words = why;
    told_add(&arena, &lines, PLAYER_VISIT, "notice", why);
  } else {
    memset(&input, 0, sizeof input);
    input.kind = SPROUT_TURN_COMMAND;
    input.visit = PLAYER_VISIT;
    input.reading = &read;
    input.text = text;
    input.text_length = text == NULL ? 0 : strlen(text);
    status = turns_run(session, &input, &outcome);
    if (status != SPROUT_OK) {
      /* A reading the world cannot take: said in words, and nothing was written. */
      words = status == SPROUT_BAD_INPUT ? outcome.fault.text : sprout_status_text(status);
      told_add(&arena, &lines, PLAYER_VISIT, "notice", words);
    } else {
      committed = outcome.committed;
      result = result_name(outcome.result);
      told_collect(&arena, &lines, &outcome, PLAYER_VISIT);
    }
  }
  session_save_if_dirty(session);
  root = jb_object(&builder, 4);
  jb_set(&builder, root, "committed", jb_bool(&builder, committed));
  jb_set(&builder, root, "result", jb_string(&builder, result));
  jb_set(&builder, root, "words", words == NULL ? jb_null(&builder) : jb_string(&builder, words));
  jb_set(&builder, root, "lines", jb_told(&builder, &lines));
  reply = session_reply_end(session, &arena, &builder, root);
  sprout_outcome_free(&outcome);
  return reply;
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
    input.nth = woken_count(arena, table, &kept, object);
    if (turns_run(session, &input, &outcome) == SPROUT_OK) {
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
    if (turns_run(session, &input, &outcome) == SPROUT_OK) {
      ran = ran || outcome.result != SPROUT_RESULT_IDLE;
      told_collect(arena, lines, &outcome, PLAYER_VISIT);
    }
    sprout_outcome_free(&outcome);
  }
  sprout_places_free(&places);
  return ran;
}

const char *player_tick(player_session *session) {
  sprout_arena arena;
  jb builder;
  sprout_json *root;
  told_list lines;
  const sprout_stored_visitor *visitor = session_visitor(session);
  bool ran = false;
  if (session->state == NULL || visitor == NULL || !session_visitor_present(session, visitor))
    return cannot(session, "ran", "You are not in a world.");
  if (!session_reply_begin(session, &arena, &builder)) return session_reply_end(session, &arena, &builder, NULL);
  memset(&lines, 0, sizeof lines);
  ran = wake_due(session, &arena, &lines, player_host_seconds(&session->host));
  ran = tick_places(session, &arena, &lines) || ran;
  session_save_if_dirty(session);
  root = jb_object(&builder, 2);
  jb_set(&builder, root, "ran", jb_bool(&builder, ran));
  jb_set(&builder, root, "lines", jb_told(&builder, &lines));
  return session_reply_end(session, &arena, &builder, root);
}
