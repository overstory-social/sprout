/*
 * One world open on the device: the cartridge loaded, its stored state, and the single visit
 * the device holds for it (the spec's The host contract; on a device a visit is one per world,
 * keyed by nothing but the world, since there is one person). Each call returns the JSON text
 * of its reply, valid until the next call on the session; the shapes are:
 *
 *   inspect  { ok, name, reason }            can the cartridge at `path` be shelved
 *   open     { ok, name, hash, words, reason }
 *   load     { ok, fresh, nickname, present, last, recovered, words }
 *   admit    { admitted, words, visit, lines }   catch-up runs first and tells nothing
 *   view     { place, description, exits, occupants, carried, chips, faulted }
 *   turn     { committed, result, words, lines }
 *   tick     { ran, lines }
 *   save     { ok, words }
 *   close    { lines }
 *
 * `lines` is an array of { reader, kind, text }. Time is host seconds, clamped so it never goes
 * below the last the save recorded (pd_host.h). The save is written after every committed turn.
 */
#ifndef PLAYER_SESSION_H
#define PLAYER_SESSION_H

#include "pd_api.h"

typedef struct player_session player_session;

player_session *player_session_new(PlaydateAPI *pd);
void player_session_free(player_session *session);

const char *player_inspect(player_session *session, const char *path);
const char *player_open(player_session *session, const char *path);
const char *player_load(player_session *session);
const char *player_admit(player_session *session, const char *nickname);
const char *player_view(player_session *session);
const char *player_turn(player_session *session, const char *reading);
const char *player_tick(player_session *session);
const char *player_save(player_session *session);
const char *player_close(player_session *session);

#endif
