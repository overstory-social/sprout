/*
 * Tests for src/view_json.c: a view is written as canonical JSON in the form the TypeScript view specs write it
 * (description, effects, exits, occupants, carried, readings), a filler of each kind, a refusal or null, and the
 * options of a symbol role and of an integer role. The writer is also the tree a chip client's leaf and filler
 * are written from.
 */
#include "check.h"
#include "view_json.h"

static const sprout_seen_thing APPLE = {{"w.apple", 7}, {"an apple", 8}};
static const sprout_seen_thing PEAR = {{"w.pear", 6}, {"a pear", 6}};

/* A view of every shape, held in static storage. */
static void build(sprout_seen_view *view) {
  static const sprout_str description[] = {{"A cobbled yard.", 15}, {"The gate stands open.", 21}};
  static const sprout_seen_exit exits[] = {{"north", "through the gate", {"w.tower", 7}}, {NULL, "down the stair", {"w.yard", 6}}};
  static const sprout_seen_option topics[] = {{{"old_road", 8}, {"old road", 8}}, {{"toll", 4}, {"toll", 4}}};
  static const sprout_seen_range ranges[] = {{1, 12}};
  static const sprout_seen_options options[] = {{"topic", true, 2, topics, 0, NULL}, {"code", false, 0, NULL, 1, ranges}};
  static const sprout_seen_thing members[] = {{{"w.apple", 7}, {"an apple", 8}}, {{"w.pear", 6}, {"a pear", 6}}};
  static const sprout_str refusal[] = {{"Not before me.", 14}};
  static const sprout_seen_filler fillers[] = {
      {"target", SPROUT_SEEN_OBJECT, {{"w.apple", 7}, {"an apple", 8}}, 0, NULL, {NULL, NULL, {NULL, 0}}},
      {"things", SPROUT_SEEN_SET, {{NULL, 0}, {NULL, 0}}, 2, members, {NULL, NULL, {NULL, 0}}},
      {"way", SPROUT_SEEN_EXIT, {{NULL, 0}, {NULL, 0}}, 0, NULL, {"north", "through the gate", {"w.tower", 7}}},
      {"link", SPROUT_SEEN_EXIT, {{NULL, 0}, {NULL, 0}}, 0, NULL, {NULL, "down the stair", {"w.yard", 6}}},
      {"topic", SPROUT_SEEN_UNBOUND, {{NULL, 0}, {NULL, 0}}, 0, NULL, {NULL, NULL, {NULL, 0}}}};
  static const sprout_seen_reading readings[] = {
      {"w.vouch", {"vouch apple \xe2\x80\xa6", 15}, true, 1, refusal, 5, fillers, 2, options},
      {"w.look", {"look", 4}, false, 0, NULL, 0, NULL, 0, NULL}};
  memset(view, 0, sizeof *view);
  view->description_count = 2;
  view->description = description;
  view->exit_count = 2;
  view->exits = exits;
  view->occupant_count = 1;
  view->occupants = &PEAR;
  view->carried_count = 1;
  view->carried = &APPLE;
  view->reading_count = 2;
  view->readings = readings;
}

static void a_view_is_written_in_the_canonical_form_the_view_specs_write(void) {
  sprout_seen_view view;
  test_heap heap;
  sprout_host host = test_host(&heap);
  sprout_arena arena;
  sprout_json *tree;
  const char *bytes;
  size_t length;
  host.page_bytes = 4096;
  sprout_arena_init(&arena, &host);
  build(&view);
  tree = sprout_view_tree(&arena, &view);
  CHECK(tree != NULL);
  CHECK_INT(sprout_json_write(&arena, tree, &bytes, &length), SPROUT_OK);
  CHECK_BYTES(bytes, length,
              "{\"description\":[\"A cobbled yard.\",\"The gate stands open.\"],\"effects\":[],"
              "\"exits\":[{\"direction\":\"north\",\"label\":\"through the gate\",\"to\":\"w.tower\"},"
              "{\"direction\":null,\"label\":\"down the stair\",\"to\":\"w.yard\"}],"
              "\"occupants\":[{\"id\":\"w.pear\",\"name\":\"a pear\"}],"
              "\"carried\":[{\"id\":\"w.apple\",\"name\":\"an apple\"}],"
              "\"readings\":[{\"verb\":\"w.vouch\",\"typed\":\"vouch apple \xe2\x80\xa6\",\"refused\":[\"Not before me.\"],"
              "\"fillers\":[{\"role\":\"target\",\"binds\":\"object\",\"id\":\"w.apple\",\"name\":\"an apple\"},"
              "{\"role\":\"things\",\"binds\":\"set\",\"ids\":[\"w.apple\",\"w.pear\"],\"names\":[\"an apple\",\"a pear\"]},"
              "{\"role\":\"way\",\"binds\":\"exit\",\"direction\":\"north\",\"label\":\"through the gate\",\"to\":\"w.tower\"},"
              "{\"role\":\"link\",\"binds\":\"exit\",\"direction\":null,\"label\":\"down the stair\",\"to\":\"w.yard\"},"
              "{\"role\":\"topic\",\"binds\":\"unbound\"}],"
              "\"options\":[{\"role\":\"topic\",\"takes\":\"symbol\",\"options\":[{\"value\":\"old_road\",\"words\":\"old road\"},"
              "{\"value\":\"toll\",\"words\":\"toll\"}]},{\"role\":\"code\",\"takes\":\"integer\",\"ranges\":[{\"min\":1,\"max\":12}]}]},"
              "{\"verb\":\"w.look\",\"typed\":\"look\",\"refused\":null,\"fillers\":[],\"options\":[]}]}");
  sprout_arena_reset(&arena);
  CHECK_INT(heap.pages, 0);
}

static void a_view_with_nothing_in_it_is_written_empty(void) {
  sprout_seen_view view;
  test_heap heap;
  sprout_host host = test_host(&heap);
  sprout_arena arena;
  const char *bytes;
  size_t length;
  host.page_bytes = 4096;
  sprout_arena_init(&arena, &host);
  memset(&view, 0, sizeof view);
  CHECK_INT(sprout_json_write(&arena, sprout_view_tree(&arena, &view), &bytes, &length), SPROUT_OK);
  CHECK_BYTES(bytes, length, "{\"description\":[],\"effects\":[],\"exits\":[],\"occupants\":[],\"carried\":[],\"readings\":[]}");
  sprout_arena_reset(&arena);
  CHECK_INT(heap.pages, 0);
}

static void the_pieces_a_chip_leaf_is_made_of_are_written_as_the_view_writes_them(void) {
  sprout_seen_view view;
  test_heap heap;
  sprout_host host = test_host(&heap);
  sprout_arena arena;
  const char *bytes;
  size_t length;
  host.page_bytes = 4096;
  sprout_arena_init(&arena, &host);
  build(&view);
  CHECK_INT(sprout_json_write(&arena, sprout_seen_filler_json(&arena, &view.readings[0].fillers[2]), &bytes, &length), SPROUT_OK);
  CHECK_BYTES(bytes, length,
              "{\"role\":\"way\",\"binds\":\"exit\",\"direction\":\"north\",\"label\":\"through the gate\",\"to\":\"w.tower\"}");
  CHECK_INT(sprout_json_write(&arena, sprout_seen_refusal_json(&arena, &view.readings[0]), &bytes, &length), SPROUT_OK);
  CHECK_BYTES(bytes, length, "[\"Not before me.\"]");
  CHECK_INT(sprout_json_write(&arena, sprout_seen_refusal_json(&arena, &view.readings[1]), &bytes, &length), SPROUT_OK);
  CHECK_BYTES(bytes, length, "null");
  CHECK_INT(sprout_json_write(&arena, sprout_seen_options_json(&arena, &view.readings[1]), &bytes, &length), SPROUT_OK);
  CHECK_BYTES(bytes, length, "[]");
  sprout_arena_reset(&arena);
  CHECK_INT(heap.pages, 0);
}

static void a_host_that_cannot_give_a_page_is_told_so(void) {
  sprout_seen_view view;
  test_heap heap;
  sprout_host host = test_host(&heap);
  sprout_arena arena;
  sprout_arena_init(&arena, &host);
  build(&view);
  heap.refuse_after = heap.pages;
  CHECK(sprout_view_tree(&arena, &view) == NULL);
  heap.refuse_after = -1;
  sprout_arena_reset(&arena);
  CHECK_INT(heap.pages, 0);
}

int main(void) {
  RUN(a_view_is_written_in_the_canonical_form_the_view_specs_write);
  RUN(a_view_with_nothing_in_it_is_written_empty);
  RUN(the_pieces_a_chip_leaf_is_made_of_are_written_as_the_view_writes_them);
  RUN(a_host_that_cannot_give_a_page_is_told_so);
  return REPORT();
}
