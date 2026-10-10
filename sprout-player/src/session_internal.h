/*
 * What the session's modules share: the session record and the few functions that cross
 * between them. session.c opens, loads, saves and closes; turns.c runs the write turns;
 * seen.c writes the view; savelog.c keeps the log tail.
 */
#ifndef PLAYER_SESSION_INTERNAL_H
#define PLAYER_SESSION_INTERNAL_H

#include "pd_host.h"
#include "reply.h"
#include "session.h"
#include "state.h"

/* The one visit the device holds in a world. */
#define PLAYER_VISIT "visit:player"
/* Entries of the log the save keeps. */
#define LOG_KEEP 32
#define PATH_BYTES 128

struct player_session {
  PlaydateAPI *pd;
  player_host host;
  sprout_world *world;
  sprout_state *state;
  char hash[72];
  char title[96];
  char state_path[PATH_BYTES];
  char log_path[PATH_BYTES];
  bool dirty;          /* a turn committed since the last save */
  char *log[LOG_KEEP]; /* the log tail, oldest first, one JSON text each */
  size_t log_count;
  char *reply;         /* the text last handed to Lua */
};

/* Begins a reply in a fresh arena over the session's host; false when the host gives no page. */
bool session_reply_begin(player_session *session, sprout_arena *arena, jb *builder);

/* Ends a reply: the text written into `session->reply`, which is returned. A reply that could not be built says so. */
const char *session_reply_end(player_session *session, sprout_arena *arena, jb *builder, const sprout_json *root);

/* The visitor's record in the stored state, or NULL. */
const sprout_stored_visitor *session_visitor(const player_session *session);

/* Whether a visitor's instance stands in the world now (away visitors have no container). */
bool session_visitor_present(const player_session *session, const sprout_stored_visitor *visitor);

/* Writes the state and the log tail if a turn has committed since the last save. */
bool session_save_if_dirty(player_session *session);

/* savelog.c */
void savelog_clear(player_session *session);
void savelog_add(player_session *session, const char *entry, size_t length);
void savelog_read(player_session *session);
bool savelog_write(player_session *session);

/*
 * turns.c: runs one write turn at the host's seconds, under a seed drawn now, logs it, and marks
 * the state dirty when it changed. The outcome is the caller's to free.
 */
sprout_status turns_run(player_session *session, sprout_turn_input *input, sprout_outcome *outcome);

/* The visitor leaves: a departure turn if they stand in the world. False when they did not. */
bool turns_depart(player_session *session, sprout_outcome *outcome);

#endif
