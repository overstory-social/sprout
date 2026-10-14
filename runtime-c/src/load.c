/*
 * Loading a cartridge (the spec's The compiler > What compiling produces;
 * Language levels): the sixteen header bytes are checked, the body is
 * inflated into one block in the world's arena, as many bytes a step as the
 * host allows, from the cartridge held whole or from a source read a piece
 * at a time (so the compressed bytes are never whole in memory), and then
 * read where it lies: the preamble as a JSON tree in
 * the load's scratch, the table mapped in place and checked once, the
 * catalogue built beside them; then the scratch is released. A peek inflates
 * only as far as the preamble. The host's code is not in a cartridge, so the
 * extensions it pins are only recorded. Nothing is parsed or checked beyond
 * the shape: a cartridge holds a world that published.
 */
#include "load.h"

#include <string.h>

#include "catalogue_build.h"
#include "inflate.h"

static void say(sprout_refusal *refusal, const char *a, const char *b, const char *c, const char *d,
                const char *e) {
  const char *parts[5];
  size_t used = 0, i;
  if (refusal == NULL) return;
  parts[0] = a;
  parts[1] = b;
  parts[2] = c;
  parts[3] = d;
  parts[4] = e;
  for (i = 0; i < 5 && used + 1 < sizeof refusal->text; i++) {
    size_t room = sizeof refusal->text - 1 - used;
    size_t n = parts[i] == NULL ? 0 : strlen(parts[i]);
    if (n > room) n = room;
    if (n > 0) memcpy(refusal->text + used, parts[i], n);
    used += n;
  }
  refusal->text[used] = '\0';
}

/* A non-negative whole number in decimal, written into `out`. */
static const char *decimal(long n, char *out) {
  char reversed[24];
  size_t count = 0, i;
  if (n < 0) n = 0;
  do {
    reversed[count++] = (char)('0' + n % 10);
    n /= 10;
  } while (n > 0);
  for (i = 0; i < count; i++) out[i] = reversed[count - 1 - i];
  out[count] = '\0';
  return out;
}

static size_t word(const unsigned char *at) {
  return (size_t)at[0] | ((size_t)at[1] << 8) | ((size_t)at[2] << 16) | ((size_t)at[3] << 24);
}

sprout_status sprout_cartridge_check_header(const unsigned char *bytes, size_t length, long *format, long *level,
                                            size_t *body_bytes, size_t *table_at, sprout_refusal *refusal) {
  char number[24], limit[24];
  if (length < SPROUT_CARTRIDGE_HEADER_BYTES || memcmp(bytes, SPROUT_CARTRIDGE_MAGIC, 4) != 0) {
    say(refusal,
        "This is not a Sprout cartridge: it does not begin with `SPRT`. Pack a world with `sprout pack`.",
        NULL, NULL, NULL, NULL);
    return SPROUT_BAD_INPUT;
  }
  *format = (long)bytes[4] | ((long)bytes[5] << 8);
  *level = (long)bytes[6] | ((long)bytes[7] << 8);
  *body_bytes = word(bytes + 8);
  *table_at = word(bytes + 12);
  if (*format > SPROUT_CARTRIDGE_FORMAT) {
    say(refusal, "This cartridge is format version ", decimal(*format, number),
        ", and this runtime reads up to version ", decimal(SPROUT_CARTRIDGE_FORMAT, limit),
        ". Update the runtime, or pack the world again with this one.");
    return SPROUT_BAD_INPUT;
  }
  if (*format < 1) {
    say(refusal, "This cartridge says it is format version ", decimal(*format, number),
        ", and versions begin at 1. It is damaged.", NULL, NULL);
    return SPROUT_BAD_INPUT;
  }
  if (*format < SPROUT_CARTRIDGE_FORMAT) {
    say(refusal, "This cartridge is format version ", decimal(*format, number),
        ", and this runtime reads version ", decimal(SPROUT_CARTRIDGE_FORMAT, limit),
        ". Pack the world again with `sprout pack`.");
    return SPROUT_BAD_INPUT;
  }
  if (*level > SPROUT_LANGUAGE_LEVEL) {
    say(refusal, "This cartridge was made for language level ", decimal(*level, number),
        ", and this runtime reads up to level ", decimal(SPROUT_LANGUAGE_LEVEL, limit),
        ". Update the runtime, or pack the world again with this one.");
    return SPROUT_BAD_INPUT;
  }
  return SPROUT_OK;
}

#define NOT_SIZED "This cartridge cannot be read: its body is not the size its header says."
#define UNREAD "This cartridge cannot be read: its file could not be read to the end."

/* How much of a source's cartridge is read at once: small enough to share the load's scratch pages, about a read a step. */
#define PIECE_BYTES 8192u

/* The state of one body being read. */
typedef struct body_reader {
  sprout_world *world;
  sprout_arena *scratch;
  sprout_refusal *refusal;
  sprout_inflater inflater;
  unsigned char *block; /* the body, or its preamble alone for a peek, in the world's arena */
  size_t body_bytes, table_at;
  size_t wanted; /* bytes to inflate: the body's, or the preamble's for a peek */
  size_t filled;
  bool peek, done;
  char error[320];
} body_reader;

/*
 * Begins a body's reader over the compressed `body` held whole, or over what
 * `source` gives when it is not NULL, its state in `scratch`.
 */
static sprout_status begin_body(body_reader **out, sprout_world *world, sprout_arena *scratch,
                                const unsigned char *body, size_t body_length, const sprout_source *source,
                                size_t body_bytes, size_t table_at, sprout_refusal *refusal, bool peek) {
  sprout_status inflating;
  body_reader *b = (body_reader *)sprout_arena_take(scratch, sizeof *b);
  const char *why = NULL;
  *out = NULL;
  if (b == NULL) return SPROUT_NO_MEMORY;
  memset(b, 0, sizeof *b);
  b->world = world;
  b->scratch = scratch;
  b->refusal = refusal;
  b->peek = peek;
  b->body_bytes = body_bytes;
  b->table_at = table_at;
  b->wanted = peek ? table_at : body_bytes;
  if (table_at > body_bytes || table_at % 8 != 0) {
    say(refusal, NOT_SIZED, NULL, NULL, NULL, NULL);
    return SPROUT_BAD_INPUT;
  }
  if (source == NULL) {
    inflating = sprout_inflate_begin(&b->inflater, body, body_length, &why);
  } else {
    unsigned char *piece = (unsigned char *)sprout_arena_take_aligned(scratch, PIECE_BYTES, 1);
    if (piece == NULL) return SPROUT_NO_MEMORY;
    inflating = sprout_inflate_begin_source(&b->inflater, source, piece, PIECE_BYTES, &why);
  }
  if (inflating != SPROUT_OK) {
    say(refusal, "This cartridge cannot be read: ", why, ".", NULL, NULL);
    return SPROUT_BAD_INPUT;
  }
  b->block = (unsigned char *)sprout_arena_take(&world->arena, b->wanted == 0 ? 1 : b->wanted);
  if (b->block == NULL) return SPROUT_NO_MEMORY;
  *out = b;
  return SPROUT_OK;
}

/* The preamble, a JSON object, read from the block into scratch; `*root` set. */
static sprout_status read_preamble(body_reader *b, sprout_json **root) {
  size_t length = b->table_at;
  sprout_json_error json_error;
  sprout_status status;
  while (length > 0 && b->block[length - 1] == '\0') length--;
  status = sprout_json_read(b->scratch, (const char *)b->block, length, root, &json_error);
  if (status == SPROUT_BAD_INPUT) {
    say(b->refusal, "This cartridge cannot be read: its preamble is not JSON.", NULL, NULL, NULL, NULL);
    return status;
  }
  if (status != SPROUT_OK) return status;
  if ((*root)->kind != SPROUT_JSON_OBJECT) {
    say(b->refusal, "This cartridge is not shaped as a cartridge is: its preamble is not an object.", NULL, NULL, NULL,
        NULL);
    return SPROUT_BAD_INPUT;
  }
  return SPROUT_OK;
}

/* Everything after the inflate: the preamble, the table (not for a peek) and the catalogue. */
static sprout_status read_body(body_reader *b) {
  sprout_json *root;
  sprout_status status = read_preamble(b, &root);
  if (status != SPROUT_OK) return status;
  b->error[0] = '\0';
  if (b->peek) {
    status = sprout_catalogue_peek(b->world, root, b->error, sizeof b->error);
    if (status == SPROUT_BAD_INPUT) say(b->refusal, b->error, NULL, NULL, NULL, NULL);
    return status;
  }
  {
    const sprout_json *table = sprout_json_get(root, "table");
    const sprout_json *files = table == NULL || table->kind != SPROUT_JSON_OBJECT ? NULL : sprout_json_get(table, "files");
    if (files == NULL) {
      say(b->refusal, "This cartridge is not shaped as a cartridge is at `table.files`: it is not what a cartridge holds there.",
          NULL, NULL, NULL, NULL);
      return SPROUT_BAD_INPUT;
    }
    status = sprout_graph_map(&b->world->graph, b->block + b->table_at, b->body_bytes - b->table_at, &b->world->arena,
                              files, b->error, sizeof b->error);
    if (status == SPROUT_BAD_INPUT) say(b->refusal, "This cartridge is not shaped as a cartridge is: ", b->error, NULL, NULL, NULL);
    if (status != SPROUT_OK) return status;
  }
  status = sprout_catalogue_build(b->world, root, b->scratch, b->error, sizeof b->error);
  if (status == SPROUT_BAD_INPUT) say(b->refusal, b->error, NULL, NULL, NULL, NULL);
  return status;
}

/* Inflates up to `budget` more bytes of the body; reads the body once it is whole. */
static sprout_status body_step(body_reader *b, size_t budget) {
  const char *why = NULL;
  while (!b->done && budget > 0 && b->filled < b->wanted) {
    size_t cap = b->wanted - b->filled, got = 0;
    if (cap > budget) cap = budget;
    if (sprout_inflate_next(&b->inflater, b->block + b->filled, cap, &got, &why) != SPROUT_OK) {
      say(b->refusal, "This cartridge cannot be read: ", why, ".", NULL, NULL);
      return SPROUT_BAD_INPUT;
    }
    b->filled += got;
    budget -= got;
    if (got == 0 && !sprout_inflate_done(&b->inflater)) break;
    if (got == 0 || (sprout_inflate_done(&b->inflater) && b->filled < b->wanted)) {
      say(b->refusal, NOT_SIZED, NULL, NULL, NULL, NULL);
      return SPROUT_BAD_INPUT;
    }
  }
  if (b->done || b->filled < b->wanted) return SPROUT_OK;
  if (!b->peek) {
    /* The body ends where the header says: one more byte, or fewer, is a damaged cartridge. */
    size_t got = 0;
    unsigned char spare;
    if (sprout_inflate_next(&b->inflater, &spare, 1, &got, &why) != SPROUT_OK) {
      say(b->refusal, "This cartridge cannot be read: ", why, ".", NULL, NULL);
      return SPROUT_BAD_INPUT;
    }
    if (got != 0 || !sprout_inflate_done(&b->inflater)) {
      say(b->refusal, NOT_SIZED, NULL, NULL, NULL, NULL);
      return SPROUT_BAD_INPUT;
    }
  }
  b->done = true;
  return read_body(b);
}

/* ---- the load ---- */

struct sprout_loading {
  sprout_arena scratch; /* holds this record, the reader and everything the load alone needs */
  sprout_world *world;
  body_reader *reader;
  sprout_refusal refusal;
  bool done;
};

/* The world record in its own arena, the header's format and level checked. */
static sprout_status begin_world(const sprout_host *host, const unsigned char *header, size_t length,
                                 sprout_world **out, size_t *body_bytes, size_t *table_at, sprout_refusal *refusal) {
  sprout_arena boot;
  sprout_world *world;
  sprout_status status;
  long format, level;
  *out = NULL;
  status = sprout_arena_init(&boot, host);
  if (status != SPROUT_OK) return status;
  if (header == NULL) length = 0;
  status = sprout_cartridge_check_header(header, length, &format, &level, body_bytes, table_at, refusal);
  if (status != SPROUT_OK) return status;
  world = (sprout_world *)sprout_arena_take(&boot, sizeof *world);
  if (world == NULL) {
    sprout_arena_reset(&boot);
    return SPROUT_NO_MEMORY;
  }
  memset(world, 0, sizeof *world);
  world->host = *host;
  world->arena = boot;
  world->arena.host = &world->host;
  world->format = format;
  world->level = level;
  *out = world;
  return SPROUT_OK;
}

/* As many of the cartridge's first bytes as its header is, read from `source`; false when the source failed. */
static bool read_header(const sprout_source *source, unsigned char *header, size_t *length) {
  *length = 0;
  while (*length < SPROUT_CARTRIDGE_HEADER_BYTES) {
    size_t got = 0;
    if (!source->read(source->ctx, header + *length, SPROUT_CARTRIDGE_HEADER_BYTES - *length, &got)) return false;
    if (got == 0) break;
    *length += got;
  }
  return true;
}

/* Begins a load of the cartridge held whole in `cartridge`, or read from `source` when it is not NULL. */
static sprout_status begin_load(const sprout_host *host, const char *cartridge, size_t length,
                                const sprout_source *source, sprout_loading **out, sprout_refusal *refusal, bool peek) {
  sprout_arena scratch;
  sprout_loading *loading;
  sprout_world *world;
  sprout_status status;
  unsigned char header[SPROUT_CARTRIDGE_HEADER_BYTES];
  const unsigned char *head = (const unsigned char *)cartridge;
  size_t head_length = length, body_bytes = 0, table_at = 0;
  if (out != NULL) *out = NULL;
  if (refusal != NULL) refusal->text[0] = '\0';
  if (host == NULL || out == NULL || (source != NULL && source->read == NULL)) return SPROUT_BAD_HOST;
  if (source != NULL) {
    if (!read_header(source, header, &head_length)) {
      say(refusal, UNREAD, NULL, NULL, NULL, NULL);
      return SPROUT_BAD_INPUT;
    }
    head = header;
  }
  status = begin_world(host, head, head_length, &world, &body_bytes, &table_at, refusal);
  if (status == SPROUT_NO_MEMORY) say(refusal, sprout_status_text(status), NULL, NULL, NULL, NULL);
  if (status != SPROUT_OK) return status;
  sprout_arena_init(&scratch, &world->host);
  loading = (sprout_loading *)sprout_arena_take(&scratch, sizeof *loading);
  if (loading == NULL) {
    sprout_arena_reset(&scratch);
    sprout_world_free(world);
    say(refusal, sprout_status_text(SPROUT_NO_MEMORY), NULL, NULL, NULL, NULL);
    return SPROUT_NO_MEMORY;
  }
  memset(loading, 0, sizeof *loading);
  loading->scratch = scratch;
  loading->world = world;
  status = begin_body(&loading->reader, world, &loading->scratch,
                      source != NULL ? NULL : (const unsigned char *)cartridge + SPROUT_CARTRIDGE_HEADER_BYTES,
                      source != NULL ? 0 : length - SPROUT_CARTRIDGE_HEADER_BYTES, source, body_bytes, table_at,
                      &loading->refusal, peek);
  if (status != SPROUT_OK) {
    if (refusal != NULL) *refusal = loading->refusal;
    if (status == SPROUT_NO_MEMORY) say(refusal, sprout_status_text(status), NULL, NULL, NULL, NULL);
    sprout_load_abandon(loading);
    return status;
  }
  *out = loading;
  return SPROUT_OK;
}

sprout_status sprout_load_begin(const sprout_host *host, const sprout_source *source, sprout_loading **loading,
                                sprout_refusal *refusal) {
  if (source == NULL) return SPROUT_BAD_HOST;
  return begin_load(host, NULL, 0, source, loading, refusal, false);
}

sprout_status sprout_load_step(sprout_loading *loading, size_t budget, bool *done, sprout_refusal *refusal) {
  sprout_status status;
  if (done != NULL) *done = false;
  if (refusal != NULL) refusal->text[0] = '\0';
  if (loading == NULL) return SPROUT_BAD_HOST;
  if (loading->done) {
    if (done != NULL) *done = true;
    return SPROUT_OK;
  }
  status = body_step(loading->reader, budget);
  if (status != SPROUT_OK) {
    if (status == SPROUT_NO_MEMORY) say(&loading->refusal, sprout_status_text(status), NULL, NULL, NULL, NULL);
    if (refusal != NULL) *refusal = loading->refusal;
    sprout_load_abandon(loading);
    return status;
  }
  loading->done = loading->reader->done;
  if (done != NULL) *done = loading->done;
  return SPROUT_OK;
}

void sprout_load_progress(const sprout_loading *loading, size_t *read, size_t *counted) {
  const body_reader *b = loading == NULL ? NULL : loading->reader;
  *read = b == NULL ? 0 : b->filled;
  *counted = b == NULL ? 0 : b->wanted;
}

sprout_world *sprout_load_finish(sprout_loading *loading) {
  sprout_arena scratch;
  sprout_world *world;
  if (loading == NULL || !loading->done) return NULL;
  world = loading->world;
  scratch = loading->scratch;
  sprout_arena_reset(&scratch);
  return world;
}

void sprout_load_abandon(sprout_loading *loading) {
  sprout_arena scratch;
  sprout_world *world;
  if (loading == NULL) return;
  world = loading->world;
  scratch = loading->scratch;
  sprout_arena_reset(&scratch);
  sprout_world_free(world);
}

/* A load whole, in one call: begin, every step, finish. */
static sprout_status load_whole(const sprout_host *host, const char *cartridge, size_t length,
                                sprout_world **out, sprout_refusal *refusal, bool peek) {
  sprout_loading *loading;
  sprout_status status;
  bool done = false;
  if (out != NULL) *out = NULL;
  status = begin_load(host, cartridge, length, NULL, &loading, refusal, peek);
  if (status != SPROUT_OK) return status;
  status = sprout_load_step(loading, (size_t)-1, &done, refusal);
  if (status != SPROUT_OK) return status;
  *out = sprout_load_finish(loading);
  return SPROUT_OK;
}

sprout_status sprout_peek(const sprout_host *host, const char *cartridge, size_t length, sprout_world **world,
                          sprout_refusal *refusal) {
  return load_whole(host, cartridge, length, world, refusal, true);
}

bool sprout_world_peeked(const sprout_world *world) { return world != NULL && world->peeked; }

sprout_status sprout_load_explained(const sprout_host *host, const char *cartridge, size_t length,
                                    sprout_world **out, sprout_refusal *refusal) {
  return load_whole(host, cartridge, length, out, refusal, false);
}

sprout_status sprout_load(const sprout_host *host, const char *cartridge, size_t length,
                          sprout_world **world) {
  return sprout_load_explained(host, cartridge, length, world, NULL);
}

void sprout_world_free(sprout_world *world) {
  sprout_arena arena;
  sprout_host host;
  if (world == NULL) return;
  /* The world and its host record live in the arena being released, so the release goes through copies. */
  host = world->host;
  arena = world->arena;
  arena.host = &host;
  sprout_arena_reset(&arena);
}
