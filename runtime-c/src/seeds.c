/*
 * SHA-256 and the seed of a tick's or a wake's turn (see seeds.h). The library calls nothing but
 * string.h, so the hash is written here, fed a piece at a time so a path of any length is hashed
 * without a buffer of its own.
 */
#include "seeds.h"

#include <string.h>

static const uint32_t ROUND[64] = {
    0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
    0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
    0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
    0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
    0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
    0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
    0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
    0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2};

static uint32_t rotate_right(uint32_t value, unsigned bits) { return (value >> bits) | (value << (32 - bits)); }

/* One 64-byte block folded into the state. */
static void compress(uint32_t state[8], const unsigned char block[64]) {
  uint32_t w[64], a, b, c, d, e, f, g, h;
  unsigned i;
  for (i = 0; i < 16; i++)
    w[i] = (uint32_t)block[4 * i] << 24 | (uint32_t)block[4 * i + 1] << 16 | (uint32_t)block[4 * i + 2] << 8 |
           (uint32_t)block[4 * i + 3];
  for (i = 16; i < 64; i++) {
    uint32_t s0 = rotate_right(w[i - 15], 7) ^ rotate_right(w[i - 15], 18) ^ (w[i - 15] >> 3);
    uint32_t s1 = rotate_right(w[i - 2], 17) ^ rotate_right(w[i - 2], 19) ^ (w[i - 2] >> 10);
    w[i] = w[i - 16] + s0 + w[i - 7] + s1;
  }
  a = state[0];
  b = state[1];
  c = state[2];
  d = state[3];
  e = state[4];
  f = state[5];
  g = state[6];
  h = state[7];
  for (i = 0; i < 64; i++) {
    uint32_t s1 = rotate_right(e, 6) ^ rotate_right(e, 11) ^ rotate_right(e, 25);
    uint32_t choose = (e & f) ^ (~e & g);
    uint32_t t1 = h + s1 + choose + ROUND[i] + w[i];
    uint32_t s0 = rotate_right(a, 2) ^ rotate_right(a, 13) ^ rotate_right(a, 22);
    uint32_t majority = (a & b) ^ (a & c) ^ (b & c);
    uint32_t t2 = s0 + majority;
    h = g;
    g = f;
    f = e;
    e = d + t1;
    d = c;
    c = b;
    b = a;
    a = t1 + t2;
  }
  state[0] += a;
  state[1] += b;
  state[2] += c;
  state[3] += d;
  state[4] += e;
  state[5] += f;
  state[6] += g;
  state[7] += h;
}

void sprout_sha256_begin(sprout_sha256_context *hash) {
  static const uint32_t START[8] = {0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a,
                                    0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19};
  memcpy(hash->state, START, sizeof START);
  hash->held = 0;
  hash->length = 0;
}

void sprout_sha256_feed(sprout_sha256_context *hash, const char *bytes, size_t length) {
  const unsigned char *at = (const unsigned char *)bytes;
  hash->length += length;
  while (length > 0) {
    size_t room = 64 - hash->held, take = length < room ? length : room;
    memcpy(hash->block + hash->held, at, take);
    hash->held += take;
    at += take;
    length -= take;
    if (hash->held == 64) {
      compress(hash->state, hash->block);
      hash->held = 0;
    }
  }
}

void sprout_sha256_end(sprout_sha256_context *hash, unsigned char digest[32]) {
  uint64_t bits = hash->length * 8;
  unsigned char tail[72];
  size_t pad = hash->held < 56 ? 56 - hash->held : 120 - hash->held, i;
  memset(tail, 0, sizeof tail);
  tail[0] = 0x80;
  sprout_sha256_feed(hash, (const char *)tail, pad);
  for (i = 0; i < 8; i++) tail[i] = (unsigned char)(bits >> (56 - 8 * i));
  sprout_sha256_feed(hash, (const char *)tail, 8);
  for (i = 0; i < 8; i++) {
    digest[4 * i] = (unsigned char)(hash->state[i] >> 24);
    digest[4 * i + 1] = (unsigned char)(hash->state[i] >> 16);
    digest[4 * i + 2] = (unsigned char)(hash->state[i] >> 8);
    digest[4 * i + 3] = (unsigned char)hash->state[i];
  }
}

void sprout_sha256(const char *bytes, size_t length, unsigned char digest[32]) {
  sprout_sha256_context hash;
  sprout_sha256_begin(&hash);
  sprout_sha256_feed(&hash, bytes, length);
  sprout_sha256_end(&hash, digest);
}

/* Feeds the decimal digits of `number`. */
static void feed_number(sprout_sha256_context *hash, uint64_t number) {
  char digits[24];
  size_t count = sizeof digits;
  do {
    digits[--count] = (char)('0' + (int)(number % 10));
    number /= 10;
  } while (number > 0);
  sprout_sha256_feed(hash, digits + count, sizeof digits - count);
}

uint32_t sprout_turn_seed(uint64_t seed, const char *path, size_t path_length, uint64_t nth) {
  sprout_sha256_context hash;
  unsigned char digest[32];
  sprout_sha256_begin(&hash);
  feed_number(&hash, seed);
  sprout_sha256_feed(&hash, " ", 1);
  sprout_sha256_feed(&hash, path, path_length);
  sprout_sha256_feed(&hash, " ", 1);
  feed_number(&hash, nth);
  sprout_sha256_end(&hash, digest);
  return (uint32_t)digest[0] << 24 | (uint32_t)digest[1] << 16 | (uint32_t)digest[2] << 8 | (uint32_t)digest[3];
}
