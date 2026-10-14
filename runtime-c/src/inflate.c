/*
 * Inflate (RFC 1951) and the gzip member around it (RFC 1952). The decoder
 * is a small state machine (between blocks, in a stored block, in a coded
 * block, at the end) so it can stop when the caller's buffer is full and go
 * on from there. Its input is read a byte at a time from `in`, and a source's
 * next piece is pulled when `in` is spent, so a refill never stops the decoder
 * part way through a code. A member held whole has every byte it gives counted
 * against the trailer's ISIZE, so a stream that lies about its length is
 * refused rather than overrun; a member from a source has its length checked
 * when it ends. Nothing may follow a member's trailer.
 * Huffman decoding is the canonical count-and-symbol walk: no tables beyond
 * the code lengths.
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


enum { BLOCK, STORED, CODES, END, DONE };

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

static long refuse(sprout_inflater *s, const char *why) {
  if (s->why == NULL) s->why = why;
  return -1;
}

/* Whether `in` holds a byte, the source's next piece pulled when it is spent. */
static bool more(sprout_inflater *s) {
  size_t got = 0;
  if (s->in_at < s->in_length) return true;
  if (s->source.read == NULL) return false;
  if (!s->source.read(s->source.ctx, s->piece, s->piece_bytes, &got)) {
    refuse(s, "its file could not be read to the end");
    return false;
  }
  s->in = s->piece;
  s->in_length = got < s->piece_bytes ? got : s->piece_bytes;
  s->in_at = 0;
  return s->in_length > 0;
}

/* The next byte of the member; -1 when it ends. */
static long byte(sprout_inflater *s) {
  if (!more(s)) return refuse(s, "the compressed data ends early");
  return s->in[s->in_at++];
}

/* The next `need` bits, least significant first; -1 when the stream ends. */
static long bits(sprout_inflater *s, int need) {
  long value;
  while (s->bit_count < need) {
    long next = byte(s);
    if (next < 0) return -1;
    s->bit_buffer |= (unsigned long)next << s->bit_count;
    s->bit_count += 8;
  }
  value = (long)(s->bit_buffer & ((1ul << need) - 1ul));
  s->bit_buffer >>= need;
  s->bit_count -= need;
  return value;
}

/* Builds a canonical code from lengths; the number of unused codes, negative when over-subscribed. */
static int construct(sprout_huffman *h, const unsigned short *lengths, int n) {
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

static int decode(sprout_inflater *s, const sprout_huffman *h) {
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

/* The fixed block's tables, into the inflater's. */
static void fixed_tables(sprout_inflater *s) {
  unsigned short lengths[LITERAL_CODES];
  int i;
  for (i = 0; i < 144; i++) lengths[i] = 8;
  for (; i < 256; i++) lengths[i] = 9;
  for (; i < 280; i++) lengths[i] = 7;
  for (; i < LITERAL_CODES; i++) lengths[i] = 8;
  construct(&s->lit, lengths, LITERAL_CODES);
  for (i = 0; i < DISTANCE_CODES; i++) lengths[i] = 5;
  construct(&s->dist, lengths, DISTANCE_CODES);
}

/* Reads a dynamic block's tables into the inflater's. */
static int dynamic_tables(sprout_inflater *s) {
  sprout_huffman lengths_code;
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
  status = construct(&s->lit, lengths, (int)nlen);
  if (status < 0 || (status > 0 && nlen - s->lit.count[0] != 1))
    return (int)refuse(s, "the compressed data holds an unusable table of literal codes");
  status = construct(&s->dist, lengths + nlen, (int)ndist);
  if (status < 0 || (status > 0 && ndist - s->dist.count[0] != 1))
    return (int)refuse(s, "the compressed data holds an unusable table of distance codes");
  return 0;
}


/* Reads a block's header and readies the decoder for its bytes. */
static int begin_block(sprout_inflater *s) {
  long last = bits(s, 1);
  long kind = bits(s, 2);
  if (last < 0 || kind < 0) return -1;
  s->last = last != 0;
  if (kind == 0) {
    unsigned len, nlen;
    s->bit_buffer = 0;
    s->bit_count = 0;
    len = (unsigned)bits(s, 16);
    nlen = (unsigned)bits(s, 16);
    if (s->why != NULL) return -1;
    if (len != (~nlen & 0xFFFFu)) return (int)refuse(s, "a stored block's length does not match its check");
    s->stored_left = len;
    s->state = STORED;
    return 0;
  }
  if (kind == 1) {
    fixed_tables(s);
  } else if (kind == 2) {
    if (dynamic_tables(s) < 0) return -1;
  } else {
    return (int)refuse(s, "the compressed data holds a block of a kind that does not exist");
  }
  s->state = CODES;
  return 0;
}

/* One byte out: to the caller, into the window, and through the checksum. */
static void put(sprout_inflater *s, unsigned char *out, size_t *produced, unsigned char byte) {
  out[(*produced)++] = byte;
  s->window[s->total & (SPROUT_INFLATE_WINDOW - 1)] = byte;
  s->total++;
  s->crc = s->crc_table[(s->crc ^ byte) & 0xFFu] ^ (s->crc >> 8);
}

static uint32_t le32(const unsigned char *p) {
  return (uint32_t)p[0] | ((uint32_t)p[1] << 8) | ((uint32_t)p[2] << 16) | ((uint32_t)p[3] << 24);
}

/* Reads `count` bytes of the member into `out` (or past them where `out` is NULL); false when it ends first. */
static bool take(sprout_inflater *s, unsigned char *out, size_t count) {
  size_t i;
  for (i = 0; i < count; i++) {
    long next = byte(s);
    if (next < 0) return false;
    if (out != NULL) out[i] = (unsigned char)next;
  }
  return true;
}

/* Reads up to and past a NUL the member holds; false when it ends first. */
static bool past_nul(sprout_inflater *s) {
  long next;
  do next = byte(s);
  while (next > 0);
  return next == 0;
}

/* Reads the member's header (RFC 1952 section 2.3), leaving `in` at the deflate data; false with `why` set. */
static bool read_header(sprout_inflater *s) {
  unsigned char head[10], extra[2];
  unsigned flags;
  const char *wrong = NULL;
  if (!take(s, head, sizeof head)) return false;
  flags = head[3];
  if (head[0] != 0x1F || head[1] != 0x8B) wrong = "the data is not gzip: it does not begin with its magic number";
  else if (head[2] != 8) wrong = "the data is gzip with a method other than deflate";
  else if (flags & 0xE0u) wrong = "the gzip header sets flags that are reserved";
  if (wrong != NULL) {
    refuse(s, wrong);
    return false;
  }
  if ((flags & 4u) && (!take(s, extra, 2) || !take(s, NULL, extra[0] | ((size_t)extra[1] << 8)))) return false;
  if ((flags & 8u) && !past_nul(s)) return false;
  if ((flags & 16u) && !past_nul(s)) return false;
  if ((flags & 2u) && !take(s, NULL, 2)) return false;
  return true;
}

/* The decoder's state before its header is read: nothing given yet, and the CRC's table built. */
static void begin_state(sprout_inflater *s) {
  uint32_t n;
  s->state = BLOCK;
  s->crc = 0xFFFFFFFFu;
  for (n = 0; n < 256; n++) {
    uint32_t c = n, k;
    for (k = 0; k < 8; k++) c = (c & 1u) ? 0xEDB88320u ^ (c >> 1) : c >> 1;
    s->crc_table[n] = c;
  }
}

sprout_status sprout_inflate_begin(sprout_inflater *s, const unsigned char *bytes, size_t length,
                                   const char **why) {
  *why = NULL;
  memset(s, 0, sizeof *s);
  /* A header of ten bytes and a trailer of eight is the least a member is. */
  if (length < 18 || bytes[0] != 0x1F || bytes[1] != 0x8B) {
    *why = "the data is not gzip: it does not begin with its magic number";
    return SPROUT_BAD_INPUT;
  }
  s->size_said = le32(bytes + length - 4);
  /* Deflate cannot expand more than 1032 to 1, so a longer ISIZE is a damaged trailer, not a size to reserve. */
  if (s->size_said / 1032u > length) {
    *why = "the gzip trailer gives a length that data this small cannot expand to";
    return SPROUT_BAD_INPUT;
  }
  s->in = bytes;
  s->in_length = length;
  begin_state(s);
  if (!read_header(s)) {
    *why = s->why;
    return SPROUT_BAD_INPUT;
  }
  return SPROUT_OK;
}

sprout_status sprout_inflate_begin_source(sprout_inflater *s, const sprout_source *source, unsigned char *piece,
                                          size_t piece_bytes, const char **why) {
  *why = NULL;
  memset(s, 0, sizeof *s);
  s->source = *source;
  s->piece = piece;
  s->piece_bytes = piece_bytes;
  /* Unknown until the trailer is read, so no byte is refused for passing it. */
  s->size_said = 0xFFFFFFFFu;
  begin_state(s);
  if (!read_header(s)) {
    *why = s->why;
    return SPROUT_BAD_INPUT;
  }
  return SPROUT_OK;
}

/* Reads and checks the trailer once the last block has ended; the member is done, or `why` set. */
static void end_member(sprout_inflater *s) {
  unsigned char trailer[8];
  uint32_t length;
  s->bit_buffer = 0;
  s->bit_count = 0;
  if (!take(s, trailer, sizeof trailer)) return;
  length = le32(trailer + 4);
  if ((uint32_t)s->total != length || (s->source.read == NULL && s->total != s->size_said)) {
    refuse(s, (uint32_t)s->total < length ? "the compressed data is shorter than it says"
                                          : "the compressed data is longer than it says");
    return;
  }
  if (~s->crc != le32(trailer)) {
    refuse(s, "the compressed data does not match its checksum");
    return;
  }
  if (more(s)) {
    refuse(s, "the compressed data goes on past its end");
    return;
  }
  if (s->why == NULL) s->state = DONE;
}

bool sprout_inflate_done(const sprout_inflater *s) { return s->state == DONE; }

sprout_status sprout_inflate_next(sprout_inflater *s, unsigned char *out, size_t cap, size_t *got,
                                  const char **why) {
  size_t produced = 0;
  *got = 0;
  *why = NULL;
  for (;;) {
    if (s->state == DONE) break;
    if (s->state == END) {
      end_member(s);
      break;
    }
    if (s->state == BLOCK) {
      if (begin_block(s) < 0) break;
      continue;
    }
    if (s->state == STORED && s->stored_left == 0) {
      s->state = s->last ? END : BLOCK;
      continue;
    }
    if (produced >= cap) break;
    if (s->state == STORED) {
      size_t n = s->stored_left < cap - produced ? s->stored_left : cap - produced;
      size_t i;
      if (!more(s)) {
        refuse(s, "the compressed data ends early");
        break;
      }
      if (n > s->in_length - s->in_at) n = s->in_length - s->in_at;
      if (s->total + n > s->size_said) {
        refuse(s, "the compressed data is longer than it says");
        break;
      }
      for (i = 0; i < n; i++) put(s, out, &produced, s->in[s->in_at + i]);
      s->in_at += n;
      s->stored_left -= n;
      continue;
    }
    if (s->copy_left > 0) {
      put(s, out, &produced, s->window[(s->total - s->copy_distance) & (SPROUT_INFLATE_WINDOW - 1)]);
      s->copy_left--;
      continue;
    }
    {
      int symbol = decode(s, &s->lit);
      if (symbol < 0) break;
      if (symbol < 256) {
        if (s->total >= s->size_said) {
          refuse(s, "the compressed data is longer than it says");
          break;
        }
        put(s, out, &produced, (unsigned char)symbol);
      } else if (symbol == 256) {
        s->state = s->last ? END : BLOCK;
      } else {
        long extra, length, distance;
        int d;
        symbol -= 257;
        if (symbol >= 29) {
          refuse(s, "the compressed data holds a length that does not exist");
          break;
        }
        extra = bits(s, LENGTH_EXTRA[symbol]);
        if (extra < 0) break;
        length = LENGTH_BASE[symbol] + extra;
        d = decode(s, &s->dist);
        if (d < 0) break;
        if (d >= DISTANCE_CODES) {
          refuse(s, "the compressed data holds a distance that does not exist");
          break;
        }
        extra = bits(s, DISTANCE_EXTRA[d]);
        if (extra < 0) break;
        distance = DISTANCE_BASE[d] + extra;
        if ((size_t)distance > s->total) {
          refuse(s, "the compressed data reaches back before its start");
          break;
        }
        if (s->total + (size_t)length > s->size_said) {
          refuse(s, "the compressed data is longer than it says");
          break;
        }
        s->copy_left = (size_t)length;
        s->copy_distance = (size_t)distance;
      }
    }
  }
  *got = produced;
  if (s->why != NULL) {
    *why = s->why;
    return SPROUT_BAD_INPUT;
  }
  return SPROUT_OK;
}

sprout_status sprout_gunzip(sprout_arena *arena, const unsigned char *bytes, size_t length,
                            char **out, size_t *out_length, const char **why) {
  sprout_inflater *s;
  unsigned char *text;
  size_t got;
  sprout_status status;
  *out = NULL;
  *out_length = 0;
  s = (sprout_inflater *)sprout_arena_take(arena, sizeof *s);
  if (s == NULL) return SPROUT_NO_MEMORY;
  status = sprout_inflate_begin(s, bytes, length, why);
  if (status != SPROUT_OK) return status;
  text = (unsigned char *)sprout_arena_take(arena, (size_t)s->size_said + 1);
  if (text == NULL) return SPROUT_NO_MEMORY;
  /* One more than the trailer says, so a stream that runs long is refused rather than cut. */
  status = sprout_inflate_next(s, text, (size_t)s->size_said + 1, &got, why);
  if (status != SPROUT_OK) return status;
  text[got] = '\0';
  *out = (char *)text;
  *out_length = got;
  return SPROUT_OK;
}
