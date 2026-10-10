/*
 * Tests for src/state.c: opening a stored world against the catalogue the way
 * load does. A new world's store reconciled with its catalogue is the initial
 * state; a saved world reopened is unchanged; and stored worlds edited against
 * the world (an object gone, a property retyped, a kind removed, an object
 * destroyed) come out as the TypeScript load makes them, byte for byte, with
 * the same report of what was created, kept dormant and dropped.
 */
#include "corpus.h"
#include "state.h"

static sprout_status read_in(const sprout_host *host, const char *text, size_t length,
                             sprout_state **state, sprout_refusal *why) {
  return sprout_state_read(host, text, length, state, why);
}

static const char *why_name(sprout_drop_reason why) {
  switch (why) {
    case SPROUT_DROP_UNDECLARED:
      return "undeclared";
    case SPROUT_DROP_RETYPED:
      return "retyped";
    case SPROUT_DROP_NO_LONGER_FITS:
      return "no-longer-fits";
  }
  return "";
}

static void same_ids(const sprout_str *got, size_t got_count, const sprout_json *want) {
  size_t i;
  CHECK_INT(got_count, want->count);
  for (i = 0; i < got_count && i < want->count; i++)
    CHECK_BYTES(got[i].bytes, got[i].length, want->items[i]->bytes);
}

static void a_new_worlds_store_reconciled_is_the_initial_state_the_typescript_load_makes(void) {
  test_heap heap;
  sprout_host host = corpus_host(&heap);
  sprout_arena arena;
  size_t length, i;
  char *text = test_golden("stored-worlds.json", &length);
  sprout_json *root = NULL;
  sprout_json_error error;
  const sprout_json *initial;
  sprout_arena_init(&arena, &host);
  CHECK_INT(sprout_json_read(&arena, text, length, &root, &error), SPROUT_OK);
  initial = corpus_get(root, "initial");
  for (i = 0; i < initial->count; i++) {
    sprout_world *world = corpus_load(initial->items[i]->key, &host);
    sprout_state *state = NULL;
    sprout_opened report;
    sprout_refusal why;
    const char *want, *got;
    size_t want_length, got_length;
    CHECK_INT(sprout_state_empty(&host, world->header.name, &state), SPROUT_OK);
    CHECK_INT(sprout_state_open(state, world, &report, &why), SPROUT_OK);
    CHECK_INT(report.dropped_count, 0);
    CHECK_INT(report.dormant_count, 0);
    CHECK_INT(report.stranded_count, 0);
    CHECK(report.created_count >= 1);
    corpus_value_text(&arena, initial->items[i], &want, &want_length);
    CHECK_INT(sprout_state_write(state, &got, &got_length), SPROUT_OK);
    CHECK_BYTES(got, got_length, want);
    sprout_state_free(state);
    sprout_world_free(world);
  }
  sprout_arena_reset(&arena);
  free(text);
}

static void a_saved_world_reopened_is_unchanged_and_reports_nothing(void) {
  test_heap heap;
  sprout_host host = corpus_host(&heap);
  sprout_arena arena;
  size_t length, i;
  char *text = test_golden("stored-worlds.json", &length);
  sprout_json *root = NULL;
  sprout_json_error error;
  const sprout_json *played;
  sprout_arena_init(&arena, &host);
  CHECK_INT(sprout_json_read(&arena, text, length, &root, &error), SPROUT_OK);
  played = corpus_get(root, "played");
  for (i = 0; i < played->count; i++) {
    sprout_world *world = corpus_load(corpus_get(played->items[i], "world")->bytes, &host);
    sprout_state *state = NULL;
    sprout_opened report;
    sprout_refusal why;
    const char *want, *got;
    size_t want_length, got_length;
    corpus_value_text(&arena, corpus_get(played->items[i], "stored"), &want, &want_length);
    CHECK_INT(read_in(&host, want, want_length, &state, &why), SPROUT_OK);
    CHECK_INT(sprout_state_open(state, world, &report, &why), SPROUT_OK);
    CHECK_INT(report.created_count, 0);
    CHECK_INT(report.dropped_count, 0);
    CHECK_INT(report.dormant_count, 0);
    CHECK_INT(report.stranded_count, 0);
    CHECK_INT(sprout_state_write(state, &got, &got_length), SPROUT_OK);
    CHECK_BYTES(got, got_length, want);
    sprout_state_free(state);
    sprout_world_free(world);
  }
  sprout_arena_reset(&arena);
  free(text);
}

static void a_stored_world_edited_against_the_world_comes_out_as_the_typescript_load_makes_it(void) {
  test_heap heap;
  sprout_host host = corpus_host(&heap);
  sprout_arena arena;
  size_t length, i, j;
  char *text = corpus_read(SPROUT_GOLDENS "/stored-reopened.json", &length);
  sprout_json *root = NULL;
  sprout_json_error error;
  sprout_arena_init(&arena, &host);
  CHECK_INT(sprout_json_read(&arena, text, length, &root, &error), SPROUT_OK);
  CHECK(root->count > 60);
  for (i = 0; i < root->count; i++) {
    const sprout_json *one = root->items[i];
    const sprout_json *dropped = corpus_get(one, "dropped");
    sprout_world *world = corpus_load(corpus_get(one, "world")->bytes, &host);
    sprout_state *state = NULL;
    sprout_opened report;
    sprout_refusal why;
    const char *input, *want, *got;
    size_t input_length, want_length, got_length;
    corpus_value_text(&arena, corpus_get(one, "input"), &input, &input_length);
    corpus_value_text(&arena, corpus_get(one, "saved"), &want, &want_length);
    CHECK_INT(read_in(&host, input, input_length, &state, &why), SPROUT_OK);
    CHECK_INT(sprout_state_open(state, world, &report, &why), SPROUT_OK);
    same_ids(report.created, report.created_count, corpus_get(one, "created"));
    same_ids(report.dormant, report.dormant_count, corpus_get(one, "dormant"));
    same_ids(report.stranded, report.stranded_count, corpus_get(one, "stranded"));
    CHECK_INT(report.dropped_count, dropped->count);
    for (j = 0; j < report.dropped_count && j < dropped->count; j++) {
      const sprout_json *row = dropped->items[j];
      CHECK_BYTES(report.dropped[j].id.bytes, report.dropped[j].id.length, row->items[0]->bytes);
      CHECK_BYTES(report.dropped[j].property.bytes, report.dropped[j].property.length, row->items[1]->bytes);
      if (row->items[2]->kind == SPROUT_JSON_NULL) CHECK(!report.dropped[j].has_actor);
      else {
        CHECK(report.dropped[j].has_actor);
        CHECK_BYTES(report.dropped[j].actor.bytes, report.dropped[j].actor.length, row->items[2]->bytes);
      }
      CHECK_STR(why_name(report.dropped[j].why), row->items[3]->bytes);
    }
    CHECK_INT(sprout_state_write(state, &got, &got_length), SPROUT_OK);
    CHECK_BYTES(got, got_length, want);
    sprout_state_free(state);
    sprout_world_free(world);
  }
  sprout_arena_reset(&arena);
  free(text);
}

static void the_store_of_another_world_is_refused_in_words(void) {
  test_heap heap;
  sprout_host host = corpus_host(&heap);
  sprout_world *world = corpus_load("printers_shop", &host);
  sprout_state *state = NULL;
  sprout_opened report;
  sprout_refusal why;
  CHECK_INT(sprout_state_empty(&host, "teashop", &state), SPROUT_OK);
  CHECK_INT(sprout_state_open(state, world, &report, &why), SPROUT_BAD_INPUT);
  CHECK_STR(why.text, "The stored state is not readable: the store holds `teashop`, and this is `printers_shop`.");
  sprout_state_free(state);
  sprout_world_free(world);
}

static void a_destroyed_declared_object_is_never_made_again_nor_anything_inside_it(void) {
  test_heap heap;
  sprout_host host = corpus_host(&heap);
  sprout_world *world = corpus_load("printers_shop", &host);
  sprout_state *state = NULL;
  sprout_opened report;
  sprout_refusal why;
  size_t i;
  const char *text =
      "{\"world\":\"printers_shop\",\"serial\":0,\"instances\":[],\"visitors\":[],"
      "\"tombstones\":[\"printers_shop.composing_room\"]}";
  CHECK_INT(read_in(&host, text, strlen(text), &state, &why), SPROUT_OK);
  CHECK_INT(sprout_state_open(state, world, &report, &why), SPROUT_OK);
  for (i = 0; i < report.created_count; i++) {
    CHECK(strstr(report.created[i].bytes, "composing_room") == NULL);
  }
  CHECK(report.created_count > 0);
  CHECK(sprout_state_find(state, (sprout_str){"printers_shop.composing_room", 28}) == NULL);
  CHECK(sprout_state_tombstoned(state, (sprout_str){"printers_shop.composing_room", 28}));
  sprout_state_free(state);
  sprout_world_free(world);
}

static void lookups_bisect_once_sorted_and_scan_before(void) {
  test_heap heap;
  sprout_host host = corpus_host(&heap);
  sprout_state *state = NULL;
  sprout_refusal why;
  const char *text =
      "{\"world\":\"shop\",\"serial\":2,\"instances\":["
      "{\"id\":\"shop.b\",\"made\":{\"from\":\"declared\"},\"container\":\"shop\",\"arrival\":null,\"properties\":{},\"links\":{},\"wakes\":[],\"memory\":{},\"lastTick\":null},"
      "{\"id\":\"shop\",\"made\":{\"from\":\"world\"},\"container\":null,\"arrival\":null,\"properties\":{},\"links\":{},\"wakes\":[],\"memory\":{},\"lastTick\":null},"
      "{\"id\":\"shop#2\",\"made\":{\"from\":\"visitor\"},\"container\":\"shop\",\"arrival\":2,\"properties\":{},\"links\":{},\"wakes\":[],\"memory\":{},\"lastTick\":null}],"
      "\"visitors\":[{\"visit\":\"v\",\"nickname\":\"N\",\"instance\":\"shop#2\",\"lastPlace\":null,\"referents\":[],\"lastReading\":null}],"
      "\"tombstones\":[\"shop.z\",\"shop.a\"]}";
  CHECK_INT(read_in(&host, text, strlen(text), &state, &why), SPROUT_OK);
  CHECK(!state->instances_sorted);
  CHECK(sprout_state_find(state, (sprout_str){"shop.b", 6}) == &state->instances[0]);
  CHECK(sprout_state_find(state, (sprout_str){"shop.c", 6}) == NULL);
  CHECK_INT(sprout_state_sort(state), SPROUT_OK);
  CHECK(state->instances_sorted);
  CHECK_BYTES(state->instances[0].id.bytes, state->instances[0].id.length, "shop");
  CHECK_BYTES(state->instances[1].id.bytes, state->instances[1].id.length, "shop#2");
  CHECK_BYTES(state->instances[2].id.bytes, state->instances[2].id.length, "shop.b");
  CHECK(sprout_state_find(state, (sprout_str){"shop#2", 6}) == &state->instances[1]);
  CHECK(sprout_state_find(state, (sprout_str){"shop.c", 6}) == NULL);
  CHECK_BYTES(state->tombstones[0].bytes, state->tombstones[0].length, "shop.a");
  CHECK(sprout_state_find_visitor(state, (sprout_str){"v", 1}) == &state->visitors[0]);
  CHECK(sprout_state_find_visitor(state, (sprout_str){"w", 1}) == NULL);
  sprout_state_free(state);
}

int main(void) {
  RUN(a_new_worlds_store_reconciled_is_the_initial_state_the_typescript_load_makes);
  RUN(a_saved_world_reopened_is_unchanged_and_reports_nothing);
  RUN(a_stored_world_edited_against_the_world_comes_out_as_the_typescript_load_makes_it);
  RUN(the_store_of_another_world_is_refused_in_words);
  RUN(a_destroyed_declared_object_is_never_made_again_nor_anything_inside_it);
  RUN(lookups_bisect_once_sorted_and_scan_before);
  return REPORT();
}
