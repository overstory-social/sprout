/* budgets.c: the figures the app ships, and the static caps a cartridge is checked against. */
#include "budgets.h"
#include "support.h"
#include "world.h"

static void every_row_the_spec_gives_a_figure_for_is_set(void) {
  sprout_budgets budgets;
  memset(&budgets, 0, sizeof budgets);
  player_budgets(&budgets);
  CHECK(sizeof budgets == 16 * sizeof(sprout_limit), "the budgets table has %zu rows", sizeof budgets / sizeof(sprout_limit));
  /* The spec's Runtime budgets table. */
  CHECK(budgets.steps.set && budgets.steps.value == 50000, "steps");
  CHECK(budgets.poll_steps.set && budgets.poll_steps.value == PLAYER_POLL_STEPS, "poll steps");
  CHECK(budgets.output.set && budgets.output.value == 8000, "output");
  CHECK(budgets.events.set && budgets.events.value == 256, "events");
  CHECK(budgets.cascade_depth.set && budgets.cascade_depth.value == 20, "cascade depth");
  CHECK(budgets.passage_depth.set && budgets.passage_depth.value == 8, "passage depth");
  CHECK(budgets.set_role_objects.set && budgets.set_role_objects.value == 8, "set role");
  CHECK(budgets.spawns.set && budgets.spawns.value == 8, "spawns");
  CHECK(budgets.shortest_wake_seconds.set && budgets.shortest_wake_seconds.value == 60, "shortest wake");
  CHECK(budgets.pending_wakes.set && budgets.pending_wakes.value == 1, "pending wakes");
  CHECK(budgets.nickname_characters.set && budgets.nickname_characters.value == 24, "nickname");
  CHECK(budgets.list_elements.set && budgets.list_elements.value == 16, "lists");
}

static void the_rows_the_host_chooses_are_set_and_people_in_a_place_stay_unbounded(void) {
  sprout_budgets budgets;
  memset(&budgets, 0, sizeof budgets);
  player_budgets(&budgets);
  CHECK(!budgets.people_per_place.set, "the spec leaves people in a place unbounded");
  CHECK(budgets.extension_effects.set && budgets.extension_effects.value > 0, "extension effects");
  CHECK(budgets.wall_clock_ms.set && budgets.wall_clock_ms.value > 0, "the wall clock backstop");
  CHECK(budgets.instances.set && budgets.instances.value > 0, "the live instances stored");
}

static void a_cartridge_recording_larger_caps_is_refused_cap_by_cap(void) {
  sprout_world world;
  char words[900];
  memset(&world, 0, sizeof world);
  world.caps = (sprout_caps){100, 8, 8, 8, 80, 8, 40, 8, 16, 600};
  CHECK(player_caps_fit(&world, words, sizeof words), "the defaults fit: %s", words);
  world.caps.exits_per_place = 12;
  world.caps.nouns_per_object = 9;
  CHECK(!player_caps_fit(&world, words, sizeof words), "larger caps fit");
  CHECK(HAS(words, "This world was published allowing 9 nouns on one object. This host allows 8, 1 fewer."), "%s", words);
  CHECK(HAS(words, "This world was published allowing 12 exits on one place. This host allows 8, 4 fewer."), "%s", words);
  CHECK(HAS(words, "Publish it again under this host's limits."), "%s", words);
  world.caps.exits_per_place = 3;
  world.caps.nouns_per_object = 1;
  CHECK(player_caps_fit(&world, words, sizeof words), "smaller caps are fine: %s", words);
  /* The caps the app gives no figure are never exceeded. */
  world.caps.places_set = world.caps.objects_set = world.caps.kinds_set = true;
  world.caps.places = world.caps.objects = world.caps.kinds = 1e9;
  CHECK(player_caps_fit(&world, words, sizeof words), "the unset caps are never exceeded");
}

static void every_cap_with_a_figure_is_checked_and_a_small_buffer_is_not_overrun(void) {
  sprout_world world;
  char words[40];
  memset(&world, 0, sizeof world);
  world.caps = (sprout_caps){101, 9, 9, 9, 81, 9, 41, 9, 17, 601};
  CHECK(!player_caps_fit(&world, words, sizeof words), "every cap is larger");
  CHECK(strlen(words) < sizeof words, "the words are cut to the buffer");
  {
    char big[2000];
    player_caps_fit(&world, big, sizeof big);
    CHECK(HAS(big, "options on one enum") && HAS(big, "roles on one verb") && HAS(big, "phrases on one verb") &&
              HAS(big, "steps in one intent") && HAS(big, "characters in one phrase") && HAS(big, "nouns on one object") &&
              HAS(big, "characters in one noun word") && HAS(big, "exits on one place") && HAS(big, "elements in one list") &&
              HAS(big, "characters in a say, tell or text written as a literal"), "%s", big);
  }
}

int main(void) {
  test_program("budgets");
  every_row_the_spec_gives_a_figure_for_is_set();
  the_rows_the_host_chooses_are_set_and_people_in_a_place_stay_unbounded();
  a_cartridge_recording_larger_caps_is_refused_cap_by_cap();
  every_cap_with_a_figure_is_checked_and_a_small_buffer_is_not_overrun();
  return finish();
}
