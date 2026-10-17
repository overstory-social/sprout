/*
 * Tests for src/stored.c: the stored world is read as the stored form's
 * schema reads it and written back in the canonical form, byte for byte, for
 * the canonical golden and for every stored world the transcripts produce;
 * a store the schema refuses is refused in words that name where. The form
 * is the diff from a fresh load: a record is its id and the fields that
 * differ, a minted id says how it was made, and a value is bare.
 */
#include "corpus.h"
#include "state.h"

/* The stored world of a small shop, with room to mutate one piece. */
#define WORLD_HEAD "{\"world\":\"shop\",\"serial\":3,"
#define NO_VISITORS "\"visitors\":[],\"tombstones\":[]}"
#define SHOP_ROOM "{\"id\":\"shop.hall\",\"lastTick\":5}"
#define SHOP_WORLD "{\"id\":\"shop\",\"properties\":{\"season\":\"winter\"}}"

static sprout_str S(const char *text) {
  sprout_str s;
  s.bytes = text;
  s.length = strlen(text);
  return s;
}

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
  sprout_arena scratch;
  sprout_status status = read_text(text, &state, &why);
  CHECK_INT(status, SPROUT_OK);
  if (status != SPROUT_OK) {
    fprintf(stderr, "  refused: %s\n", why.text);
    return;
  }
  CHECK_INT(test_state_write(state, &scratch, &out, &length), SPROUT_OK);
  CHECK_BYTES(out, length, text);
  sprout_arena_reset(&scratch);
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

static void a_declared_object_that_says_nothing_of_its_container_is_where_it_was_declared(void) {
  sprout_state *state = NULL;
  sprout_refusal why;
  const sprout_stored_instance *cup;
  CHECK_INT(read_text(WORLD_HEAD "\"instances\":[{\"id\":\"shop.hall.cup\",\"properties\":{\"full\":true}}]," NO_VISITORS,
                      &state, &why), SPROUT_OK);
  cup = sprout_state_find(state, S("shop.hall.cup"));
  CHECK(cup != NULL && cup->made == SPROUT_MADE_DECLARED && cup->has_container);
  if (cup != NULL) CHECK_BYTES(cup->container.bytes, cup->container.length, "shop.hall");
  CHECK(sprout_state_find(state, S("shop.hall.cup"))->container.bytes[9] == '\0');
  CHECK(sprout_str_is(sprout_declared_container(S("shop.hall.cup")), "shop.hall"));
  CHECK(sprout_str_is(sprout_declared_container(S("shop.hall")), "shop"));
  sprout_state_free(state);
}

static void made_is_a_minted_ids_to_say_and_a_declared_ids_not(void) {
  refused(WORLD_HEAD "\"instances\":[{\"id\":\"shop#1\"}]," NO_VISITORS,
          "The stored state is not readable at instances[0].made: it should say how the instance was made: visitor, spawned or given.");
  refused(WORLD_HEAD "\"instances\":[{\"id\":\"shop.hall\",\"made\":{\"from\":\"visitor\"}}]," NO_VISITORS,
          "The stored state is not readable at instances[0].made: a declared id says how it was made; `made` is for a minted one.");
  refused(WORLD_HEAD "\"instances\":[{\"id\":\"shop\",\"made\":{\"from\":\"world\"}}]," NO_VISITORS,
          "The stored state is not readable at instances[0].made: a declared id says how it was made; `made` is for a minted one.");
  refused(WORLD_HEAD "\"instances\":[{\"id\":\"shop#1\",\"made\":{\"from\":\"declared\"}}]," NO_VISITORS,
          "The stored state is not readable at instances[0].made: `from` is not one of visitor, spawned or given: declared");
  refused(WORLD_HEAD "\"instances\":[{\"id\":\"shop#1\",\"made\":{\"from\":\"spawned\"}}]," NO_VISITORS,
          "The stored state is not readable at instances[0].made.kind: it should be a string.");
  refused(WORLD_HEAD "\"instances\":[{\"id\":\"shop#1\",\"made\":{\"from\":\"given\",\"kind\":\"shop.Lantern\",\"path\":[\"Wick\"]}}]," NO_VISITORS,
          "The stored state is not readable at instances[0].made.path[0]: it should be a name: lower case letters, digits and underscores.");
}

static void strings_keep_their_escapes_and_their_bytes(void) {
  round_trips(WORLD_HEAD "\"instances\":[" SHOP_WORLD ",{\"id\":\"shop#1\",\"made\":{\"from\":\"visitor\"},"
              "\"container\":\"shop\",\"arrival\":1}],\"visitors\":[{\"visit\":\"v\\\"1\\\\\","
              "\"nickname\":\"Mar\\ta\\n\\u0001\\u001f \xc3\xa9 \xf0\x9f\x8c\xb1 \xe2\x80\xa8\","
              "\"instance\":\"shop#1\",\"lastPlace\":null,\"referents\":[],\"lastReading\":null}],"
              "\"tombstones\":[]}");
}

static void a_repeated_name_keeps_its_first_place_and_its_last_value(void) {
  sprout_state *state = NULL;
  sprout_refusal why;
  const char *out;
  size_t length;
  sprout_arena scratch;
  CHECK_INT(read_text(WORLD_HEAD "\"instances\":[{\"id\":\"shop\",\"properties\":{\"a\":1,\"b\":2,\"a\":3}}]," NO_VISITORS,
                      &state, &why), SPROUT_OK);
  CHECK_INT(state->instances[0].property_count, 2);
  CHECK_INT(test_state_write(state, &scratch, &out, &length), SPROUT_OK);
  CHECK(strstr(out, "\"properties\":{\"a\":3,\"b\":2}") != NULL);
  sprout_arena_reset(&scratch);
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
  refused(WORLD_HEAD "\"instances\":[{\"id\":\"shop#1\",\"made\":{\"from\":\"borrowed\"}}]," NO_VISITORS,
          "The stored state is not readable at instances[0].made: `from` is not one of visitor, spawned or given: borrowed");
}

static void a_field_left_out_is_not_set_and_one_written_null_is_refused(void) {
  refused(WORLD_HEAD "\"instances\":[{\"id\":\"shop.hall\",\"container\":null}]," NO_VISITORS,
          "The stored state is not readable at instances[0].container: it should be an id.");
  refused(WORLD_HEAD "\"instances\":[{\"id\":\"shop.hall\",\"arrival\":null}]," NO_VISITORS,
          "The stored state is not readable at instances[0].arrival: it should be a whole number of at least 1.");
  refused(WORLD_HEAD "\"instances\":[{\"id\":\"shop.hall\",\"lastTick\":-5}]," NO_VISITORS,
          "The stored state is not readable at instances[0].lastTick: it should be a whole number of at least 0.");
  refused(WORLD_HEAD "\"instances\":[{\"id\":\"shop.hall\",\"links\":null}]," NO_VISITORS,
          "The stored state is not readable at instances[0].links: it should be an object of ids.");
  refused(WORLD_HEAD "\"instances\":[{\"id\":\"shop.hall\",\"wakes\":[{\"serial\":1,\"askedAt\":0}]}]," NO_VISITORS,
          "The stored state is not readable at instances[0].wakes[0].dueAt: it should be a whole number of at least 0.");
  refused(WORLD_HEAD "\"instances\":[{\"id\":\"shop.hall\",\"memory\":[]}]," NO_VISITORS,
          "The stored state is not readable at instances[0].memory: it should be an object of what each actor is remembered to have.");
}

static void a_stored_value_is_a_boolean_a_number_a_string_or_a_list_of_them(void) {
  refused(WORLD_HEAD "\"instances\":[{\"id\":\"shop\",\"properties\":{\"p\":null}}]," NO_VISITORS,
          "The stored state is not readable at instances[0].properties.p: a value is a boolean, a number, a string or a list of them.");
  refused(WORLD_HEAD "\"instances\":[{\"id\":\"shop\",\"memory\":{\"shop#1\":{\"p\":{}}}}]," NO_VISITORS,
          "The stored state is not readable at instances[0].memory.shop#1.p: a value is a boolean, a number, a string or a list of them.");
  round_trips(WORLD_HEAD "\"instances\":[{\"id\":\"shop\",\"properties\":{\"a\":[true,[1,\"x\"]],\"b\":-7}}]," NO_VISITORS);
}

static void a_list_nested_past_sixty_four_deep_is_refused_not_overflowed(void) {
  char text[1024];
  size_t at = 0, i;
  const char *head = WORLD_HEAD "\"instances\":[{\"id\":\"shop\",\"properties\":{\"p\":";
  memcpy(text, head, strlen(head));
  at = strlen(head);
  for (i = 0; i < 70; i++) text[at++] = '[';
  for (i = 0; i < 70; i++) text[at++] = ']';
  text[at] = '\0';
  strcat(text, "}}]," NO_VISITORS);
  {
    sprout_state *state = NULL;
    sprout_refusal why;
    CHECK_INT(read_text(text, &state, &why), SPROUT_BAD_INPUT);
    CHECK(strstr(why.text, "a list is nested more deeply than a stored value can be.") != NULL);
  }
}

static void a_bound_role_is_a_thing_a_set_a_value_or_an_exit(void) {
  round_trips(WORLD_HEAD "\"instances\":[" SHOP_WORLD ",{\"id\":\"shop#1\",\"made\":{\"from\":\"visitor\"},"
              "\"container\":\"shop.hall\",\"arrival\":1}," SHOP_ROOM "],\"visitors\":[{\"visit\":\"v\",\"nickname\":\"M\","
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
  RUN(a_declared_object_that_says_nothing_of_its_container_is_where_it_was_declared);
  RUN(made_is_a_minted_ids_to_say_and_a_declared_ids_not);
  RUN(strings_keep_their_escapes_and_their_bytes);
  RUN(a_repeated_name_keeps_its_first_place_and_its_last_value);
  RUN(a_store_that_is_not_json_is_refused_in_words);
  RUN(a_store_of_the_wrong_shape_is_refused_where_it_goes_wrong);
  RUN(a_field_left_out_is_not_set_and_one_written_null_is_refused);
  RUN(a_stored_value_is_a_boolean_a_number_a_string_or_a_list_of_them);
  RUN(a_list_nested_past_sixty_four_deep_is_refused_not_overflowed);
  RUN(a_bound_role_is_a_thing_a_set_a_value_or_an_exit);
  RUN(a_host_that_runs_out_of_memory_is_told_so_and_leaves_nothing_behind);
  return REPORT();
}
