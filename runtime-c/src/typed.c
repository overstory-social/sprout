/* A typed line as words; see typed.h. */
#include "typed.h"

#include <string.h>

#include "prose/prose.h"
#include "prose/unicode.h"

/* Whether a cased letter follows `at` (or precedes it, walking backwards), past any case-ignorable code points. */
static bool cased_beside(const unsigned long *cps, size_t count, size_t at, bool forward) {
  size_t i = at;
  for (;;) {
    if (forward) {
      if (++i >= count) return false;
    } else {
      if (i == 0) return false;
      i--;
    }
    if (prose_unicode_case_ignorable(cps[i])) continue;
    return prose_unicode_cased(cps[i]);
  }
}

/* `cp` as UTF-8 at `out`; how many bytes that is. */
static size_t encoded(unsigned long cp, char *out) {
  if (cp < 0x80) {
    out[0] = (char)cp;
    return 1;
  }
  if (cp < 0x800) {
    out[0] = (char)(0xC0 | (cp >> 6));
    out[1] = (char)(0x80 | (cp & 0x3F));
    return 2;
  }
  if (cp < 0x10000) {
    out[0] = (char)(0xE0 | (cp >> 12));
    out[1] = (char)(0x80 | ((cp >> 6) & 0x3F));
    out[2] = (char)(0x80 | (cp & 0x3F));
    return 3;
  }
  out[0] = (char)(0xF0 | (cp >> 18));
  out[1] = (char)(0x80 | ((cp >> 12) & 0x3F));
  out[2] = (char)(0x80 | ((cp >> 6) & 0x3F));
  out[3] = (char)(0x80 | (cp & 0x3F));
  return 4;
}

/* The code point at `i` in lower case at `out`, a capital sigma final where a cased letter comes before it and none after; how many bytes. */
static size_t lowered(const unsigned long *cps, size_t count, size_t i, char *out) {
  unsigned long folded[2];
  size_t parts, k, used = 0;
  if (cps[i] == 0x3A3) return encoded(cased_beside(cps, count, i, false) && !cased_beside(cps, count, i, true) ? 0x3C2 : 0x3C3, out);
  parts = prose_unicode_lower(cps[i], folded);
  for (k = 0; k < parts; k++) used += encoded(folded[k], out + used);
  return used;
}

sprout_status typed_lower(sprout_arena *arena, sprout_str text, sprout_str *lower) {
  unsigned long *cps = (unsigned long *)sprout_arena_take(arena, (text.length + 1) * sizeof *cps);
  char *out = (char *)sprout_arena_take(arena, text.length * 8 + 1);
  size_t n = 0, at = 0, width, i, used = 0;
  if (cps == NULL || out == NULL) return SPROUT_NO_MEMORY;
  while (at < text.length) {
    cps[n++] = prose_decode(text.bytes, text.length, at, &width);
    at += width;
  }
  for (i = 0; i < n; i++) used += lowered(cps, n, i, out + used);
  out[used] = '\0';
  lower->bytes = out;
  lower->length = used;
  return SPROUT_OK;
}

sprout_status typed_words(sprout_arena *arena, sprout_str text, sprout_str **words, size_t *count) {
  unsigned long *cps = (unsigned long *)sprout_arena_take(arena, (text.length + 1) * sizeof *cps);
  sprout_str *found = (sprout_str *)sprout_arena_take(arena, (text.length + 1) * sizeof *found);
  /* A code point lower-cases to two at most, each four bytes at most, and each word ends in a NUL. */
  char *out = (char *)sprout_arena_take(arena, text.length * 9 + 1);
  size_t n = 0, at = 0, width, i, made = 0, used = 0, begun = 0;
  bool open = false;
  if (cps == NULL || found == NULL || out == NULL) return SPROUT_NO_MEMORY;
  while (at < text.length) {
    cps[n++] = prose_decode(text.bytes, text.length, at, &width);
    at += width;
  }
  for (i = 0; i <= n; i++) {
    bool space = i < n && prose_is_space(cps[i]);
    bool comma = i < n && cps[i] == ',';
    if ((i == n || space || comma) && open) {
      found[made].bytes = out + begun;
      found[made++].length = used - begun;
      out[used++] = '\0';
      open = false;
    }
    if (i == n || space) continue;
    if (!open) {
      begun = used;
      open = true;
    }
    if (comma) {
      found[made].bytes = out + begun;
      found[made++].length = 1;
      out[used++] = ',';
      out[used++] = '\0';
      open = false;
      continue;
    }
    used += lowered(cps, n, i, out + used);
  }
  *words = found;
  *count = made;
  return SPROUT_OK;
}
