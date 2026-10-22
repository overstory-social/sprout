/*
 * Rendered words, laid out (the spec's Prose > Passages, Slots, Verbatim). Lines in source are
 * reflowed: every run of spaces and line breaks is one space, and a paragraph has none at its
 * ends. A blank line is a paragraph break, and a paragraph left with nothing in it is no
 * paragraph. Words keep the case they were written in; only a name an object slot renders, where
 * it opens a line, has its first letter capitalised, past an opening quotation mark but not past
 * a bracket. A verbatim block keeps every space and line break it holds. A passage put into a
 * slot loses the padding inside its braces and keeps a paragraph break it opens or closes with
 * only where it renders words.
 *
 * Three rules are JavaScript's, which the language reads them from: white space is `\s`, a
 * letter or a number is `\p{L}` or `\p{N}`, and the letter a name opens a line with becomes what
 * `toUpperCase` makes of its one UTF-16 code unit, so a letter past the Basic Multilingual Plane
 * is left as it is. The last two are tables (unicode.c).
 */
#include "prose/prose.h"
#include "prose/unicode.h"

bool prose_put(sprout_arena *arena, prose_pieces *pieces, prose_piece_kind kind, const char *bytes, size_t length) {
  prose_piece *slot =
      (prose_piece *)sprout_exec_grow(arena, (void **)&pieces->items, &pieces->count, &pieces->capacity, sizeof *slot);
  if (slot == NULL) return false;
  slot->kind = kind;
  slot->bytes = bytes;
  slot->length = length;
  return true;
}

bool prose_is_space(unsigned long cp) {
  return (cp >= 9 && cp <= 13) || cp == 32 || cp == 0xA0 || cp == 0x1680 || (cp >= 0x2000 && cp <= 0x200A) ||
         cp == 0x2028 || cp == 0x2029 || cp == 0x202F || cp == 0x205F || cp == 0x3000 || cp == 0xFEFF;
}

unsigned long prose_decode(const char *bytes, size_t length, size_t at, size_t *width) {
  const unsigned char *p = (const unsigned char *)bytes + at;
  size_t left = length - at;
  if (p[0] < 0x80 || left < 2) {
    *width = 1;
    return p[0];
  }
  if (p[0] < 0xE0 || left < 3) {
    *width = 2;
    return ((unsigned long)(p[0] & 0x1F) << 6) | (p[1] & 0x3F);
  }
  if (p[0] < 0xF0 || left < 4) {
    *width = 3;
    return ((unsigned long)(p[0] & 0x0F) << 12) | ((unsigned long)(p[1] & 0x3F) << 6) | (p[2] & 0x3F);
  }
  *width = 4;
  return ((unsigned long)(p[0] & 0x07) << 18) | ((unsigned long)(p[1] & 0x3F) << 12) |
         ((unsigned long)(p[2] & 0x3F) << 6) | (p[3] & 0x3F);
}

size_t prose_characters(sprout_str text) {
  size_t i, count = 0;
  for (i = 0; i < text.length; i++)
    if (((unsigned char)text.bytes[i] & 0xC0) != 0x80) count++;
  return count;
}

/* ---- bytes under construction ---- */

typedef struct buffer {
  sprout_arena *arena;
  char *bytes;
  size_t length, capacity;
  bool failed;
} buffer;

static void put(buffer *b, const char *bytes, size_t length) {
  if (b->failed) return;
  if (b->length + length + 1 > b->capacity) {
    size_t wanted = b->capacity == 0 ? 64 : b->capacity * 2;
    char *bigger;
    while (wanted < b->length + length + 1) wanted *= 2;
    bigger = (char *)sprout_arena_take(b->arena, wanted);
    if (bigger == NULL) {
      b->failed = true;
      return;
    }
    if (b->length > 0) memcpy(bigger, b->bytes, b->length);
    b->bytes = bigger;
    b->capacity = wanted;
  }
  if (length > 0) memcpy(b->bytes + b->length, bytes, length);
  b->length += length;
  b->bytes[b->length] = '\0';
}

static void put_code_point(buffer *b, unsigned long cp) {
  char out[4];
  size_t n;
  if (cp < 0x80) {
    out[0] = (char)cp;
    n = 1;
  } else if (cp < 0x800) {
    out[0] = (char)(0xC0 | (cp >> 6));
    out[1] = (char)(0x80 | (cp & 0x3F));
    n = 2;
  } else if (cp < 0x10000) {
    out[0] = (char)(0xE0 | (cp >> 12));
    out[1] = (char)(0x80 | ((cp >> 6) & 0x3F));
    out[2] = (char)(0x80 | (cp & 0x3F));
    n = 3;
  } else {
    out[0] = (char)(0xF0 | (cp >> 18));
    out[1] = (char)(0x80 | ((cp >> 12) & 0x3F));
    out[2] = (char)(0x80 | ((cp >> 6) & 0x3F));
    out[3] = (char)(0x80 | (cp & 0x3F));
    n = 4;
  }
  put(b, out, n);
}

/* ---- white space ---- */

/* The bytes of `text` from its first to its last character that is not white space. */
static sprout_str trimmed(const char *bytes, size_t length) {
  size_t start = 0, end = length, width;
  sprout_str out;
  while (start < end) {
    if (!prose_is_space(prose_decode(bytes, end, start, &width))) break;
    start += width;
  }
  while (end > start) {
    size_t back = end - 1;
    while (back > start && ((unsigned char)bytes[back] & 0xC0) == 0x80) back--;
    if (!prose_is_space(prose_decode(bytes, end, back, &width))) break;
    end = back;
  }
  out.bytes = bytes + start;
  out.length = end - start;
  return out;
}

/* ---- capitalising ---- */

bool prose_capitalise(sprout_arena *arena, sprout_str line, sprout_str *out) {
  size_t lead = 0, width;
  unsigned long cp, upper[3];
  size_t count, i;
  buffer made;
  *out = line;
  /* The opening: whatever comes before the first letter or number. */
  while (lead < line.length) {
    cp = prose_decode(line.bytes, line.length, lead, &width);
    if (prose_unicode_letter_or_number(cp)) break;
    if (cp == '(' || cp == '[' || cp == '{') return true;
    lead += width;
  }
  if (lead >= line.length) return true;
  cp = prose_decode(line.bytes, line.length, lead, &width);
  count = prose_unicode_upper(cp, upper);
  if (count == 1 && upper[0] == cp) return true;
  memset(&made, 0, sizeof made);
  made.arena = arena;
  put(&made, line.bytes, lead);
  for (i = 0; i < count; i++) put_code_point(&made, upper[i]);
  put(&made, line.bytes + lead + width, line.length - lead - width);
  if (made.failed) return false;
  out->bytes = made.bytes;
  out->length = made.length;
  return true;
}

/* ---- reflow ---- */

/* The paragraph being laid out, and where its line has got to. */
typedef struct laying {
  buffer text;
  bool pending;           /* white space written since the line's last words, still to be one space */
  bool line_has_words;    /* the line holds something that is not white space */
  bool line_opened;       /* a letter, a number or a bracket has opened the line, so a name there is not capitalised */
  bool verbatim;          /* the paragraph holds a verbatim block, from `kept_from` to `kept_to` */
  size_t kept_from, kept_to;
} laying;

static void laying_start(laying *p, sprout_arena *arena) {
  memset(p, 0, sizeof *p);
  p->text.arena = arena;
}

static void line_start(laying *p) {
  p->pending = false;
  p->line_has_words = false;
  p->line_opened = false;
}

/* Words into the line: every run of white space one space, and none where the line has nothing yet. */
static void lay_words(laying *p, const char *bytes, size_t length) {
  size_t at = 0, width;
  while (at < length) {
    unsigned long cp = prose_decode(bytes, length, at, &width);
    if (prose_is_space(cp)) {
      if (p->line_has_words) p->pending = true;
    } else {
      if (p->pending) put(&p->text, " ", 1);
      p->pending = false;
      put(&p->text, bytes + at, width);
      p->line_has_words = true;
      if (prose_unicode_letter_or_number(cp) || cp == '(' || cp == '[' || cp == '{') p->line_opened = true;
    }
    at += width;
  }
}

/* A verbatim block into the line, byte for byte; a paragraph's trimming stops at its ends. */
static void lay_verbatim(laying *p, const char *bytes, size_t length) {
  if (length == 0) return;
  if (p->pending) put(&p->text, " ", 1);
  p->pending = false;
  if (!p->verbatim) p->kept_from = p->text.length;
  p->verbatim = true;
  put(&p->text, bytes, length);
  p->kept_to = p->text.length;
  p->line_has_words = true;
  p->line_opened = true;
}

/* The paragraph laid so far, if it has anything in it, and a fresh start. */
static bool close_paragraph(laying *p, prose_paragraphs *out, size_t *capacity) {
  const char *bytes;
  size_t start, end;
  sprout_str whole;
  if (p->text.failed) return false;
  bytes = p->text.bytes == NULL ? "" : p->text.bytes;
  whole = trimmed(bytes, p->text.length);
  start = (size_t)(whole.bytes - bytes);
  end = start + whole.length;
  if (p->verbatim) {
    if (p->kept_from < start || whole.length == 0) start = p->kept_from;
    if (p->kept_to > end || whole.length == 0) end = p->kept_to;
  }
  if (end > start) {
    sprout_str *slot = (sprout_str *)sprout_exec_grow(p->text.arena, (void **)&out->items, &out->count, capacity, sizeof *slot);
    if (slot == NULL) return false;
    /* Copied out so the paragraph ends in a NUL, as a host prints it. */
    slot->bytes = sprout_arena_copy(p->text.arena, bytes + start, end - start);
    if (slot->bytes == NULL) return false;
    slot->length = end - start;
  }
  laying_start(p, p->text.arena);
  return true;
}

bool prose_reflow(sprout_arena *arena, const prose_pieces *rendered, prose_paragraphs *out) {
  laying p;
  size_t capacity = 0, i;
  memset(out, 0, sizeof *out);
  laying_start(&p, arena);
  for (i = 0; i < rendered->count; i++) {
    const prose_piece *piece = &rendered->items[i];
    switch (piece->kind) {
      case PROSE_WORDS:
        lay_words(&p, piece->bytes, piece->length);
        break;
      case PROSE_NAME: {
        sprout_str name = {piece->bytes, piece->length};
        if (!p.line_opened && !prose_capitalise(arena, name, &name)) return false;
        lay_words(&p, name.bytes, name.length);
        break;
      }
      case PROSE_VERBATIM:
        lay_verbatim(&p, piece->bytes, piece->length);
        break;
      case PROSE_LINE:
        put(&p.text, "\n", 1);
        line_start(&p);
        break;
      case PROSE_PARAGRAPH:
        if (!close_paragraph(&p, out, &capacity)) return false;
        break;
    }
  }
  return close_paragraph(&p, out, &capacity);
}

/* ---- slotting a passage into a line ---- */

static bool said(const prose_piece *piece) {
  if (piece->kind == PROSE_VERBATIM) return piece->length > 0;
  return (piece->kind == PROSE_WORDS || piece->kind == PROSE_NAME) && trimmed(piece->bytes, piece->length).length > 0;
}

/* The break the space at a slotted passage's end leaves: a paragraph, a line, or none. */
static bool edge(sprout_arena *arena, const prose_piece *space, size_t count, prose_pieces *out) {
  size_t breaks = 0, i;
  bool paragraph = false;
  for (i = 0; i < count; i++) {
    if (space[i].kind != PROSE_PARAGRAPH && space[i].kind != PROSE_LINE) continue;
    breaks++;
    if (space[i].kind == PROSE_PARAGRAPH) paragraph = true;
  }
  if (paragraph || breaks > 1) return prose_put(arena, out, PROSE_PARAGRAPH, NULL, 0);
  if (breaks == 1) return prose_put(arena, out, PROSE_LINE, NULL, 0);
  return true;
}

bool prose_slotted(sprout_arena *arena, const prose_pieces *rendered, prose_pieces *out) {
  size_t first = 0, last, i;
  memset(out, 0, sizeof *out);
  while (first < rendered->count && !said(&rendered->items[first])) first++;
  if (first == rendered->count) return true;
  last = rendered->count - 1;
  while (!said(&rendered->items[last])) last--;
  if (!edge(arena, rendered->items, first, out)) return false;
  for (i = first; i <= last; i++) {
    const prose_piece *piece = &rendered->items[i];
    const char *bytes = piece->bytes;
    size_t length = piece->length;
    if (piece->kind == PROSE_PARAGRAPH || piece->kind == PROSE_LINE) {
      if (!prose_put(arena, out, piece->kind, NULL, 0)) return false;
      continue;
    }
    if (piece->kind == PROSE_VERBATIM) {
      if (!prose_put(arena, out, piece->kind, bytes, length)) return false;
      continue;
    }
    if (i == first) {
      sprout_str whole = trimmed(bytes, length);
      length -= (size_t)(whole.bytes - bytes);
      bytes = whole.bytes;
    }
    if (i == last) {
      sprout_str whole = trimmed(bytes, length);
      length = (size_t)(whole.bytes - bytes) + whole.length;
    }
    if (!prose_put(arena, out, piece->kind, bytes, length)) return false;
  }
  return edge(arena, rendered->items + last + 1, rendered->count - last - 1, out);
}
