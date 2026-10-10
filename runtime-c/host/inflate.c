/* Gzip and deflate reader for the desktop host; see inflate.h. */
#include "inflate.h"

#include <stdlib.h>
#include <string.h>

#define MAX_BITS 15

typedef struct reader {
  const unsigned char *bytes;
  size_t length, position;
  unsigned long bits;
  int count;
  unsigned char *out;
  size_t out_length, out_capacity;
  const char *error;
} reader;

typedef struct huffman {
  unsigned short count[MAX_BITS + 1];
  unsigned short symbol[288];
} huffman;

static const unsigned short LENGTH_BASE[29] = {3,  4,  5,  6,  7,  8,  9,  10,  11,  13,
                                               15, 17, 19, 23, 27, 31, 35, 43,  51,  59,
                                               67, 83, 99, 115, 131, 163, 195, 227, 258};
static const unsigned short LENGTH_EXTRA[29] = {0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 2, 2,
                                                2, 2, 3, 3, 3, 3, 4, 4, 4, 4, 5, 5, 5, 5, 0};
static const unsigned short DISTANCE_BASE[30] = {
    1,   2,   3,   4,   5,   7,    9,    13,   17,   25,   33,   49,   65,    97,    129,
    193, 257, 385, 513, 769, 1025, 1537, 2049, 3073, 4097, 6145, 8193, 12289, 16385, 24577};
static const unsigned short DISTANCE_EXTRA[30] = {0, 0, 0, 0, 1, 1, 2, 2,  3,  3,  4,  4,  5,  5,  6,
                                                  6, 7, 7, 8, 8, 9, 9, 10, 10, 11, 11, 12, 12, 13, 13};
static const unsigned char CODE_LENGTH_ORDER[19] = {16, 17, 18, 0, 8, 7, 9, 6, 10, 5,
                                                    11, 4,  12, 3, 13, 2, 14, 1, 15};

unsigned long sproutc_crc32(const unsigned char *bytes, size_t length) {
  unsigned long crc = 0xffffffffUL;
  size_t i;
  int bit;
  for (i = 0; i < length; i++) {
    crc ^= bytes[i];
    for (bit = 0; bit < 8; bit++) crc = (crc >> 1) ^ (0xedb88320UL & (0UL - (crc & 1UL)));
  }
  return crc ^ 0xffffffffUL;
}

static int fail(reader *r, const char *why) {
  if (r->error == NULL) r->error = why;
  return -1;
}

static int take_bits(reader *r, int need) {
  unsigned long value = r->bits;
  while (r->count < need) {
    if (r->position >= r->length) return fail(r, "the compressed data ends before it should.");
    value |= (unsigned long)r->bytes[r->position++] << r->count;
    r->count += 8;
  }
  r->bits = value >> need;
  r->count -= need;
  return (int)(value & ((1UL << need) - 1));
}

static int emit(reader *r, unsigned char byte) {
  if (r->out_length == r->out_capacity) {
    size_t capacity = r->out_capacity == 0 ? 4096 : r->out_capacity * 2;
    unsigned char *grown = (unsigned char *)realloc(r->out, capacity);
    if (grown == NULL) return fail(r, "the host is out of memory.");
    r->out = grown;
    r->out_capacity = capacity;
  }
  r->out[r->out_length++] = byte;
  return 0;
}

/* Builds the decoding tables for code lengths; negative where the code is over-subscribed. */
static int construct(huffman *h, const unsigned short *lengths, int n) {
  int len, symbol, left = 1;
  unsigned short offsets[MAX_BITS + 1];
  for (len = 0; len <= MAX_BITS; len++) h->count[len] = 0;
  for (symbol = 0; symbol < n; symbol++) h->count[lengths[symbol]]++;
  if (h->count[0] == n) return 0;
  for (len = 1; len <= MAX_BITS; len++) {
    left <<= 1;
    left -= h->count[len];
    if (left < 0) return left;
  }
  offsets[1] = 0;
  for (len = 1; len < MAX_BITS; len++) offsets[len + 1] = (unsigned short)(offsets[len] + h->count[len]);
  for (symbol = 0; symbol < n; symbol++)
    if (lengths[symbol] != 0) h->symbol[offsets[lengths[symbol]]++] = (unsigned short)symbol;
  return left;
}

static int decode(reader *r, const huffman *h) {
  int code = 0, first = 0, index = 0, len;
  for (len = 1; len <= MAX_BITS; len++) {
    int bit = take_bits(r, 1);
    int count;
    if (bit < 0) return -1;
    code |= bit;
    count = h->count[len];
    if (code - count < first) return h->symbol[index + (code - first)];
    index += count;
    first += count;
    first <<= 1;
    code <<= 1;
  }
  return fail(r, "the compressed data holds a code that is none of the block's.");
}

static int codes(reader *r, const huffman *lengths, const huffman *distances) {
  for (;;) {
    int symbol = decode(r, lengths);
    if (symbol < 0) return -1;
    if (symbol < 256) {
      if (emit(r, (unsigned char)symbol) < 0) return -1;
    } else if (symbol == 256) {
      return 0;
    } else {
      int extra, length, distance;
      size_t from;
      symbol -= 257;
      if (symbol >= 29) return fail(r, "the compressed data holds a length that does not exist.");
      extra = take_bits(r, LENGTH_EXTRA[symbol]);
      if (extra < 0) return -1;
      length = LENGTH_BASE[symbol] + extra;
      symbol = decode(r, distances);
      if (symbol < 0) return -1;
      if (symbol >= 30) return fail(r, "the compressed data holds a distance that does not exist.");
      extra = take_bits(r, DISTANCE_EXTRA[symbol]);
      if (extra < 0) return -1;
      distance = DISTANCE_BASE[symbol] + extra;
      if ((size_t)distance > r->out_length)
        return fail(r, "the compressed data reaches back before its start.");
      from = r->out_length - (size_t)distance;
      while (length-- > 0) {
        if (emit(r, r->out[from++]) < 0) return -1;
      }
    }
  }
}

static int stored(reader *r) {
  unsigned len, inverse;
  r->bits = 0;
  r->count = 0;
  if (r->position + 4 > r->length) return fail(r, "the compressed data ends before it should.");
  len = r->bytes[r->position] | (unsigned)(r->bytes[r->position + 1] << 8);
  inverse = r->bytes[r->position + 2] | (unsigned)(r->bytes[r->position + 3] << 8);
  r->position += 4;
  if (len != (~inverse & 0xffffU)) return fail(r, "a stored block's length does not match its check.");
  if (r->position + len > r->length) return fail(r, "the compressed data ends before it should.");
  while (len-- > 0)
    if (emit(r, r->bytes[r->position++]) < 0) return -1;
  return 0;
}

static int fixed(reader *r) {
  unsigned short lengths[288];
  huffman lit, dist;
  int symbol;
  for (symbol = 0; symbol < 144; symbol++) lengths[symbol] = 8;
  for (; symbol < 256; symbol++) lengths[symbol] = 9;
  for (; symbol < 280; symbol++) lengths[symbol] = 7;
  for (; symbol < 288; symbol++) lengths[symbol] = 8;
  construct(&lit, lengths, 288);
  for (symbol = 0; symbol < 30; symbol++) lengths[symbol] = 5;
  construct(&dist, lengths, 30);
  return codes(r, &lit, &dist);
}

static int dynamic(reader *r) {
  unsigned short lengths[320];
  huffman lit, dist, code;
  int nlen = take_bits(r, 5), ndist = take_bits(r, 5), ncode = take_bits(r, 4), index = 0, i;
  if (nlen < 0 || ndist < 0 || ncode < 0) return -1;
  nlen += 257;
  ndist += 1;
  ncode += 4;
  if (nlen > 286 || ndist > 30) return fail(r, "a block says it has more codes than deflate has.");
  for (i = 0; i < 19; i++) lengths[i] = 0;
  for (i = 0; i < ncode; i++) {
    int v = take_bits(r, 3);
    if (v < 0) return -1;
    lengths[CODE_LENGTH_ORDER[i]] = (unsigned short)v;
  }
  if (construct(&code, lengths, 19) != 0)
    return fail(r, "a block's code lengths are not a complete code.");
  while (index < nlen + ndist) {
    int symbol = decode(r, &code);
    if (symbol < 0) return -1;
    if (symbol < 16) {
      lengths[index++] = (unsigned short)symbol;
    } else {
      int repeat, value = 0, extra;
      if (symbol == 16) {
        if (index == 0) return fail(r, "a block repeats a code length before it has one.");
        value = lengths[index - 1];
        extra = take_bits(r, 2);
        repeat = 3 + extra;
      } else if (symbol == 17) {
        extra = take_bits(r, 3);
        repeat = 3 + extra;
      } else {
        extra = take_bits(r, 7);
        repeat = 11 + extra;
      }
      if (extra < 0) return -1;
      if (index + repeat > nlen + ndist)
        return fail(r, "a block repeats more code lengths than it has.");
      while (repeat-- > 0) lengths[index++] = (unsigned short)value;
    }
  }
  if (lengths[256] == 0) return fail(r, "a block has no way to end.");
  if (construct(&lit, lengths, nlen) < 0)
    return fail(r, "a block's literal codes are over-subscribed.");
  if (construct(&dist, lengths + nlen, ndist) < 0)
    return fail(r, "a block's distance codes are over-subscribed.");
  return codes(r, &lit, &dist);
}

const char *sproutc_gunzip(const unsigned char *bytes, size_t length, char **out, size_t *out_length) {
  reader r;
  unsigned flags;
  size_t start = 10;
  int last;
  unsigned long crc, size;
  memset(&r, 0, sizeof r);
  r.bytes = bytes;
  r.length = length;
  *out = NULL;
  if (length < 18 || bytes[0] != 0x1f || bytes[1] != 0x8b)
    return "the data is not gzip: it does not begin with 1f 8b.";
  if (bytes[2] != 8) return "the gzip data uses a method other than deflate.";
  flags = bytes[3];
  if (flags & 4) {
    if (start + 2 > length) return "the gzip header ends before it should.";
    start += 2 + (size_t)(bytes[start] | (bytes[start + 1] << 8));
  }
  if (flags & 8) {
    while (start < length && bytes[start] != 0) start++;
    start++;
  }
  if (flags & 16) {
    while (start < length && bytes[start] != 0) start++;
    start++;
  }
  if (flags & 2) start += 2;
  if (start + 8 > length) return "the gzip header ends before it should.";
  r.position = start;
  r.length = length - 8;
  do {
    int type;
    last = take_bits(&r, 1);
    type = last < 0 ? -1 : take_bits(&r, 2);
    if (type < 0) break;
    if (type == 0) {
      if (stored(&r) < 0) break;
    } else if (type == 1) {
      if (fixed(&r) < 0) break;
    } else if (type == 2) {
      if (dynamic(&r) < 0) break;
    } else {
      fail(&r, "a block is of a type deflate does not have.");
      break;
    }
  } while (!last);
  if (r.error != NULL) {
    free(r.out);
    return r.error;
  }
  crc = bytes[length - 8] | ((unsigned long)bytes[length - 7] << 8) |
        ((unsigned long)bytes[length - 6] << 16) | ((unsigned long)bytes[length - 5] << 24);
  size = bytes[length - 4] | ((unsigned long)bytes[length - 3] << 8) |
         ((unsigned long)bytes[length - 2] << 16) | ((unsigned long)bytes[length - 1] << 24);
  if ((size & 0xffffffffUL) != (unsigned long)(r.out_length & 0xffffffffUL) ||
      crc != sproutc_crc32(r.out, r.out_length)) {
    free(r.out);
    return "the gzip data is damaged: its length or checksum does not match.";
  }
  if (emit(&r, 0) < 0) {
    free(r.out);
    return r.error;
  }
  *out = (char *)r.out;
  *out_length = r.out_length - 1;
  return NULL;
}
