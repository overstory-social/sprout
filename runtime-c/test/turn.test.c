/*
 * Tests for src/turn.c: what every kind of turn shares. A call the host should not have made is refused with
 * words and writes nothing; a host that cannot give memory is told so and the world is as it was; the same
 * seed draws the same turn; a faulted turn tells the actor in the cartridge's own words (the spec's The runtime
 * > Turns and Faults; The host contract).
 */
#include "turn_fixture.h"

static void a_call_the_host_should_not_have_made_is_refused_and_writes_nothing(void) {
  turn_world w;
  sprout_outcome out;
  sprout_turn_input input = tw_input(SPROUT_TURN_POLL, 1000);
  char *before, *after;
  tw_open(&w, "turn-faults");
  before = tw_bytes(&w);
  CHECK_INT(tw_run(&w, input, 0, &out), SPROUT_BAD_INPUT);
  CHECK(strstr(out.fault.text, "poll") != NULL);
  CHECK_INT(sprout_run_turn(NULL, w.state, &w.host, &input, &out), SPROUT_BAD_INPUT);
  CHECK_INT(sprout_run_turn(w.world, w.state, NULL, &input, &out), SPROUT_BAD_HOST);
  CHECK_INT(sprout_run_turn(w.world, w.state, &w.host, &input, NULL), SPROUT_BAD_HOST);
  input.kind = SPROUT_TURN_ARRIVAL;
  CHECK_INT(tw_run(&w, input, 0, &out), SPROUT_BAD_INPUT);
  CHECK(strlen(out.fault.text) > 0);
  after = tw_bytes(&w);
  CHECK(strcmp(before, after) == 0);
  free(before);
  free(after);
  tw_close(&w);
}

static void a_host_that_cannot_give_memory_is_told_so_and_the_world_is_as_it_was(void) {
  turn_world w;
  sprout_outcome out, arrived;
  sprout_turn_input input = tw_input(SPROUT_TURN_ARRIVAL, 1000);
  char *before, *after;
  tw_open(&w, "turn-faults");
  before = tw_bytes(&w);
  input.visit = "v-marta";
  input.nickname = "Marta";
  input.nickname_length = 5;
  w.heap.refuse_after = w.heap.pages;
  CHECK_INT(tw_run(&w, input, 0, &out), SPROUT_NO_MEMORY);
  w.heap.refuse_after = -1;
  after = tw_bytes(&w);
  CHECK(strcmp(before, after) == 0);
  CHECK_INT(tw_run(&w, input, 0, &arrived), SPROUT_OK);
  CHECK_INT(arrived.result, SPROUT_RESULT_DONE);
  sprout_outcome_free(&arrived);
  free(before);
  free(after);
  tw_close(&w);
}

static void the_same_seed_draws_the_same_turn_and_the_log_names_the_seed_it_drew_from(void) {
  turn_world a, b;
  sprout_outcome out_a, out_b;
  sprout_turn_input tick;
  char *bytes_a, *bytes_b;
  tw_open(&a, "turn-faults");
  tw_open(&b, "turn-faults");
  tw_arrive(&a, "v-marta", "Marta", 1000, &out_a);
  sprout_outcome_free(&out_a);
  tw_arrive(&b, "v-marta", "Marta", 1000, &out_b);
  sprout_outcome_free(&out_b);
  tick = tw_input(SPROUT_TURN_TICK, 1010);
  tick.place = "turn_faults.porch";
  CHECK_INT(tw_run(&a, tick, 99, &out_a), SPROUT_OK);
  CHECK_INT(tw_run(&b, tick, 99, &out_b), SPROUT_OK);
  CHECK_INT(out_a.log.seed, out_b.log.seed);
  bytes_a = tw_bytes(&a);
  bytes_b = tw_bytes(&b);
  CHECK(strcmp(bytes_a, bytes_b) == 0);
  sprout_outcome_free(&out_a);
  sprout_outcome_free(&out_b);
  free(bytes_a);
  free(bytes_b);
  tw_close(&a);
  tw_close(&b);
}

static void a_turn_compacts_a_crowded_state_once_its_scratch_is_gone(void) {
  turn_world w;
  sprout_outcome out;
  sprout_turn_input tick;
  size_t settled;
  tw_open(&w, "turn-faults");
  tw_arrive(&w, "v-marta", "Marta", 1000, &out);
  sprout_outcome_free(&out);
  tick = tw_input(SPROUT_TURN_TICK, 1010);
  tick.place = "turn_faults.porch";
  CHECK_INT(tw_run(&w, tick, 7, &out), SPROUT_OK);
  sprout_outcome_free(&out);
  CHECK(!sprout_state_crowded(w.state));
  /* As if hundreds of commits had replaced records: a quarter of the state and two pages, held but not live. */
  settled = w.state->settled;
  CHECK(sprout_arena_take(&w.state->arena, settled / 4 + 2 * w.host.page_bytes) != NULL);
  CHECK(sprout_state_crowded(w.state));
  tick.instant = 1020;
  CHECK_INT(tw_run(&w, tick, 7, &out), SPROUT_OK);
  sprout_outcome_free(&out);
  /* The turn compacted it after its own work: the state holds its live records and nothing else, and reads as before. */
  CHECK(!sprout_state_crowded(w.state));
  CHECK(w.state->arena.held == w.state->settled);
  CHECK(w.state->arena.held <= settled + w.host.page_bytes);
  CHECK_STR(tw_person(&w, "v-marta"), "turn_faults#1");
  tw_close(&w);
}

static void a_seed_outside_the_range_is_the_hosts_defect(void) {
  turn_world w;
  sprout_outcome out;
  sprout_turn_input input = tw_input(SPROUT_TURN_ARRIVAL, 1000);
  tw_open(&w, "turn-faults");
  input.visit = "v-marta";
  input.nickname = "Marta";
  input.nickname_length = 5;
  CHECK_INT(tw_run(&w, input, 4294967296ull, &out), SPROUT_BAD_SEED);
  tw_close(&w);
}

int main(void) {
  RUN(a_call_the_host_should_not_have_made_is_refused_and_writes_nothing);
  RUN(a_host_that_cannot_give_memory_is_told_so_and_the_world_is_as_it_was);
  RUN(the_same_seed_draws_the_same_turn_and_the_log_names_the_seed_it_drew_from);
  RUN(a_seed_outside_the_range_is_the_hosts_defect);
  RUN(a_turn_compacts_a_crowded_state_once_its_scratch_is_gone);
  return REPORT();
}
