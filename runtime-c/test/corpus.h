/*
 * The corpus as the C tests use it: every `corpus/good` world packed as a
 * cartridge (the CMake setup test packs them under SPROUT_CARTRIDGES), and
 * `corpus/goldens/catalogues.json`, the dump the TypeScript catalogue spec
 * writes of what each world declares.
 */
#ifndef SPROUT_TEST_CORPUS_H
#define SPROUT_TEST_CORPUS_H

#include "check.h"
#include "json.h"
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

/* The dump of every corpus world's catalogue, read into `arena`. */
static inline const sprout_json *corpus_dump(sprout_arena *arena) {
  size_t length;
  char *text = test_golden("catalogues.json", &length);
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
