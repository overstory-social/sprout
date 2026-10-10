/*
 * Whether a nickname may be admitted (the spec's Names > Nicknames; The host contract > Admission and
 * identity). A nickname is kept as its words, single-spaced, and is admitted only if no word of it is
 * shaped like source, a word of the world's word set or a connector, or a reserved word of the language,
 * and no one present holds it; someone away holds nothing, since reservations are soft. Two nicknames are
 * one where they are typed alike, which is lower case, as JavaScript folds it. Its length is bounded by the
 * host's `nickname_characters`, counted in characters as it is kept. Moderation is the host's.
 */
#ifndef SPROUT_NICKNAME_H
#define SPROUT_NICKNAME_H

#include "state.h"

/* What checking a nickname found; everything it points to is in the arena it was given. */
typedef struct nickname_check {
  sprout_nickname_reason reason;
  sprout_str kept;
  sprout_str words;
  size_t collide_count;
  sprout_str *collides;
} nickname_check;

/* `nickname` as the world keeps it: its words, separated by single spaces. False when the host refuses a page. */
bool nickname_kept(sprout_arena *arena, sprout_str nickname, sprout_str *kept);

/*
 * Why `nickname` cannot be admitted for `visit` to the world `state` is, under `world`'s word set and the
 * `budgets`, or SPROUT_NICKNAME_OK. SPROUT_NO_MEMORY when the host refuses a page.
 */
sprout_status nickname_check_for(sprout_arena *arena, const sprout_world *world, const sprout_state *state,
                                 const sprout_budgets *budgets, sprout_str visit, sprout_str nickname,
                                 nickname_check *out);

/* A nickname's words, folded: each as typed, lower case, a comma a word of its own. The text of each is in the arena. */
sprout_status nickname_typed_words(sprout_arena *arena, sprout_str text, sprout_str **words, size_t *count);

#endif
