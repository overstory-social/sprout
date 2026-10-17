/*
 * ui/transcript.c: the reader's transcript. Paragraphs are led by their kind's mark and wrapped
 * to the column; the newest lines are shown at the bottom; a reader scrolled back keeps their
 * place as more is told and cannot scroll past either end; the oldest paragraphs fall off past
 * the keep; the column can be fitted to another row count without losing a line; a font that
 * changes wraps every paragraph and the status again with every line told still there; and the
 * status is the place and its ways out, wrapped to the column.
 */
#include <stdio.h>

#include "support.h"
#include "ui/transcript.h"

/* A font ten pixels a byte, so a column of 100 holds ten. */
static int measure(void *ctx, const char *text, size_t length) {
  (void)ctx;
  return (int)length * 10;
}

static void push(transcript *t, const char *kind, const char *text) {
  CHECK(transcript_push(t, kind, text, strlen(text)), "pushing %s", text);
}

static void kinds_are_led_by_their_mark(void) {
  transcript t;
  const char *shown[4];
  size_t n;
  begin("leads");
  transcript_init(&t, &fake->api, measure, measure, NULL, 100, 4);
  push(&t, "typed", "look");
  push(&t, "refused", "no");
  push(&t, "notice", "hm");
  push(&t, "client", "hi");
  n = transcript_visible(&t, shown);
  CHECK(n == 4 && strcmp(shown[0], "> look") == 0 && strcmp(shown[1], "! no") == 0 && strcmp(shown[2], "* hm") == 0 &&
            strcmp(shown[3], "- hi") == 0,
        "%zu: %s %s %s %s", n, shown[0], shown[1], shown[2], shown[3]);
  push(&t, "said", "plain");
  push(&t, "described", "plain too");
  n = transcript_visible(&t, shown);
  CHECK(strcmp(shown[2], "plain") == 0 && strcmp(shown[3], "plain too") == 0, "the world's own lines have no mark");
  transcript_free(&t);
  end();
}

static void the_newest_are_at_the_bottom_and_a_reader_scrolled_back_keeps_their_place(void) {
  transcript t;
  const char *shown[3];
  size_t n;
  begin("scroll");
  transcript_init(&t, &fake->api, measure, measure, NULL, 100, 3);
  push(&t, "said", "one two three four five six"); /* "one two" "three four" "five six" */
  push(&t, "said", "seven");
  CHECK(t.line_count == 4 && transcript_furthest(&t) == 1, "%zu lines", t.line_count);
  n = transcript_visible(&t, shown);
  CHECK(n == 3 && strcmp(shown[0], "three four") == 0 && strcmp(shown[2], "seven") == 0, "the newest three: %s .. %s", shown[0],
        shown[2]);
  CHECK(!transcript_behind(&t), "at the newest");
  transcript_scroll(&t, 5);
  n = transcript_visible(&t, shown);
  CHECK(t.offset == 1 && strcmp(shown[0], "one two") == 0 && strcmp(shown[2], "five six") == 0 && transcript_behind(&t),
        "back as far as the first line and no further: %zu", t.offset);
  push(&t, "said", "eight");
  n = transcript_visible(&t, shown);
  CHECK(strcmp(shown[0], "one two") == 0 && t.offset == 2, "a reader scrolled back still sees what they saw");
  transcript_scroll(&t, -10);
  n = transcript_visible(&t, shown);
  CHECK(t.offset == 0 && strcmp(shown[2], "eight") == 0 && !transcript_behind(&t), "forward stops at the newest");
  push(&t, "said", "nine");
  n = transcript_visible(&t, shown);
  CHECK(strcmp(shown[2], "nine") == 0, "a reader at the newest sees what comes");
  transcript_free(&t);
  end();
}

static void a_short_transcript_shows_all_and_does_not_scroll(void) {
  transcript t;
  const char *shown[5];
  begin("short");
  transcript_init(&t, &fake->api, measure, measure, NULL, 100, 5);
  CHECK(transcript_visible(&t, shown) == 0, "nothing told, nothing shown");
  push(&t, "said", "only");
  transcript_scroll(&t, 3);
  CHECK(transcript_visible(&t, shown) == 1 && t.offset == 0 && !transcript_behind(&t), "one line, no scroll");
  transcript_free(&t);
  end();
}

static void the_oldest_fall_off_past_the_keep(void) {
  transcript t;
  const char *shown[2];
  char said[32];
  int i;
  begin("keep");
  transcript_init(&t, &fake->api, measure, measure, NULL, 100, 2);
  for (i = 1; i <= TRANSCRIPT_KEEP + 50; i++) {
    snprintf(said, sizeof said, "p%d", i);
    push(&t, "said", said);
  }
  CHECK(t.count == TRANSCRIPT_KEEP && t.line_count == TRANSCRIPT_KEEP, "%zu kept, %zu lines", t.count, t.line_count);
  transcript_scroll(&t, 100000);
  transcript_visible(&t, shown);
  CHECK(strcmp(shown[0], "p51") == 0, "the oldest kept is the 51st: %s", shown[0]);
  transcript_free(&t);
  end();
}

/* A font `*ctx` pixels a byte. */
static int measure_scaled(void *ctx, const char *text, size_t length) {
  (void)text;
  return (int)length * *(const int *)ctx;
}

/* The characters of `line` that are not spaces, appended to `out`. */
static void ink_line(const char *line, char *out) {
  out += strlen(out);
  for (; *line != '\0'; line++)
    if (*line != ' ') *out++ = *line;
  *out = '\0';
}

/* The characters of every kept line, oldest first, without spaces, into `out`; the transcript is left at the newest. */
static void all_ink(transcript *t, char *out) {
  const char *shown[64];
  size_t n, i;
  transcript_scroll(t, 100000);
  n = transcript_visible(t, shown);
  *out = '\0';
  for (i = 0; i < n; i++) ink_line(shown[i], out);
  while (t->offset > 0) {
    transcript_scroll(t, -1);
    n = transcript_visible(t, shown);
    ink_line(shown[n - 1], out);
  }
}

/*
 * A font that grows wraps every paragraph and the status again by the new measure: the lines fit
 * the column, every character told is still there in order, a marked kind keeps its mark, and a
 * reader scrolled back is still within the transcript once the rows are fitted.
 */
static void a_font_that_changes_wraps_every_paragraph_again_and_loses_nothing(void) {
  transcript t;
  sprout_seen_view view;
  sprout_seen_exit exits[2];
  char before[1024], after[1024];
  const char *shown[8];
  int scale = 10;
  size_t n, i;
  begin("rewrap");
  transcript_init(&t, &fake->api, measure_scaled, measure_scaled, &scale, 100, 4);
  push(&t, "typed", "look around");
  push(&t, "said", "one two three four five six seven");
  push(&t, "described", "a\nnewline stays");
  push(&t, "notice", "abcdefghijklmnopqrstuvwxyz");
  memset(&view, 0, sizeof view);
  memset(exits, 0, sizeof exits);
  view.place.name.bytes = "the hall";
  view.place.name.length = 8;
  exits[0].direction = "north";
  exits[1].direction = "south";
  view.exits = exits;
  view.exit_count = 2;
  CHECK(transcript_set_status(&t, &view) && t.status.line_count == 4, "the status at ten a byte: %zu lines", t.status.line_count);
  CHECK(t.line_count == 2 + 4 + 3 + 4, "ten a byte: %zu lines", t.line_count);
  all_ink(&t, before);
  transcript_scroll(&t, 100000);
  scale = 20;
  transcript_rewrap(&t);
  transcript_fit(&t, 2);
  CHECK(t.rows == 2 && t.line_count == 4 + 7 + 4 + 7, "five a byte, two rows: %zu lines", t.line_count);
  CHECK(t.status.line_count == 8 && strcmp(t.status.bytes, "the") == 0, "the status wraps again too: %zu lines", t.status.line_count);
  CHECK(t.offset <= transcript_furthest(&t), "the place scrolled back to is still within the transcript: %zu of %zu", t.offset,
        transcript_furthest(&t));
  transcript_scroll(&t, 100000);
  n = transcript_visible(&t, shown);
  CHECK(n == 2 && strcmp(shown[0], ">") == 0 && strcmp(shown[1], "look") == 0, "the mark still leads: %s | %s", shown[0], shown[1]);
  for (;;) {
    n = transcript_visible(&t, shown);
    for (i = 0; i < n; i++)
      CHECK(measure_scaled(&scale, shown[i], strlen(shown[i])) <= 100 || strlen(shown[i]) == 1, "\"%s\" is wider than the column",
            shown[i]);
    if (t.offset == 0) break;
    transcript_scroll(&t, -1);
  }
  all_ink(&t, after);
  CHECK(strcmp(before, after) == 0, "every character told is still there:\n%s\n%s", before, after);
  scale = 10;
  transcript_rewrap(&t);
  transcript_fit(&t, 4);
  CHECK(t.line_count == 13 && t.rows == 4, "wrapped back: %zu lines", t.line_count);
  all_ink(&t, after);
  CHECK(strcmp(before, after) == 0, "and still whole");
  transcript_free(&t);
  end();
}

static sprout_str str(const char *text) {
  sprout_str s;
  s.bytes = text;
  s.length = strlen(text);
  return s;
}

/* The status's lines joined by one space, into `out`. */
static void status_joined(const transcript *t, char *out, size_t room) {
  const char *line = t->status.bytes;
  size_t i;
  out[0] = '\0';
  for (i = 0; i < t->status.line_count; i++, line = wrap_next(line))
    snprintf(out + strlen(out), room - strlen(out), "%s%s", i > 0 ? " " : "", line);
}

static void the_status_is_the_place_and_its_ways_out(void) {
  transcript t;
  sprout_seen_view view;
  sprout_seen_exit exits[2];
  char joined[256];
  begin("status");
  transcript_init(&t, &fake->api, measure, measure, NULL, 1000, 2);
  CHECK(t.status.line_count == 0, "no lines before the first view");
  memset(&view, 0, sizeof view);
  memset(exits, 0, sizeof exits);
  view.place.name = str("the hall");
  CHECK(transcript_set_status(&t, &view) && t.status.line_count == 1 && strcmp(t.status.bytes, "the hall") == 0,
        "no ways out: %s", t.status.bytes);
  exits[0].direction = "north";
  exits[0].label = "to the yard";
  exits[1].label = "the trapdoor";
  view.exits = exits;
  view.exit_count = 2;
  CHECK(transcript_set_status(&t, &view) && t.status.line_count == 1, "one line in a wide column: %zu", t.status.line_count);
  status_joined(&t, joined, sizeof joined);
  CHECK(strcmp(joined, "the hall - exits: north, the trapdoor") == 0, "an exit by its direction, a link by its label: %s", joined);
  transcript_free(&t);
  end();
}

/* A place with more ways out than the column holds on one line: the status wraps, and every way out is on the lines. */
static void a_status_with_many_ways_out_wraps_to_the_column(void) {
  static const char *const ways[] = {"north", "south", "east", "west", "up", "down", "the arch", "the stair"};
  transcript t;
  sprout_seen_view view;
  sprout_seen_exit exits[8];
  const char *line;
  char joined[256], want[256];
  size_t i, k;
  begin("status-wraps");
  transcript_init(&t, &fake->api, measure, measure, NULL, 100, 2);
  memset(&view, 0, sizeof view);
  memset(exits, 0, sizeof exits);
  view.place.name = str("the hall");
  for (i = 0; i < 8; i++) exits[i].label = ways[i];
  view.exits = exits;
  view.exit_count = 8;
  CHECK(transcript_set_status(&t, &view), "the status is set");
  CHECK(t.status.line_count > 1, "it takes more than one line: %zu", t.status.line_count);
  for (i = 0, line = t.status.bytes; i < t.status.line_count; i++, line = wrap_next(line))
    CHECK(measure(NULL, line, strlen(line)) <= 100, "line %zu is wider than the column: %s", i, line);
  for (k = 0; k < 8; k++) {
    /* A way out of more than one word may break between them: each of its words is on some line. */
    char words[32], *word, *rest = words;
    snprintf(words, sizeof words, "%s", ways[k]);
    while ((word = strsep(&rest, " ")) != NULL) {
      bool found = false;
      for (i = 0, line = t.status.bytes; i < t.status.line_count; i++, line = wrap_next(line)) found = found || HAS(line, word);
      CHECK(found, "%s of %s is on no line", word, ways[k]);
    }
  }
  status_joined(&t, joined, sizeof joined);
  snprintf(want, sizeof want, "the hall - exits: ");
  for (k = 0; k < 8; k++) snprintf(want + strlen(want), sizeof want - strlen(want), "%s%s", k > 0 ? ", " : "", ways[k]);
  CHECK(strcmp(joined, want) == 0, "the lines read as the one status: %s", joined);
  transcript_free(&t);
  end();
}

/* Fitting the column to fewer rows loses no line: a reader at the newest stays there, one scrolled back stays within reach. */
static void fitting_the_column_keeps_every_line(void) {
  transcript t;
  const char *shown[5];
  size_t n;
  begin("fit");
  transcript_init(&t, &fake->api, measure, measure, NULL, 100, 5);
  push(&t, "said", "one");
  push(&t, "said", "two");
  push(&t, "said", "three");
  push(&t, "said", "four");
  push(&t, "said", "five");
  transcript_fit(&t, 3);
  n = transcript_visible(&t, shown);
  CHECK(t.rows == 3 && n == 3 && strcmp(shown[0], "three") == 0 && strcmp(shown[2], "five") == 0 && t.line_count == 5,
        "three rows show the newest three, and all five are kept: %zu", n);
  transcript_scroll(&t, 2);
  transcript_fit(&t, 4);
  n = transcript_visible(&t, shown);
  CHECK(t.offset == 1 && n == 4 && strcmp(shown[0], "one") == 0 && strcmp(shown[3], "four") == 0,
        "a reader scrolled to the oldest is kept within what there is: offset %zu", t.offset);
  transcript_fit(&t, 5);
  n = transcript_visible(&t, shown);
  CHECK(t.offset == 0 && n == 5 && strcmp(shown[4], "five") == 0, "wide enough for everything, nothing is scrolled back");
  transcript_free(&t);
  end();
}

int main(void) {
  test_program("transcript");
  kinds_are_led_by_their_mark();
  the_newest_are_at_the_bottom_and_a_reader_scrolled_back_keeps_their_place();
  a_short_transcript_shows_all_and_does_not_scroll();
  the_oldest_fall_off_past_the_keep();
  a_font_that_changes_wraps_every_paragraph_again_and_loses_nothing();
  the_status_is_the_place_and_its_ways_out();
  a_status_with_many_ways_out_wraps_to_the_column();
  fitting_the_column_keeps_every_line();
  return finish();
}
