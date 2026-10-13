/*
 * A line a visitor typed, as the command turns it runs (the spec's Parsing > Sequences, again and all; Intents): its
 * commands, split at each `.` and each word `then`, and the turns each runs; see sprout_line_begin. Beside it, the
 * copies a turn and a line make of what an earlier turn handed on, so it outlives the outcome it came in.
 */
#ifndef SPROUT_LINE_H
#define SPROUT_LINE_H

#include "arena.h"

/*
 * The commands `text` holds, each trimmed of white space, empty ones left out, in `arena`: split at each `.`, then
 * at each word `then` in any case; the whole line where it holds none.
 */
sprout_status sprout_line_parts(sprout_arena *arena, sprout_str text, sprout_str **parts, size_t *count);

/* A deep copy of `from` in `arena`; NULL when the host refuses a page. */
sprout_reading *sprout_reading_copy(sprout_arena *arena, const sprout_reading *from);
sprout_reread *sprout_reread_copy(sprout_arena *arena, const sprout_reread *from);

#endif
