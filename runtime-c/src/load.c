/*
 * Loading a cartridge (the spec's The compiler > What compiling produces;
 * Language levels): the sixteen header bytes are checked and the body read
 * as a stream, its small sections into JSON trees in the load's scratch and
 * its table of entries one entry at a time into the graph, so the body is
 * never whole in memory; then the catalogue is built into the world's own
 * load arena and the scratch is released. The host's code is not in a
 * cartridge, so the extensions it pins are only recorded. Nothing is parsed
 * or checked beyond the shape: a cartridge holds a world that published.
 */
#include "load.h"

#include <string.h>

#include "catalogue_build.h"
#include "stream.h"

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
  for (i = 0; i < 5; i++) {
    size_t n = parts[i] == NULL ? 0 : strlen(parts[i]);
    if (used + n >= sizeof refusal->text) n = sizeof refusal->text - 1 - used;
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

sprout_status sprout_cartridge_check_header(const unsigned char *bytes, size_t length, long *format,
                                      long *level, sprout_refusal *refusal) {
  char number[24], limit[24];
  if (length < SPROUT_CARTRIDGE_HEADER_BYTES || memcmp(bytes, SPROUT_CARTRIDGE_MAGIC, 4) != 0) {
    say(refusal,
        "This is not a Sprout cartridge: it does not begin with `SPRT`. Pack a world with `sprout pack`.",
        NULL, NULL, NULL, NULL);
    return SPROUT_BAD_INPUT;
  }
  *format = (long)bytes[4] | ((long)bytes[5] << 8);
  *level = (long)bytes[6] | ((long)bytes[7] << 8);
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

/* The sections whose `entries` are the graph's three runs, in the order the runs are numbered. */
static const char *const RUNS[3] = {"prose", "bodies", "table"};

#define NOT_JSON "This cartridge cannot be read: its body is not JSON."

/* The state of one body being read. */
typedef struct body_reader {
  sprout_world *world;
  sprout_arena *scratch;
  sprout_stream stream;
  sprout_json *root;
  sprout_graph_reader graph;
  bool counted, begun;
  size_t counts[3];
  size_t run; /* the next run whose entries may come */
  char error[320];
  sprout_refusal *refusal;
} body_reader;

/* A refusal naming what the stream could not read, or NOT_JSON when the text itself was wrong. */
static sprout_status unreadable(body_reader *b) {
  if (b->stream.why != NULL) say(b->refusal, "This cartridge cannot be read: ", b->stream.why, ".", NULL, NULL);
  else say(b->refusal, NOT_JSON, NULL, NULL, NULL, NULL);
  return SPROUT_BAD_INPUT;
}

static sprout_status shaped(body_reader *b, const char *where) {
  say(b->refusal, "This cartridge is not shaped as a cartridge is at `", where,
      "`: it is not what a cartridge holds there.", NULL, NULL);
  return SPROUT_BAD_INPUT;
}

/* Reads the next value of the stream as a JSON tree in `arena`. */
static sprout_status read_value(body_reader *b, sprout_arena *arena, sprout_json **value) {
  char *text;
  size_t length;
  sprout_json_error json_error;
  sprout_status status = sprout_stream_capture(&b->stream, arena, &text, &length);
  if (status == SPROUT_BAD_INPUT) return unreadable(b);
  if (status != SPROUT_OK) return status;
  status = sprout_json_read(arena, text, length, value, &json_error);
  if (status == SPROUT_BAD_INPUT) return unreadable(b);
  return status;
}

/* Reads a member's name into `key`, with the comma before it where one is due. */
static sprout_status read_key(body_reader *b, bool first, char *key, size_t cap) {
  sprout_status status;
  if (!first && !sprout_stream_take(&b->stream, ',')) return unreadable(b);
  status = sprout_stream_key(&b->stream, key, cap);
  if (status == SPROUT_BAD_INPUT) return unreadable(b);
  if (status != SPROUT_OK) return status;
  if (!sprout_stream_take(&b->stream, ':')) return unreadable(b);
  return SPROUT_OK;
}

/* Reads a member's value as a tree into `parent`, under the key `name`, copied. */
static sprout_status read_member(body_reader *b, sprout_json *parent, const char *name) {
  sprout_json *value;
  const char *key = sprout_arena_copy(b->scratch, name, strlen(name));
  sprout_status status;
  if (key == NULL) return SPROUT_NO_MEMORY;
  status = read_value(b, b->scratch, &value);
  if (status != SPROUT_OK) return status;
  sprout_json_adopt(parent, key, value);
  return parent->count == 0 ? SPROUT_NO_MEMORY : SPROUT_OK;
}

/*
 * Takes the opening bracket `open` of the value at `where`: a value of another shape is said
 * to be not what a cartridge holds there, and a text that ends or breaks is unreadable.
 */
static sprout_status read_opening_of(body_reader *b, int open, const char *where) {
  int c;
  if (sprout_stream_take(&b->stream, open)) return SPROUT_OK;
  c = sprout_stream_peek(&b->stream);
  if (c < 0) return unreadable(b);
  return shaped(b, where);
}

/* The counts the header gives of the three runs, which the graph needs before its first entry. */
static sprout_status read_counts(body_reader *b) {
  const sprout_json *header = sprout_json_get(b->root, "header");
  const sprout_json *counts = header == NULL ? NULL : sprout_json_get(header, "counts");
  size_t i;
  if (counts == NULL || counts->kind != SPROUT_JSON_OBJECT) return shaped(b, "header.counts");
  for (i = 0; i < 3; i++) {
    const sprout_json *count = sprout_json_get(counts, RUNS[i]);
    /* A count is a whole number the graph can hold; the reader has refused a fraction already. */
    if (count == NULL || count->kind != SPROUT_JSON_NUMBER || count->number < 0 ||
        count->number >= (double)SPROUT_NOT_AN_ENTRY)
      return shaped(b, "header.counts");
    b->counts[i] = (size_t)count->number;
  }
  b->counted = true;
  return SPROUT_OK;
}

/* Reads a run's entries, each captured into a scratch of its own that is reset once the graph holds it. */
static sprout_status read_entries(body_reader *b, size_t run) {
  sprout_arena entry;
  sprout_status status = SPROUT_OK;
  bool first = true;
  if (!b->counted) {
    say(b->refusal, "This cartridge is not shaped as a cartridge is: its header does not come first.", NULL,
        NULL, NULL, NULL);
    return SPROUT_BAD_INPUT;
  }
  if (run != b->run) {
    say(b->refusal, "This cartridge is not shaped as a cartridge is: its entries are not in order.", NULL, NULL,
        NULL, NULL);
    return SPROUT_BAD_INPUT;
  }
  b->run++;
  if (!b->begun) {
    status = sprout_graph_begin(&b->graph, &b->world->graph, &b->world->arena, b->scratch, b->counts[0],
                                b->counts[1], b->counts[2], b->error, sizeof b->error);
    if (status != SPROUT_OK) goto graph_said;
    b->begun = true;
  }
  status = read_opening_of(b, '[', run == 0 ? "prose.entries" : run == 1 ? "bodies.entries" : "table.entries");
  if (status != SPROUT_OK) return status;
  status = sprout_arena_init(&entry, &b->world->host);
  if (status != SPROUT_OK) return status;
  for (;;) {
    sprout_json *value;
    if (sprout_stream_take(&b->stream, ']')) break;
    if (!first && !sprout_stream_take(&b->stream, ',')) {
      status = unreadable(b);
      break;
    }
    first = false;
    status = read_value(b, &entry, &value);
    if (status != SPROUT_OK) break;
    status = sprout_graph_fill(&b->graph, value);
    if (status != SPROUT_OK) {
      sprout_arena_reset(&entry);
      goto graph_said;
    }
    sprout_arena_reset(&entry);
  }
  sprout_arena_reset(&entry);
  return status;
graph_said:
  if (status == SPROUT_BAD_INPUT)
    say(b->refusal, "This cartridge is not shaped as a cartridge is: ", b->error, NULL, NULL, NULL);
  return status;
}

/* Reads one of the sections that hold a run of entries: its entries into the graph, the rest as a tree. */
static sprout_status read_run_section(body_reader *b, size_t run) {
  sprout_json *section = sprout_json_make(b->scratch, SPROUT_JSON_OBJECT, 4);
  char key[64];
  bool first = true;
  sprout_status status;
  if (section == NULL) return SPROUT_NO_MEMORY;
  sprout_json_adopt(b->root, RUNS[run], section);
  if (b->root->count == 0) return SPROUT_NO_MEMORY;
  status = read_opening_of(b, '{', RUNS[run]);
  if (status != SPROUT_OK) return status;
  for (;;) {
    if (sprout_stream_take(&b->stream, '}')) return SPROUT_OK;
    status = read_key(b, first, key, sizeof key);
    if (status != SPROUT_OK) return status;
    first = false;
    if (strcmp(key, "entries") == 0) status = read_entries(b, run);
    else status = read_member(b, section, key);
    if (status != SPROUT_OK) return status;
  }
}

/* Whether the body's first value is an object: a body that is not one is said so, and one that is not JSON at all likewise. */
static sprout_status read_opening(body_reader *b) {
  sprout_json *value;
  sprout_status status;
  if (sprout_stream_take(&b->stream, '{')) return SPROUT_OK;
  status = read_value(b, b->scratch, &value);
  if (status != SPROUT_OK) return status;
  if (!sprout_stream_ended(&b->stream)) return unreadable(b);
  say(b->refusal, "This cartridge is not shaped as a cartridge is: its body is not an object.", NULL, NULL, NULL,
      NULL);
  return SPROUT_BAD_INPUT;
}

static sprout_status read_body(sprout_world *world, sprout_arena *scratch,
                               const unsigned char *body, size_t body_length,
                               sprout_refusal *refusal) {
  body_reader *b = (body_reader *)sprout_arena_take(scratch, sizeof *b);
  const sprout_json *table;
  char key[64];
  bool first = true;
  sprout_status status;
  size_t run;
  if (b == NULL) return SPROUT_NO_MEMORY;
  memset(b, 0, sizeof *b);
  b->world = world;
  b->scratch = scratch;
  b->refusal = refusal;
  status = sprout_stream_begin(&b->stream, scratch, body, body_length);
  if (status == SPROUT_BAD_INPUT) return unreadable(b);
  if (status != SPROUT_OK) return status;
  b->root = sprout_json_make(scratch, SPROUT_JSON_OBJECT, 16);
  if (b->root == NULL) return SPROUT_NO_MEMORY;
  status = read_opening(b);
  if (status != SPROUT_OK) return status;
  for (;;) {
    if (sprout_stream_take(&b->stream, '}')) break;
    status = read_key(b, first, key, sizeof key);
    if (status != SPROUT_OK) return status;
    first = false;
    for (run = 0; run < 3; run++)
      if (strcmp(key, RUNS[run]) == 0) break;
    if (run < 3) {
      status = read_run_section(b, run);
    } else {
      status = read_member(b, b->root, key);
      if (status == SPROUT_OK && strcmp(key, "header") == 0) status = read_counts(b);
    }
    if (status != SPROUT_OK) return status;
  }
  if (!sprout_stream_ended(&b->stream)) return unreadable(b);
  table = sprout_json_get(b->root, "table");
  if (!b->begun || b->run < 3 || table == NULL || sprout_json_get(table, "files") == NULL) {
    say(refusal,
        "This cartridge is not shaped as a cartridge is at `table`: it is missing the entries it refers to.",
        NULL, NULL, NULL, NULL);
    return SPROUT_BAD_INPUT;
  }
  status = sprout_graph_end(&b->graph, sprout_json_get(table, "files"));
  if (status == SPROUT_BAD_INPUT) {
    say(refusal, "This cartridge is not shaped as a cartridge is: ", b->error, NULL, NULL, NULL);
    return status;
  }
  if (status != SPROUT_OK) return status;
  b->error[0] = '\0';
  status = sprout_catalogue_build(world, b->root, scratch, b->error, sizeof b->error);
  if (status == SPROUT_BAD_INPUT) say(refusal, b->error, NULL, NULL, NULL, NULL);
  return status;
}

sprout_status sprout_load_explained(const sprout_host *host, const char *cartridge, size_t length,
                                    sprout_world **out, sprout_refusal *refusal) {
  sprout_arena boot, scratch;
  sprout_world *world;
  sprout_status status;
  long format, level;
  if (out != NULL) *out = NULL;
  if (refusal != NULL) refusal->text[0] = '\0';
  if (host == NULL || out == NULL) return SPROUT_BAD_HOST;
  status = sprout_arena_init(&boot, host);
  if (status != SPROUT_OK) return status;
  if (cartridge == NULL) length = 0;
  status = sprout_cartridge_check_header((const unsigned char *)cartridge, length, &format, &level,
                                   refusal);
  if (status != SPROUT_OK) return status;
  world = (sprout_world *)sprout_arena_take(&boot, sizeof *world);
  if (world == NULL) {
    sprout_arena_reset(&boot);
    return SPROUT_NO_MEMORY;
  }
  world->host = *host;
  world->arena = boot;
  world->arena.host = &world->host;
  world->format = format;
  world->level = level;
  sprout_arena_init(&scratch, &world->host);
  status = read_body(world, &scratch, (const unsigned char *)cartridge + SPROUT_CARTRIDGE_HEADER_BYTES,
                     length - SPROUT_CARTRIDGE_HEADER_BYTES, refusal);
  sprout_arena_reset(&scratch);
  if (status != SPROUT_OK) {
    if (status == SPROUT_NO_MEMORY) say(refusal, sprout_status_text(status), NULL, NULL, NULL, NULL);
    sprout_world_free(world);
    return status;
  }
  *out = world;
  return SPROUT_OK;
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
