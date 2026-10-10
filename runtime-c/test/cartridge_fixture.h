/*
 * A cartridge built in memory for the host's tests: the sixteen bytes, then
 * the JSON in one stored deflate block inside a gzip frame. The host reads
 * stored, fixed and dynamic blocks alike (inflate.host.test.c pins the
 * dynamic one), so a test need not compress anything.
 */
#ifndef SPROUTC_CARTRIDGE_FIXTURE_H
#define SPROUTC_CARTRIDGE_FIXTURE_H

#include "check.h"
#include "inflate.h"

/* A header section with no body behind it: the empty-bodied cartridge. */
#define EMPTY_BODIED_JSON                                                                          \
  "{\"header\":{\"name\":\"bare\",\"namespace\":\"bare\",\"version\":\"1.2.3\",\"author\":\"Ines\","  \
  "\"license\":\"MIT\",\"level\":1,\"hash\":\"abc123\",\"files\":[\"bare.sprout\",\"room.sprout\"],"    \
  "\"libraries\":[{\"name\":\"sprout\",\"version\":\"0.1.0\",\"sha\":\"ff00\"}]}}"

static inline unsigned char *build_cartridge(const char *json, unsigned format, unsigned level,
                                             size_t *length) {
  size_t n = strlen(json), at = 0;
  unsigned long crc = sproutc_crc32((const unsigned char *)json, n);
  unsigned char *bytes = (unsigned char *)calloc(16 + 10 + 5 + n + 8, 1);
  if (bytes == NULL) exit(2);
  memcpy(bytes, "SPRT", 4);
  bytes[4] = (unsigned char)(format & 0xff);
  bytes[5] = (unsigned char)(format >> 8);
  bytes[6] = (unsigned char)(level & 0xff);
  bytes[7] = (unsigned char)(level >> 8);
  at = 16;
  bytes[at++] = 0x1f;
  bytes[at++] = 0x8b;
  bytes[at++] = 8;
  at += 7; /* flags, mtime, extra flags and os, all zero */
  bytes[at++] = 1; /* the last block, stored */
  bytes[at++] = (unsigned char)(n & 0xff);
  bytes[at++] = (unsigned char)(n >> 8);
  bytes[at++] = (unsigned char)(~n & 0xff);
  bytes[at++] = (unsigned char)((~n >> 8) & 0xff);
  memcpy(bytes + at, json, n);
  at += n;
  bytes[at++] = (unsigned char)(crc & 0xff);
  bytes[at++] = (unsigned char)((crc >> 8) & 0xff);
  bytes[at++] = (unsigned char)((crc >> 16) & 0xff);
  bytes[at++] = (unsigned char)((crc >> 24) & 0xff);
  bytes[at++] = (unsigned char)(n & 0xff);
  bytes[at++] = (unsigned char)((n >> 8) & 0xff);
  bytes[at++] = (unsigned char)((n >> 16) & 0xff);
  bytes[at++] = (unsigned char)((n >> 24) & 0xff);
  *length = at;
  return bytes;
}

#endif
