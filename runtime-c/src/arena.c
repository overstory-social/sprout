/*
 * Page arenas (the spec's The host contract: memory is the host's). A piece
 * is carved from the newest page; a request that does not fit it takes a new
 * page, sized to the host's page_bytes or to the request if that is larger.
 * Taken bytes are zero.
 */
#include "arena.h"

#include <stdbool.h>
#include <string.h>

struct sprout_page {
  sprout_page *next;
  size_t bytes; /* the whole block, header included */
  size_t used;  /* offset of the next free byte */
};

/* Aligned for any object the runtime keeps. */
#define ALIGN 16u
#define ROUND(n) (((n) + (ALIGN - 1u)) & ~(size_t)(ALIGN - 1u))
#define HEADER ROUND(sizeof(sprout_page))

sprout_status sprout_arena_init(sprout_arena *arena, const sprout_host *host) {
  arena->host = host;
  arena->pages = NULL;
  arena->held = 0;
  if (host == NULL || host->alloc == NULL || host->release == NULL || host->page_bytes == 0)
    return SPROUT_BAD_HOST;
  return SPROUT_OK;
}

/* A page with room for `room` bytes; `head` makes it the page being filled. */
static sprout_page *new_page(sprout_arena *arena, size_t room, bool head) {
  size_t bytes;
  sprout_page *page;
  if (room > (size_t)-1 - HEADER) return NULL;
  bytes = HEADER + room;
  page = (sprout_page *)arena->host->alloc(arena->host->ctx, bytes);
  if (page == NULL) return NULL;
  page->bytes = bytes;
  page->used = HEADER;
  if (head || arena->pages == NULL) {
    page->next = arena->pages;
    arena->pages = page;
  } else {
    /* An oversize piece sits behind the page that keeps filling. */
    page->next = arena->pages->next;
    arena->pages->next = page;
  }
  arena->held += bytes;
  return page;
}

void *sprout_arena_take(sprout_arena *arena, size_t bytes) {
  size_t need;
  sprout_page *page = arena->pages;
  char *piece;
  if (bytes > (size_t)-1 - ALIGN) return NULL;
  need = ROUND(bytes == 0 ? 1 : bytes);
  if (page == NULL || page->bytes - page->used < need) {
    bool oversize = need > arena->host->page_bytes;
    page = new_page(arena, oversize ? need : arena->host->page_bytes, !oversize);
    if (page == NULL) return NULL;
  }
  piece = (char *)page + page->used;
  page->used += need;
  memset(piece, 0, need);
  return piece;
}

char *sprout_arena_copy(sprout_arena *arena, const char *bytes, size_t length) {
  char *copy = (char *)sprout_arena_take(arena, length + 1);
  if (copy == NULL) return NULL;
  if (length > 0) memcpy(copy, bytes, length);
  copy[length] = '\0';
  return copy;
}

void sprout_arena_reset(sprout_arena *arena) {
  sprout_page *page = arena->pages;
  while (page != NULL) {
    sprout_page *next = page->next;
    arena->host->release(arena->host->ctx, page, page->bytes);
    page = next;
  }
  arena->pages = NULL;
  arena->held = 0;
}
