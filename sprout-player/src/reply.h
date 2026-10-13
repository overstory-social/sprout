/*
 * The JSON the bridge hands back to Lua: one text each (a registered function has no way to
 * build a table), written from the session's structs. Only the bridge builds it. A constructor
 * whose page is refused returns NULL and marks the builder failed, as `jb_set` does when given
 * NULL, so a builder is checked once, at `jb_finish`.
 */
#ifndef PLAYER_REPLY_H
#define PLAYER_REPLY_H

#include "json.h"
#include "pd_api.h"
#include "sprout.h"
#include "told.h"

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

/* The list as an array of { reader, kind, text }, with { extension, statement, payload } on an extension's effect. */
sprout_json *jb_told(jb *builder, const told_list *list);

#endif
