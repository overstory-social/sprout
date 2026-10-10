/*
 * A reading as the sentence builder hands it over: `{ verb, text?, fillers: [...] }`, each
 * filler `{ role, binds, ... }` in the shape the view's chip tree gives (object by `id`, set by
 * `ids`, exit by `direction`, `label` and `to`) or, for a value role, `{ role, binds: "value",
 * value }` with a word or a whole number. Nothing here is text a visitor typed: the device has
 * no command parser, and a reading is built from the view's chips.
 */
#ifndef PLAYER_READING_JSON_H
#define PLAYER_READING_JSON_H

#include "arena.h"
#include "sprout.h"

/*
 * Reads `json` into `read`, performed by `actor`; everything it points to is in `arena`. `text`
 * is the line the builder says the reading stands for, or NULL. NULL on success, or words for
 * what is wrong with the reading.
 */
const char *reading_parse(sprout_arena *arena, const char *json, size_t length, const char *actor,
                          sprout_reading *read, const char **text);

#endif
