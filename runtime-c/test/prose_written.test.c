/*
 * Tests for src/prose/written.c: each effect a turn tells names where its words were written, a one-line
 * passage by the file, line and column it stands at, once for each (the spec's The runtime > Effects).
 */
#include "turn_fixture.h"

static void a_description_names_the_one_line_passage_that_gave_its_words(void) {
  turn_world w;
  sprout_outcome out;
  tw_open(&w, "turn-faults");
  tw_arrive(&w, "v-marta", "Marta", 1000, &out);
  CHECK(out.effect_count >= 1);
  if (out.effect_count >= 1) {
    const sprout_told_effect *effect = &out.effects[0];
    CHECK_INT(effect->written_count, 1);
    if (effect->written_count == 1) {
      CHECK(!effect->written[0].passage);
      CHECK(strstr(effect->written[0].at, "turn_faults.sprout:") != NULL);
      CHECK(effect->written[0].at[strlen(effect->written[0].at) - 1] >= '0');
    }
  }
  sprout_outcome_free(&out);
  tw_close(&w);
}

static void a_line_a_body_said_names_the_string_it_said(void) {
  turn_world w;
  sprout_outcome out;
  tw_open(&w, "turn-faults");
  tw_arrive(&w, "v-marta", "Marta", 1000, &out);
  sprout_outcome_free(&out);
  tw_do(&w, "v-marta", "crack", "porch.dud", 1001, &out);
  CHECK_INT(out.effect_count, 1);
  if (out.effect_count == 1) {
    CHECK_INT(out.effects[0].written_count, 1);
    if (out.effects[0].written_count == 1) {
      CHECK(!out.effects[0].written[0].passage);
      CHECK(strstr(out.effects[0].written[0].at, "fuse.sprout:") != NULL);
    }
  }
  sprout_outcome_free(&out);
  tw_close(&w);
}

int main(void) {
  RUN(a_description_names_the_one_line_passage_that_gave_its_words);
  RUN(a_line_a_body_said_names_the_string_it_said);
  return REPORT();
}
