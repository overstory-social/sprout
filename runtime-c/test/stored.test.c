/*
 * Tests for src/stored.c: the stored world is read as the stored form's
 * schema reads it and written back in the canonical form, byte for byte, for
 * the canonical golden and for every stored world the transcripts produce;
 * a store the schema refuses is refused in words that name where.
 */
#include "corpus.h"
#include "state.h"

/* The stored world of a small shop, with room to mutate one piece. */
#define WORLD_HEAD "{\"world\":\"shop\",\"serial\":3,"
#define NO_VISITORS "\"visitors\":[],\"tombstones\":[]}"
#define SHOP_ROOM                                                                              \
  "{\"id\":\"shop.hall\",\"made\":{\"from\":\"declared\"},\"container\":\"shop\",\"arrival\":null," \
  "\"properties\":{},\"links\":{},\"wakes\":[],\"memory\":{},\"lastTick\":null}"
#define SHOP_WORLD                                                                              \
  "{\"id\":\"shop\",\"made\":{\"from\":\"world\"},\"container\":null,\"arrival\":null,"          \
  "\"properties\":{},\"links\":{},\"wakes\":[],\"memory\":{},\"lastTick\":null}"

static sprout_status read_text(const char *text, sprout_state **state, sprout_refusal *why) {
  static test_heap heap;
  static sprout_host host;
  host = test_host(&heap);
  host.page_bytes = 4096;
  return sprout_state_read(&host, text, strlen(text), state, why);
}

static void refused(const char *text, const char *words) {
  sprout_state *state = NULL;
  sprout_refusal why;
  CHECK_INT(read_text(text, &state, &why), SPROUT_BAD_INPUT);
  CHECK(state == NULL);
  CHECK_STR(why.text, words);
}

static void round_trips(const char *text) {
  sprout_state *state = NULL;
  sprout_refusal why;
  const char *out;
  size_t length;
  sprout_status status = read_text(text, &state, &why);
  CHECK_INT(status, SPROUT_OK);
  if (status != SPROUT_OK) {
    fprintf(stderr, "  refused: %s\n", why.text);
    return;
  }
  CHECK_INT(sprout_state_write(state, &out, &length), SPROUT_OK);
  CHECK_BYTES(out, length, text);
  sprout_state_free(state);
}

static void the_canonical_golden_is_read_and_written_back_byte_for_byte(void) {
  size_t length;
  char *golden = test_golden("stored-canon.json", &length);
  while (length > 0 && golden[length - 1] == '\n') golden[--length] = '\0';
  round_trips(golden);
  free(golden);
}

static void every_stored_world_the_transcripts_produce_round_trips(void) {
  test_heap heap;
  sprout_host host = corpus_host(&heap);
  sprout_arena arena;
  size_t length, i, seen = 0;
  char *text = test_golden("stored-worlds.json", &length);
  sprout_json *root = NULL;
  sprout_json_error error;
  const sprout_json *initial, *played;
  sprout_arena_init(&arena, &host);
  CHECK_INT(sprout_json_read(&arena, text, length, &root, &error), SPROUT_OK);
  initial = corpus_get(root, "initial");
  played = corpus_get(root, "played");
  CHECK(initial != NULL && initial->count > 40);
  CHECK(played != NULL && played->count > 100);
  for (i = 0; i < initial->count; i++, seen++) {
    const char *canonical;
    size_t canonical_length;
    corpus_value_text(&arena, initial->items[i], &canonical, &canonical_length);
    round_trips(canonical);
  }
  for (i = 0; i < played->count; i++, seen++) {
    const char *canonical;
    size_t canonical_length;
    corpus_value_text(&arena, corpus_get(played->items[i], "stored"), &canonical, &canonical_length);
    round_trips(canonical);
  }
  CHECK(seen > 140);
  sprout_arena_reset(&arena);
  free(text);
}

static void strings_keep_their_escapes_and_their_bytes(void) {
  round_trips(WORLD_HEAD "\"instances\":[" SHOP_WORLD ",{\"id\":\"shop#1\",\"made\":{\"from\":\"visitor\"},"
              "\"container\":\"shop\",\"arrival\":1,\"properties\":{},\"links\":{},\"wakes\":[],\"memory\":{},"
              "\"lastTick\":null}],\"visitors\":[{\"visit\":\"v\\\"1\\\\\","
              "\"nickname\":\"Mar\\ta\\n\\u0001\\u001f \xc3\xa9 \xf0\x9f\x8c\xb1 \xe2\x80\xa8\","
              "\"instance\":\"shop#1\",\"lastPlace\":null,\"referents\":[],\"lastReading\":null}],"
              "\"tombstones\":[]}");
}

static void a_repeated_name_keeps_its_first_place_and_its_last_value(void) {
  sprout_state *state = NULL;
  sprout_refusal why;
  const char *out;
  size_t length;
  CHECK_INT(read_text(WORLD_HEAD "\"instances\":[{\"id\":\"shop\",\"made\":{\"from\":\"world\"},"
                      "\"container\":null,\"arrival\":null,\"properties\":{\"a\":{\"type\":\"integer\",\"value\":1},"
                      "\"b\":{\"type\":\"integer\",\"value\":2},\"a\":{\"type\":\"integer\",\"value\":3}},"
                      "\"links\":{},\"wakes\":[],\"memory\":{},\"lastTick\":null}]," NO_VISITORS,
                      &state, &why), SPROUT_OK);
  CHECK_INT(state->instances[0].property_count, 2);
  CHECK_INT(sprout_state_write(state, &out, &length), SPROUT_OK);
  CHECK(strstr(out, "\"properties\":{\"a\":{\"type\":\"integer\",\"value\":3},\"b\":{\"type\":\"integer\",\"value\":2}}") != NULL);
  sprout_state_free(state);
}

static void a_store_that_is_not_json_is_refused_in_words(void) {
  sprout_state *state = NULL;
  sprout_refusal why;
  CHECK_INT(read_text("{\"world\":", &state, &why), SPROUT_BAD_INPUT);
  CHECK(strncmp(why.text, "The stored state is not readable: the store is not JSON: ", 56) == 0);
}

static void a_store_of_the_wrong_shape_is_refused_where_it_goes_wrong(void) {
  refused("[]", "The stored state is not readable: the store should hold an object.");
  refused("{\"world\":\"Shop\",\"serial\":0}", "The stored state is not readable at world: it should be a name: lower case letters, digits and underscores.");
  refused("{\"world\":\"shop\",\"serial\":-1}", "The stored state is not readable at serial: it should be a whole number of at least 0.");
  refused("{\"world\":\"shop\",\"serial\":0,\"visitors\":[],\"tombstones\":[]}", "The stored state is not readable at instances: it should be a list.");
  refused(WORLD_HEAD "\"instances\":[]," "\"visitors\":[]}", "The stored state is not readable at tombstones: it should be a list of ids.");
  refused(WORLD_HEAD "\"instances\":[1]," NO_VISITORS, "The stored state is not readable at instances[0]: it should be an object.");
  refused(WORLD_HEAD "\"instances\":[{\"id\":\"shop\",\"made\":{\"from\":\"borrowed\"}}]," NO_VISITORS,
          "The stored state is not readable at instances[0].made: `from` is not one of world, declared, visitor, spawned or given: borrowed");
}

static void a_spawn_must_say_its_kind_and_a_time_must_be_whole_seconds(void) {
  refused(WORLD_HEAD "\"instances\":[{\"id\":\"shop#1\",\"made\":{\"from\":\"spawned\"}}]," NO_VISITORS,
          "The stored state is not readable at instances[0].made.kind: it should be a string.");
  refused(WORLD_HEAD "\"instances\":[{\"id\":\"shop\",\"made\":{\"from\":\"world\"},\"container\":null,"
          "\"arrival\":null,\"properties\":{},\"links\":{},\"wakes\":[],\"memory\":{},\"lastTick\":-5}]," NO_VISITORS,
          "The stored state is not readable at instances[0].lastTick: it should be a whole number of at least 0, or null.");
}

static void a_stored_value_is_a_boolean_a_number_a_string_or_a_list_of_them(void) {
  refused(WORLD_HEAD "\"instances\":[{\"id\":\"shop\",\"made\":{\"from\":\"world\"},\"container\":null,"
          "\"arrival\":null,\"properties\":{\"p\":{\"type\":\"x\",\"value\":null}},\"links\":{},\"wakes\":[],"
          "\"memory\":{},\"lastTick\":null}]," NO_VISITORS,
          "The stored state is not readable at instances[0].properties.p.value: a value is a boolean, a number, a string or a list of them.");
  refused(WORLD_HEAD "\"instances\":[{\"id\":\"shop\",\"made\":{\"from\":\"world\"},\"container\":null,"
          "\"arrival\":null,\"properties\":{\"p\":{\"type\":\"\",\"value\":1}},\"links\":{},\"wakes\":[],"
          "\"memory\":{},\"lastTick\":null}]," NO_VISITORS,
          "The stored state is not readable at instances[0].properties.p.type: it should not be empty.");
}

static void a_list_nested_past_sixty_four_deep_is_refused_not_overflowed(void) {
  char text[1024];
  size_t at = 0, i;
  const char *head = WORLD_HEAD "\"instances\":[{\"id\":\"shop\",\"made\":{\"from\":\"world\"},\"container\":null,"
                     "\"arrival\":null,\"properties\":{\"p\":{\"type\":\"x\",\"value\":";
  memcpy(text, head, strlen(head));
  at = strlen(head);
  for (i = 0; i < 70; i++) text[at++] = '[';
  for (i = 0; i < 70; i++) text[at++] = ']';
  text[at] = '\0';
  strcat(text, "}},\"links\":{},\"wakes\":[],\"memory\":{},\"lastTick\":null}]," NO_VISITORS);
  {
    sprout_state *state = NULL;
    sprout_refusal why;
    CHECK_INT(read_text(text, &state, &why), SPROUT_BAD_INPUT);
    CHECK(strstr(why.text, "a list is nested more deeply than a stored value can be.") != NULL);
  }
}

static void a_bound_role_is_a_thing_a_set_a_value_or_an_exit(void) {
  round_trips(WORLD_HEAD "\"instances\":[" SHOP_WORLD ",{\"id\":\"shop#1\",\"made\":{\"from\":\"visitor\"},"
              "\"container\":\"shop.hall\",\"arrival\":1,\"properties\":{},\"links\":{},\"wakes\":[],\"memory\":{},"
              "\"lastTick\":null}," SHOP_ROOM "],\"visitors\":[{\"visit\":\"v\",\"nickname\":\"M\","
              "\"instance\":\"shop#1\",\"lastPlace\":\"shop.hall\",\"referents\":[\"shop.hall\"],"
              "\"lastReading\":{\"verb\":{\"library\":\"sprout\",\"name\":\"take\"},\"bindings\":["
              "[\"target\",{\"object\":\"shop.hall\"}],[\"all\",{\"set\":[\"shop.hall\",\"shop\"]}],"
              "[\"n\",{\"value\":7}],[\"w\",{\"value\":\"oak\"}],"
              "[\"way\",{\"exit\":{\"direction\":\"north\",\"label\":\"door\",\"to\":\"shop.hall\"}}],"
              "[\"way2\",{\"exit\":{\"direction\":null,\"label\":\"hatch\",\"to\":\"shop.hall\"}}]]}}],"
              "\"tombstones\":[]}");
  refused(WORLD_HEAD "\"instances\":[],\"visitors\":[{\"visit\":\"v\",\"nickname\":\"M\",\"instance\":\"shop#1\","
          "\"lastPlace\":null,\"referents\":[],\"lastReading\":{\"verb\":{\"library\":\"sprout\",\"name\":\"go\"},"
          "\"bindings\":[[\"way\",{\"exit\":{\"direction\":\"sideways\",\"label\":\"\",\"to\":\"shop\"}}]]}}],"
          "\"tombstones\":[]}",
          "The stored state is not readable at visitors[0].lastReading.bindings[0].exit: `direction` is not a direction: sideways");
}

static void a_host_that_runs_out_of_memory_is_told_so_and_leaves_nothing_behind(void) {
  const char *text = WORLD_HEAD "\"instances\":[" SHOP_WORLD "," SHOP_ROOM "]," NO_VISITORS;
  long pages;
  for (pages = 0; pages < 12; pages++) {
    test_heap heap;
    sprout_host host = test_host(&heap);
    sprout_state *state = NULL;
    sprout_refusal why;
    sprout_status status;
    host.page_bytes = 256;
    heap.refuse_after = pages;
    status = sprout_state_read(&host, text, strlen(text), &state, &why);
    if (status == SPROUT_OK) {
      sprout_state_free(state);
    } else {
      CHECK_INT(status, SPROUT_NO_MEMORY);
      CHECK(state == NULL);
    }
    CHECK_INT(heap.pages, 0);
  }
}

int main(void) {
  RUN(the_canonical_golden_is_read_and_written_back_byte_for_byte);
  RUN(every_stored_world_the_transcripts_produce_round_trips);
  RUN(strings_keep_their_escapes_and_their_bytes);
  RUN(a_repeated_name_keeps_its_first_place_and_its_last_value);
  RUN(a_store_that_is_not_json_is_refused_in_words);
  RUN(a_store_of_the_wrong_shape_is_refused_where_it_goes_wrong);
  RUN(a_spawn_must_say_its_kind_and_a_time_must_be_whole_seconds);
  RUN(a_stored_value_is_a_boolean_a_number_a_string_or_a_list_of_them);
  RUN(a_list_nested_past_sixty_four_deep_is_refused_not_overflowed);
  RUN(a_bound_role_is_a_thing_a_set_a_value_or_an_exit);
  RUN(a_host_that_runs_out_of_memory_is_told_so_and_leaves_nothing_behind);
  return REPORT();
}
