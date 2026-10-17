/*
 * Tests for src/state.c: opening a stored world against the catalogue the way
 * load does. A new world's store opened is the initial state, which the diff
 * form writes as nothing; a saved world reopened is unchanged; a record a
 * declaration cannot explain, a property a kind does not declare and a
 * value not of its type are refused in a sentence naming the record; and
 * the stored worlds edited against their
 * world come out as the golden holds them, byte for byte, or are refused in
 * the words it holds.
 */
#include "corpus.h"
#include "state.h"

static sprout_str S(const char *text) {
  sprout_str s;
  s.bytes = text;
  s.length = strlen(text);
  return s;
}

static sprout_status read_in(const sprout_host *host, const char *text, size_t length,
                             sprout_state **state, sprout_refusal *why) {
  return sprout_state_read(host, text, length, state, why);
}

static void a_new_worlds_store_opened_is_the_initial_state_which_the_diff_form_writes_as_nothing(void) {
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
    sprout_refusal why;
    const char *want, *got;
    size_t want_length, got_length;
    CHECK_INT(sprout_state_empty(&host, world->header.name, &state), SPROUT_OK);
    CHECK_INT(sprout_state_open(state, world, &why), SPROUT_OK);
    /* Every declared object is made, at its declaration. */
    CHECK(state->instance_count >= world->declared_count);
    corpus_value_text(&arena, initial->items[i], &want, &want_length);
    CHECK_INT(sprout_state_write(state, &arena, &got, &got_length), SPROUT_OK);
    CHECK_BYTES(got, got_length, want);
    CHECK(strstr(got, "\"instances\":[]") != NULL);
    sprout_state_free(state);
    sprout_world_free(world);
  }
  sprout_arena_reset(&arena);
  free(text);
}

/* The form keys a declared object's container to its id: every corpus world declares each object where its path says. */
static void a_declared_objects_container_is_its_id_up_to_the_last_dot_in_every_corpus_world(void) {
  test_heap heap;
  sprout_host host = corpus_host(&heap);
  sprout_arena arena;
  size_t length, i, j, checked = 0;
  char *text = test_golden("stored-worlds.json", &length);
  sprout_json *root = NULL;
  sprout_json_error error;
  const sprout_json *initial;
  sprout_arena_init(&arena, &host);
  CHECK_INT(sprout_json_read(&arena, text, length, &root, &error), SPROUT_OK);
  initial = corpus_get(root, "initial");
  for (i = 0; i < initial->count; i++) {
    sprout_world *world = corpus_load(initial->items[i]->key, &host);
    for (j = 0; j < world->declared_count; j++, checked++)
      CHECK(sprout_str_is(sprout_declared_container(S(world->declared[j].id)), world->declared[j].container));
    sprout_world_free(world);
  }
  CHECK(checked > 100);
  sprout_arena_reset(&arena);
  free(text);
}

/* Whether a stored value is a scalar default, which the record would not keep; a list is not compared here. */
static bool at_scalar_default(const sprout_property *declared, const sprout_stored_value *value) {
  const sprout_literal *literal = &declared->default_value;
  if (literal->kind == SPROUT_LITERAL_BOOLEAN) return value->kind == SPROUT_BOOL && value->boolean == literal->boolean;
  if (literal->kind == SPROUT_LITERAL_NUMBER) return value->kind == SPROUT_NUMBER && value->number == literal->number;
  if (literal->kind == SPROUT_LITERAL_LIST) return false;
  return value->kind == SPROUT_STRING && sprout_str_is(value->string, literal->text);
}

static void an_opened_record_keeps_only_what_holds_other_than_its_default(void) {
  test_heap heap;
  sprout_host host = corpus_host(&heap);
  sprout_world *world = corpus_load("printers_shop", &host);
  sprout_state *state = NULL;
  sprout_refusal why;
  size_t i, j;
  const char *text =
      "{\"world\":\"printers_shop\",\"serial\":0,\"instances\":["
      "{\"id\":\"printers_shop\",\"properties\":{\"season\":\"autumn\"}},"
      "{\"id\":\"printers_shop.composing_room.cabinet\",\"properties\":{\"open\":true,\"capacity\":12,\"ward\":\"brass\"}},"
      "{\"id\":\"printers_shop.composing_room\",\"memory\":{\"printers_shop\":{\"visits\":0}}}],\"visitors\":[],\"tombstones\":[]}";
  CHECK_INT(read_in(&host, text, strlen(text), &state, &why), SPROUT_OK);
  CHECK_INT(sprout_state_open(state, world, &why), SPROUT_OK);
  for (i = 0; i < state->instance_count; i++) {
    const sprout_stored_instance *in = &state->instances[i];
    CHECK(in->kind != NULL);
    for (j = 0; j < in->property_count; j++) {
      char name[64];
      const sprout_property *one;
      snprintf(name, sizeof name, "%.*s", (int)in->properties[j].name.length, in->properties[j].name.bytes);
      one = sprout_kind_property(in->kind, name);
      CHECK(one != NULL && !one->remembered);
      if (one != NULL) CHECK(!at_scalar_default(one, &in->properties[j].value));
    }
  }
  CHECK_INT(sprout_state_find(state, S("printers_shop"))->property_count, 0);
  CHECK_INT(sprout_state_find(state, S("printers_shop.composing_room.cabinet"))->property_count, 1);
  CHECK_INT(sprout_state_find(state, S("printers_shop.composing_room"))->memory_count, 0);
  sprout_state_free(state);
  sprout_world_free(world);
}

static void a_saved_world_reopened_is_unchanged(void) {
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
    sprout_refusal why;
    const char *want, *got;
    size_t want_length, got_length;
    corpus_value_text(&arena, corpus_get(played->items[i], "stored"), &want, &want_length);
    CHECK_INT(read_in(&host, want, want_length, &state, &why), SPROUT_OK);
    CHECK_INT(sprout_state_open(state, world, &why), SPROUT_OK);
    CHECK_INT(sprout_state_write(state, &arena, &got, &got_length), SPROUT_OK);
    CHECK_BYTES(got, got_length, want);
    sprout_state_free(state);
    sprout_world_free(world);
  }
  sprout_arena_reset(&arena);
  free(text);
}

static void a_stored_world_edited_against_the_world_is_saved_or_refused_as_the_golden_holds(void) {
  test_heap heap;
  sprout_host host = corpus_host(&heap);
  sprout_arena arena;
  size_t length, i, refusals = 0;
  char *text = corpus_read(SPROUT_GOLDENS "/stored-reopened.json", &length);
  sprout_json *root = NULL;
  sprout_json_error error;
  sprout_arena_init(&arena, &host);
  CHECK_INT(sprout_json_read(&arena, text, length, &root, &error), SPROUT_OK);
  CHECK(root->count > 60);
  for (i = 0; i < root->count; i++) {
    const sprout_json *one = root->items[i];
    const sprout_json *saved = corpus_get(one, "saved"), *refused = corpus_get(one, "refused");
    sprout_world *world = corpus_load(corpus_get(one, "world")->bytes, &host);
    sprout_state *state = NULL;
    sprout_refusal why;
    sprout_status status;
    const char *input, *want, *got;
    size_t input_length, want_length, got_length;
    corpus_value_text(&arena, corpus_get(one, "input"), &input, &input_length);
    why.text[0] = '\0';
    status = read_in(&host, input, input_length, &state, &why);
    if (status == SPROUT_OK) status = sprout_state_open(state, world, &why);
    if (refused != NULL) {
      CHECK_INT(status, SPROUT_BAD_INPUT);
      CHECK_STR(why.text, refused->bytes);
      refusals++;
    } else {
      CHECK_INT(status, SPROUT_OK);
      if (status != SPROUT_OK) fprintf(stderr, "  %s, %s: %s\n", corpus_get(one, "world")->bytes, corpus_get(one, "edit")->bytes, why.text);
      corpus_value_text(&arena, saved, &want, &want_length);
      if (status == SPROUT_OK) {
        CHECK_INT(sprout_state_write(state, &arena, &got, &got_length), SPROUT_OK);
        CHECK_BYTES(got, got_length, want);
      }
    }
    if (state != NULL) sprout_state_free(state);
    sprout_world_free(world);
  }
  CHECK(refusals > 20);
  sprout_arena_reset(&arena);
  free(text);
}

static void the_store_of_another_world_is_refused_in_words(void) {
  test_heap heap;
  sprout_host host = corpus_host(&heap);
  sprout_world *world = corpus_load("printers_shop", &host);
  sprout_state *state = NULL;
  sprout_refusal why;
  CHECK_INT(sprout_state_empty(&host, "teashop", &state), SPROUT_OK);
  CHECK_INT(sprout_state_open(state, world, &why), SPROUT_BAD_INPUT);
  CHECK_STR(why.text, "The stored state is not readable: the store holds `teashop`, and this is `printers_shop`.");
  sprout_state_free(state);
  sprout_world_free(world);
}

static void a_destroyed_declared_object_is_never_made_again_nor_anything_inside_it(void) {
  test_heap heap;
  sprout_host host = corpus_host(&heap);
  sprout_world *world = corpus_load("printers_shop", &host);
  sprout_state *state = NULL;
  sprout_refusal why;
  size_t i;
  const char *text =
      "{\"world\":\"printers_shop\",\"serial\":0,\"instances\":[],\"visitors\":[],"
      "\"tombstones\":[\"printers_shop.composing_room\"]}";
  CHECK_INT(read_in(&host, text, strlen(text), &state, &why), SPROUT_OK);
  CHECK_INT(sprout_state_open(state, world, &why), SPROUT_OK);
  for (i = 0; i < state->instance_count; i++) CHECK(strstr(state->instances[i].id.bytes, "composing_room") == NULL);
  CHECK(state->instance_count > 0);
  CHECK(sprout_state_find(state, S("printers_shop.composing_room")) == NULL);
  CHECK(sprout_state_tombstoned(state, S("printers_shop.composing_room")));
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
      "{\"id\":\"shop.b\",\"lastTick\":1},"
      "{\"id\":\"shop\",\"lastTick\":2},"
      "{\"id\":\"shop#2\",\"made\":{\"from\":\"visitor\"},\"container\":\"shop\",\"arrival\":2}],"
      "\"visitors\":[{\"visit\":\"v\",\"nickname\":\"N\",\"instance\":\"shop#2\",\"lastPlace\":null,\"referents\":[],\"lastReading\":null}],"
      "\"tombstones\":[\"shop.z\",\"shop.a\"]}";
  CHECK_INT(read_in(&host, text, strlen(text), &state, &why), SPROUT_OK);
  CHECK(!state->instances_sorted);
  CHECK(sprout_state_find(state, (sprout_str){"shop.b", 6}) == &state->instances[0]);
  CHECK(sprout_state_find(state, (sprout_str){"shop.c", 6}) == NULL);
  CHECK_INT(sprout_state_sort(state, &state->arena), SPROUT_OK);
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

/* The edition counts every change to the records: a sort, an opening and a compaction each move it on. */
static void the_edition_moves_on_with_every_change_to_the_records(void) {
  test_heap heap;
  sprout_host host = corpus_host(&heap);
  sprout_world *world = corpus_load("printers_shop", &host);
  sprout_state *state = NULL;
  sprout_refusal why;
  uint64_t edition;
  const char *text = "{\"world\":\"printers_shop\",\"serial\":0,\"instances\":[],\"visitors\":[],\"tombstones\":[]}";
  CHECK_INT(sprout_state_read(&host, text, strlen(text), &state, &why), SPROUT_OK);
  if (state == NULL) exit(2);
  edition = state->edition;
  CHECK_INT(sprout_state_sort(state, &state->arena), SPROUT_OK);
  CHECK(state->edition > edition);
  edition = state->edition;
  CHECK_INT(sprout_state_open(state, world, &why), SPROUT_OK);
  CHECK(state->edition > edition);
  edition = state->edition;
  CHECK_INT(sprout_state_compact(state), SPROUT_OK);
  CHECK(state->edition > edition);
  sprout_state_free(state);
  sprout_world_free(world);
  CHECK_INT(heap.pages, 0);
}

/* ---- what a declaration cannot explain is refused, naming the record ---- */

/* Opens `text` against a corpus world; the state stays with the caller. */
static void open_store(const sprout_host *host, sprout_world *world, const char *text, sprout_state **state) {
  sprout_refusal why;
  CHECK_INT(sprout_state_read(host, text, strlen(text), state, &why), SPROUT_OK);
  if (*state == NULL) exit(2);
  CHECK_INT(sprout_state_open(*state, world, &why), SPROUT_OK);
}

/* Reads and opens `text` against a corpus world, expecting the refusal `words`. */
static void refused_against(const sprout_host *host, sprout_world *world, const char *text, const char *words) {
  sprout_refusal why;
  sprout_state *state = NULL;
  sprout_status status = sprout_state_read(host, text, strlen(text), &state, &why);
  if (status == SPROUT_OK) status = sprout_state_open(state, world, &why);
  CHECK_INT(status, SPROUT_BAD_INPUT);
  CHECK_STR(why.text, words);
  if (state != NULL) sprout_state_free(state);
}

#define SHOP_HEAD "{\"world\":\"printers_shop\",\"serial\":2,\"instances\":["
#define SHOP_TAIL "],\"visitors\":[],\"tombstones\":[]}"

static void a_record_no_declaration_explains_is_refused(void) {
  test_heap heap;
  sprout_host host = corpus_host(&heap);
  sprout_world *world = corpus_load("printers_shop", &host);
  char text[1024];
  refused_against(&host, world, SHOP_HEAD "{\"id\":\"printers_shop.attic\",\"lastTick\":1}" SHOP_TAIL,
                  "The stored state is not readable at instances[0].id: `printers_shop.attic` is not an object this world declares.");
  refused_against(&host, world,
                  SHOP_HEAD "{\"id\":\"printers_shop#1\",\"made\":{\"from\":\"spawned\",\"kind\":\"printers_shop.Nowhere\"},\"container\":\"printers_shop\",\"arrival\":1}" SHOP_TAIL,
                  "The stored state is not readable at instances[0].made: `printers_shop#1` is a spawn of `printers_shop.Nowhere`, which this world does not declare.");
  snprintf(text, sizeof text,
           SHOP_HEAD "{\"id\":\"printers_shop#1\",\"made\":{\"from\":\"spawned\",\"kind\":\"%s\"},\"container\":\"printers_shop\",\"arrival\":1}" SHOP_TAIL,
           world->visitor_kind->qualified);
  refused_against(&host, world, text,
                  "The stored state is not readable at instances[0].made: `printers_shop#1` is a spawn of `printers_shop.Visitor`, which cannot be spawned.");
  refused_against(&host, world,
                  SHOP_HEAD "{\"id\":\"printers_shop#1\",\"made\":{\"from\":\"given\",\"kind\":\"printers_shop.Sheet\",\"path\":[\"wick\"]},\"container\":\"printers_shop\",\"arrival\":1}" SHOP_TAIL,
                  "The stored state is not readable at instances[0].made: `printers_shop#1` is given by `printers_shop.Sheet`, whose body does not give it.");
  sprout_world_free(world);
  CHECK_INT(heap.pages, 0);
}

static void a_given_record_is_decoded_while_its_content_path_exists(void) {
  test_heap heap;
  sprout_host host = corpus_host(&heap);
  sprout_world *world = corpus_load("kind-contents", &host);
  sprout_state *state = NULL;
  const char *text =
      "{\"world\":\"kind_contents\",\"serial\":2,\"instances\":["
      "{\"id\":\"kind_contents#1\",\"made\":{\"from\":\"given\",\"kind\":\"kind_contents.Lantern\",\"path\":[\"wick\"]},\"container\":\"kind_contents\",\"arrival\":1}"
      "],\"visitors\":[],\"tombstones\":[]}";
  open_store(&host, world, text, &state);
  CHECK(sprout_state_find(state, S("kind_contents#1"))->kind != NULL);
  sprout_state_free(state);
  refused_against(&host, world,
                  "{\"world\":\"kind_contents\",\"serial\":2,\"instances\":["
                  "{\"id\":\"kind_contents#2\",\"made\":{\"from\":\"given\",\"kind\":\"kind_contents.Lantern\",\"path\":[\"wax\"]},\"container\":\"kind_contents\",\"arrival\":2}"
                  "],\"visitors\":[],\"tombstones\":[]}",
                  "The stored state is not readable at instances[0].made: `kind_contents#2` is given by `kind_contents.Lantern`, whose body does not give it.");
  sprout_world_free(world);
}

static void a_world_without_its_kind_makes_no_world_record_and_refuses_one_stored(void) {
  test_heap heap;
  sprout_host host = corpus_host(&heap);
  sprout_world *world = corpus_load("printers_shop", &host);
  sprout_state *state = NULL;
  sprout_refusal why;
  world->world_kind = NULL;
  CHECK_INT(sprout_state_empty(&host, "printers_shop", &state), SPROUT_OK);
  CHECK_INT(sprout_state_open(state, world, &why), SPROUT_OK);
  CHECK(sprout_state_find(state, S("printers_shop")) == NULL);
  CHECK(sprout_state_find(state, S("printers_shop.composing_room")) != NULL);
  sprout_state_free(state);
  refused_against(&host, world, "{\"world\":\"printers_shop\",\"serial\":0,\"instances\":[{\"id\":\"printers_shop\",\"lastTick\":1}],\"visitors\":[],\"tombstones\":[]}",
                  "The stored state is not readable at instances[0].id: `printers_shop` is the world, which has no kind in this world.");
  sprout_world_free(world);
}

static void a_property_the_kind_does_not_hold_or_remember_is_refused(void) {
  test_heap heap;
  sprout_host host = corpus_host(&heap);
  sprout_world *world = corpus_load("brief", &host);
  refused_against(&host, world,
                  "{\"world\":\"brief\",\"serial\":0,\"instances\":[{\"id\":\"brief.west_of_house\",\"properties\":{\"visits\":3}}],\"visitors\":[],\"tombstones\":[]}",
                  "The stored state is not readable at instances[0].properties: `brief.west_of_house` does not hold `:visits`.");
  refused_against(&host, world,
                  "{\"world\":\"brief\",\"serial\":0,\"instances\":[{\"id\":\"brief.west_of_house\",\"memory\":{\"brief\":{\"gone\":1}}}],\"visitors\":[],\"tombstones\":[]}",
                  "The stored state is not readable at instances[0].memory: `brief.west_of_house` does not remember `:gone`.");
  sprout_world_free(world);
}

static void a_value_not_of_its_type_is_refused_and_one_at_its_default_is_not_kept(void) {
  test_heap heap;
  sprout_host host = corpus_host(&heap);
  sprout_world *world = corpus_load("printers_shop", &host);
  sprout_state *state = NULL;
  const char *out;
  size_t out_length;
  sprout_arena scratch;
  refused_against(&host, world, SHOP_HEAD "{\"id\":\"printers_shop\",\"properties\":{\"season\":\"monsoon\"}}" SHOP_TAIL,
                  "The stored state is not readable at instances[0].properties: `:season` of `printers_shop` is not a value of its type, `printers_shop.Season`.");
  refused_against(&host, world, SHOP_HEAD "{\"id\":\"printers_shop.press_yard.press\",\"properties\":{\"inked\":1}}" SHOP_TAIL,
                  "The stored state is not readable at instances[0].properties: `:inked` of `printers_shop.press_yard.press` is not a value of its type, `boolean`.");
  refused_against(&host, world, SHOP_HEAD "{\"id\":\"printers_shop.composing_room.cabinet.shop_key\",\"properties\":{\"wear\":100}}" SHOP_TAIL,
                  "The stored state is not readable at instances[0].properties: `:wear` of `printers_shop.composing_room.cabinet.shop_key` is not a value of its type, `integer`.");
  refused_against(&host, world, SHOP_HEAD "{\"id\":\"printers_shop.composing_room.cabinet.shop_key\",\"properties\":{\"opens\":[\"iron\",\"iron\"]}}" SHOP_TAIL,
                  "The stored state is not readable at instances[0].properties: `:opens` of `printers_shop.composing_room.cabinet.shop_key` is not a value of its type, `[printers_shop.Ward]`.");
  refused_against(&host, world, SHOP_HEAD "{\"id\":\"printers_shop.composing_room\",\"memory\":{\"printers_shop\":{\"visits\":\"many\"}}}" SHOP_TAIL,
                  "The stored state is not readable at instances[0].memory: `:visits` of `printers_shop.composing_room` is not a value of its type, `integer`.");
  /* A value at its default, and a remembered one too, is read as the fresh load would have it: not kept, not written. */
  open_store(&host, world,
             SHOP_HEAD "{\"id\":\"printers_shop.composing_room.cabinet.shop_key\",\"properties\":{\"opens\":[\"brass\",\"iron\"],\"wear\":0}},"
             "{\"id\":\"printers_shop.composing_room\",\"memory\":{\"printers_shop\":{\"visits\":0}}}" SHOP_TAIL,
             &state);
  CHECK_INT(sprout_state_find(state, S("printers_shop.composing_room.cabinet.shop_key"))->property_count, 0);
  CHECK_INT(sprout_state_find(state, S("printers_shop.composing_room"))->memory_count, 0);
  CHECK_INT(test_state_write(state, &scratch, &out, &out_length), SPROUT_OK);
  CHECK_BYTES(out, out_length, "{\"world\":\"printers_shop\",\"serial\":2,\"instances\":[],\"visitors\":[],\"tombstones\":[]}");
  sprout_arena_reset(&scratch);
  sprout_state_free(state);
  sprout_world_free(world);
}

static void a_reading_of_a_verb_the_world_does_not_declare_is_let_go(void) {
  test_heap heap;
  sprout_host host = corpus_host(&heap);
  sprout_world *world = corpus_load("printers_shop", &host);
  sprout_state *state = NULL;
  open_store(&host, world,
             "{\"world\":\"printers_shop\",\"serial\":2,\"instances\":["
             "{\"id\":\"printers_shop#1\",\"made\":{\"from\":\"visitor\"},\"container\":\"printers_shop.composing_room\",\"arrival\":2}],"
             "\"visitors\":[{\"visit\":\"v\",\"nickname\":\"Marta\",\"instance\":\"printers_shop#1\",\"lastPlace\":null,\"referents\":[],"
             "\"lastReading\":{\"verb\":{\"library\":\"printers_shop\",\"name\":\"frobnicate\"},\"bindings\":[]}}],"
             "\"tombstones\":[]}",
             &state);
  CHECK(!state->visitors[0].has_reading);
  sprout_state_free(state);
  sprout_world_free(world);
}

static void a_destroyed_container_takes_every_declared_child_with_it_by_exact_id_set(void) {
  test_heap heap;
  sprout_host host = corpus_host(&heap);
  sprout_world *world = corpus_load("tree", &host);
  sprout_state *state = NULL;
  const char *text =
      "{\"world\":\"tree\",\"serial\":0,\"instances\":[],\"visitors\":[],\"tombstones\":[\"tree.shop_floor\"]}";
  size_t i, expected = 0, under = 0;
  open_store(&host, world, text, &state);
  for (i = 0; i < world->declared_count; i++) {
    const char *id = world->declared[i].id;
    bool inside = strcmp(id, "tree.shop_floor") == 0 || strncmp(id, "tree.shop_floor.", 16) == 0;
    if (inside) {
      under++;
      CHECK(sprout_state_find(state, S(id)) == NULL);
    } else if (world->declared[i].kind != NULL) {
      expected++;
      CHECK(sprout_state_find(state, S(id)) != NULL);
    }
  }
  CHECK(under >= 5);
  /* The world itself is made too; nothing else is. */
  CHECK_INT(state->instance_count, expected + 1);
  sprout_state_free(state);
  sprout_world_free(world);
}

static void a_declared_object_moved_out_before_its_container_was_destroyed_is_where_stored_and_holds_its_own(void) {
  test_heap heap;
  sprout_host host = corpus_host(&heap);
  sprout_world *world = corpus_load("moved-out-of-destroyed", &host);
  sprout_state *state = NULL;
  const sprout_stored_instance *boat, *label;
  /* The store a turn wrote: the boat moved to the dock, the pile and the pump in it destroyed, the label never written. */
  const char *text =
      "{\"world\":\"moved_out_of_destroyed\",\"serial\":1,\"instances\":["
      "{\"id\":\"moved_out_of_destroyed.dock.pile.boat\",\"container\":\"moved_out_of_destroyed.dock\",\"arrival\":1}],\"visitors\":[],"
      "\"tombstones\":[\"moved_out_of_destroyed.dock.pile\",\"moved_out_of_destroyed.dock.pile.pump\"]}";
  open_store(&host, world, text, &state);
  boat = sprout_state_find(state, S("moved_out_of_destroyed.dock.pile.boat"));
  label = sprout_state_find(state, S("moved_out_of_destroyed.dock.pile.boat.label"));
  CHECK(boat != NULL);
  if (boat != NULL) CHECK(sprout_str_is(boat->container, "moved_out_of_destroyed.dock"));
  CHECK(label != NULL);
  if (label != NULL) CHECK(sprout_str_is(label->container, "moved_out_of_destroyed.dock.pile.boat"));
  CHECK(sprout_state_find(state, S("moved_out_of_destroyed.dock.pile")) == NULL);
  CHECK(sprout_state_find(state, S("moved_out_of_destroyed.dock.pile.pump")) == NULL);
  sprout_state_free(state);
  sprout_world_free(world);
}

int main(void) {
  RUN(a_new_worlds_store_opened_is_the_initial_state_which_the_diff_form_writes_as_nothing);
  RUN(a_declared_objects_container_is_its_id_up_to_the_last_dot_in_every_corpus_world);
  RUN(an_opened_record_keeps_only_what_holds_other_than_its_default);
  RUN(a_saved_world_reopened_is_unchanged);
  RUN(a_stored_world_edited_against_the_world_is_saved_or_refused_as_the_golden_holds);
  RUN(the_store_of_another_world_is_refused_in_words);
  RUN(a_destroyed_declared_object_is_never_made_again_nor_anything_inside_it);
  RUN(lookups_bisect_once_sorted_and_scan_before);
  RUN(the_edition_moves_on_with_every_change_to_the_records);
  RUN(a_record_no_declaration_explains_is_refused);
  RUN(a_given_record_is_decoded_while_its_content_path_exists);
  RUN(a_world_without_its_kind_makes_no_world_record_and_refuses_one_stored);
  RUN(a_property_the_kind_does_not_hold_or_remember_is_refused);
  RUN(a_value_not_of_its_type_is_refused_and_one_at_its_default_is_not_kept);
  RUN(a_reading_of_a_verb_the_world_does_not_declare_is_let_go);
  RUN(a_destroyed_container_takes_every_declared_child_with_it_by_exact_id_set);
  RUN(a_declared_object_moved_out_before_its_container_was_destroyed_is_where_stored_and_holds_its_own);
  return REPORT();
}
