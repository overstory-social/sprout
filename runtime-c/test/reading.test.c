/*
 * Tests for src/reading.c: the reading pass an `act` runs is C07's, so until
 * it lands running a reading ends `not_built` with words that say so, and an
 * exec begins with that function as its reading pass.
 */
#include "exec_fixture.h"

static void running_a_reading_ends_not_built_with_words_that_say_so(void) {
  exec_bench b;
  exec_case c;
  sprout_reading_end end = SPROUT_READING_ACTED;
  const char *words = NULL;
  exec_bench_open(&b);
  exec_case_open(&b, &c, exec_named(&b, "set a string"));
  CHECK(c.x.reading == sprout_run_reading);
  CHECK_INT(sprout_run_reading(&c.x, &c.frame, c.frame.self, "sniff", 0, NULL, &end, &words), SPROUT_EVAL_OK);
  CHECK_INT(end, SPROUT_READING_NOT_BUILT);
  CHECK(words != NULL && strstr(words, "not built") != NULL);
  CHECK_INT(c.x.effect_count, 0);
  exec_case_close(&c);
  exec_bench_close(&b);
}

int main(void) {
  RUN(running_a_reading_ends_not_built_with_words_that_say_so);
  return REPORT();
}
