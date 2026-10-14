/*
 * `everything` in the sentence builder, where the parser would read `all` (the spec's Parsing › Sequences,
 * again and all): which things of a level it takes, whether the level offers it, and the turns a sentence
 * with `everything` for a role that takes one thing runs. Nothing here draws or runs a turn.
 */
#ifndef PLAYER_UI_EVERYTHING_H
#define PLAYER_UI_EVERYTHING_H

#include <stdbool.h>
#include <stddef.h>

#include "sentence.h"

/* How many things the host lets a set role bind, which bounds what `everything` takes too. */
size_t everything_most(void);

/*
 * Whether `everything` takes a choice of the level: a thing, or a set's one thing, that can be done, and neither
 * the visitor's own place nor anyone the view lists as here. The view does not say what kind a thing is, so the
 * people it lists are left out for every role, as `all` leaves them out of an open role.
 */
bool everything_takes(const sentence *s, const sentence_choice *choice);

/* Whether the level offers `everything`: two or more things it takes, and for a role that takes one thing, none before it in the sentence did. */
bool everything_offered(const sentence *s);

/*
 * The turns of a sentence whose role that takes one thing says `everything`, into the sentence's `each`: each of
 * its things whose reading, the rest of the sentence as it was built, the view offers and does not refuse, in its
 * level's order, as `all` leaves out what its consent pass would refuse; at most everything_most().
 */
void everything_plan(sentence *s);

#endif
