/* Tests for src/draws.c: the stream is the one the spec writes, and the TypeScript runtime's golden. */
#include "draws.h"
#include "json.h"
#include "check.h"

static void the_first_sixteen_draws_from_seed_one_are_the_golden(void) {
  test_heap heap;
  sprout_host host = test_host(&heap);
  sprout_arena arena;
  sprout_json *root;
  sprout_json_error error;
  size_t length;
  char *text = test_golden("draws.json", &length);
  const sprout_json *draws, *seed;
  sprout_draws stream;
  sprout_arena_init(&arena, &host);
  CHECK_INT(sprout_json_read(&arena, text, length, &root, &error), SPROUT_OK);
  draws = sprout_json_get(root, "draws");
  seed = sprout_json_get(root, "seed");
  CHECK(draws != NULL && seed != NULL);
  CHECK_INT(draws->count, 16);
  CHECK_INT(sprout_draws_begin(&stream, (uint64_t)seed->number), SPROUT_OK);
  for (size_t i = 0; i < draws->count; i++)
    CHECK_INT(sprout_draws_next(&stream), (long long)draws->items[i]->number);
  sprout_arena_reset(&arena);
  free(text);
}

static uint32_t below(sprout_draws *stream, uint64_t n) {
  uint32_t result = 0xFFFFFFFFu;
  CHECK(sprout_draws_below(stream, n, &result));
  return result;
}

static void a_draw_below_n_pins_the_stream_the_log_replays_against(void) {
  sprout_draws stream;
  sprout_draws_begin(&stream, 7);
  CHECK_INT(below(&stream, 6), 4);
  CHECK_INT(below(&stream, 6), 2);
  CHECK_INT(below(&stream, 2), 0);
  CHECK_INT(below(&stream, 100), 30);
  CHECK_INT(below(&stream, 1000000), 590375);
  CHECK_INT(stream.made, 5);
}

static void the_same_seed_gives_the_same_draws_and_another_seed_others(void) {
  sprout_draws one, two, other;
  int differs = 0;
  sprout_draws_begin(&one, 41);
  sprout_draws_begin(&two, 41);
  sprout_draws_begin(&other, 42);
  for (int i = 0; i < 20; i++) {
    uint32_t x = below(&one, 1000), y = below(&two, 1000), z = below(&other, 1000);
    CHECK_INT(x, y);
    if (x != z) differs = 1;
  }
  CHECK(differs);
}

static void every_draw_is_within_its_bound_and_a_bound_of_one_gives_zero(void) {
  sprout_draws stream;
  uint64_t bounds[] = {1, 2, 3, 6, 7, 100, 1000, 2147483647u, 4294967295u, 4294967296u};
  sprout_draws_begin(&stream, 2026);
  for (int round = 0; round < 50; round++)
    for (size_t b = 0; b < sizeof bounds / sizeof bounds[0]; b++) {
      uint32_t value = below(&stream, bounds[b]);
      CHECK((uint64_t)value < bounds[b]);
    }
  for (int i = 0; i < 10; i++) CHECK_INT(below(&stream, 1), 0);
}

static void a_small_bound_reaches_every_value_about_as_often_as_the_others(void) {
  sprout_draws stream;
  int seen[6] = {0};
  sprout_draws_begin(&stream, 2026);
  for (int i = 0; i < 6000; i++) seen[below(&stream, 6)]++;
  for (int v = 0; v < 6; v++) CHECK(seen[v] > 850 && seen[v] < 1150);
}

static void rejection_leaves_no_bias_at_a_bound_that_does_not_divide_the_range(void) {
  /* With n = 3 * 2^30, the values 3 * 2^30 or more are rejected, so a draw is never from the biased tail. */
  sprout_draws stream;
  uint64_t n = 3ull << 30;
  sprout_draws_begin(&stream, 5);
  for (int i = 0; i < 2000; i++) CHECK((uint64_t)below(&stream, n) < n);
}

static void a_seed_past_the_range_and_a_bound_the_checker_refuses_are_turned_away(void) {
  sprout_draws stream;
  uint32_t result;
  CHECK_INT(sprout_draws_begin(&stream, 0), SPROUT_OK);
  CHECK_INT(sprout_draws_begin(&stream, 4294967295u), SPROUT_OK);
  CHECK_INT(sprout_draws_begin(&stream, 4294967296ull), SPROUT_BAD_SEED);
  CHECK_INT(sprout_draws_begin(&stream, UINT64_MAX), SPROUT_BAD_SEED);
  sprout_draws_begin(&stream, 1);
  CHECK(!sprout_draws_below(&stream, 0, &result));
  CHECK(!sprout_draws_below(&stream, 4294967297ull, &result));
  CHECK_INT(stream.made, 0);
}

int main(void) {
  RUN(the_first_sixteen_draws_from_seed_one_are_the_golden);
  RUN(a_draw_below_n_pins_the_stream_the_log_replays_against);
  RUN(the_same_seed_gives_the_same_draws_and_another_seed_others);
  RUN(every_draw_is_within_its_bound_and_a_bound_of_one_gives_zero);
  RUN(a_small_bound_reaches_every_value_about_as_often_as_the_others);
  RUN(rejection_leaves_no_bias_at_a_bound_that_does_not_divide_the_range);
  RUN(a_seed_past_the_range_and_a_bound_the_checker_refuses_are_turned_away);
  return REPORT();
}
