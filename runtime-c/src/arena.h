/*
 * Page arenas. A load arena holds a world's declarations for as long as it
 * is loaded; a turn arena holds one turn's scratch and is reset when the turn
 * ends. Pieces are never freed one by one: a page is released whole, and the
 * page size is the host's (sprout_host.page_bytes).
 */
#ifndef SPROUT_ARENA_H
#define SPROUT_ARENA_H

#include "sprout.h"

typedef struct sprout_page sprout_page;

typedef struct sprout_arena {
  const sprout_host *host;
  sprout_page *pages; /* newest first; the head is the page being filled */
  size_t held;        /* bytes taken from the host, headers included */
} sprout_arena;

/* Begins an empty arena over a host; SPROUT_BAD_HOST if the host cannot give pages. */
sprout_status sprout_arena_init(sprout_arena *arena, const sprout_host *host);

/* Takes zeroed, suitably aligned bytes; NULL when the host refuses a page. */
void *sprout_arena_take(sprout_arena *arena, size_t bytes);

/* A copy of bytes, with a NUL after them; NULL when the host refuses a page. */
char *sprout_arena_copy(sprout_arena *arena, const char *bytes, size_t length);

/* Releases every page: the arena is empty and may be used again. */
void sprout_arena_reset(sprout_arena *arena);

#endif
