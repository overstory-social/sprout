/*
 * The corpus as the C tests use it: every `corpus/good` world packed as a
 * cartridge (the CMake setup test packs them under SPROUT_CARTRIDGES), and
 * `catalogues.json` beside them, the dump of what each world declares as the
 * language reads it back from the cartridge, written by the setup's
 * `dump-catalogues.mjs` each run and never committed.
 */
#ifndef SPROUT_TEST_CORPUS_H
#define SPROUT_TEST_CORPUS_H

#include "check.h"
#include "inflate.h"
#include "json.h"
#include "load.h"
#include "world.h"

/* A host with 64 KiB pages, so loading a whole cartridge is not a thousand allocations. */
static inline sprout_host corpus_host(test_heap *heap) {
  sprout_host host = test_host(heap);
  host.page_bytes = 65536;
  return host;
}

/* The bytes of a file, malloc'd and NUL-terminated; the test aborts if it is missing. */
static inline char *corpus_read(const char *path, size_t *length) {
  FILE *file = fopen(path, "rb");
  char *bytes;
  long size;
  if (file == NULL) {
    fprintf(stderr, "cannot open %s\n", path);
    exit(2);
  }
  fseek(file, 0, SEEK_END);
  size = ftell(file);
  fseek(file, 0, SEEK_SET);
  bytes = (char *)malloc((size_t)size + 1);
  if (bytes == NULL || fread(bytes, 1, (size_t)size, file) != (size_t)size) exit(2);
  bytes[size] = '\0';
  fclose(file);
  *length = (size_t)size;
  return bytes;
}

/* The packed cartridge of a corpus world, malloc'd. */
static inline char *corpus_cartridge(const char *name, size_t *length) {
  char path[1024];
  snprintf(path, sizeof path, "%s/%s.sproutworld", SPROUT_CARTRIDGES, name);
  return corpus_read(path, length);
}

/* The inflated body of a corpus world's cartridge in `arena`, its size and where its table begins, as its header says. */
static inline unsigned char *corpus_body(sprout_arena *arena, const char *name, size_t *length, size_t *table_at) {
  size_t packed_length, body_length = 0;
  char *packed = corpus_cartridge(name, &packed_length);
  char *body = NULL;
  const char *why = NULL;
  sprout_cartridge_layout layout;
  sprout_refusal refusal;
  CHECK_INT(sprout_cartridge_check_header((const unsigned char *)packed, packed_length, &layout, &refusal), SPROUT_OK);
  *length = layout.body_bytes;
  *table_at = layout.table_at;
  CHECK_INT(sprout_gunzip(arena, (const unsigned char *)packed + SPROUT_CARTRIDGE_HEADER_BYTES,
                          layout.assets_at - SPROUT_CARTRIDGE_HEADER_BYTES, &body, &body_length, &why),
            SPROUT_OK);
  CHECK_INT(body_length, *length);
  free(packed);
  return (unsigned char *)body;
}

/* The language's dump of every corpus world's catalogue, read into `arena`. */
static inline const sprout_json *corpus_dump(sprout_arena *arena) {
  size_t length;
  char *text = corpus_read(SPROUT_CARTRIDGES "/catalogues.json", &length);
  sprout_json *root = NULL;
  sprout_json_error error;
  if (sprout_json_read(arena, text, length, &root, &error) != SPROUT_OK) {
    fprintf(stderr, "catalogues.json: %s\n", error.text);
    exit(2);
  }
  free(text);
  return root;
}

/* Loads a corpus world's cartridge; the test aborts if it does not load. */
static inline sprout_world *corpus_load(const char *name, const sprout_host *host) {
  size_t length;
  char *bytes = corpus_cartridge(name, &length);
  sprout_world *world = NULL;
  sprout_refusal why;
  sprout_status status = sprout_load_explained(host, bytes, length, &world, &why);
  free(bytes);
  if (status != SPROUT_OK) {
    fprintf(stderr, "%s did not load: %s\n", name, why.text);
    exit(2);
  }
  return world;
}

/* A member's value as canonical text: the writer prints a member with its key in front, which is dropped. */
static inline void corpus_value_text(sprout_arena *arena, const sprout_json *member, const char **text,
                                     size_t *length) {
  const char *all;
  size_t all_length;
  const char *colon;
  if (sprout_json_write(arena, member, &all, &all_length) != SPROUT_OK) exit(2);
  colon = (const char *)memchr(all, ':', all_length);
  *text = colon + 1;
  *length = all_length - (size_t)(colon + 1 - all);
}

/* A member of an object by name, or NULL. */
static inline const sprout_json *corpus_get(const sprout_json *object, const char *key) {
  return sprout_json_get(object, key);
}

#endif
