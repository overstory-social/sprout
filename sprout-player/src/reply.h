/*
 * What the registered functions hand back to Lua: one JSON text each (a registered function has
 * no way to build a table), written here from the runtime's own results. Every constructor
 * returns NULL once a page has been refused, and `jb_set` and `jb_add` take NULL without effect,
 * so a builder is checked once, at `jb_finish`.
 */
#ifndef PLAYER_REPLY_H
#define PLAYER_REPLY_H

#include "json.h"
#include "pd_api.h"
#include "sprout.h"

typedef struct jb {
  sprout_arena *arena;
  bool ok;
} jb;

void jb_begin(jb *builder, sprout_arena *arena);

/* An object or an array with room for `members`, which is fixed when it is made. */
sprout_json *jb_object(jb *builder, size_t members);
sprout_json *jb_array(jb *builder, size_t members);
sprout_json *jb_text(jb *builder, const char *bytes, size_t length);
sprout_json *jb_string(jb *builder, const char *text);
sprout_json *jb_str(jb *builder, sprout_str text);
sprout_json *jb_number(jb *builder, double number);
sprout_json *jb_bool(jb *builder, bool value);
sprout_json *jb_null(jb *builder);

/* Adds `child` under `key` to an object, or to an array where `key` is NULL. */
void jb_set(jb *builder, sprout_json *parent, const char *key, sprout_json *child);

/*
 * The canonical text of `root`, copied into `*reply` (a block from the device's allocator that
 * replaces the one it held); false when a page was refused along the way.
 */
bool jb_finish(jb *builder, PlaydateAPI *pd, const sprout_json *root, char **reply);

/*
 * The lines the turns of one call told, copied out of their outcomes into the reply's arena so
 * the outcomes can be released as each turn ends.
 */
typedef struct told {
  const char *reader;
  size_t reader_length;
  const char *kind;
  const char *text;
  size_t text_length;
} told;

typedef struct told_list {
  told *items;
  size_t count, capacity;
} told_list;

/* Adds the lines of `outcome`, and its fault's name as a record where it faulted; false when a page was refused. */
bool told_collect(sprout_arena *arena, told_list *list, const sprout_outcome *outcome, const char *visit);

/* Adds one line of `kind` for `reader`. */
bool told_add(sprout_arena *arena, told_list *list, const char *reader, const char *kind, const char *text);

/* The list as an array of { reader, kind, text }. */
sprout_json *jb_told(jb *builder, const told_list *list);

/* The word for a kind of line: the one the TypeScript player writes. */
const char *line_kind_name(sprout_line_kind kind);
const char *turn_kind_name(sprout_turn_kind kind);
const char *result_name(sprout_turn_result result);

#endif
