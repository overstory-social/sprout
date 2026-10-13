/*
 * Tests for src/reading_json.c: a reading, an item of a run and a turn a line runs written in the readings file's
 * forms (player/src/parsed.ts), and a reading and an item read back to what was written; what no role takes, or
 * what is missing, is refused in words.
 */
#include "check.h"
#include "reading_json.h"

static const char *written(sprout_arena *arena, const sprout_json *tree) {
  const char *bytes = "";
  size_t length;
  if (tree == NULL || sprout_json_write(arena, tree, &bytes, &length) != SPROUT_OK) return "";
  return bytes;
}

static const sprout_json *tree_of(sprout_arena *arena, const char *text) {
  sprout_json *tree = NULL;
  sprout_json_error error;
  CHECK_INT(sprout_json_read(arena, text, strlen(text), &tree, &error), SPROUT_OK);
  return tree;
}

static void a_reading_is_written_and_read_back_filler_by_filler(void) {
  test_heap heap;
  sprout_host host = test_host(&heap);
  sprout_arena arena;
  const char *ids[2] = {"w.pin", "w.key"};
  sprout_filling fillings[5];
  sprout_reading reading = {"w.turn", "w#1", 5, fillings}, back;
  const char *text;
  sprout_arena_init(&arena, &host);
  memset(fillings, 0, sizeof fillings);
  fillings[0].role = "target";
  fillings[0].binds = SPROUT_FILL_OBJECT;
  fillings[0].id = "w.dial";
  fillings[1].role = "things";
  fillings[1].binds = SPROUT_FILL_SET;
  fillings[1].ids = ids;
  fillings[1].id_count = 2;
  fillings[2].role = "way";
  fillings[2].binds = SPROUT_FILL_EXIT;
  fillings[2].label = "through the arch";
  fillings[2].id = "w.yard";
  fillings[3].role = "notch";
  fillings[3].binds = SPROUT_FILL_NUMBER;
  fillings[3].number = 3;
  fillings[4].role = "tune";
  fillings[4].binds = SPROUT_FILL_TEXT;
  fillings[4].text = "low";
  text = written(&arena, sprout_reading_tree(&arena, "verb", &reading));
  CHECK_STR(text, "{\"verb\":\"w.turn\",\"actor\":\"w#1\",\"bindings\":[{\"role\":\"target\",\"binds\":\"object\",\"id\":"
                  "\"w.dial\"},{\"role\":\"things\",\"binds\":\"set\",\"ids\":[\"w.pin\",\"w.key\"]},{\"role\":\"way\","
                  "\"binds\":\"exit\",\"direction\":null,\"label\":\"through the arch\",\"to\":\"w.yard\"},{\"role\":"
                  "\"notch\",\"binds\":\"value\",\"value\":3},{\"role\":\"tune\",\"binds\":\"value\",\"value\":\"low\"}]}");
  CHECK(sprout_reading_of_tree(&arena, tree_of(&arena, text), &back) == NULL);
  CHECK_STR(written(&arena, sprout_reading_tree(&arena, "verb", &back)), text);
  CHECK(back.fillings[2].direction == NULL);
  sprout_arena_reset(&arena);
}

static void an_item_of_a_run_and_a_turn_a_line_runs_are_written_and_read_back(void) {
  test_heap heap;
  sprout_host host = test_host(&heap);
  sprout_arena arena;
  sprout_reread_value values[1] = {{"notch", "three"}};
  const char *referents[1] = {"w.box"};
  sprout_reread reread = {"target", "box", 1, values, 1, referents}, back;
  sprout_reading look = {"sprout.look", "w#1", 0, NULL};
  sprout_following planned = {&look, &reread, NULL}, words = {NULL, NULL, "drop it"};
  const char *text;
  sprout_arena_init(&arena, &host);
  text = written(&arena, sprout_reread_tree(&arena, &reread));
  CHECK_STR(text, "{\"role\":\"target\",\"words\":\"box\",\"values\":[{\"role\":\"notch\",\"words\":\"three\"}],"
                  "\"referents\":[\"w.box\"]}");
  CHECK(sprout_reread_of_tree(&arena, tree_of(&arena, text), &back) == NULL);
  CHECK_STR(written(&arena, sprout_reread_tree(&arena, &back)), text);
  CHECK_STR(written(&arena, sprout_following_tree(&arena, &planned)),
            "{\"planned\":{\"verb\":\"sprout.look\",\"actor\":\"w#1\",\"bindings\":[]},\"reread\":{\"role\":\"target\","
            "\"words\":\"box\",\"values\":[{\"role\":\"notch\",\"words\":\"three\"}],\"referents\":[\"w.box\"]}}");
  CHECK_STR(written(&arena, sprout_following_tree(&arena, &words)), "{\"text\":\"drop it\"}");
  sprout_arena_reset(&arena);
}

static void what_no_role_takes_or_what_is_missing_is_refused_in_words(void) {
  test_heap heap;
  sprout_host host = test_host(&heap);
  sprout_arena arena;
  sprout_reading reading;
  sprout_reread reread;
  sprout_arena_init(&arena, &host);
  CHECK(sprout_reading_of_tree(&arena, tree_of(&arena, "{\"actor\":\"w#1\",\"bindings\":[]}"), &reading) != NULL);
  CHECK(sprout_reading_of_tree(&arena, tree_of(&arena, "{\"verb\":\"v\",\"actor\":\"w#1\"}"), &reading) != NULL);
  CHECK(sprout_reading_of_tree(&arena,
                               tree_of(&arena, "{\"verb\":\"v\",\"actor\":\"a\",\"bindings\":[{\"role\":\"r\",\"binds\":\"ghost\"}]}"),
                               &reading) != NULL);
  CHECK(sprout_reading_of_tree(&arena,
                               tree_of(&arena, "{\"verb\":\"v\",\"actor\":\"a\",\"bindings\":[{\"role\":\"r\",\"binds\":\"set\","
                                               "\"ids\":[1]}]}"),
                               &reading) != NULL);
  CHECK(sprout_reread_of_tree(&arena, tree_of(&arena, "{\"role\":\"r\",\"words\":\"w\"}"), &reread) != NULL);
  sprout_arena_reset(&arena);
}

int main(void) {
  RUN(a_reading_is_written_and_read_back_filler_by_filler);
  RUN(an_item_of_a_run_and_a_turn_a_line_runs_are_written_and_read_back);
  RUN(what_no_role_takes_or_what_is_missing_is_refused_in_words);
  return REPORT();
}
