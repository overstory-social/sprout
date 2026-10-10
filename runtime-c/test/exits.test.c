/*
 * Tests for src/exits.c (the spec's Verbs > Exits, An exit may be
 * conditional, Links): the exits and links that apply on a place are one for
 * each direction, the first whose guard holds, and each link set, in the
 * order the kind answers them; an exit that refuses applies as any exit
 * does and is never offered. Every exit asked is a step. What a way says as
 * it is taken is asked of the place that has it.
 */
#include "reading_fixture.h"

static void check_way(const sprout_way *way, const sprout_json *want) {
  const sprout_json *direction = sprout_json_get(want, "direction"), *refuses = sprout_json_get(want, "refuses");
  if (direction->kind == SPROUT_JSON_NULL) CHECK(way->direction == NULL);
  else CHECK(way->direction != NULL && strcmp(way->direction, direction->bytes) == 0);
  CHECK_STR(way->label, exec_text(want, "label"));
  CHECK_INT(way->refuses, refuses != NULL);
  if (refuses == NULL) {
    CHECK(exec_same_str(way->to, sprout_json_get(want, "to")));
  } else {
    CHECK(exec_same_str(way->by, sprout_json_get(refuses, "by")));
    exec_check_speech(&way->said, sprout_json_get(refuses, "said"));
  }
}

static void the_ways_out_of_a_place_are_those_that_apply_in_the_order_its_kind_answers_them(void) {
  exec_bench b;
  const sprout_json *ways;
  size_t i, j;
  reading_bench_open(&b);
  ways = sprout_json_get(b.golden, "ways");
  CHECK(ways->count >= 4);
  for (i = 0; i < ways->count; i++) {
    exec_case c;
    const sprout_json *want = ways->items[i], *expect = sprout_json_get(want, "expect"), *list = sprout_json_get(expect, "ways");
    const sprout_way *found;
    size_t count;
    int before = check_failures;
    reading_open(&b, &c, want, exec_text(want, "place"));
    CHECK_INT(sprout_ways_from(&c.frame, exec_str(exec_text(want, "place")), &found, &count), SPROUT_EVAL_OK);
    CHECK_INT(count, list->count);
    for (j = 0; j < count && j < list->count; j++) check_way(&found[j], list->items[j]);
    CHECK_INT(c.meter.steps, exec_number(expect, "steps"));
    if (check_failures != before) fprintf(stderr, "  in the case `%s`\n", exec_text(want, "name"));
    exec_case_close(&c);
  }
  exec_bench_close(&b);
  CHECK_INT(b.heap.pages, 0);
}

static void the_exits_offered_leave_out_a_way_that_refuses(void) {
  exec_bench b;
  exec_case c;
  const sprout_way *found;
  size_t count;
  reading_bench_open(&b);
  reading_case_in(&b, &c, "fresh");
  CHECK_INT(sprout_exits_from(&c.frame, exec_str("bench.shop"), &found, &count), SPROUT_EVAL_OK);
  CHECK_INT(count, 2);
  CHECK_STR(found[0].label, "to the yard");
  CHECK_STR(found[1].label, "into the vault");
  CHECK(sprout_str_same(found[0].to, exec_str("bench.yard")));
  exec_case_close(&c);
  exec_bench_close(&b);
}

static void a_link_applies_once_it_is_connected(void) {
  exec_bench b;
  exec_case c;
  const sprout_way *found;
  size_t count;
  reading_bench_open(&b);
  reading_case_in(&b, &c, "fresh");
  CHECK_INT(sprout_exits_from(&c.frame, exec_str("bench.shop"), &found, &count), SPROUT_EVAL_OK);
  CHECK_INT(count, 2);
  exec_case_close(&c);
  reading_case_in(&b, &c, "linked");
  CHECK_INT(sprout_exits_from(&c.frame, exec_str("bench.shop"), &found, &count), SPROUT_EVAL_OK);
  CHECK_INT(count, 3);
  CHECK(found[2].direction == NULL);
  CHECK_STR(found[2].label, "onward");
  CHECK(sprout_str_same(found[2].to, exec_str("bench.yard")));
  exec_case_close(&c);
  exec_bench_close(&b);
}

static void a_place_not_in_the_world_has_no_ways_out(void) {
  exec_bench b;
  exec_case c;
  const sprout_way *found;
  size_t count = 9;
  reading_bench_open(&b);
  reading_case_in(&b, &c, "fresh");
  CHECK_INT(sprout_ways_from(&c.frame, exec_str("bench.nowhere"), &found, &count), SPROUT_EVAL_OK);
  CHECK_INT(count, 0);
  exec_case_close(&c);
  exec_bench_close(&b);
}

static void asking_too_many_ways_exhausts_the_steps(void) {
  exec_bench b;
  exec_case c;
  const sprout_way *found;
  size_t count;
  reading_bench_open(&b);
  reading_case_in(&b, &c, "fresh");
  c.host.budgets.steps.set = true;
  c.host.budgets.steps.value = 2;
  CHECK_INT(sprout_ways_from(&c.frame, exec_str("bench.shop"), &found, &count), SPROUT_EVAL_FAULT);
  CHECK_STR(c.meter.fault.budget, "steps");
  exec_case_close(&c);
  exec_bench_close(&b);
}

static void what_a_way_says_as_it_is_taken_is_asked_of_its_place(void) {
  exec_bench b;
  const sprout_json *sayings;
  size_t i;
  reading_bench_open(&b);
  sayings = sprout_json_get(b.golden, "sayings");
  CHECK(sayings->count >= 2);
  for (i = 0; i < sayings->count; i++) {
    exec_case c;
    const sprout_json *want = sprout_json_get(sayings->items[i], "expect"), *way = sprout_json_get(want, "way");
    const sprout_json *says = sprout_json_get(want, "says");
    const sprout_way *found;
    sprout_way taken;
    sprout_saying saying;
    size_t count, j;
    uint64_t spent;
    int before = check_failures;
    reading_open(&b, &c, sayings->items[i], exec_text(sayings->items[i], "place"));
    CHECK_INT(sprout_exits_from(&c.frame, exec_str(exec_text(sayings->items[i], "place")), &found, &count), SPROUT_EVAL_OK);
    for (j = 0; j < count; j++)
      if (strcmp(found[j].label, exec_text(way, "label")) == 0) taken = found[j];
    spent = c.meter.steps;
    CHECK_INT(sprout_exit_saying(&c.frame, exec_str(exec_text(sayings->items[i], "place")), &taken, &saying), SPROUT_EVAL_OK);
    CHECK_INT(c.meter.steps - spent, exec_number(want, "steps"));
    CHECK_INT(saying.says, says->kind == SPROUT_JSON_OBJECT);
    if (saying.says && says->kind == SPROUT_JSON_OBJECT) {
      CHECK(exec_same_str(saying.by, sprout_json_get(says, "by")));
      exec_check_speech(&saying.said, sprout_json_get(says, "said"));
    }
    if (check_failures != before) fprintf(stderr, "  in the case `%s`\n", exec_text(sayings->items[i], "name"));
    exec_case_close(&c);
  }
  exec_bench_close(&b);
}

static void a_link_says_nothing(void) {
  exec_bench b;
  exec_case c;
  const sprout_way *found;
  sprout_saying saying;
  size_t count;
  reading_bench_open(&b);
  reading_case_in(&b, &c, "linked");
  CHECK_INT(sprout_exits_from(&c.frame, exec_str("bench.shop"), &found, &count), SPROUT_EVAL_OK);
  CHECK_INT(sprout_exit_saying(&c.frame, exec_str("bench.shop"), &found[2], &saying), SPROUT_EVAL_OK);
  CHECK(!saying.says);
  exec_case_close(&c);
  exec_bench_close(&b);
}

int main(void) {
  RUN(the_ways_out_of_a_place_are_those_that_apply_in_the_order_its_kind_answers_them);
  RUN(the_exits_offered_leave_out_a_way_that_refuses);
  RUN(a_link_applies_once_it_is_connected);
  RUN(a_place_not_in_the_world_has_no_ways_out);
  RUN(asking_too_many_ways_exhausts_the_steps);
  RUN(what_a_way_says_as_it_is_taken_is_asked_of_its_place);
  RUN(a_link_says_nothing);
  return REPORT();
}
