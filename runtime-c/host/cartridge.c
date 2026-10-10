/* The cartridge's prefix and header section, read for the desktop host; see cartridge.h. */
#include "cartridge.h"

#include <stdlib.h>
#include <string.h>

#include "arena.h"
#include "inflate.h"
#include "json.h"

const char *sproutc_cartridge_prefix(const unsigned char *bytes, size_t length, unsigned *format,
                                     unsigned *level) {
  if (length < SPROUTC_CARTRIDGE_HEADER_BYTES || memcmp(bytes, "SPRT", 4) != 0)
    return "this is not a Sprout cartridge: it does not begin with `SPRT`. Pack a world with `sprout pack`.";
  *format = (unsigned)(bytes[4] | (bytes[5] << 8));
  *level = (unsigned)(bytes[6] | (bytes[7] << 8));
  if (*format < 1) return "this cartridge says it is format version 0, and versions begin at 1. It is damaged.";
  return NULL;
}

static const char *text_of(const sprout_json *object, const char *key) {
  const sprout_json *member = sprout_json_get(object, key);
  return member != NULL && member->kind == SPROUT_JSON_STRING ? member->bytes : "";
}

const char *sproutc_cartridge_describe(FILE *out, const sprout_host *host, const unsigned char *bytes,
                                       size_t length) {
  unsigned format, level;
  const char *why = sproutc_cartridge_prefix(bytes, length, &format, &level);
  char *json = NULL;
  size_t json_length = 0;
  sprout_arena arena;
  sprout_json *root = NULL;
  sprout_json_error error;
  const sprout_json *header, *files, *libraries;
  size_t i;
  static char problem[160];

  if (why != NULL) return why;
  why = sproutc_gunzip(bytes + SPROUTC_CARTRIDGE_HEADER_BYTES, length - SPROUTC_CARTRIDGE_HEADER_BYTES,
                       &json, &json_length);
  if (why != NULL) return why;
  if (sprout_arena_init(&arena, host) != SPROUT_OK) {
    free(json);
    return "the host record cannot give the reader memory.";
  }
  if (sprout_json_read(&arena, json, json_length, &root, &error) != SPROUT_OK) {
    snprintf(problem, sizeof problem, "the cartridge's JSON would not read, at line %zu, column %zu: %s",
             error.line, error.column, error.text);
    sprout_arena_reset(&arena);
    free(json);
    return problem;
  }
  header = root != NULL && root->kind == SPROUT_JSON_OBJECT ? sprout_json_get(root, "header") : NULL;
  if (header == NULL || header->kind != SPROUT_JSON_OBJECT) {
    sprout_arena_reset(&arena);
    free(json);
    return "the cartridge has no `header` section: it is damaged, or not from `sprout pack`.";
  }
  fprintf(out, "cartridge format: %u\n", format);
  fprintf(out, "language level: %u\n", level);
  fprintf(out, "name: %s\n", text_of(header, "name"));
  fprintf(out, "namespace: %s\n", text_of(header, "namespace"));
  fprintf(out, "version: %s\n", text_of(header, "version"));
  fprintf(out, "author: %s\n", text_of(header, "author"));
  fprintf(out, "license: %s\n", text_of(header, "license"));
  fprintf(out, "hash: %s\n", text_of(header, "hash"));
  files = sprout_json_get(header, "files");
  fprintf(out, "files: %zu\n", files != NULL ? files->count : (size_t)0);
  for (i = 0; files != NULL && i < files->count; i++)
    fprintf(out, "  %s\n", files->items[i]->kind == SPROUT_JSON_STRING ? files->items[i]->bytes : "");
  libraries = sprout_json_get(header, "libraries");
  fprintf(out, "libraries: %zu\n", libraries != NULL ? libraries->count : (size_t)0);
  for (i = 0; libraries != NULL && i < libraries->count; i++) {
    const sprout_json *one = libraries->items[i];
    fprintf(out, "  %s %s %s\n", text_of(one, "name"), text_of(one, "version"), text_of(one, "sha"));
  }
  sprout_arena_reset(&arena);
  free(json);
  return NULL;
}
