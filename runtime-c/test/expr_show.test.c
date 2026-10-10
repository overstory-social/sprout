/*
 * Tests for src/expr/show.c: the canonical form of an evaluation, in the
 * bytes JSON.stringify gives the same value.
 */
#include "eval_fixture.h"
#include "expr/expr.h"
#include "lists.h"

static void shows(const sprout_frame *frame, const sprout_evaluated *evaluated, const char *expected) {
  const char *bytes;
  size_t length;
  CHECK_INT(sprout_eval_show(frame, evaluated, &bytes, &length), SPROUT_EVAL_OK);
  CHECK_BYTES(bytes, length, expected);
}

static void a_value_is_shown_as_json_shows_it(void) {
  bench b;
  bench_turn t;
  sprout_value text, list_items[2];
  const sprout_list *list;
  sprout_evaluated list_value;
  bench_open(&b);
  bench_turn_for(&b, &t, "get reads the property");
  shows(&t.frame, &(sprout_evaluated){SPROUT_BINDS_VALUE, sprout_bool(true), {0}, 0, NULL}, "{\"value\":true}");
  shows(&t.frame, &(sprout_evaluated){SPROUT_BINDS_VALUE, sprout_number(-4), {0}, 0, NULL}, "{\"value\":-4}");
  shows(&t.frame, &(sprout_evaluated){SPROUT_BINDS_VALUE, sprout_number(0), {0}, 0, NULL}, "{\"value\":0}");
  static const char raw[] = "a \"quoted\" \\ line\nand\ttab \x01 caf\xc3\xa9";
  CHECK(sprout_string(&t.turn, raw, strlen(raw), &text));
  shows(&t.frame, &(sprout_evaluated){SPROUT_BINDS_VALUE, text, {0}, 0, NULL},
        "{\"value\":\"a \\\"quoted\\\" \\\\ line\\nand\\ttab \\u0001 caf\xc3\xa9\"}");
  CHECK(sprout_string(&t.turn, "shino", 5, &list_items[0]));
  CHECK(sprout_string(&t.turn, "tenmoku", 7, &list_items[1]));
  CHECK_INT(sprout_list_make(&t.turn, &(sprout_type){SPROUT_STRING, NULL}, list_items, 2, (sprout_limit){true, 16}, &list),
            SPROUT_LIST_OK);
  list_value = sprout_evaluated_value(sprout_number(0));
  list_value.value.kind = SPROUT_LIST;
  list_value.value.as.list = list;
  shows(&t.frame, &list_value, "{\"value\":[\"shino\",\"tenmoku\"]}");
  bench_turn_close(&t);
  bench_close(&b);
  CHECK_INT(b.heap.pages, 0);
}

static void an_empty_list_is_an_empty_array(void) {
  bench b;
  bench_turn t;
  const sprout_list *list;
  sprout_evaluated empty;
  bench_open(&b);
  bench_turn_for(&b, &t, "get reads the property");
  CHECK_INT(sprout_list_make(&t.turn, &(sprout_type){SPROUT_NUMBER, NULL}, NULL, 0, (sprout_limit){true, 16}, &list), SPROUT_LIST_OK);
  empty = sprout_evaluated_value(sprout_number(0));
  empty.value.kind = SPROUT_LIST;
  empty.value.as.list = list;
  shows(&t.frame, &empty, "{\"value\":[]}");
  bench_turn_close(&t);
  bench_close(&b);
}

static void an_object_a_set_and_readings_are_shown_by_their_ids_and_lines(void) {
  bench b;
  bench_turn t;
  sprout_str ids[2] = {{"shop#1", 6}, {"shop.hall", 9}};
  sprout_evaluated set;
  bench_open(&b);
  bench_turn_for(&b, &t, "get reads the property");
  shows(&t.frame, &(sprout_evaluated){SPROUT_BINDS_OBJECT, {0}, {"shop#1", 6}, 0, NULL}, "{\"object\":\"shop#1\"}");
  memset(&set, 0, sizeof set);
  set.binds = SPROUT_BINDS_SET;
  set.count = 2;
  set.items = ids;
  shows(&t.frame, &set, "{\"set\":[\"shop#1\",\"shop.hall\"]}");
  set.binds = SPROUT_BINDS_READINGS;
  set.count = 0;
  shows(&t.frame, &set, "{\"readings\":[]}");
  bench_turn_close(&t);
  bench_close(&b);
}

int main(void) {
  RUN(a_value_is_shown_as_json_shows_it);
  RUN(an_empty_list_is_an_empty_array);
  RUN(an_object_a_set_and_readings_are_shown_by_their_ids_and_lines);
  return REPORT();
}
