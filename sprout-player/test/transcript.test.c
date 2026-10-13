/*
 * ui/transcript.c: the reader's transcript. Paragraphs are led by their kind's mark and wrapped
 * to the column; the newest lines are shown at the bottom; a reader scrolled back keeps their
 * place as more is told and cannot scroll past either end; the oldest paragraphs fall off past
 * the keep; and the status line is the place and its ways out.
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
  transcript_init(&t, &fake->api, measure, NULL, 100, 4);
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
  transcript_init(&t, &fake->api, measure, NULL, 100, 3);
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
  transcript_init(&t, &fake->api, measure, NULL, 100, 5);
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
  transcript_init(&t, &fake->api, measure, NULL, 100, 2);
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

static sprout_str str(const char *text) {
  sprout_str s;
  s.bytes = text;
  s.length = strlen(text);
  return s;
}

static void the_status_is_the_place_and_its_ways_out(void) {
  transcript t;
  sprout_seen_view view;
  sprout_seen_exit exits[2];
  begin("status");
  transcript_init(&t, &fake->api, measure, NULL, 100, 2);
  memset(&view, 0, sizeof view);
  memset(exits, 0, sizeof exits);
  view.place.name = str("the hall");
  CHECK(transcript_set_status(&t, &view) && strcmp(t.status, "the hall") == 0, "no ways out: %s", t.status);
  exits[0].direction = "north";
  exits[0].label = "to the yard";
  exits[1].label = "the trapdoor";
  view.exits = exits;
  view.exit_count = 2;
  CHECK(transcript_set_status(&t, &view) && strcmp(t.status, "the hall - exits: north, the trapdoor") == 0,
        "an exit by its direction, a link by its label: %s", t.status);
  transcript_free(&t);
  end();
}

int main(void) {
  test_program("transcript");
  kinds_are_led_by_their_mark();
  the_newest_are_at_the_bottom_and_a_reader_scrolled_back_keeps_their_place();
  a_short_transcript_shows_all_and_does_not_scroll();
  the_oldest_fall_off_past_the_keep();
  the_status_is_the_place_and_its_ways_out();
  return finish();
}
