/*
 * A cartridge built in memory for the host's tests: the header's bytes, then
 * the preamble and a table of no nodes in one stored deflate block inside a gzip frame. The host reads
 * stored, fixed and dynamic blocks alike (inflate.host.test.c pins the
 * dynamic one), so a test need not compress anything.
 */
#ifndef SPROUTC_CARTRIDGE_FIXTURE_H
#define SPROUTC_CARTRIDGE_FIXTURE_H

#include "check.h"
#include "inflate.h"
#include "load.h"

/* A header section with no body behind it: the empty-bodied cartridge. */
#define EMPTY_BODIED_JSON                                                                          \
  "{\"header\":{\"name\":\"bare\",\"namespace\":\"bare\",\"version\":\"1.2.3\",\"author\":\"Ines\","  \
  "\"license\":\"MIT\",\"level\":1,\"hash\":\"abc123\",\"files\":[\"bare.sprout\",\"room.sprout\"],"    \
  "\"libraries\":[{\"name\":\"sprout\",\"version\":\"0.1.0\",\"sha\":\"ff00\"}]}}"

/* A table of no nodes: its counts, then the one string offset and the one shape offset, each padded. */
static const unsigned char FIXTURE_EMPTY_TABLE[64] = {'T', 'B', 'L', '4'};

/* The header, then `json` as the preamble (padded to eight) and a table of no nodes, as one stored gzip member, and no assets. */
static inline unsigned char *build_cartridge(const char *json, unsigned format, unsigned level,
                                             size_t *length) {
  size_t text = strlen(json), table_at = (text + 7) & ~(size_t)7, n = table_at + sizeof FIXTURE_EMPTY_TABLE, at = 0;
  unsigned char *body = (unsigned char *)calloc(n, 1);
  unsigned char *bytes = (unsigned char *)calloc(SPROUT_CARTRIDGE_HEADER_BYTES + 10 + 5 + n + 8, 1);
  unsigned long crc;
  if (bytes == NULL || body == NULL) exit(2);
  memcpy(body, json, text);
  memcpy(body + table_at, FIXTURE_EMPTY_TABLE, sizeof FIXTURE_EMPTY_TABLE);
  crc = sprout_crc32(0, body, n);
  memcpy(bytes, "SPRT", 4);
  bytes[4] = (unsigned char)(format & 0xff);
  bytes[5] = (unsigned char)(format >> 8);
  bytes[6] = (unsigned char)(level & 0xff);
  bytes[7] = (unsigned char)(level >> 8);
  bytes[8] = (unsigned char)(n & 0xff), bytes[9] = (unsigned char)((n >> 8) & 0xff), bytes[10] = (unsigned char)((n >> 16) & 0xff),
  bytes[11] = (unsigned char)((n >> 24) & 0xff);
  bytes[12] = (unsigned char)(table_at & 0xff), bytes[13] = (unsigned char)((table_at >> 8) & 0xff),
  bytes[14] = (unsigned char)((table_at >> 16) & 0xff), bytes[15] = (unsigned char)((table_at >> 24) & 0xff);
  at = SPROUT_CARTRIDGE_HEADER_BYTES;
  bytes[at++] = 0x1f;
  bytes[at++] = 0x8b;
  bytes[at++] = 8;
  at += 7; /* flags, mtime, extra flags and os, all zero */
  bytes[at++] = 1; /* the last block, stored */
  bytes[at++] = (unsigned char)(n & 0xff);
  bytes[at++] = (unsigned char)(n >> 8);
  bytes[at++] = (unsigned char)(~n & 0xff);
  bytes[at++] = (unsigned char)((~n >> 8) & 0xff);
  memcpy(bytes + at, body, n);
  at += n;
  bytes[at++] = (unsigned char)(crc & 0xff);
  bytes[at++] = (unsigned char)((crc >> 8) & 0xff);
  bytes[at++] = (unsigned char)((crc >> 16) & 0xff);
  bytes[at++] = (unsigned char)((crc >> 24) & 0xff);
  bytes[at++] = (unsigned char)(n & 0xff);
  bytes[at++] = (unsigned char)((n >> 8) & 0xff);
  bytes[at++] = (unsigned char)((n >> 16) & 0xff);
  bytes[at++] = (unsigned char)((n >> 24) & 0xff);
  free(body);
  bytes[16] = (unsigned char)(at & 0xff), bytes[17] = (unsigned char)((at >> 8) & 0xff),
  bytes[18] = (unsigned char)((at >> 16) & 0xff), bytes[19] = (unsigned char)((at >> 24) & 0xff);
  *length = at;
  return bytes;
}

#endif
