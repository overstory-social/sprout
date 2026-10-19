/*
 * Tests for src/reading/after.c (the spec's Verbs > After a command), over the corpus world `after-command`: what
 * follows a visitor's command runs nearest first, the lamp she carries, then the place, then the world; after the
 * description of a place she walked into; not after a refused command, nor for what she has set down or shut in her
 * tin; not for an arrival or a tick; and a plain `tell` from it leaves her out while her neighbour reads it.
 */
#include "turn_fixture.h"

static const char *const lamp = "after_command.cellar.lamp";

/* Where `text` stands among what the outcome told `visit`, or -1. */
static int line_at(const sprout_outcome *out, const char *visit, const char *text) {
  size_t i;
  for (i = 0; i < out->line_count; i++)
    if (out->lines[i].recipient_length == strlen(visit) && memcmp(out->lines[i].recipient, visit, out->lines[i].recipient_length) == 0 &&
        out->lines[i].text_length == strlen(text) && memcmp(out->lines[i].text, text, out->lines[i].text_length) == 0)
      return (int)i;
  return -1;
}

/* Runs the library's or the world's `verb` on the lamp as `visit`. */
static void on_lamp(turn_world *w, const char *visit, const char *verb, uint64_t instant, sprout_outcome *out) {
  sprout_filling filling;
  sprout_reading reading = tw_reading(verb, tw_person(w, visit), &filling, "target", lamp);
  tw_command(w, visit, &reading, instant, out);
}

/* Marta in the cellar, the lamp in her hands and lit; Wren already at the falls. */
static void lit_in_hand(turn_world *w) {
  sprout_outcome out;
  tw_open(w, "after-command");
  tw_arrive(w, "v-wren", "Wren", 1000, &out);
  sprout_outcome_free(&out);
  tw_go(w, "v-wren", "north", "up to the falls", "falls", 1001, &out);
  sprout_outcome_free(&out);
  tw_arrive(w, "v-marta", "Marta", 1002, &out);
  sprout_outcome_free(&out);
  on_lamp(w, "v-marta", "sprout.take", 1003, &out);
  sprout_outcome_free(&out);
  on_lamp(w, "v-marta", "after_command.light", 1004, &out);
  CHECK(tw_told(&out, "v-marta", "The wick catches."));
  CHECK(line_at(&out, "v-marta", "The wick catches.") < line_at(&out, "v-marta", "The lamp burns a little lower."));
  sprout_outcome_free(&out);
}

static void what_follows_runs_nearest_first_after_the_place_walked_into_is_read(void) {
  turn_world w;
  sprout_outcome out;
  int described, lamp_line, roar, bell;
  lit_in_hand(&w);
  CHECK_INT(tw_property(&w, lamp, "charge"), 4);
  CHECK_INT(tw_property(&w, "after_command", "commands"), 3);
  tw_go(&w, "v-marta", "north", "up to the falls", "falls", 1005, &out);
  described = line_at(&out, "v-marta", "Water thunders down a cleft in the rock.");
  lamp_line = line_at(&out, "v-marta", "The lamp burns a little lower.");
  roar = line_at(&out, "v-marta", "The roar of the water is deafening.");
  bell = line_at(&out, "v-marta", "Somewhere far off, a bell tolls.");
  CHECK(described >= 0 && described < lamp_line && lamp_line < roar && roar < bell);
  /* The room's plain `tell` leaves out the one who made the command, and reaches the one beside her. */
  CHECK(tw_told(&out, "v-wren", "Marta winces at the noise."));
  CHECK(line_at(&out, "v-marta", "Marta winces at the noise.") < 0);
  CHECK_INT(tw_property(&w, lamp, "charge"), 3);
  CHECK_INT(tw_property(&w, "after_command", "commands"), 4);
  sprout_outcome_free(&out);
  tw_close(&w);
}

static void a_refused_command_is_followed_by_nothing(void) {
  turn_world w;
  sprout_outcome out;
  lit_in_hand(&w);
  on_lamp(&w, "v-marta", "after_command.light", 1005, &out);
  CHECK(out.refused);
  CHECK_INT(out.line_count, 1);
  CHECK(tw_told(&out, "v-marta", "It is already lit."));
  CHECK_INT(tw_property(&w, lamp, "charge"), 4);
  CHECK_INT(tw_property(&w, "after_command", "commands"), 3);
  sprout_outcome_free(&out);
  tw_close(&w);
}

static void what_she_has_set_down_follows_nobody(void) {
  turn_world w;
  sprout_outcome out;
  lit_in_hand(&w);
  on_lamp(&w, "v-marta", "sprout.drop", 1005, &out);
  CHECK(line_at(&out, "v-marta", "The lamp burns a little lower.") < 0);
  CHECK_INT(tw_property(&w, lamp, "charge"), 4);
  CHECK_INT(tw_property(&w, "after_command", "commands"), 4);
  sprout_outcome_free(&out);
  tw_close(&w);
}

static void an_arrival_and_a_tick_are_followed_by_nothing(void) {
  turn_world w;
  sprout_outcome out;
  sprout_turn_input tick;
  tw_open(&w, "after-command");
  tw_arrive(&w, "v-wren", "Wren", 1000, &out);
  sprout_outcome_free(&out);
  CHECK_INT(tw_property(&w, "after_command", "commands"), 0);
  tw_go(&w, "v-wren", "north", "up to the falls", "falls", 1001, &out);
  CHECK(tw_told(&out, "v-wren", "The roar of the water is deafening."));
  sprout_outcome_free(&out);
  tick = tw_input(SPROUT_TURN_TICK, 1010);
  tick.place = "after_command.falls";
  CHECK_INT(tw_run(&w, tick, 0, &out), SPROUT_OK);
  CHECK(!tw_told(&out, "v-wren", "The roar of the water is deafening."));
  CHECK_INT(tw_property(&w, "after_command", "commands"), 1);
  sprout_outcome_free(&out);
  tw_close(&w);
}

int main(void) {
  RUN(what_follows_runs_nearest_first_after_the_place_walked_into_is_read);
  RUN(a_refused_command_is_followed_by_nothing);
  RUN(what_she_has_set_down_follows_nobody);
  RUN(an_arrival_and_a_tick_are_followed_by_nothing);
  return REPORT();
}
