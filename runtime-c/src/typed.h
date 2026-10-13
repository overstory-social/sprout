/*
 * A typed line as words (the spec's Parsing > Matching a line; Names > Nicknames): lower case as JavaScript's
 * `toLowerCase` makes it, final sigma included, split on the white space JavaScript's `\s` is, each comma a
 * word of its own. A nickname is compared by these words, and the parser reads a line by them, so the two
 * agree on what is typed alike.
 */
#ifndef SPROUT_TYPED_H
#define SPROUT_TYPED_H

#include "arena.h"

/* `text`'s words, each NUL-terminated, in the arena; SPROUT_NO_MEMORY when the host refuses a page. */
sprout_status typed_words(sprout_arena *arena, sprout_str text, sprout_str **words, size_t *count);

/* `text` in lower case as JavaScript's `toLowerCase` makes it, every other byte kept, NUL-terminated in the arena. */
sprout_status typed_lower(sprout_arena *arena, sprout_str text, sprout_str *lower);

#endif
