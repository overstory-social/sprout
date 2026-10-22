/*
 * Tests for src/catalogue.c: every corpus world's cartridge loads, and its
 * header, declared tree, caps, extensions and word set are what the
 * language's cartridge reader dumps for it; lookups find what the tree holds.
 */
#include "corpus.h"
#include "load.h"

static void check_text_or_null(const char *actual, const sprout_json *expected) {
  if (expected->kind == SPROUT_JSON_NULL) CHECK(actual == NULL);
  else {
    CHECK(actual != NULL);
    if (actual != NULL) CHECK_BYTES(actual, strlen(actual), expected->bytes);
  }
}

static void every_corpus_cartridge_loads_with_the_header_and_tree_the_dump_holds(void) {
  test_heap heap;
  sprout_host host = corpus_host(&heap);
  sprout_arena arena;
  const sprout_json *dump;
  size_t w, i;
  sprout_arena_init(&arena, &host);
  dump = corpus_dump(&arena);
  CHECK(dump->count > 40);
  for (w = 0; w < dump->count; w++) {
    const sprout_json *entry = dump->items[w];
    const sprout_json *declared = corpus_get(entry, "declared");
    long held = heap.pages;
    sprout_world *world = corpus_load(entry->key, &host);
    CHECK_INT(world->format, SPROUT_CARTRIDGE_FORMAT);
    CHECK_INT(world->level, corpus_get(entry, "level")->number);
    CHECK_STR(world->header.name, corpus_get(entry, "world")->bytes);
    check_text_or_null(world->header.title, corpus_get(entry, "title"));
    check_text_or_null(world->arrival, corpus_get(entry, "arrival"));
    CHECK_INT(world->declared_count, declared->count);
    for (i = 0; i < world->declared_count && i < declared->count; i++) {
      const sprout_json *row = declared->items[i];
      CHECK_STR(world->declared[i].id, row->items[0]->bytes);
      CHECK_STR(world->declared[i].container, row->items[1]->bytes);
      if (row->items[2]->kind == SPROUT_JSON_NULL) CHECK(world->declared[i].kind == NULL);
      else if (world->declared[i].kind != NULL)
        CHECK_STR(world->declared[i].kind->qualified, row->items[2]->bytes);
      else
        CHECK(false);
      CHECK_INT(world->declared[i].rank, row->items[3]->number);
      CHECK_INT(world->declared[i].rank, i);
    }
    sprout_world_free(world);
    CHECK_INT(heap.pages, held); /* a world gives back every page it took */
  }
  sprout_arena_reset(&arena);
  CHECK_INT(heap.pages, 0);
}

static void the_words_the_world_and_the_visitor_are_made_of_match_the_dump(void) {
  test_heap heap;
  sprout_host host = corpus_host(&heap);
  sprout_arena arena;
  const sprout_json *dump;
  size_t w, i;
  sprout_arena_init(&arena, &host);
  dump = corpus_dump(&arena);
  for (w = 0; w < dump->count; w++) {
    const sprout_json *entry = dump->items[w];
    const sprout_json *words = corpus_get(entry, "words");
    sprout_world *world = corpus_load(entry->key, &host);
    check_text_or_null(world->world_kind == NULL ? NULL : world->world_kind->qualified,
                       corpus_get(entry, "worldKind"));
    check_text_or_null(world->visitor_kind == NULL ? NULL : world->visitor_kind->qualified,
                       corpus_get(entry, "visitorKind"));
    CHECK_INT(world->word_count, words->count);
    for (i = 0; i < world->word_count && i < words->count; i++)
      CHECK_STR(world->words[i], words->items[i]->bytes);
    sprout_world_free(world);
  }
  sprout_arena_reset(&arena);
}

static void expect_cap(const sprout_json *caps, const char *name, double value, bool set) {
  const sprout_json *field = corpus_get(caps, name);
  CHECK(field != NULL);
  if (field == NULL) return;
  if (field->kind == SPROUT_JSON_NULL) CHECK(!set);
  else {
    CHECK(set);
    CHECK(field->number == value);
  }
}

static void the_caps_a_cartridge_records_are_read_and_the_optional_ones_stay_unset(void) {
  test_heap heap;
  sprout_host host = corpus_host(&heap);
  sprout_arena arena;
  const sprout_json *dump;
  size_t w;
  sprout_arena_init(&arena, &host);
  dump = corpus_dump(&arena);
  for (w = 0; w < dump->count; w++) {
    const sprout_json *entry = dump->items[w];
    const sprout_json *caps = corpus_get(entry, "caps");
    sprout_world *world = corpus_load(entry->key, &host);
    const sprout_caps *c = &world->caps;
    expect_cap(caps, "optionsPerEnum", c->options_per_enum, true);
    expect_cap(caps, "rolesPerVerb", c->roles_per_verb, true);
    expect_cap(caps, "phrasesPerVerb", c->phrases_per_verb, true);
    expect_cap(caps, "stepsPerIntent", c->steps_per_intent, true);
    expect_cap(caps, "phraseCharacters", c->phrase_characters, true);
    expect_cap(caps, "nounsPerObject", c->nouns_per_object, true);
    expect_cap(caps, "nounCharacters", c->noun_characters, true);
    expect_cap(caps, "exitsPerPlace", c->exits_per_place, true);
    expect_cap(caps, "listElements", c->list_elements, true);
    expect_cap(caps, "literalCharacters", c->literal_characters, true);
    expect_cap(caps, "places", c->places, c->places_set);
    expect_cap(caps, "objects", c->objects, c->objects_set);
    expect_cap(caps, "kinds", c->kinds, c->kinds_set);
    expect_cap(caps, "files", c->files, c->files_set);
    expect_cap(caps, "sourceBytes", c->source_bytes, c->source_bytes_set);
    sprout_world_free(world);
  }
  sprout_arena_reset(&arena);
}

static void the_extensions_a_cartridge_pins_are_recorded(void) {
  test_heap heap;
  sprout_host host = corpus_host(&heap);
  sprout_arena arena;
  const sprout_json *dump;
  size_t w, i;
  sprout_arena_init(&arena, &host);
  dump = corpus_dump(&arena);
  for (w = 0; w < dump->count; w++) {
    const sprout_json *pins = corpus_get(dump->items[w], "extensions");
    sprout_world *world = corpus_load(dump->items[w]->key, &host);
    CHECK_INT(world->extension_count, pins->count);
    for (i = 0; i < world->extension_count && i < pins->count; i++) {
      CHECK_STR(world->extensions[i].name, pins->items[i]->items[0]->bytes);
      CHECK_INT(world->extensions[i].major, pins->items[i]->items[1]->number);
    }
    sprout_world_free(world);
  }
  sprout_arena_reset(&arena);
}

static void lookups_find_what_the_tree_and_the_kinds_hold(void) {
  test_heap heap;
  sprout_host host = corpus_host(&heap);
  sprout_world *world = corpus_load("printers_shop", &host);
  const sprout_declared *cabinet = sprout_world_declared(world, "printers_shop.composing_room.cabinet");
  const sprout_kind_def *person;
  CHECK(cabinet != NULL);
  if (cabinet != NULL) {
    CHECK_STR(cabinet->container, "printers_shop.composing_room");
    /* A container's id is the holder's own, not a copy. */
    CHECK(cabinet->container == sprout_world_declared(world, "printers_shop.composing_room")->id);
    CHECK_INT(cabinet->path_count, 2);
    CHECK_STR(cabinet->path[1], "cabinet");
  }
  CHECK(sprout_world_declared(world, "printers_shop.nowhere") == NULL);
  person = sprout_world_kind(world, world->visitor_kind->qualified);
  CHECK(person == world->visitor_kind);
  CHECK(sprout_world_kind(world, "sprout.Place") != NULL);
  CHECK(sprout_world_kind(world, "sprout.Nothing") == NULL);
  CHECK(sprout_kind_property(world->world_kind, "no_such_property") == NULL);
  CHECK(sprout_world_bound(world, NULL) == NULL);
  sprout_world_free(world);
  CHECK_INT(heap.pages, 0);
}

/* Every declared object, kind and property is found by its name, and nothing is found by a near miss. */
static void every_name_in_the_catalogue_is_found_and_a_near_miss_is_not(void) {
  test_heap heap;
  sprout_host host = corpus_host(&heap);
  sprout_world *world = corpus_load("printers_shop", &host);
  size_t i, j;
  char near[256];
  CHECK(world->declared_count > 3 && world->kind_count > 3);
  for (i = 0; i < world->declared_count; i++) {
    const sprout_declared *one = &world->declared[i];
    CHECK(sprout_world_declared(world, one->id) == one);
    snprintf(near, sizeof near, "%sx", one->id);
    CHECK(sprout_world_declared(world, near) == NULL);
  }
  for (i = 0; i < world->kind_count; i++) {
    const sprout_kind_def *kind = world->kinds[i];
    CHECK(sprout_world_kind(world, kind->qualified) == kind);
    CHECK(sprout_world_kind_named(world, kind->library, strlen(kind->library), kind->name) == kind);
    /* A library name read up to its length: the bytes past it are not looked at. */
    snprintf(near, sizeof near, "%s/own", kind->library);
    CHECK(sprout_world_kind_named(world, near, strlen(kind->library), kind->name) == kind);
    CHECK(sprout_world_kind_named(world, kind->library, strlen(kind->library) - 1, kind->name) == NULL);
    snprintf(near, sizeof near, "%sx", kind->name);
    CHECK(sprout_world_kind_named(world, kind->library, strlen(kind->library), near) == NULL);
    for (j = 0; j < kind->property_count; j++) CHECK(sprout_kind_property(kind, kind->properties[j]->name) == kind->properties[j]);
  }
  CHECK(sprout_world_kind_named(world, "sprout", 6, "Nothing") == NULL);
  sprout_world_free(world);
  CHECK_INT(heap.pages, 0);
}

/* The verbs offered are each verb with a typed phrase, once, in the order of their first phrase, whose runs partition the phrases. */
static void the_offered_verbs_are_those_with_a_typed_phrase_once_in_the_parsers_order(void) {
  test_heap heap;
  sprout_host host = corpus_host(&heap);
  sprout_world *world = corpus_load("printers_shop", &host);
  size_t i, j, at = 0;
  CHECK(world->offered_count > 3);
  for (i = 0; i < world->offered_count; i++) {
    const sprout_verb *verb = world->offered[i];
    CHECK(verb->typed_count > 0);
    CHECK_INT(verb->typed_at, at);
    for (j = 0; j < verb->typed_count; j++) CHECK(world->phrases[at + j].verb == verb);
    at += verb->typed_count;
    for (j = 0; j < i; j++) CHECK(world->offered[j] != verb);
  }
  CHECK_INT(at, world->phrase_count);
  for (i = 0; i < world->verb_count; i++) {
    bool listed = false;
    for (j = 0; j < world->offered_count; j++) listed = listed || world->offered[j] == world->verbs[i];
    CHECK(listed == (world->verbs[i]->typed_count > 0));
  }
  sprout_world_free(world);
  CHECK_INT(heap.pages, 0);
}

/* The name table and the option slots have room for what they hold (half as much would not do), not for every entry. */
static void the_name_table_and_the_option_slots_are_sized_to_what_they_hold(void) {
  test_heap heap;
  sprout_host host = corpus_host(&heap);
  sprout_arena arena;
  const sprout_json *dump;
  size_t w, i;
  sprout_arena_init(&arena, &host);
  dump = corpus_dump(&arena);
  for (w = 0; w < dump->count; w++) {
    sprout_world *world = corpus_load(dump->items[w]->key, &host);
    size_t named = 0, slots = 0;
    for (i = 0; i < world->graph.count; i++) {
      const sprout_node *entry = &world->graph.table.nodes[i];
      if (sprout_world_bound(world, entry) != NULL) named++;
      if (sprout_world_option_slot(world, entry)) slots++;
    }
    CHECK_INT(named, world->bound.count);
    CHECK_INT(slots, world->option_slots.count);
    CHECK(world->bound.capacity == 8 || world->bound.capacity / 2 / 4 * 3 < world->bound.count);
    CHECK(world->option_slots.capacity == 8 || world->option_slots.capacity / 2 / 4 * 3 < world->option_slots.count);
    sprout_world_free(world);
  }
  sprout_arena_reset(&arena);
}

static void a_thing_in_several_places_is_declared_once_and_stands_in_each(void) {
  test_heap heap;
  sprout_host host = corpus_host(&heap);
  sprout_world *world = corpus_load("several-places", &host);
  const sprout_declared *door = sprout_world_declared(world, "several_places.tiny_room.pdoor");
  const sprout_declared *dreary = sprout_world_declared(world, "several_places.dreary_room");
  const sprout_declared *chairman = sprout_world_declared(world, "several_places.chairman");
  const char *const *places;
  sprout_str door_id = {"several_places.tiny_room.pdoor", 30};
  CHECK(world->shares);
  CHECK(sprout_world_declared(world, "several_places.dreary_room.pdoor") == NULL);
  CHECK_STR(door->container, "several_places.tiny_room");
  CHECK_INT(door->also_count, 1);
  CHECK_STR(door->also_in[0], "several_places.dreary_room");
  CHECK_INT(dreary->lobe_count, 1);
  CHECK_STR(dreary->lobes[0], "several_places.tiny_room.pdoor");
  /* Each of the four walls stands in the chairman's office, in the order declared. */
  CHECK_INT(chairman->lobe_count, 4);
  CHECK_STR(chairman->lobes[0], "several_places.west_teller.north_wall");
  CHECK_STR(chairman->lobes[3], "several_places.west_teller.west_wall");
  CHECK_INT(sprout_world_also_in(world, door_id, &places), 1);
  CHECK(sprout_world_also_stands_in(world, door_id, (sprout_str){"several_places.dreary_room", 26}));
  CHECK(!sprout_world_also_stands_in(world, door_id, (sprout_str){"several_places.tiny_room", 24}));
  CHECK_INT(sprout_world_also_in(world, (sprout_str){"several_places.tiny_room", 24}, &places), 0);
  sprout_world_free(world);
  CHECK_INT(heap.pages, 0);
}

int main(void) {
  RUN(a_thing_in_several_places_is_declared_once_and_stands_in_each);
  RUN(every_corpus_cartridge_loads_with_the_header_and_tree_the_dump_holds);
  RUN(the_words_the_world_and_the_visitor_are_made_of_match_the_dump);
  RUN(the_caps_a_cartridge_records_are_read_and_the_optional_ones_stay_unset);
  RUN(the_extensions_a_cartridge_pins_are_recorded);
  RUN(lookups_find_what_the_tree_and_the_kinds_hold);
  RUN(every_name_in_the_catalogue_is_found_and_a_near_miss_is_not);
  RUN(the_offered_verbs_are_those_with_a_typed_phrase_once_in_the_parsers_order);
  RUN(the_name_table_and_the_option_slots_are_sized_to_what_they_hold);
  return REPORT();
}
