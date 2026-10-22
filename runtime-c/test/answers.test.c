/*
 * Tests for src/answers.c: a person who moved reads the place they arrived in, and one who typed `look` reads
 * the place they stand in, both after what the turn's bodies said (the spec's Verbs > Engine verbs; The runtime
 * > Effects); `seen` is `:look` for a look and `:examine` for an examination, the place's own included (Prose);
 * and `help` offers nothing unseen (Range > Unseen). Both are folded into the lines before what follows the command
 * runs (Verbs > After a command), and a place is read once for one arrival.
 */
#include "turn_fixture.h"

static void a_person_who_moved_reads_the_place_they_arrived_in(void) {
  turn_world w;
  sprout_outcome out;
  tw_open(&w, "turn-faults");
  tw_arrive(&w, "v-marta", "Marta", 1000, &out);
  sprout_outcome_free(&out);
  tw_go(&w, "v-marta", "down", "down the stair", "cellar", 1001, &out);
  CHECK_INT(out.result, SPROUT_RESULT_DONE);
  CHECK(tw_told(&out, "v-marta", "A cold cellar."));
  CHECK_INT(out.line_count, 1);
  if (out.line_count == 1) CHECK_INT(out.lines[0].kind, SPROUT_LINE_DESCRIBED);
  sprout_outcome_free(&out);
  tw_close(&w);
}

static void a_look_is_answered_with_the_place_and_a_body_that_spoke_is_heard_alone(void) {
  turn_world w;
  sprout_outcome out;
  sprout_reading look;
  sprout_filling none;
  tw_open(&w, "turn-faults");
  tw_arrive(&w, "v-marta", "Marta", 1000, &out);
  sprout_outcome_free(&out);
  look = tw_reading("sprout.look", tw_person(&w, "v-marta"), &none, NULL, NULL);
  tw_command(&w, "v-marta", &look, 1001, &out);
  CHECK_INT(out.result, SPROUT_RESULT_DONE);
  CHECK(tw_told(&out, "v-marta", "A stone porch, and a steep stair going down."));
  sprout_outcome_free(&out);
  tw_do(&w, "v-marta", "crack", "porch.dud", 1002, &out);
  CHECK_INT(out.line_count, 1);
  CHECK(tw_told(&out, "v-marta", "The fuse splits along its length."));
  sprout_outcome_free(&out);
  tw_close(&w);
}

/* A bucket is the place of whoever stands in it: a look reads it for `:look`, and an examination of it for `:examine`. */
static void a_look_and_an_examination_of_the_place_are_told_apart_by_seen(void) {
  turn_world w;
  sprout_outcome out;
  sprout_reading reading;
  sprout_filling filling;
  const char *bucket = "examine_from_inside.well.bucket";
  const char *itself = "A wooden bucket, banded with iron, big enough to stand in.";
  const char *from_it = "From the bucket you see the round stone walls of the well, and daylight far above.";
  tw_open(&w, "examine-from-inside");
  tw_arrive(&w, "v-marta", "Marta", 1000, &out);
  sprout_outcome_free(&out);
  reading = tw_reading("sprout.examine", tw_person(&w, "v-marta"), &filling, "target", bucket);
  tw_command(&w, "v-marta", &reading, 1001, &out);
  CHECK(tw_told(&out, "v-marta", itself));
  sprout_outcome_free(&out);
  tw_do(&w, "v-marta", "board", "well.bucket", 1002, &out);
  CHECK(tw_told(&out, "v-marta", from_it));
  sprout_outcome_free(&out);
  reading = tw_reading("sprout.look", tw_person(&w, "v-marta"), &filling, NULL, NULL);
  tw_command(&w, "v-marta", &reading, 1003, &out);
  CHECK(tw_told(&out, "v-marta", from_it));
  CHECK(!tw_told(&out, "v-marta", itself));
  sprout_outcome_free(&out);
  reading = tw_reading("sprout.examine", tw_person(&w, "v-marta"), &filling, "target", bucket);
  tw_command(&w, "v-marta", &reading, 1004, &out);
  CHECK(tw_told(&out, "v-marta", itself));
  CHECK(!tw_told(&out, "v-marta", from_it));
  sprout_outcome_free(&out);
  tw_close(&w);
}

/* Whether a line the outcome told `visit` holds `word`. */
static bool told_word(const sprout_outcome *out, const char *visit, const char *word) {
  size_t i, at, length = strlen(word);
  for (i = 0; i < out->line_count; i++) {
    if (out->lines[i].recipient_length != strlen(visit) || memcmp(out->lines[i].recipient, visit, out->lines[i].recipient_length) != 0)
      continue;
    for (at = 0; at + length <= out->lines[i].text_length; at++)
      if (memcmp(out->lines[i].text + at, word, length) == 0) return true;
  }
  return false;
}

static void help_offers_nothing_that_is_unseen(void) {
  turn_world w;
  sprout_outcome out;
  sprout_filling filling;
  sprout_reading reading;
  memset(&w, 0, sizeof w);
  tw_open(&w, "unseen");
  tw_arrive(&w, "v-marta", "Marta", 1000, &out);
  sprout_outcome_free(&out);
  reading = tw_reading("sprout.help", tw_person(&w, "v-marta"), &filling, NULL, NULL);
  tw_command(&w, "v-marta", &reading, 1001, &out);
  CHECK(told_word(&out, "v-marta", "ring bell"));
  CHECK(!told_word(&out, "v-marta", "thief") && !told_word(&out, "v-marta", "coin"));
  sprout_outcome_free(&out);
  tw_close(&w);
}

/* Where `text` stands among the outcome's lines, or -1. */
static int line_index(const sprout_outcome *out, const char *text) {
  size_t i;
  for (i = 0; i < out->line_count; i++)
    if (out->lines[i].text_length == strlen(text) && memcmp(out->lines[i].text, text, out->lines[i].text_length) == 0) return (int)i;
  return -1;
}

static void the_arrival_and_the_answer_are_read_before_what_follows_the_command(void) {
  turn_world w;
  sprout_outcome out;
  sprout_reading look;
  sprout_filling none;
  const char *falls = "Water thunders down a cleft in the rock.", *roar = "The roar of the water is deafening.";
  size_t i;
  int read = 0;
  tw_open(&w, "after-command");
  tw_arrive(&w, "v-marta", "Marta", 1000, &out);
  sprout_outcome_free(&out);
  tw_go(&w, "v-marta", "north", "up to the falls", "falls", 1001, &out);
  CHECK(line_index(&out, falls) >= 0 && line_index(&out, falls) < line_index(&out, roar));
  for (i = 0; i < out.line_count; i++) read += out.lines[i].kind == SPROUT_LINE_DESCRIBED;
  CHECK_INT(read, 1);
  sprout_outcome_free(&out);
  look = tw_reading("sprout.look", tw_person(&w, "v-marta"), &none, NULL, NULL);
  tw_command(&w, "v-marta", &look, 1002, &out);
  CHECK(line_index(&out, falls) >= 0 && line_index(&out, falls) < line_index(&out, roar));
  sprout_outcome_free(&out);
  tw_close(&w);
}

int main(void) {
  RUN(a_person_who_moved_reads_the_place_they_arrived_in);
  RUN(a_look_is_answered_with_the_place_and_a_body_that_spoke_is_heard_alone);
  RUN(a_look_and_an_examination_of_the_place_are_told_apart_by_seen);
  RUN(help_offers_nothing_that_is_unseen);
  RUN(the_arrival_and_the_answer_are_read_before_what_follows_the_command);
  return REPORT();
}
