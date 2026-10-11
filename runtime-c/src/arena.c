/*
 * Page arenas (the spec's The host contract: memory is the host's). A piece
 * is carved from the newest page at the alignment asked for; a request that
 * does not fit it takes a new page, sized to the host's page_bytes or to the
 * request if that is larger. Taken bytes are zero. A world holds hundreds of
 * thousands of small arrays, so a piece is not rounded past its alignment.
 */
#include "arena.h"

#include <stdbool.h>
#include <string.h>

struct sprout_page {
  sprout_page *next;
  size_t bytes; /* the whole block, header included */
  size_t used;  /* offset of the next free byte */
};

/* Aligned for any object the runtime keeps: the double in a node. */
#define ALIGN 8u
#define ROUND_UP(n, a) (((n) + ((a) - 1u)) & ~(size_t)((a) - 1u))
#define HEADER ROUND_UP(sizeof(sprout_page), ALIGN)

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

void *sprout_arena_take_aligned(sprout_arena *arena, size_t bytes, size_t align) {
  size_t start = 0;
  sprout_page *page = arena->pages;
  char *piece;
  if (align == 0 || align > ALIGN || (align & (align - 1u)) != 0) align = ALIGN;
  if (bytes == 0) bytes = 1;
  if (bytes > (size_t)-1 - ALIGN) return NULL;
  if (page != NULL) {
    start = ROUND_UP(page->used, align);
    if (page->bytes - start < bytes) page = NULL;
  }
  if (page == NULL) {
    size_t need = ROUND_UP(bytes, ALIGN);
    bool oversize = need > arena->host->page_bytes;
    page = new_page(arena, oversize ? need : arena->host->page_bytes, !oversize);
    if (page == NULL) return NULL;
    start = page->used;
  }
  piece = (char *)page + start;
  page->used = start + bytes;
  memset(piece, 0, bytes);
  return piece;
}

void *sprout_arena_take(sprout_arena *arena, size_t bytes) { return sprout_arena_take_aligned(arena, bytes, ALIGN); }

char *sprout_arena_copy(sprout_arena *arena, const char *bytes, size_t length) {
  char *copy = (char *)sprout_arena_take_aligned(arena, length + 1, 1);
  if (copy == NULL) return NULL;
  if (length > 0) memcpy(copy, bytes, length);
  copy[length] = '\0';
  return copy;
}

void sprout_arena_rewind(sprout_arena *arena) {
  sprout_page *keep = arena->pages, *page;
  if (keep == NULL) return;
  page = keep->next;
  while (page != NULL) {
    sprout_page *next = page->next;
    arena->host->release(arena->host->ctx, page, page->bytes);
    page = next;
  }
  keep->next = NULL;
  keep->used = HEADER;
  arena->held = keep->bytes;
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
