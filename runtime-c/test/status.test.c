/* Tests for src/status.c: every status has words. */
#include "sprout.h"
#include "check.h"

static void every_status_has_text_a_host_can_show(void) {
  sprout_status all[] = {SPROUT_OK,       SPROUT_NO_MEMORY, SPROUT_BAD_HOST, SPROUT_BAD_SEED,
                         SPROUT_BAD_INPUT, SPROUT_FAULT};
  for (size_t i = 0; i < sizeof all / sizeof all[0]; i++) {
    const char *words = sprout_status_text(all[i]);
    CHECK(words != NULL && strlen(words) > 10);
    for (size_t j = 0; j < i; j++) CHECK(strcmp(words, sprout_status_text(all[j])) != 0);
  }
  CHECK(strlen(sprout_status_text((sprout_status)99)) > 10);
}

int main(void) {
  RUN(every_status_has_text_a_host_can_show);
  return REPORT();
}
