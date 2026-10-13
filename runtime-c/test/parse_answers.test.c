/*
 * Tests for src/parse/answers.c: the world's answers to a line it could not run (the spec's Parsing > When nothing
 * matches; Verbs > Carried roles, Exits), the cases of runtime/parser/answers.spec.ts in the study (the corpus world
 * `grammar`) with Marta arrived in its hall, and an exit's refusal in the corpus world `no-way`.
 */
#include "parse_fixture.h"

/* Whether the answer is the standard library's passage `name`, said by the world, with `actor` and `here` bound first. */
static void said_by_the_world(bench *b, const parse_answer *answer, const char *name, const char *here) {
  CHECK_STR(answer->answer, name);
  CHECK_INT(answer->said.kind, SPROUT_SPEECH_PASSAGE);
  CHECK_STR(answer->said.origin, "sprout.World");
  CHECK_STR(answer->said.name, name);
  CHECK_BYTES(answer->by.bytes, answer->by.length, b->run.world->header.name);
  CHECK(answer->binding_count >= 2);
  if (answer->binding_count < 2) return;
  CHECK_STR(answer->bindings[0].name, "actor");
  CHECK(answer->bindings[0].object);
  CHECK(sprout_str_same(answer->bindings[0].text, b->actor));
  CHECK_STR(answer->bindings[1].name, "here");
  CHECK(answer->bindings[1].object);
  CHECK_BYTES(answer->bindings[1].text.bytes, answer->bindings[1].text.length, here);
}

static void unknown_and_not_here_bind_actor_and_here_and_nothing_they_name(void) {
  bench b;
  parse_answer answer;
  bench_open(&b, "grammar", "Marta");
  parse_answer_of(&b.frame, "unknown", b.actor, bench_str("study.hall"), NULL, &answer);
  said_by_the_world(&b, &answer, "unknown", "study.hall");
  CHECK_INT(answer.binding_count, 2);
  parse_answer_of(&b.frame, "not_here", b.actor, bench_str("study.hall"), NULL, &answer);
  said_by_the_world(&b, &answer, "not_here", "study.hall");
  CHECK_INT(answer.binding_count, 2);
  bench_close(&b);
}

static void cannot_binds_the_reading_and_not_carrying_the_thing_after_them(void) {
  bench b;
  parse_answer answer;
  sprout_said_binding given;
  bench_open(&b, "grammar", "Marta");
  given.name = "reading";
  given.object = false;
  given.text = bench_str("unlock the door with the gong");
  parse_answer_of(&b.frame, "cannot", b.actor, bench_str("study.hall"), &given, &answer);
  said_by_the_world(&b, &answer, "cannot", "study.hall");
  CHECK_INT(answer.binding_count, 3);
  CHECK_STR(answer.bindings[2].name, "reading");
  CHECK(!answer.bindings[2].object);
  CHECK_BYTES(answer.bindings[2].text.bytes, answer.bindings[2].text.length, "unlock the door with the gong");
  given.name = "thing";
  given.object = true;
  given.text = bench_str("study.hall.brass_key");
  parse_answer_of(&b.frame, "not_carrying", b.actor, bench_str("study.hall"), &given, &answer);
  said_by_the_world(&b, &answer, "not_carrying", "study.hall");
  CHECK_INT(answer.binding_count, 3);
  CHECK_STR(answer.bindings[2].name, "thing");
  CHECK(answer.bindings[2].object);
  CHECK_BYTES(answer.bindings[2].text.bytes, answer.bindings[2].text.length, "study.hall.brass_key");
  bench_close(&b);
}

static void an_exit_that_refuses_says_its_own_words_by_its_place(void) {
  bench b;
  parse_answer answer;
  const sprout_way *ways, *west = NULL;
  size_t count, i;
  bench_open(&b, "no-way", "Marta");
  CHECK_INT(sprout_ways_from(&b.frame, bench_str("no_way.clearing"), &ways, &count), SPROUT_EVAL_OK);
  for (i = 0; i < count; i++)
    if (ways[i].direction != NULL && strcmp(ways[i].direction, "west") == 0) west = &ways[i];
  CHECK(west != NULL && west->refuses);
  if (west == NULL) {
    bench_close(&b);
    return;
  }
  parse_refused(west, b.actor, bench_str("no_way.clearing"), &answer);
  CHECK_STR(answer.answer, "refused");
  CHECK_INT(answer.said.kind, SPROUT_SPEECH_TEXT);
  CHECK_BYTES(answer.by.bytes, answer.by.length, "no_way.clearing");
  CHECK_INT(answer.binding_count, 2);
  CHECK_STR(answer.bindings[0].name, "actor");
  CHECK_STR(answer.bindings[1].name, "here");
  CHECK_BYTES(answer.bindings[1].text.bytes, answer.bindings[1].text.length, "no_way.clearing");
  bench_close(&b);
}

int main(void) {
  RUN(unknown_and_not_here_bind_actor_and_here_and_nothing_they_name);
  RUN(cannot_binds_the_reading_and_not_carrying_the_thing_after_them);
  RUN(an_exit_that_refuses_says_its_own_words_by_its_place);
  return REPORT();
}
