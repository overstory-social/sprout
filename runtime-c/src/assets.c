/* A cartridge's assets section; see assets.h. */
#include "assets.h"

#include <string.h>

static size_t word(const unsigned char *at) {
  return (size_t)at[0] | ((size_t)at[1] << 8) | ((size_t)at[2] << 16) | ((size_t)at[3] << 24);
}

bool sprout_assets_prefix(const unsigned char *prefix, size_t section_bytes, size_t *count, size_t *directory_bytes) {
  *count = word(prefix);
  *directory_bytes = word(prefix + 4);
  return section_bytes >= SPROUT_ASSETS_PREFIX_BYTES && *directory_bytes <= section_bytes - SPROUT_ASSETS_PREFIX_BYTES;
}

bool sprout_assets_find(const unsigned char *directory, size_t directory_bytes, size_t count, size_t section_bytes,
                        const char *path, size_t path_length, size_t *at, size_t *bytes) {
  size_t entry = 0, i;
  size_t files_from = SPROUT_ASSETS_PREFIX_BYTES + directory_bytes;
  for (i = 0; i < count; i++) {
    size_t length;
    if (directory_bytes - entry < 10) return false;
    length = (size_t)directory[entry + 8] | ((size_t)directory[entry + 9] << 8);
    if (directory_bytes - entry - 10 < length) return false;
    *at = word(directory + entry);
    *bytes = word(directory + entry + 4);
    if (*at < files_from || *at > section_bytes || *bytes > section_bytes - *at) return false;
    if (length == path_length && memcmp(directory + entry + 10, path, length) == 0) return true;
    entry += 10 + length;
  }
  return false;
}
