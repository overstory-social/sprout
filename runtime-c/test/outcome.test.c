/*
 * Tests for src/outcome.c (the spec's The runtime > Effects): what a reading
 * recorded and the refusal the consent pass gave are canonical JSON, in the
 * form the TypeScript goldens hold, so a host reads the same lines whichever
 * runtime ran the turn. Every reading the goldens hold is run and its JSON
 * compared, byte for byte, with the golden's.
 */
#include "outcome.h"
#include "reading_fixture.h"

/* The canonical text of a golden member, without the `"key":` the writer puts in front of a member. */
static void golden_text(exec_bench *b, const sprout_json *member, const char **text, size_t *length) {
  const char *all;
  size_t n;
  CHECK_INT(sprout_json_write(&b->json, member, &all, &n), SPROUT_OK);
  *text = all + member->key_length + 3;
  *length = n - member->key_length - 3;
}

static void shown_text(exec_case *c, sprout_json *tree, const char **text, size_t *length) {
  CHECK_INT(sprout_json_write(&c->turn, tree, text, length), SPROUT_OK);
}

static void every_golden_reading_is_told_in_the_goldens_own_words(void) {
  exec_bench b;
  const sprout_json *cases;
  size_t i, told = 0, refused = 0;
  reading_bench_open(&b);
  cases = sprout_json_get(b.golden, "cases");
  for (i = 0; i < cases->count; i++) {
    exec_case c;
    const sprout_json *golden = cases->items[i], *expect = sprout_json_get(golden, "expect");
    sprout_resolved reading;
    sprout_reading_end end = SPROUT_READING_ACTED;
    sprout_permit_refusal refusal;
    sprout_json *tree;
    const char *shown, *wanted;
    size_t shown_length, wanted_length;
    int before = check_failures;
    if (strcmp(exec_text(expect, "how"), "fault") == 0) continue;
    reading_case_open(&b, &c, golden);
    reading = reading_of(&c, sprout_json_get(golden, "reading"));
    memset(&refusal, 0, sizeof refusal);
    CHECK_INT(reading_run(&c, &reading, &end, &refusal), SPROUT_EVAL_OK);
    if (end == SPROUT_READING_REFUSED) {
      CHECK_INT(sprout_outcome_refusal(&c.frame, &refusal, &tree), SPROUT_EVAL_OK);
      shown_text(&c, tree, &shown, &shown_length);
      golden_text(&b, sprout_json_get(expect, "refused"), &wanted, &wanted_length);
      refused++;
    } else {
      CHECK_INT(sprout_outcome_effects(&c.x, &c.frame, &tree), SPROUT_EVAL_OK);
      shown_text(&c, tree, &shown, &shown_length);
      golden_text(&b, sprout_json_get(expect, "effects"), &wanted, &wanted_length);
      told++;
    }
    CHECK(shown_length == wanted_length && memcmp(shown, wanted, wanted_length) == 0);
    if (check_failures != before) {
      fprintf(stderr, "  in the case `%s`: %.*s, expected %.*s\n", exec_text(golden, "name"), (int)shown_length, shown,
              (int)wanted_length, wanted);
    }
    exec_case_close(&c);
  }
  CHECK(told > 30);
  CHECK(refused > 10);
  exec_bench_close(&b);
  CHECK_INT(b.heap.pages, 0);
}

int main(void) {
  RUN(every_golden_reading_is_told_in_the_goldens_own_words);
  return REPORT();
}
