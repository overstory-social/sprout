/*
 * A reading, an item of a run read afresh and a turn a line runs after another, as JSON: the forms the WebAssembly
 * engine's export layer (wasm/engine/) hands a host, which hands a planned turn back in. A reading is its verb (or, for an
 * intent's, the intent) by qualified name, who performs it, and what fills each role it binds, in order, each filler
 * by id with a value role's value. Trees are built in the arena given and point into what they were made from; a
 * reading read back points into the tree.
 */
#ifndef SPROUT_READING_JSON_H
#define SPROUT_READING_JSON_H

#include "json.h"

/* `reading` as a tree, its verb under the key `what` (`verb`, or `intent` for an intent's); NULL when a page is refused. */
sprout_json *sprout_reading_tree(sprout_arena *arena, const char *what, const sprout_reading *reading);

/* `reread` as a tree; NULL when a page is refused. */
sprout_json *sprout_reread_tree(sprout_arena *arena, const sprout_reread *reread);

/* `following` as a tree: `{planned, reread?}` or `{text}`; NULL when a page is refused. */
sprout_json *sprout_following_tree(sprout_arena *arena, const sprout_following *following);

/* The fillings of `fillers`, an array of fillers, in `arena`; NULL, or words for what is wrong with them. */
const char *sprout_fillings_of_tree(sprout_arena *arena, const sprout_json *fillers, sprout_filling **out, size_t *count);

/* The reading `tree` holds, `{verb, actor, bindings}`, in `arena`; NULL, or words for what is wrong with it. */
const char *sprout_reading_of_tree(sprout_arena *arena, const sprout_json *tree, sprout_reading *out);

/* The item of a run `tree` holds, `{role, words, values, referents}`, in `arena`; NULL, or words for what is wrong with it. */
const char *sprout_reread_of_tree(sprout_arena *arena, const sprout_json *tree, sprout_reread *out);

#endif
