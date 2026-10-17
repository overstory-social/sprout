/* Word wrap; see wrap.h. The lines are built in place after the words' copy, in room twice the
 * text's size: every character cut onto a line of its own. */
#include "wrap.h"

#include <string.h>

#include "host/files.h"

static bool is_space(char c) { return c == ' ' || c == '\t' || c == '\r' || c == '\f' || c == '\v'; }

/* The length of the UTF-8 character that starts at `text`, at most `left`. */
static size_t char_length(const char *text, size_t left) {
  unsigned char lead = (unsigned char)text[0];
  size_t n = lead < 0x80u ? 1 : lead >= 0xF0u ? 4 : lead >= 0xE0u ? 3 : lead >= 0xC0u ? 2 : 1;
  size_t i;
  if (n > left) n = left;
  for (i = 1; i < n; i++)
    if (((unsigned char)text[i] & 0xC0u) != 0x80u) return i;
  return n;
}

typedef struct wrapping {
  char *out;
  size_t used;       /* bytes written */
  size_t line_start; /* where the line being filled begins */
  size_t lines;
  int width;
  wrap_measure measure;
  void *ctx;
} wrapping;

static int line_width(const wrapping *w) { return w->measure(w->ctx, w->out + w->line_start, w->used - w->line_start); }

/* Ends the line being filled and starts the next after it. */
static void end_line(wrapping *w) {
  w->out[w->used++] = '\0';
  w->line_start = w->used;
  w->lines++;
}

/* The line being filled is one word wider than the column: it is cut between characters into lines that fit. */
static void cut(wrapping *w) {
  size_t at = w->line_start;
  while (at < w->used) {
    size_t step = char_length(w->out + at, w->used - at);
    if (at > w->line_start && w->measure(w->ctx, w->out + w->line_start, at + step - w->line_start) > w->width) {
      memmove(w->out + at + 1, w->out + at, w->used - at);
      w->out[at] = '\0';
      w->used++;
      w->lines++;
      w->line_start = at + 1;
      at = w->line_start;
      continue;
    }
    at += step;
  }
}

/* Adds one word to the line being filled, or ends the line and starts the next with it. */
static void add_word(wrapping *w, const char *word, size_t length) {
  if (w->used > w->line_start) {
    size_t before = w->used;
    w->out[w->used++] = ' ';
    memcpy(w->out + w->used, word, length);
    w->used += length;
    if (line_width(w) <= w->width) return;
    /* The space becomes the end of the line, and the word, already after it, starts the next. */
    w->out[before] = '\0';
    w->lines++;
    w->line_start = before + 1;
  } else {
    memcpy(w->out + w->used, word, length);
    w->used += length;
  }
  if (line_width(w) > w->width) cut(w);
}

bool wrap_lines(PlaydateAPI *pd, const char *text, size_t length, int width, wrap_measure measure, void *ctx,
                wrapped *out) {
  wrapping w;
  size_t i = 0;
  char *block = (char *)player_alloc(pd, length + 1 + length * 2 + 2);
  if (block == NULL) return false;
  memset(&w, 0, sizeof w);
  memcpy(block, text, length);
  block[length] = '\0';
  w.out = block + length + 1;
  w.width = width;
  w.measure = measure;
  w.ctx = ctx;
  for (;;) {
    while (i < length && text[i] != '\n') {
      size_t start;
      if (is_space(text[i])) {
        i++;
        continue;
      }
      start = i;
      while (i < length && text[i] != '\n' && !is_space(text[i])) i++;
      add_word(&w, text + start, i - start);
    }
    end_line(&w);
    if (i >= length) break;
    i++; /* past the newline */
  }
  out->bytes = w.out;
  out->line_count = w.lines;
  out->text = block;
  out->length = length;
  return true;
}

bool wrap_again(PlaydateAPI *pd, wrapped *w, int width, wrap_measure measure, void *ctx) {
  wrapped again;
  if (w->bytes == NULL || !wrap_lines(pd, w->text, w->length, width, measure, ctx, &again)) return false;
  wrap_free(pd, w);
  *w = again;
  return true;
}

void wrap_free(PlaydateAPI *pd, wrapped *w) {
  if (w->bytes != NULL) player_free(pd, w->text);
  w->bytes = NULL;
  w->text = NULL;
  w->line_count = 0;
  w->length = 0;
}

const char *wrap_next(const char *line) { return line + strlen(line) + 1; }
