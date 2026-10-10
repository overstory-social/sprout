/*
 * Inflate (RFC 1951) and the gzip member around it (RFC 1952). The output is
 * sized from the trailer's ISIZE and every write is bounds-checked against
 * it, so a stream that lies about its length is refused rather than
 * overrun. Huffman decoding is the canonical count-and-symbol walk: no
 * tables beyond the code lengths.
 */
#include "inflate.h"

#include <string.h>

#define MAX_BITS 15
#define LITERAL_CODES 288
#define DISTANCE_CODES 30

static const unsigned short LENGTH_BASE[29] = {3,  4,  5,  6,   7,   8,   9,   10,  11,  13,
                                               15, 17, 19, 23,  27,  31,  35,  43,  51,  59,
                                               67, 83, 99, 115, 131, 163, 195, 227, 258};
static const unsigned char LENGTH_EXTRA[29] = {0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 2, 2, 2,
                                               2, 3, 3, 3, 3, 4, 4, 4, 4, 5, 5, 5, 5, 0};
static const unsigned short DISTANCE_BASE[30] = {
    1,   2,   3,   4,   5,   7,    9,    13,   17,   25,   33,   49,   65,    97,    129,
    193, 257, 385, 513, 769, 1025, 1537, 2049, 3073, 4097, 6145, 8193, 12289, 16385, 24577};
static const unsigned char DISTANCE_EXTRA[30] = {0, 0, 0, 0, 1, 1, 2, 2,  3,  3,  4,  4,  5,  5,  6,
                                                 6, 7, 7, 8, 8, 9, 9, 10, 10, 11, 11, 12, 12, 13, 13};
static const unsigned char CODE_LENGTH_ORDER[19] = {16, 17, 18, 0, 8,  7, 9,  6, 10, 5,
                                                    11, 4,  12, 3, 13, 2, 14, 1, 15};

typedef struct huffman {
  unsigned short count[MAX_BITS + 1];
  unsigned short symbol[LITERAL_CODES];
} huffman;

typedef struct inflater {
  const unsigned char *in;
  size_t in_length;
  size_t in_at;
  unsigned long bit_buffer;
  int bit_count;
  unsigned char *out;
  size_t out_length;
  size_t out_at;
  const char *why;
} inflater;

uint32_t sprout_crc32(uint32_t crc, const unsigned char *bytes, size_t length) {
  uint32_t table[256];
  uint32_t n, k;
  size_t i;
  for (n = 0; n < 256; n++) {
    uint32_t c = n;
    for (k = 0; k < 8; k++) c = (c & 1u) ? 0xEDB88320u ^ (c >> 1) : c >> 1;
    table[n] = c;
  }
  crc = ~crc;
  for (i = 0; i < length; i++) crc = table[(crc ^ bytes[i]) & 0xFFu] ^ (crc >> 8);
  return ~crc;
}

static long refuse(inflater *s, const char *why) {
  if (s->why == NULL) s->why = why;
  return -1;
}

/* The next `need` bits, least significant first; -1 when the stream ends. */
static long bits(inflater *s, int need) {
  long value;
  while (s->bit_count < need) {
    if (s->in_at >= s->in_length) return refuse(s, "the compressed data ends early");
    s->bit_buffer |= (unsigned long)s->in[s->in_at++] << s->bit_count;
    s->bit_count += 8;
  }
  value = (long)(s->bit_buffer & ((1ul << need) - 1ul));
  s->bit_buffer >>= need;
  s->bit_count -= need;
  return value;
}

/* Builds a canonical code from lengths; the number of unused codes, negative when over-subscribed. */
static int construct(huffman *h, const unsigned short *lengths, int n) {
  int len, left, symbol;
  unsigned short offsets[MAX_BITS + 1];
  for (len = 0; len <= MAX_BITS; len++) h->count[len] = 0;
  for (symbol = 0; symbol < n; symbol++) h->count[lengths[symbol]]++;
  if (h->count[0] == n) return 0;
  left = 1;
  for (len = 1; len <= MAX_BITS; len++) {
    left <<= 1;
    left -= h->count[len];
    if (left < 0) return left;
  }
  offsets[1] = 0;
  for (len = 1; len < MAX_BITS; len++)
    offsets[len + 1] = (unsigned short)(offsets[len] + h->count[len]);
  for (symbol = 0; symbol < n; symbol++)
    if (lengths[symbol] != 0) h->symbol[offsets[lengths[symbol]]++] = (unsigned short)symbol;
  return left;
}

static int decode(inflater *s, const huffman *h) {
  int code = 0, first = 0, index = 0, len;
  for (len = 1; len <= MAX_BITS; len++) {
    long bit = bits(s, 1);
    int count;
    if (bit < 0) return -1;
    code |= (int)bit;
    count = h->count[len];
    if (code - count < first) return h->symbol[index + (code - first)];
    index += count;
    first += count;
    first <<= 1;
    code <<= 1;
  }
  return (int)refuse(s, "the compressed data holds a code that is not in its table");
}

static int codes(inflater *s, const huffman *lit, const huffman *dist) {
  for (;;) {
    int symbol = decode(s, lit);
    if (symbol < 0) return -1;
    if (symbol < 256) {
      if (s->out_at >= s->out_length)
        return (int)refuse(s, "the compressed data is longer than it says");
      s->out[s->out_at++] = (unsigned char)symbol;
    } else if (symbol == 256) {
      return 0;
    } else {
      long extra, length, distance;
      int d;
      symbol -= 257;
      if (symbol >= 29)
        return (int)refuse(s, "the compressed data holds a length that does not exist");
      extra = bits(s, LENGTH_EXTRA[symbol]);
      if (extra < 0) return -1;
      length = LENGTH_BASE[symbol] + extra;
      d = decode(s, dist);
      if (d < 0) return -1;
      if (d >= DISTANCE_CODES)
        return (int)refuse(s, "the compressed data holds a distance that does not exist");
      extra = bits(s, DISTANCE_EXTRA[d]);
      if (extra < 0) return -1;
      distance = DISTANCE_BASE[d] + extra;
      if ((size_t)distance > s->out_at)
        return (int)refuse(s, "the compressed data reaches back before its start");
      if (s->out_at + (size_t)length > s->out_length)
        return (int)refuse(s, "the compressed data is longer than it says");
      while (length-- > 0) {
        s->out[s->out_at] = s->out[s->out_at - (size_t)distance];
        s->out_at++;
      }
    }
  }
}

static int fixed_block(inflater *s) {
  huffman lit, dist;
  unsigned short lengths[LITERAL_CODES];
  int i;
  for (i = 0; i < 144; i++) lengths[i] = 8;
  for (; i < 256; i++) lengths[i] = 9;
  for (; i < 280; i++) lengths[i] = 7;
  for (; i < LITERAL_CODES; i++) lengths[i] = 8;
  construct(&lit, lengths, LITERAL_CODES);
  for (i = 0; i < DISTANCE_CODES; i++) lengths[i] = 5;
  construct(&dist, lengths, DISTANCE_CODES);
  return codes(s, &lit, &dist);
}

static int dynamic_block(inflater *s) {
  huffman lengths_code, lit, dist;
  unsigned short lengths[LITERAL_CODES + DISTANCE_CODES];
  long nlen, ndist, ncode;
  int index, status;
  nlen = bits(s, 5);
  ndist = bits(s, 5);
  ncode = bits(s, 4);
  if (nlen < 0 || ndist < 0 || ncode < 0) return -1;
  nlen += 257;
  ndist += 1;
  ncode += 4;
  if (nlen > 286 || ndist > DISTANCE_CODES)
    return (int)refuse(s, "the compressed data declares more codes than exist");
  for (index = 0; index < 19; index++) lengths[index] = 0;
  for (index = 0; index < ncode; index++) {
    long v = bits(s, 3);
    if (v < 0) return -1;
    lengths[CODE_LENGTH_ORDER[index]] = (unsigned short)v;
  }
  if (construct(&lengths_code, lengths, 19) != 0)
    return (int)refuse(s, "the compressed data holds an incomplete table of code lengths");
  index = 0;
  while (index < nlen + ndist) {
    int symbol = decode(s, &lengths_code);
    if (symbol < 0) return -1;
    if (symbol < 16) {
      lengths[index++] = (unsigned short)symbol;
    } else {
      unsigned short previous = 0;
      long repeat;
      if (symbol == 16) {
        if (index == 0)
          return (int)refuse(s, "the compressed data repeats a length it has not given");
        previous = lengths[index - 1];
        repeat = bits(s, 2);
        if (repeat < 0) return -1;
        repeat += 3;
      } else if (symbol == 17) {
        repeat = bits(s, 3);
        if (repeat < 0) return -1;
        repeat += 3;
      } else {
        repeat = bits(s, 7);
        if (repeat < 0) return -1;
        repeat += 11;
      }
      if (index + repeat > nlen + ndist)
        return (int)refuse(s, "the compressed data repeats more lengths than it declared");
      while (repeat-- > 0) lengths[index++] = previous;
    }
  }
  if (lengths[256] == 0) return (int)refuse(s, "the compressed data has no end-of-block code");
  status = construct(&lit, lengths, (int)nlen);
  if (status < 0 || (status > 0 && nlen - lit.count[0] != 1))
    return (int)refuse(s, "the compressed data holds an unusable table of literal codes");
  status = construct(&dist, lengths + nlen, (int)ndist);
  if (status < 0 || (status > 0 && ndist - dist.count[0] != 1))
    return (int)refuse(s, "the compressed data holds an unusable table of distance codes");
  return codes(s, &lit, &dist);
}

static int stored_block(inflater *s) {
  unsigned len, nlen;
  s->bit_buffer = 0;
  s->bit_count = 0;
  if (s->in_at + 4 > s->in_length) return (int)refuse(s, "the compressed data ends early");
  len = s->in[s->in_at] | ((unsigned)s->in[s->in_at + 1] << 8);
  nlen = s->in[s->in_at + 2] | ((unsigned)s->in[s->in_at + 3] << 8);
  s->in_at += 4;
  if (len != (~nlen & 0xFFFFu))
    return (int)refuse(s, "a stored block's length does not match its check");
  if (s->in_at + len > s->in_length) return (int)refuse(s, "the compressed data ends early");
  if (s->out_at + len > s->out_length)
    return (int)refuse(s, "the compressed data is longer than it says");
  memcpy(s->out + s->out_at, s->in + s->in_at, len);
  s->in_at += len;
  s->out_at += len;
  return 0;
}

static uint32_t le32(const unsigned char *p) {
  return (uint32_t)p[0] | ((uint32_t)p[1] << 8) | ((uint32_t)p[2] << 16) | ((uint32_t)p[3] << 24);
}

/* The offset of the deflate data past the member header (RFC 1952 section 2.3), or 0 with `why` set. */
static size_t header_end(const unsigned char *b, size_t n, const char **why) {
  size_t at = 10;
  unsigned flags;
  if (n < 18 || b[0] != 0x1F || b[1] != 0x8B) {
    *why = "the data is not gzip: it does not begin with its magic number";
    return 0;
  }
  if (b[2] != 8) {
    *why = "the data is gzip with a method other than deflate";
    return 0;
  }
  flags = b[3];
  if (flags & 0xE0u) {
    *why = "the gzip header sets flags that are reserved";
    return 0;
  }
  if (flags & 4u) {
    size_t extra;
    if (at + 2 > n) {
      *why = "the compressed data ends early";
      return 0;
    }
    extra = b[at] | ((size_t)b[at + 1] << 8);
    at += 2 + extra;
  }
  if (flags & 8u) {
    while (at < n && b[at] != 0) at++;
    at++;
  }
  if (flags & 16u) {
    while (at < n && b[at] != 0) at++;
    at++;
  }
  if (flags & 2u) at += 2;
  if (at + 8 > n) {
    *why = "the compressed data ends early";
    return 0;
  }
  return at;
}

sprout_status sprout_gunzip(sprout_arena *arena, const unsigned char *bytes, size_t length,
                            char **out, size_t *out_length, const char **why) {
  inflater s;
  size_t start, isize;
  int last;
  const char *reason = NULL;
  *out = NULL;
  *out_length = 0;
  *why = NULL;
  start = header_end(bytes, length, &reason);
  if (start == 0) {
    *why = reason;
    return SPROUT_BAD_INPUT;
  }
  isize = le32(bytes + length - 4);
  /* Deflate cannot expand more than 1032 to 1, so a longer ISIZE is a damaged trailer, not a size to reserve. */
  if (isize / 1032u > length) {
    *why = "the gzip trailer gives a length that data this small cannot expand to";
    return SPROUT_BAD_INPUT;
  }
  memset(&s, 0, sizeof s);
  s.in = bytes;
  s.in_length = length - 8;
  s.in_at = start;
  s.out_length = isize;
  s.out = (unsigned char *)sprout_arena_take(arena, isize + 1);
  if (s.out == NULL) return SPROUT_NO_MEMORY;
  do {
    long kind;
    int status;
    last = (int)bits(&s, 1);
    kind = bits(&s, 2);
    if (last < 0 || kind < 0) {
      last = -1;
      break;
    }
    if (kind == 0) status = stored_block(&s);
    else if (kind == 1) status = fixed_block(&s);
    else if (kind == 2) status = dynamic_block(&s);
    else status = (int)refuse(&s, "the compressed data holds a block of a kind that does not exist");
    if (status < 0) {
      last = -1;
      break;
    }
  } while (!last);
  if (last < 0) {
    *why = s.why;
    return SPROUT_BAD_INPUT;
  }
  if (s.out_at != isize) {
    *why = "the compressed data is shorter than it says";
    return SPROUT_BAD_INPUT;
  }
  if (sprout_crc32(0, s.out, s.out_at) != le32(bytes + length - 8)) {
    *why = "the compressed data does not match its checksum";
    return SPROUT_BAD_INPUT;
  }
  s.out[isize] = '\0';
  *out = (char *)s.out;
  *out_length = isize;
  return SPROUT_OK;
}
