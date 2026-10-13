/*
 * The canonical text of a JSON value: the text a signed index's signature is made over (the
 * design doc's Shipped worlds and downloads), byte for byte the text `canonicalText` in
 * scripts/index-signing.mjs signs. No white space; an object's members in the order JavaScript's
 * sort puts their names, which is UTF-16 code-unit order; strings escaped as JSON.stringify
 * escapes them; integers in decimal. Only strings, integers, arrays and objects have one, and an
 * object that names a member twice has none, since the signer's parse would keep only the last.
 */
#ifndef PLAYER_CANONICAL_H
#define PLAYER_CANONICAL_H

#include <stddef.h>

#include "json.h"

/*
 * The canonical text of `value` into `*text` (NUL-terminated, in `arena`): NULL when there is one,
 * else the reason there is none. Objects in `value` are put in canonical order in place.
 */
const char *player_canonical(sprout_arena *arena, sprout_json *value, const char **text, size_t *length);

#endif
