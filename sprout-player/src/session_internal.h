/*
 * What the session's modules share: the session record and the few functions that cross
 * between them. session.c opens, loads, saves and closes; turns.c runs the write turns;
 * seen.c polls the view and walks the chip tree; savelog.c keeps the log tail.
 */
#ifndef PLAYER_SESSION_INTERNAL_H
#define PLAYER_SESSION_INTERNAL_H

#include "chips.h"
#include "host/pd_host.h"
#include "session.h"
#include "state.h"
#include "told.h"

/* Entries of the log the save keeps. */
#define LOG_KEEP 32
#define PATH_BYTES 128

/*
 * The state being written a slice a frame: its bytes, made when the write begins, in an arena of
 * their own, and the file `<state>.part` they go into.
 */
typedef struct session_writer {
  bool live;
  sprout_arena arena;
  const char *bytes;
  size_t length, written;
  SDFile *file;
} session_writer;

struct player_session {
  PlaydateAPI *pd;
  player_host host;
  sprout_world *world;
  sprout_state *state;
  sprout_loading *loading; /* a world being opened across frames, read a piece a step from the file below */
  SDFile *loading_file;
  char hash[72];
  char title[96];
  char state_path[PATH_BYTES];
  char log_path[PATH_BYTES];
  bool dirty;          /* a turn committed since the last save was begun */
  bool owed;           /* the state is to be written: its log tail is on disk and its bytes not yet begun */
  bool unsaved;        /* a write failed since the last save that was whole */
  session_writer writer;
  char *log[LOG_KEEP]; /* the log tail, oldest first, one JSON text each */
  size_t log_count;
  sprout_arena answer; /* what the last call handed back, released when the next begins */
  sprout_seen_view seen;  /* the last scene polled, kept with its chip tree until the next, the close or the end */
  sprout_chip_tree chips; /* one verb each of the scene's, its subtree NULL until its readings are asked for */
  bool *fetched;          /* one for each verb: whether its readings were asked for and came whole */
  const char **why_empty; /* one for each verb: the words for a verb nothing fits, or whose poll ran out (asked again on the next reach) */
  sprout_arena chip_arena; /* the verbs' readings and subtrees, released with the scene */
  bool seen_live;
};

/* Begins a call's answer: what the last call handed back is released, and the arena returned is empty. */
sprout_arena *session_answer(player_session *session);

/* A copy of `text` in the answer's arena; the words for running out of memory where there is no room. */
const char *session_keep(player_session *session, const char *text);

/* Releases the view kept for the chips, if one is. */
void session_drop_view(player_session *session);

/* The visitor's record in the stored state, or NULL. */
const sprout_stored_visitor *session_visitor(const player_session *session);

/* Whether a visitor's instance stands in the world now (away visitors have no container). */
bool session_visitor_present(const player_session *session, const sprout_stored_visitor *visitor);

/*
 * After a write turn: where it committed, the log tail is written now and the state is owed, to be
 * written a slice a frame by `player_save_step`. False when a write has failed since the last
 * whole save, which stops play.
 */
bool session_save_soon(player_session *session);

/* Writes the state owed or under way, all of it now; false when it could not be. */
bool session_save_finish(player_session *session);

/* As `session_save_finish`, after what the turns since the last save owe is made owed. */
bool session_save_settle(player_session *session);

/* Drops the save under way, its `.part` removed, and whatever was owed; the world is being let go. */
void session_save_abandon(player_session *session);

/* savelog.c */
void savelog_clear(player_session *session);
void savelog_add(player_session *session, const char *entry, size_t length);
void savelog_read(player_session *session);
bool savelog_write(player_session *session);
/* Adds the entry of a turn that ran: kind, seed, seconds, who, how it ended, and the line typed. */
void savelog_turn(player_session *session, const sprout_turn_input *input, const sprout_outcome *outcome);

/*
 * turns.c: runs one write turn at the host's seconds, under a seed drawn now, logs it, and marks
 * the state dirty when it changed. The outcome is the caller's to free.
 */
sprout_status turns_run(player_session *session, sprout_turn_input *input, sprout_outcome *outcome);

/* The visitor leaves: a departure turn if they stand in the world. False when they did not. */
bool turns_depart(player_session *session, sprout_outcome *outcome);

#endif
