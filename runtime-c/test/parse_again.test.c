/*
 * Tests for src/parse/again.c: the actor's last reading, run again (the spec's Parsing > Sequences, again and all).
 * `parser.spec.ts`'s `again` cases, ported, in the corpus world `grammar` (the study): a kept reading runs where it is
 * still one its verb takes, and through `sprout_parse` `again`, `g` and `Again` run it whatever its words would mean
 * now, `unknown` before any reading.
 */
#include "parse_fixture.h"

/* A kept reading of `verb` binding each role in `roles` to the thing or set in `bounds`. */
typedef struct kept {
  sprout_stored_reading reading;
  sprout_stored_binding bindings[2];
  sprout_str set[1];
} kept;

static void keep_object(kept *k, size_t at, const char *role, const char *id) {
  memset(&k->bindings[at], 0, sizeof k->bindings[at]);
  k->bindings[at].role = bench_str(role);
  k->bindings[at].bound.kind = SPROUT_BOUND_OBJECT;
  k->bindings[at].bound.object = bench_str(id);
}

static bool fits(bench *b, kept *k, const char *library, const char *verb, size_t count) {
  parse_reading reading;
  bool fitting;
  k->reading.library = bench_str(library);
  k->reading.name = bench_str(verb);
  k->reading.binding_count = count;
  k->reading.bindings = k->bindings;
  CHECK_INT(parse_again_reading(&b->frame, &k->reading, b->actor, &reading, &fitting), SPROUT_EVAL_OK);
  if (fitting) {
    CHECK_INT(reading.count, count);
    CHECK_BYTES(reading.actor.bytes, reading.actor.length, b->actor.bytes);
  }
  return fitting;
}

static void a_kept_reading_runs_again_only_while_it_is_one_its_verb_takes(void) {
  bench b;
  kept k;
  const sprout_str *removed;
  size_t removed_count;
  bench_open(&b, "grammar", "Marta");
  keep_object(&k, 0, "target", "study.hall.door");
  keep_object(&k, 1, "tool", "study.hall.brass_key");
  CHECK(fits(&b, &k, "study", "unlock", 2));
  /* A role the verb no longer has. */
  keep_object(&k, 0, "lid", "study.hall.door");
  CHECK(!fits(&b, &k, "study", "unlock", 1));
  /* A thing no longer of the role's kind. */
  keep_object(&k, 0, "target", "study.hall.gong");
  CHECK(!fits(&b, &k, "study", "unlock", 1));
  /* A set where the role takes one thing. */
  k.set[0] = bench_str("study.hall.door");
  k.bindings[0].bound.kind = SPROUT_BOUND_SET;
  k.bindings[0].bound.set = k.set;
  k.bindings[0].bound.set_count = 1;
  CHECK(!fits(&b, &k, "study", "unlock", 1));
  /* A role that is not optional, unbound. */
  CHECK(!fits(&b, &k, "study", "unlock", 0));
  /* One thing where the role takes a set. */
  keep_object(&k, 0, "things", "study.hall.gong");
  CHECK(!fits(&b, &k, "study", "juggle", 1));
  /* A verb the world no longer has. */
  keep_object(&k, 0, "target", "study.hall.gong");
  CHECK(fits(&b, &k, "sprout", "take", 1));
  CHECK(!fits(&b, &k, "study", "whistle", 1));
  /* A thing gone from the world. */
  CHECK_INT(sprout_draft_remove(&b.run.draft, bench_str("study.hall.gong"), &removed, &removed_count), SPROUT_DRAFT_OK);
  CHECK(!fits(&b, &k, "sprout", "take", 1));
  bench_close(&b);
}

static void again_runs_the_last_reading_whatever_its_words_would_mean_now(void) {
  static const char *const LINES[] = {"again", "g", "Again"};
  bench b;
  sprout_arena keep;
  sprout_parsed out;
  size_t i;
  bench_world(&b, "grammar");
  sprout_arena_init(&keep, &b.w.host);
  CHECK_INT(bench_parse(&b, &keep, "again", 7, NULL, &out), SPROUT_OK);
  CHECK_INT(out.end, SPROUT_PARSED_ANSWERED);
  CHECK_STR(out.answer, "unknown");
  bench_command(&b, "sprout.examine", "study.hall.gong");
  for (i = 0; i < sizeof LINES / sizeof *LINES; i++) {
    CHECK_INT(bench_parse(&b, &keep, LINES[i], 7, NULL, &out), SPROUT_OK);
    CHECK_INT(out.end, SPROUT_PARSED_READING);
    CHECK_STR(out.reading.verb, "sprout.examine");
    CHECK_INT(out.reading.filling_count, 1);
    if (out.reading.filling_count == 1) CHECK_STR(out.reading.fillings[0].id, "study.hall.gong");
    CHECK_INT(out.rest_count, 0);
    CHECK_INT(out.reading.aside_count, 0);
  }
  sprout_arena_reset(&keep);
  tw_close(&b.w);
}

int main(void) {
  RUN(a_kept_reading_runs_again_only_while_it_is_one_its_verb_takes);
  RUN(again_runs_the_last_reading_whatever_its_words_would_mean_now);
  return REPORT();
}
