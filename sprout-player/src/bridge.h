/*
 * The functions Lua calls, registered under the global table `sprout`:
 *
 *   sprout.inspect(path)      can the cartridge be shelved
 *   sprout.open(path)         load a cartridge from the app's worlds folder or the Data folder
 *   sprout.load()             read the world's save (or start it) and put away a visit left open
 *   sprout.admit(nickname)    catch up, then arrive
 *   sprout.view()             the chip tree and the place, as JSON
 *   sprout.turn(reading)      a command turn from a reading the sentence builder made, as JSON
 *   sprout.tick()             a tick turn and the wakes that have fallen due
 *   sprout.save()             write the save now
 *   sprout.close()            depart, save, release the world
 *   sprout.verify(text, signature, key)   whether the hexadecimal signature is the key's over the text
 *   sprout.digest(path)       the SHA-256 and size of a file in the Data folder or the app
 *
 * Each takes strings and returns one JSON string (session.h has the shapes), since a registered
 * function cannot build a table; `engine.lua` decodes them. Nothing else of the engine is reachable from Lua.
 */
#ifndef PLAYER_BRIDGE_H
#define PLAYER_BRIDGE_H

#include "pd_api.h"

/* Registers the functions with the Lua runtime; false, with the runtime's error logged, when one is refused. */
bool player_register(PlaydateAPI *pd);

/* The app is ending: a world still open leaves and is saved. */
void player_shutdown(void);

#endif
