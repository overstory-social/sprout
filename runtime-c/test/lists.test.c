/* Tests for src/lists.c: includes, count, add and remove, bounded by the host. */
#include "lists.h"
#include "check.h"

static const sprout_type number_type = {SPROUT_NUMBER, NULL};
static const sprout_type string_type = {SPROUT_STRING, NULL};
static const sprout_type numbers_type = {SPROUT_LIST, &number_type};

static sprout_limit unbounded(void) {
  sprout_limit none = {false, 0};
  return none;
}

static sprout_limit at_most(uint64_t n) {
  sprout_limit limit = {true, n};
  return limit;
}

static const sprout_list *numbers(sprout_arena *arena, const double *values, size_t count,
                                  sprout_limit allowed) {
  sprout_value items[16];
  const sprout_list *list = NULL;
  for (size_t i = 0; i < count; i++) items[i] = sprout_number(values[i]);
  CHECK_INT(sprout_list_make(arena, &number_type, items, count, allowed, &list), SPROUT_LIST_OK);
  return list;
}

static void a_list_keeps_insertion_order_and_drops_later_duplicates(void) {
  test_heap heap;
  sprout_host host = test_host(&heap);
  sprout_arena arena;
  double values[] = {3, 1, 3, 2, 1};
  const sprout_list *list;
  sprout_arena_init(&arena, &host);
  list = numbers(&arena, values, 5, unbounded());
  CHECK_INT(sprout_list_count(list), 3);
  CHECK(list->items[0].as.number == 3 && list->items[1].as.number == 1 && list->items[2].as.number == 2);
  sprout_arena_reset(&arena);
}

static void includes_and_count_say_what_it_holds(void) {
  test_heap heap;
  sprout_host host = test_host(&heap);
  sprout_arena arena;
  double values[] = {5, 6};
  const sprout_list *list, *empty;
  sprout_value five = sprout_number(5), seven = sprout_number(7), word, flag = sprout_bool(true);
  sprout_arena_init(&arena, &host);
  list = numbers(&arena, values, 2, unbounded());
  empty = numbers(&arena, values, 0, unbounded());
  CHECK(sprout_list_includes(list, &five));
  CHECK(!sprout_list_includes(list, &seven));
  CHECK(!sprout_list_includes(list, &flag));
  CHECK(!sprout_list_includes(empty, &five));
  CHECK_INT(sprout_list_count(empty), 0);
  CHECK(sprout_string(&arena, "5", 1, &word));
  CHECK(!sprout_list_includes(list, &word));
  sprout_arena_reset(&arena);
}

static void add_appends_a_new_element_and_leaves_the_old_list_as_it_was(void) {
  test_heap heap;
  sprout_host host = test_host(&heap);
  sprout_arena arena;
  double values[] = {1, 2};
  const sprout_list *before, *after = NULL;
  sprout_value three = sprout_number(3);
  sprout_arena_init(&arena, &host);
  before = numbers(&arena, values, 2, unbounded());
  CHECK_INT(sprout_list_add(&arena, before, &three, unbounded(), &after), SPROUT_LIST_OK);
  CHECK_INT(sprout_list_count(before), 2);
  CHECK_INT(sprout_list_count(after), 3);
  CHECK(after->items[2].as.number == 3);
  sprout_arena_reset(&arena);
}

static void adding_what_is_held_does_nothing_and_gives_the_same_list(void) {
  test_heap heap;
  sprout_host host = test_host(&heap);
  sprout_arena arena;
  double values[] = {1, 2};
  const sprout_list *before, *after = NULL;
  sprout_value two = sprout_number(2);
  sprout_arena_init(&arena, &host);
  before = numbers(&arena, values, 2, unbounded());
  CHECK_INT(sprout_list_add(&arena, before, &two, at_most(2), &after), SPROUT_LIST_OK);
  CHECK(after == before);
  sprout_arena_reset(&arena);
}

static void adding_a_new_element_to_a_full_list_is_reported_at_the_hosts_number(void) {
  test_heap heap;
  sprout_host host = test_host(&heap);
  sprout_arena arena;
  double values[] = {1, 2, 3};
  const sprout_list *list, *after = NULL;
  sprout_value four = sprout_number(4);
  sprout_arena_init(&arena, &host);
  list = numbers(&arena, values, 3, at_most(3));
  CHECK_INT(sprout_list_add(&arena, list, &four, at_most(3), &after), SPROUT_LIST_FULL);
  CHECK(after == NULL);
  CHECK_INT(sprout_list_add(&arena, list, &four, at_most(4), &after), SPROUT_LIST_OK);
  CHECK_INT(sprout_list_count(after), 4);
  CHECK_INT(sprout_list_add(&arena, list, &four, unbounded(), &after), SPROUT_LIST_OK);
  CHECK_INT(sprout_list_add(&arena, list, &four, at_most(0), &after), SPROUT_LIST_FULL);
  sprout_arena_reset(&arena);
}

static void making_a_list_past_the_bound_is_reported(void) {
  test_heap heap;
  sprout_host host = test_host(&heap);
  sprout_arena arena;
  sprout_value items[3] = {sprout_number(1), sprout_number(2), sprout_number(3)};
  const sprout_list *list = NULL;
  sprout_arena_init(&arena, &host);
  CHECK_INT(sprout_list_make(&arena, &number_type, items, 3, at_most(2), &list), SPROUT_LIST_FULL);
  CHECK_INT(sprout_list_make(&arena, &number_type, items, 3, at_most(3), &list), SPROUT_LIST_OK);
  sprout_arena_reset(&arena);
}

static void remove_takes_one_out_keeping_the_order_of_the_rest(void) {
  test_heap heap;
  sprout_host host = test_host(&heap);
  sprout_arena arena;
  double values[] = {1, 2, 3};
  const sprout_list *list, *after = NULL;
  sprout_value two = sprout_number(2), nine = sprout_number(9);
  sprout_arena_init(&arena, &host);
  list = numbers(&arena, values, 3, unbounded());
  CHECK_INT(sprout_list_remove(&arena, list, &two, &after), SPROUT_LIST_OK);
  CHECK_INT(sprout_list_count(after), 2);
  CHECK(after->items[0].as.number == 1 && after->items[1].as.number == 3);
  CHECK_INT(sprout_list_count(list), 3);
  CHECK_INT(sprout_list_remove(&arena, list, &nine, &after), SPROUT_LIST_OK);
  CHECK(after == list);
  sprout_arena_reset(&arena);
}

static void removing_the_last_element_gives_an_empty_list(void) {
  test_heap heap;
  sprout_host host = test_host(&heap);
  sprout_arena arena;
  double values[] = {1};
  const sprout_list *list, *after = NULL;
  sprout_value one = sprout_number(1);
  sprout_arena_init(&arena, &host);
  list = numbers(&arena, values, 1, unbounded());
  CHECK_INT(sprout_list_remove(&arena, list, &one, &after), SPROUT_LIST_OK);
  CHECK_INT(sprout_list_count(after), 0);
  CHECK_INT(sprout_list_add(&arena, after, &one, unbounded(), &after), SPROUT_LIST_OK);
  CHECK_INT(sprout_list_count(after), 1);
  sprout_arena_reset(&arena);
}

static void an_element_of_the_wrong_type_is_refused(void) {
  test_heap heap;
  sprout_host host = test_host(&heap);
  sprout_arena arena;
  double values[] = {1};
  const sprout_list *list, *after = NULL;
  sprout_value word;
  sprout_arena_init(&arena, &host);
  list = numbers(&arena, values, 1, unbounded());
  CHECK(sprout_string(&arena, "x", 1, &word));
  CHECK_INT(sprout_list_add(&arena, list, &word, unbounded(), &after), SPROUT_LIST_WRONG_TYPE);
  CHECK_INT(sprout_list_make(&arena, &string_type, &(sprout_value){SPROUT_NUMBER, {.number = 1}}, 1,
                             unbounded(), &after),
            SPROUT_LIST_WRONG_TYPE);
  sprout_arena_reset(&arena);
}

static void a_list_of_lists_keeps_no_duplicates_by_content(void) {
  test_heap heap;
  sprout_host host = test_host(&heap);
  sprout_arena arena;
  double one_two[] = {1, 2}, again[] = {1, 2}, other[] = {2, 1};
  sprout_value a, b, c, outer_items[3];
  const sprout_list *outer = NULL, *after = NULL;
  sprout_arena_init(&arena, &host);
  a.kind = b.kind = c.kind = SPROUT_LIST;
  a.as.list = numbers(&arena, one_two, 2, unbounded());
  b.as.list = numbers(&arena, again, 2, unbounded());
  c.as.list = numbers(&arena, other, 2, unbounded());
  outer_items[0] = a;
  outer_items[1] = b;
  outer_items[2] = c;
  CHECK_INT(sprout_list_make(&arena, &numbers_type, outer_items, 3, unbounded(), &outer), SPROUT_LIST_OK);
  CHECK_INT(sprout_list_count(outer), 2);
  CHECK_INT(sprout_list_add(&arena, outer, &b, unbounded(), &after), SPROUT_LIST_OK);
  CHECK(after == outer);
  CHECK_INT(sprout_list_remove(&arena, outer, &b, &after), SPROUT_LIST_OK);
  CHECK_INT(sprout_list_count(after), 1);
  CHECK(sprout_value_same(&after->items[0], &c));
  sprout_arena_reset(&arena);
}

static void a_host_that_refuses_memory_is_met_with_a_result_not_a_crash(void) {
  test_heap heap;
  sprout_host host = test_host(&heap);
  sprout_arena arena;
  sprout_value big[40];
  const sprout_list *made = NULL;
  sprout_arena_init(&arena, &host);
  heap.refuse_after = 0;
  for (int i = 0; i < 40; i++) big[i] = sprout_number(i);
  CHECK_INT(sprout_list_make(&arena, &number_type, big, 40, unbounded(), &made), SPROUT_LIST_NO_MEMORY);
  CHECK(made == NULL);
  sprout_arena_reset(&arena);
}

int main(void) {
  RUN(a_list_keeps_insertion_order_and_drops_later_duplicates);
  RUN(includes_and_count_say_what_it_holds);
  RUN(add_appends_a_new_element_and_leaves_the_old_list_as_it_was);
  RUN(adding_what_is_held_does_nothing_and_gives_the_same_list);
  RUN(adding_a_new_element_to_a_full_list_is_reported_at_the_hosts_number);
  RUN(making_a_list_past_the_bound_is_reported);
  RUN(remove_takes_one_out_keeping_the_order_of_the_rest);
  RUN(removing_the_last_element_gives_an_empty_list);
  RUN(an_element_of_the_wrong_type_is_refused);
  RUN(a_list_of_lists_keeps_no_duplicates_by_content);
  RUN(a_host_that_refuses_memory_is_met_with_a_result_not_a_crash);
  return REPORT();
}
