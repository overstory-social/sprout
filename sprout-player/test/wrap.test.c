/*
 * ui/wrap.c: word wrap for the reader's column. The rules hold over generated text with a font
 * whose characters differ in width: no line is wider than the column unless it is one
 * character; no character is lost, added or moved; each line takes every word that fits, and a
 * word wider than the column is cut as late as it can be and never inside a character.
 */
#include <stdlib.h>

#include "support.h"
#include "host/files.h"
#include "ui/wrap.h"

/* A font whose characters are 4 to 9 pixels wide, the multibyte ones 9. */
static int measure(void *ctx, const char *text, size_t length) {
  size_t i;
  int width = 0;
  (void)ctx;
  for (i = 0; i < length; i++) {
    unsigned char c = (unsigned char)text[i];
    if ((c & 0xC0u) == 0x80u) continue;
    width += c >= 0x80u ? 9 : 4 + c % 6;
  }
  return width;
}

static size_t lines_of(const char *text, int width, const char **out, size_t room, wrapped *w) {
  const char *line;
  size_t i;
  CHECK(wrap_lines(&fake->api, text, strlen(text), width, measure, NULL, w), "wrapping %s", text);
  line = w->bytes;
  for (i = 0; i < w->line_count && i < room; i++, line = wrap_next(line)) out[i] = line;
  return w->line_count;
}

static void a_newline_starts_a_line_and_nothing_is_one_empty_line(void) {
  const char *lines[8];
  wrapped w;
  begin("newlines");
  CHECK(lines_of("", 100, lines, 8, &w) == 1 && strcmp(lines[0], "") == 0, "nothing");
  player_free(&fake->api, w.bytes);
  CHECK(lines_of("one\n\ntwo  three\n", 100, lines, 8, &w) == 4, "%zu lines", w.line_count);
  CHECK(strcmp(lines[0], "one") == 0 && strcmp(lines[1], "") == 0 && strcmp(lines[2], "two three") == 0 &&
            strcmp(lines[3], "") == 0,
        "the lines: %s|%s|%s|%s", lines[0], lines[1], lines[2], lines[3]);
  player_free(&fake->api, w.bytes);
  end();
}

static void a_word_too_wide_is_cut_between_characters(void) {
  const char *lines[8];
  wrapped w;
  size_t n, i;
  begin("cut");
  /* Each é is 9 pixels: four fit in 40, five do not; "éé cd" is 39. */
  n = lines_of("ab \xc3\xa9\xc3\xa9\xc3\xa9\xc3\xa9\xc3\xa9\xc3\xa9 cd", 40, lines, 8, &w);
  CHECK(n == 3, "%zu lines", n);
  CHECK(strcmp(lines[0], "ab") == 0, "the short word stays apart: %s", lines[0]);
  CHECK(strcmp(lines[1], "\xc3\xa9\xc3\xa9\xc3\xa9\xc3\xa9") == 0, "as many as fit: %s", lines[1]);
  CHECK(strcmp(lines[2], "\xc3\xa9\xc3\xa9 cd") == 0, "the rest takes the next word: %s", lines[2]);
  for (i = 0; i < n && i < 8; i++) CHECK(((unsigned char)lines[i][0] & 0xC0u) != 0x80u, "line %zu starts inside a character", i);
  player_free(&fake->api, w.bytes);
  end();
}

static unsigned long seed = 12345;
static unsigned next_random(void) {
  seed = seed * 6364136223846793005ul + 1442695040888963407ul;
  return (unsigned)(seed >> 33);
}

/* Generated text: words of one to twenty characters, some multibyte, between runs of spaces. */
static void generate(char *text, size_t room) {
  size_t at = 0;
  unsigned words = 1 + next_random() % 30, w, k;
  for (w = 0; w < words && at + 100 < room; w++) {
    unsigned length = 1 + next_random() % 20, spaces = 1 + next_random() % 3;
    for (k = 0; k < length; k++) {
      if (next_random() % 8 == 0) {
        text[at++] = (char)0xc3;
        text[at++] = (char)0xa9;
      } else {
        text[at++] = (char)('a' + next_random() % 26);
      }
    }
    for (k = 0; k < spaces; k++) text[at++] = ' ';
  }
  text[at] = '\0';
}

/* The characters of `text` that are not spaces, in order. */
static void ink(const char *text, char *out) {
  for (; *text != '\0'; text++)
    if (*text != ' ') *out++ = *text;
  *out = '\0';
}

static size_t char_bytes(const char *text) { return ((unsigned char)text[0] & 0x80u) ? 2 : 1; }

static void the_rules_hold_over_generated_text(void) {
  char text[2048], in_ink[2048], out_ink[2048], joined[4096], candidate[1024];
  int round;
  begin("generated");
  for (round = 0; round < 500; round++) {
    int width = 20 + (int)(next_random() % 200);
    wrapped w;
    const char *line;
    size_t i, k, at = 0, in_at = 0;
    generate(text, sizeof text);
    CHECK(wrap_lines(&fake->api, text, strlen(text), width, measure, NULL, &w), "wrapping");
    joined[0] = '\0';
    for (i = 0, line = w.bytes; i < w.line_count; i++, line = wrap_next(line)) {
      size_t n = strlen(line);
      CHECK(measure(NULL, line, n) <= width || n == char_bytes(line), "round %d: \"%s\" is wider than %d", round, line, width);
      CHECK(n == 0 || (((unsigned char)line[0] & 0xC0u) != 0x80u), "round %d: a line starts inside a character", round);
      CHECK(n == 0 || (line[0] != ' ' && line[n - 1] != ' ' && strstr(line, "  ") == NULL), "round %d: \"%s\" is not spaced by one",
            round, line);
      memcpy(joined + at, line, n);
      at += n;
      /* Walk the input along the line: a space in the line stands for a run of them in the input. */
      while (text[in_at] == ' ') in_at++;
      for (k = 0; k < n; k++) {
        if (line[k] == ' ' && text[in_at] == ' ') {
          while (text[in_at] == ' ') in_at++;
        } else {
          CHECK(line[k] == text[in_at], "round %d: \"%s\" is not the input at %zu", round, line, in_at);
          in_at++;
        }
      }
      if (i + 1 < w.line_count) {
        /* A break where the input has a space is between words; anywhere else it cuts a word. */
        const char *next = wrap_next(line);
        size_t next_word = strcspn(next, " ");
        memcpy(candidate, line, n);
        if (text[in_at] != ' ') {
          memcpy(candidate + n, next, char_bytes(next));
          CHECK(measure(NULL, candidate, n + char_bytes(next)) > width, "round %d: a cut after \"%s\" came early", round, line);
        } else {
          candidate[n] = ' ';
          memcpy(candidate + n + 1, next, next_word);
          CHECK(measure(NULL, candidate, n + 1 + next_word) > width, "round %d: \"%.*s\" would have fit after \"%s\"", round,
                (int)next_word, next, line);
        }
      }
    }
    while (text[in_at] == ' ') in_at++;
    CHECK(text[in_at] == '\0', "round %d: the lines end before the input does, at %zu", round, in_at);
    joined[at] = '\0';
    ink(text, in_ink);
    ink(joined, out_ink);
    CHECK(strcmp(in_ink, out_ink) == 0, "round %d: the characters changed:\n%s\n%s", round, in_ink, out_ink);
    player_free(&fake->api, w.bytes);
  }
  end();
}

int main(void) {
  test_program("wrap");
  a_newline_starts_a_line_and_nothing_is_one_empty_line();
  a_word_too_wide_is_cut_between_characters();
  the_rules_hold_over_generated_text();
  return finish();
}
