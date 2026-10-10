/*
 * Tests for src/chips.c (the spec's The runtime > The view: a reading is offered as verb, fillers, the options
 * of each value role, given per role in the order the verb declares them): the readings of a view are grouped
 * by verb, then by the filler of each filled role in declared order, and end in the reading's typed line, its
 * value options and the consent pass's refusal. Groups keep the order the view offers them in, a filler is
 * offered once however many readings it begins, and the first reading to end at a node is its leaf.
 */
#include "check.h"
#include "chips.h"

static const sprout_seen_filler UNBOUND_TOPIC = {"topic", SPROUT_SEEN_UNBOUND, {{NULL, 0}, {NULL, 0}}, 0, NULL, {NULL, NULL, {NULL, 0}}};

static sprout_seen_filler object(const char *role, const char *id, const char *name) {
  sprout_seen_filler filler;
  memset(&filler, 0, sizeof filler);
  filler.role = role;
  filler.binds = SPROUT_SEEN_OBJECT;
  filler.thing.id = (sprout_str){id, strlen(id)};
  filler.thing.name = (sprout_str){name, strlen(name)};
  return filler;
}

static sprout_seen_reading reading(const char *verb, const char *typed, const sprout_seen_filler *fillers, size_t count) {
  sprout_seen_reading r;
  memset(&r, 0, sizeof r);
  r.verb = verb;
  r.typed = (sprout_str){typed, strlen(typed)};
  r.fillers = fillers;
  r.filler_count = count;
  return r;
}

/* Eat, give (twice alike), look and say, as a view of a few things offers them. */
typedef struct bench {
  sprout_seen_filler eat_apple[1], eat_pear[1], give_apple_pear[2], say_pear[2];
  sprout_seen_reading readings[6];
  sprout_seen_view view;
} bench;

static void build(bench *b) {
  static const sprout_str refusal[] = {{"You cannot.", 11}};
  memset(b, 0, sizeof *b);
  b->eat_apple[0] = object("target", "w.apple", "an apple");
  b->eat_pear[0] = object("target", "w.pear", "a pear");
  b->give_apple_pear[0] = object("item", "w.apple", "an apple");
  b->give_apple_pear[1] = object("recipient", "w.pear", "a pear");
  b->say_pear[0] = object("target", "w.pear", "a pear");
  b->say_pear[1] = UNBOUND_TOPIC;
  b->readings[0] = reading("w.eat", "eat apple", b->eat_apple, 1);
  b->readings[1] = reading("w.eat", "eat pear", b->eat_pear, 1);
  b->readings[2] = reading("w.give", "give apple to pear", b->give_apple_pear, 2);
  b->readings[3] = reading("w.give", "give apple to pear please", b->give_apple_pear, 2);
  b->readings[3].refused = true;
  b->readings[3].refusal = refusal;
  b->readings[3].refusal_count = 1;
  b->readings[4] = reading("w.look", "look", NULL, 0);
  b->readings[5] = reading("w.say", "say pear \xe2\x80\xa6", b->say_pear, 2);
  b->view.readings = b->readings;
  b->view.reading_count = 6;
}

static void readings_are_grouped_by_verb_in_the_order_the_view_offers_them(void) {
  bench b;
  test_heap heap;
  sprout_host host = test_host(&heap);
  sprout_arena arena;
  sprout_chip_tree tree;
  host.page_bytes = 4096;
  sprout_arena_init(&arena, &host);
  build(&b);
  CHECK_INT(sprout_chip_tree_of(&arena, &b.view, &tree), SPROUT_OK);
  CHECK_INT(tree.verb_count, 4);
  CHECK_STR(tree.verbs[0].verb, "w.eat");
  CHECK_STR(tree.verbs[1].verb, "w.give");
  CHECK_STR(tree.verbs[2].verb, "w.look");
  CHECK_STR(tree.verbs[3].verb, "w.say");
  sprout_arena_reset(&arena);
  CHECK_INT(heap.pages, 0);
}

static void each_filled_role_is_a_level_and_the_reading_ends_at_the_last(void) {
  bench b;
  test_heap heap;
  sprout_host host = test_host(&heap);
  sprout_arena arena;
  sprout_chip_tree tree;
  const sprout_chip_node *eat, *give, *look, *say;
  host.page_bytes = 4096;
  sprout_arena_init(&arena, &host);
  build(&b);
  CHECK_INT(sprout_chip_tree_of(&arena, &b.view, &tree), SPROUT_OK);
  eat = tree.verbs[0].next;
  CHECK_INT(eat->choice_count, 2);
  CHECK(eat->leaf == NULL);
  CHECK_STR(eat->choices[0].filler->thing.name.bytes, "an apple");
  CHECK_BYTES(eat->choices[1].next->leaf->typed.bytes, eat->choices[1].next->leaf->typed.length, "eat pear");
  give = tree.verbs[1].next;
  CHECK_INT(give->choice_count, 1);
  CHECK_INT(give->choices[0].next->choice_count, 1);
  CHECK(give->choices[0].next->leaf == NULL);
  look = tree.verbs[2].next;
  CHECK_INT(look->choice_count, 0);
  CHECK(look->leaf != NULL);
  /* A value role is no level: the reading ends at the thing it is said to. */
  say = tree.verbs[3].next;
  CHECK_INT(say->choice_count, 1);
  CHECK(say->choices[0].next->choice_count == 0 && say->choices[0].next->leaf != NULL);
  sprout_arena_reset(&arena);
  CHECK_INT(heap.pages, 0);
}

static void the_first_reading_to_end_at_a_node_is_its_leaf_and_a_filler_is_offered_once(void) {
  bench b;
  test_heap heap;
  sprout_host host = test_host(&heap);
  sprout_arena arena;
  sprout_chip_tree tree;
  const sprout_chip_node *end;
  host.page_bytes = 4096;
  sprout_arena_init(&arena, &host);
  build(&b);
  CHECK_INT(sprout_chip_tree_of(&arena, &b.view, &tree), SPROUT_OK);
  end = tree.verbs[1].next->choices[0].next->choices[0].next;
  CHECK_BYTES(end->leaf->typed.bytes, end->leaf->typed.length, "give apple to pear");
  CHECK(!end->leaf->refused);
  sprout_arena_reset(&arena);
  CHECK_INT(heap.pages, 0);
}

static void the_tree_is_written_as_json_in_the_form_the_view_specs_write(void) {
  bench b;
  test_heap heap;
  sprout_host host = test_host(&heap);
  sprout_arena arena;
  sprout_chip_tree tree;
  const char *bytes;
  size_t length;
  host.page_bytes = 4096;
  sprout_arena_init(&arena, &host);
  build(&b);
  b.view.reading_count = 6;
  /* Only the look and the say, so the text is short. */
  b.view.readings = &b.readings[4];
  b.view.reading_count = 2;
  CHECK_INT(sprout_chip_tree_of(&arena, &b.view, &tree), SPROUT_OK);
  CHECK_INT(sprout_json_write(&arena, sprout_chip_tree_json(&arena, &tree), &bytes, &length), SPROUT_OK);
  CHECK_BYTES(bytes, length,
              "[{\"verb\":\"w.look\",\"next\":{\"choices\":[],\"leaf\":{\"typed\":\"look\",\"refused\":null,\"options\":[]}}},"
              "{\"verb\":\"w.say\",\"next\":{\"choices\":[{\"filler\":{\"role\":\"target\",\"binds\":\"object\",\"id\":\"w.pear\","
              "\"name\":\"a pear\"},\"next\":{\"choices\":[],\"leaf\":{\"typed\":\"say pear \xe2\x80\xa6\",\"refused\":null,"
              "\"options\":[]}}}],\"leaf\":null}}]");
  sprout_arena_reset(&arena);
  CHECK_INT(heap.pages, 0);
}

static void a_view_with_no_readings_is_an_empty_tree(void) {
  sprout_seen_view view;
  test_heap heap;
  sprout_host host = test_host(&heap);
  sprout_arena arena;
  sprout_chip_tree tree;
  const char *bytes;
  size_t length;
  host.page_bytes = 4096;
  sprout_arena_init(&arena, &host);
  memset(&view, 0, sizeof view);
  CHECK_INT(sprout_chip_tree_of(&arena, &view, &tree), SPROUT_OK);
  CHECK_INT(tree.verb_count, 0);
  CHECK_INT(sprout_json_write(&arena, sprout_chip_tree_json(&arena, &tree), &bytes, &length), SPROUT_OK);
  CHECK_BYTES(bytes, length, "[]");
  sprout_arena_reset(&arena);
  CHECK_INT(heap.pages, 0);
}

static void a_host_that_cannot_give_a_page_is_told_so(void) {
  bench b;
  test_heap heap;
  sprout_host host = test_host(&heap);
  sprout_arena arena;
  sprout_chip_tree tree;
  sprout_arena_init(&arena, &host);
  build(&b);
  heap.refuse_after = heap.pages;
  CHECK_INT(sprout_chip_tree_of(&arena, &b.view, &tree), SPROUT_NO_MEMORY);
  heap.refuse_after = -1;
  sprout_arena_reset(&arena);
  CHECK_INT(heap.pages, 0);
}

int main(void) {
  RUN(readings_are_grouped_by_verb_in_the_order_the_view_offers_them);
  RUN(each_filled_role_is_a_level_and_the_reading_ends_at_the_last);
  RUN(the_first_reading_to_end_at_a_node_is_its_leaf_and_a_filler_is_offered_once);
  RUN(the_tree_is_written_as_json_in_the_form_the_view_specs_write);
  RUN(a_view_with_no_readings_is_an_empty_tree);
  RUN(a_host_that_cannot_give_a_page_is_told_so);
  return REPORT();
}
