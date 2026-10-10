/*
 * Tests for src/turn/command.c: a command runs the reading the host's parser made, in a draft that commits when
 * the turn ends and is dropped when it faults; a fault tells the actor so in the world's words and leaves the
 * stored world byte for byte as it was (the spec's The runtime > Turns).
 */
#include "turn_fixture.h"

static void a_command_that_acts_writes_what_it_changed_and_leaves_a_log_entry(void) {
  turn_world w;
  sprout_outcome out;
  sprout_filling filling;
  sprout_reading reading;
  sprout_turn_input input;
  tw_open(&w, "turn-faults");
  tw_arrive(&w, "v-marta", "Marta", 1000, &out);
  sprout_outcome_free(&out);
  CHECK_INT(tw_property(&w, "turn_faults.porch.dud", "cracked"), 0);
  reading = tw_reading("turn_faults.crack", tw_person(&w, "v-marta"), &filling, "target", "turn_faults.porch.dud");
  input = tw_input(SPROUT_TURN_COMMAND, 1001);
  input.visit = "v-marta";
  input.reading = &reading;
  input.text = "crack dud";
  input.text_length = 9;
  CHECK_INT(tw_run(&w, input, 7, &out), SPROUT_OK);
  CHECK_INT(out.result, SPROUT_RESULT_DONE);
  CHECK(out.committed && out.state_changed && !out.faulted);
  CHECK(tw_told(&out, "v-marta", "The fuse splits along its length."));
  CHECK_INT(tw_property(&w, "turn_faults.porch.dud", "cracked"), 1);
  CHECK(out.has_log);
  CHECK_INT(out.log.kind, SPROUT_TURN_COMMAND);
  CHECK_INT(out.log.seed, 7);
  CHECK_INT(out.log.seconds, 1001);
  CHECK_BYTES(out.log.text.bytes, out.log.text.length, "crack dud");
  sprout_outcome_free(&out);
  tw_close(&w);
}

static void a_command_that_faults_tells_the_actor_and_leaves_the_world_byte_for_byte(void) {
  turn_world w;
  sprout_outcome out;
  char *before, *after;
  tw_open(&w, "turn-faults");
  tw_arrive(&w, "v-marta", "Marta", 1000, &out);
  sprout_outcome_free(&out);
  tw_go(&w, "v-marta", "down", "down the stair", "cellar", 1001, &out);
  CHECK_INT(out.result, SPROUT_RESULT_DONE);
  sprout_outcome_free(&out);
  tw_do(&w, "v-marta", "rot", "cellar", 1002, &out);
  CHECK_INT(tw_property(&w, "turn_faults.cellar", "rotten"), 1);
  sprout_outcome_free(&out);
  tw_arrive(&w, "v-ines", "Ines", 1003, &out);
  sprout_outcome_free(&out);
  before = tw_bytes(&w);
  tw_go(&w, "v-ines", "down", "down the stair", "cellar", 1004, &out);
  after = tw_bytes(&w);
  CHECK_INT(out.result, SPROUT_RESULT_FAULTED);
  CHECK(out.faulted && !out.committed && !out.state_changed);
  CHECK_STR(out.fault_name, "IntegerOverflow");
  CHECK(tw_told(&out, "v-ines", "Something in this world has gone wrong, and nothing has changed."));
  CHECK_INT(out.line_count, 1);
  CHECK(strcmp(before, after) == 0);
  sprout_outcome_free(&out);
  free(before);
  free(after);
  tw_close(&w);
}

static void a_refusals_words_see_into_the_hands_of_the_visitor_who_acted(void) {
  turn_world w;
  sprout_outcome out;
  sprout_filling filling;
  sprout_reading take;
  tw_open(&w, "refusal-hands");
  tw_arrive(&w, "v-marta", "Marta", 1000, &out);
  sprout_outcome_free(&out);
  take = tw_reading("sprout.take", tw_person(&w, "v-marta"), &filling, "target", "refusal_hands.hall.stone");
  tw_command(&w, "v-marta", &take, 1001, &out);
  CHECK(tw_told(&out, "v-marta", "The stone will not budge for someone carrying 0 coffins."));
  sprout_outcome_free(&out);
  take = tw_reading("sprout.take", tw_person(&w, "v-marta"), &filling, "target", "refusal_hands.hall.coffin");
  tw_command(&w, "v-marta", &take, 1002, &out);
  sprout_outcome_free(&out);
  take = tw_reading("sprout.take", tw_person(&w, "v-marta"), &filling, "target", "refusal_hands.hall.stone");
  tw_command(&w, "v-marta", &take, 1003, &out);
  CHECK(tw_told(&out, "v-marta", "The stone will not budge for someone carrying 1 coffins."));
  sprout_outcome_free(&out);
  tw_close(&w);
}

static void a_command_by_someone_not_in_the_world_is_the_hosts_defect_and_writes_nothing(void) {
  turn_world w;
  sprout_outcome out;
  sprout_filling filling;
  sprout_reading reading;
  sprout_turn_input input = tw_input(SPROUT_TURN_COMMAND, 1000);
  char *before, *after;
  tw_open(&w, "turn-faults");
  before = tw_bytes(&w);
  reading = tw_reading("turn_faults.crack", "turn_faults#1", &filling, "target", "turn_faults.porch.dud");
  input.visit = "v-nobody";
  input.reading = &reading;
  CHECK_INT(tw_run(&w, input, 0, &out), SPROUT_BAD_INPUT);
  CHECK(strlen(out.fault.text) > 0);
  after = tw_bytes(&w);
  CHECK(strcmp(before, after) == 0);
  sprout_outcome_free(&out);
  free(before);
  free(after);
  tw_close(&w);
}

int main(void) {
  RUN(a_command_that_acts_writes_what_it_changed_and_leaves_a_log_entry);
  RUN(a_command_that_faults_tells_the_actor_and_leaves_the_world_byte_for_byte);
  RUN(a_refusals_words_see_into_the_hands_of_the_visitor_who_acted);
  RUN(a_command_by_someone_not_in_the_world_is_the_hosts_defect_and_writes_nothing);
  return REPORT();
}
