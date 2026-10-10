/*
 * Loading a cartridge (the spec's The compiler > What compiling produces;
 * Language levels): the sixteen header bytes are checked and the body
 * inflated, its JSON read and its graph and catalogue built into the world's
 * own load arena. The host's code is not in a cartridge, so the extensions it
 * pins are only recorded. Nothing is parsed or checked beyond the shape: a
 * cartridge holds a world that published.
 */
#include "cartridge.h"

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
  if (*level > SPROUT_LANGUAGE_LEVEL) {
    say(refusal, "This cartridge was made for language level ", decimal(*level, number),
        ", and this runtime reads up to level ", decimal(SPROUT_LANGUAGE_LEVEL, limit),
        ". Update the runtime, or pack the world again with this one.");
    return SPROUT_BAD_INPUT;
  }
  return SPROUT_OK;
}

static const sprout_json *entries_of(const sprout_json *root, const char *section) {
  const sprout_json *s = sprout_json_get(root, section);
  return s == NULL ? NULL : sprout_json_get(s, "entries");
}

/* Reads the body into `world`; on a refusal, says why. */
static sprout_status read_body(sprout_world *world, sprout_arena *scratch,
                               const unsigned char *body, size_t body_length,
                               sprout_refusal *refusal) {
  char *text;
  size_t text_length;
  const char *why = NULL;
  sprout_json *root;
  sprout_json_error json_error;
  const sprout_json *table, *files;
  char error[320];
  sprout_status status = sprout_gunzip(scratch, body, body_length, &text, &text_length, &why);
  if (status == SPROUT_BAD_INPUT) {
    say(refusal, "This cartridge cannot be read: ", why, ".", NULL, NULL);
    return status;
  }
  if (status != SPROUT_OK) return status;
  /* The tree stays in the world's arena: names and text in the graph point into it. */
  status = sprout_json_read(&world->arena, text, text_length, &root, &json_error);
  if (status == SPROUT_BAD_INPUT) {
    say(refusal, "This cartridge cannot be read: its body is not JSON.", NULL, NULL, NULL, NULL);
    return status;
  }
  if (status != SPROUT_OK) return status;
  if (root->kind != SPROUT_JSON_OBJECT) {
    say(refusal, "This cartridge is not shaped as a cartridge is: its body is not an object.", NULL,
        NULL, NULL, NULL);
    return SPROUT_BAD_INPUT;
  }
  table = sprout_json_get(root, "table");
  files = table == NULL ? NULL : sprout_json_get(table, "files");
  if (files == NULL || entries_of(root, "prose") == NULL || entries_of(root, "bodies") == NULL ||
      entries_of(root, "table") == NULL) {
    say(refusal,
        "This cartridge is not shaped as a cartridge is at `table`: it is missing the entries it refers to.",
        NULL, NULL, NULL, NULL);
    return SPROUT_BAD_INPUT;
  }
  error[0] = '\0';
  status = sprout_graph_read(&world->arena, files, entries_of(root, "prose"),
                             entries_of(root, "bodies"), entries_of(root, "table"), &world->graph,
                             error, sizeof error);
  if (status == SPROUT_BAD_INPUT) {
    say(refusal, "This cartridge is not shaped as a cartridge is: ", error, NULL, NULL, NULL);
    return status;
  }
  if (status != SPROUT_OK) return status;
  error[0] = '\0';
  status = sprout_catalogue_build(world, root, error, sizeof error);
  if (status == SPROUT_BAD_INPUT) say(refusal, error, NULL, NULL, NULL, NULL);
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
