/*
 * The functions Lua calls, registered under the global table `sprout`:
 *
 *   sprout.inspect(path)      can the cartridge be shelved
 *   sprout.open(path)         begin opening a cartridge from the app's worlds folder or the Data folder
 *   sprout.step()             read on a little of the world being opened
 *   sprout.load()             read the world's save (or start it) and put away a visit left open
 *   sprout.admit(nickname)    catch up, then arrive
 *   sprout.view()             the place as the visitor sees it
 *   sprout.chips(path)        a level of the chip tree, `path` the picks so far as a JSON array
 *   sprout.turn(reading)      a command turn from a reading the sentence builder made, as JSON
 *   sprout.tick()             a tick turn and the wakes that have fallen due
 *   sprout.save()             write the save now
 *   sprout.close()            depart, save, release the world
 *   sprout.verify(text, signature, key)   whether the hexadecimal signature is the key's over the text
 *   sprout.digest(path)       the SHA-256 and size of a file in the Data folder or the app
 *
 * Each takes strings and returns one JSON string, since a registered function cannot build a
 * table; `engine.lua` decodes them. The bridge is the only JSON the session's answers become
 * (session.h has the structs), and it reads the reading Lua sends (reading_json.h). The shapes:
 *
 *   inspect  { ok, name, hash, reason }
 *   open     { ok, name, hash, reason }, or { ok: false, reason }
 *   step     { ok, done, read, counted } and, once done, { name, hash, words }; or { ok: false, reason }
 *   load     { ok, fresh, nickname, present, last, recovered, words }, or { ok: false, words }
 *   admit    { admitted, saved, words, visit, lines }
 *   view     { place: { id, name }, description, effects, exits, occupants, carried, faulted },
 *            or the same empty, with `words`
 *   chips    { choices: [{ verb | filler, greyed, reason }], leaf }, with the verb's `greyed` and
 *            `reason` right under it; or { ok: false, reason }
 *   turn     { committed, saved, result, words, lines }
 *   tick     { ran, saved, lines }
 *   save     { ok, words }
 *   close    { lines, saved }
 *   verify   { ok, reason }
 *   digest   { ok, sha256, bytes, reason }
 *
 * `lines` is an array of { reader, kind, text }, with { extension, statement, payload } on an
 * extension's effect. A call of turns that could run none (admit, turn, tick) is { admitted or
 * ran: false, committed: false, words, lines: [] }. Nothing else of the engine is reachable from Lua.
 */
#ifndef PLAYER_BRIDGE_H
#define PLAYER_BRIDGE_H

#include "pd_api.h"

/* Registers the functions with the Lua runtime; false, with the runtime's error logged, when one is refused. */
bool player_register(PlaydateAPI *pd);

/* The app is ending: a world still open leaves and is saved. */
void player_shutdown(void);

#endif
