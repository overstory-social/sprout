/*
 * The lines the turns of one call told, copied out of their outcomes into an arena the caller
 * owns, so each outcome can be released as its turn ends; and the words the TypeScript player
 * writes for a kind of line, a kind of turn and a turn's result.
 */
#ifndef PLAYER_TOLD_H
#define PLAYER_TOLD_H

#include "arena.h"
#include "sprout.h"

typedef struct told {
  const char *reader;
  size_t reader_length;
  const char *kind; /* line_kind_name's word, or "record" for a fault's name */
  const char *text;
  size_t text_length;
  const char *extension, *statement; /* an extension's effect: the statement that recorded it; NULL for any other */
  const char *payload;               /* an extension's effect: its payload as JSON text, or NULL */
  size_t payload_length;
} told;

typedef struct told_list {
  told *items;
  size_t count, capacity;
} told_list;

/* Adds the lines of `outcome`, and its fault's name as a record where it faulted; false when a page was refused. */
bool told_collect(sprout_arena *arena, told_list *list, const sprout_outcome *outcome, const char *visit);

/* Adds one line of `kind` for `reader`; false when a page was refused, and the list is as it was. */
bool told_add(sprout_arena *arena, told_list *list, const char *reader, const char *kind, const char *text);

const char *line_kind_name(sprout_line_kind kind);
const char *turn_kind_name(sprout_turn_kind kind);
const char *result_name(sprout_turn_result result);

#endif
