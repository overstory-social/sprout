/*
 * Tests for src/turn/command.c: a command runs a reading built from chips as it is, or reads typed words in the
 * turn and runs what they make, in a draft that commits when the turn ends and is dropped when it faults; a fault
 * tells the actor so in the world's words and leaves the stored world byte for byte as it was (the spec's The
 * runtime > Turns). A typed line's turns are driven through src/line.c as a host drives them: an intent's steps,
 * each a turn, a refusal or an answer ending the line (Parsing > Intents; Sequences, again and all), and words left
 * over dropped and the words read restated first (When nothing matches). Where the host asks, a command accounts for
 * the handlers it ran and the line it was answered with; a consent refusal is told apart.
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

static void a_role_players_permit_and_do_see_into_the_hands_of_the_visitor_who_acted_only(void) {
  turn_world w;
  sprout_outcome out;
  sprout_filling filling;
  sprout_reading take;
  tw_open(&w, "reading-hands");
  tw_arrive(&w, "v-wren", "Wren", 1000, &out);
  sprout_outcome_free(&out);
  tw_arrive(&w, "v-ash", "Ash", 1001, &out);
  sprout_outcome_free(&out);
  take = tw_reading("sprout.take", tw_person(&w, "v-wren"), &filling, "target", "reading_hands.shed.match");
  tw_command(&w, "v-wren", &take, 1002, &out);
  sprout_outcome_free(&out);
  tw_do(&w, "v-wren", "strike", "shed.match", 1003, &out);
  sprout_outcome_free(&out);
  /* Wren's burning match is not in Ash's hands, and only the acting visitor's open. */
  tw_do(&w, "v-ash", "light", "shed.fuse", 1004, &out);
  CHECK(tw_told(&out, "v-ash", "You have nothing to light it with."));
  CHECK_INT(tw_property(&w, "reading_hands.shed.fuse", "lit"), 0);
  sprout_outcome_free(&out);
  tw_do(&w, "v-wren", "light", "shed.fuse", 1005, &out);
  CHECK(tw_told(&out, "v-wren", "You touch the flame to the fuse, and it hisses. You hold 1 match."));
  CHECK(tw_told(&out, "v-ash", "Wren lights the fuse, holding 1 match."));
  CHECK_INT(tw_property(&w, "reading_hands.shed.fuse", "lit"), 1);
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

/*
 * Runs `text` as `visit`'s line through the line driver, the first turn under `seed` and each after it the next, and
 * writes each turn as `step:<verb>` or `-`, then its lines, `|` between turns; the last turn's outcome is kept.
 */
static void line_runs(turn_world *w, const char *visit, const char *text, uint64_t seed, char *seen, size_t size) {
  sprout_arena keep;
  sprout_commands line;
  sprout_turn_input input;
  bool more = false;
  size_t used = 0, i;
  seen[0] = '\0';
  CHECK_INT(sprout_arena_init(&keep, &w->host), SPROUT_OK);
  CHECK_INT(sprout_line_begin(&line, &keep, visit, text, strlen(text)), SPROUT_OK);
  CHECK_INT(sprout_line_next(&line, NULL, &input, &more), SPROUT_OK);
  while (more) {
    sprout_outcome out;
    CHECK_INT(tw_run(w, input, seed++, &out), SPROUT_OK);
    used += (size_t)snprintf(seen + used, size - used, "%s%s%s", used == 0 ? "" : "|", out.step == NULL ? "-" : "step:",
                             out.step == NULL ? "" : out.step->verb);
    for (i = 0; i < out.line_count; i++)
      used += (size_t)snprintf(seen + used, size - used, " %.*s", (int)out.lines[i].text_length, out.lines[i].text);
    CHECK_INT(sprout_line_next(&line, &out, &input, &more), SPROUT_OK);
    sprout_outcome_free(&out);
  }
  sprout_arena_reset(&keep);
}

static void a_typed_intent_runs_its_first_step_and_hands_the_rest_on_each_a_turn(void) {
  turn_world w;
  sprout_outcome out;
  char seen[1024];
  tw_open(&w, "intents");
  tw_arrive(&w, "v-marta", "Marta", 0, &out);
  sprout_outcome_free(&out);
  line_runs(&w, "v-marta", "take key", 1, seen, sizeof seen);
  CHECK_STR(seen, "- You take a key.");
  line_runs(&w, "v-marta", "open strongbox with key", 2, seen, sizeof seen);
  CHECK_STR(seen, "step:sprout.unlock The lock turns over.|step:sprout.open You open a strongbox. It is empty.");
  /* A step refused ends the line: the rest of the intent's steps are not run. */
  line_runs(&w, "v-marta", "stow anvil in strongbox. look", 3, seen, sizeof seen);
  CHECK_STR(seen, "step:sprout.take An anvil is not something you can pick up.");
  tw_close(&w);
}

static void a_typed_line_the_parser_answers_is_answered_and_ends_the_line(void) {
  turn_world w;
  sprout_outcome out;
  sprout_turn_input input = tw_input(SPROUT_TURN_COMMAND, 0);
  char seen[1024];
  tw_open(&w, "intents");
  tw_arrive(&w, "v-marta", "Marta", 0, &out);
  sprout_outcome_free(&out);
  input.visit = "v-marta";
  input.text = "xyzzy";
  input.text_length = 5;
  CHECK_INT(tw_run(&w, input, 4, &out), SPROUT_OK);
  CHECK(out.committed && out.answered && !out.goes_on);
  CHECK_INT(out.next_count, 0);
  CHECK(out.step == NULL);
  CHECK(tw_told(&out, "v-marta", "That is not something you can do here."));
  sprout_outcome_free(&out);
  line_runs(&w, "v-marta", "xyzzy then take key", 5, seen, sizeof seen);
  CHECK_STR(seen, "- That is not something you can do here.");
  tw_close(&w);
}

static void words_left_over_are_dropped_and_the_words_read_told_first_through_understood(void) {
  turn_world w;
  sprout_outcome out;
  char seen[1024];
  tw_open(&w, "trailing-words");
  tw_arrive(&w, "v-marta", "Marta", 0, &out);
  sprout_outcome_free(&out);
  line_runs(&w, "v-marta", "push the menhir with the sword", 1, seen, sizeof seen);
  CHECK_STR(seen, "- (push the menhir) The menhir does not budge.");
  line_runs(&w, "v-marta", "push the menhir", 2, seen, sizeof seen);
  CHECK_STR(seen, "- The menhir does not budge.");
  tw_close(&w);
}

static void a_command_accounts_for_the_handlers_it_ran_where_the_host_asks(void) {
  turn_world w;
  sprout_outcome out;
  size_t i;
  bool lamp = false;
  tw_open(&w, "handlers");
  tw_arrive(&w, "v-marta", "Marta", 0, &out);
  sprout_outcome_free(&out);
  tw_do(&w, "v-marta", "strike", "hall.lighter", 1, &out);
  CHECK(out.committed);
  CHECK_INT(out.ran_count, 0);
  sprout_outcome_free(&out);
  w.host.accounts = true;
  tw_do(&w, "v-marta", "strike", "hall.lighter", 2, &out);
  CHECK(out.committed && !out.refused && out.answer == NULL);
  CHECK(out.ran_count > 0);
  for (i = 0; i < out.ran_count; i++) {
    if (strcmp(out.ran[i].origin, "handlers.Lamp") == 0 && strcmp(out.ran[i].on, "handlers.illuminating") == 0) {
      lamp = true;
      CHECK(strncmp(out.ran[i].at, "lamp.sprout:", 12) == 0);
    }
  }
  CHECK(lamp);
  sprout_outcome_free(&out);
  tw_close(&w);
}

static void a_command_tells_a_consent_refusal_apart_and_names_the_line_it_was_answered_with(void) {
  turn_world w;
  sprout_outcome out;
  sprout_turn_input input = tw_input(SPROUT_TURN_COMMAND, 2);
  tw_open(&w, "never-runs");
  w.host.accounts = true;
  tw_arrive(&w, "v-marta", "Marta", 0, &out);
  sprout_outcome_free(&out);
  tw_do(&w, "v-marta", "pry", "hall.lid", 1, &out);
  CHECK(out.committed && out.refused && !out.answered && out.answer == NULL);
  CHECK(tw_told(&out, "v-marta", "The lid is stuck fast."));
  sprout_outcome_free(&out);
  input.visit = "v-marta";
  input.text = "xyzzy";
  input.text_length = 5;
  CHECK_INT(tw_run(&w, input, 4, &out), SPROUT_OK);
  CHECK(out.committed && out.answered && !out.refused);
  CHECK_STR(out.answer, "unknown");
  sprout_outcome_free(&out);
  w.host.accounts = false;
  CHECK_INT(tw_run(&w, input, 5, &out), SPROUT_OK);
  CHECK(out.answered && out.answer == NULL);
  sprout_outcome_free(&out);
  tw_close(&w);
}

static void a_command_is_one_of_a_reading_typed_words_or_a_planned_step(void) {
  turn_world w;
  sprout_outcome out;
  sprout_filling filling;
  sprout_reading reading;
  sprout_turn_input input = tw_input(SPROUT_TURN_COMMAND, 0);
  sprout_reread reread;
  tw_open(&w, "intents");
  tw_arrive(&w, "v-marta", "Marta", 0, &out);
  sprout_outcome_free(&out);
  reading = tw_reading("sprout.look", tw_person(&w, "v-marta"), &filling, NULL, NULL);
  input.visit = "v-marta";
  CHECK_INT(tw_run(&w, input, 0, &out), SPROUT_BAD_INPUT);
  CHECK(strstr(out.fault.text, "a typed line") != NULL);
  input.reading = &reading;
  input.planned = &reading;
  CHECK_INT(tw_run(&w, input, 0, &out), SPROUT_BAD_INPUT);
  CHECK(strstr(out.fault.text, "not both") != NULL);
  memset(&reread, 0, sizeof reread);
  input.planned = NULL;
  input.reading = NULL;
  input.reread = &reread;
  input.text = "look";
  input.text_length = 4;
  CHECK_INT(tw_run(&w, input, 0, &out), SPROUT_BAD_INPUT);
  /* A step a line planned runs as planned, and is a step the host logs. */
  input.reread = NULL;
  input.planned = &reading;
  CHECK_INT(tw_run(&w, input, 0, &out), SPROUT_OK);
  CHECK(out.committed && out.goes_on && out.step != NULL);
  if (out.step != NULL) CHECK_STR(out.step->verb, "sprout.look");
  CHECK(out.log.planned != NULL && out.log.planned != &reading);
  sprout_outcome_free(&out);
  tw_close(&w);
}

/* A typed command of `visit`'s, run at `instant`; the outcome is the caller's to free. */
static void typed(turn_world *w, const char *visit, const char *text, uint64_t instant, sprout_outcome *out) {
  sprout_turn_input input = tw_input(SPROUT_TURN_COMMAND, instant);
  input.visit = visit;
  input.text = text;
  input.text_length = strlen(text);
  CHECK_INT(tw_run(w, input, 0, out), SPROUT_OK);
}

/*
 * A command says how long its `pass`es ask the host to let pass, lowered to the host's longest pass and all of it
 * where the host leaves that unset; a command that runs no `pass` asks for none (the spec's Time > Passing time).
 */
static void a_command_asks_for_the_time_its_passes_count_lowered_to_the_longest_pass(void) {
  turn_world w;
  sprout_outcome out;
  tw_open(&w, "passing-time");
  tw_arrive(&w, "v-marta", "Marta", 0, &out);
  sprout_outcome_free(&out);
  typed(&w, "v-marta", "wait", 1, &out);
  CHECK(out.committed);
  CHECK_INT(out.passes, 90);
  sprout_outcome_free(&out);
  tw_do(&w, "v-marta", "hoist", "well_bottom.bucket", 2, &out);
  CHECK(out.committed);
  CHECK_INT(out.passes, 0);
  sprout_outcome_free(&out);
  tw_do(&w, "v-marta", "await", "well_bottom.bucket", 3, &out);
  CHECK_INT(out.passes, 3600);
  sprout_outcome_free(&out);
  typed(&w, "v-marta", "sleep", 4, &out);
  CHECK(tw_told(&out, "v-marta", "You curl up against the wall and sleep."));
  CHECK_INT(out.passes, 3600);
  sprout_outcome_free(&out);
  w.host.budgets.longest_pass_seconds = (sprout_limit){false, 0};
  typed(&w, "v-marta", "sleep", 5, &out);
  CHECK_INT(out.passes, 3 * 3600);
  sprout_outcome_free(&out);
  tw_close(&w);
}

int main(void) {
  RUN(a_command_that_acts_writes_what_it_changed_and_leaves_a_log_entry);
  RUN(a_command_that_faults_tells_the_actor_and_leaves_the_world_byte_for_byte);
  RUN(a_refusals_words_see_into_the_hands_of_the_visitor_who_acted);
  RUN(a_role_players_permit_and_do_see_into_the_hands_of_the_visitor_who_acted_only);
  RUN(a_command_by_someone_not_in_the_world_is_the_hosts_defect_and_writes_nothing);
  RUN(a_typed_intent_runs_its_first_step_and_hands_the_rest_on_each_a_turn);
  RUN(a_typed_line_the_parser_answers_is_answered_and_ends_the_line);
  RUN(a_command_is_one_of_a_reading_typed_words_or_a_planned_step);
  RUN(words_left_over_are_dropped_and_the_words_read_told_first_through_understood);
  RUN(a_command_accounts_for_the_handlers_it_ran_where_the_host_asks);
  RUN(a_command_tells_a_consent_refusal_apart_and_names_the_line_it_was_answered_with);
  RUN(a_command_asks_for_the_time_its_passes_count_lowered_to_the_longest_pass);
  return REPORT();
}
