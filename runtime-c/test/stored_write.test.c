/*
 * Tests for src/stored_write.c: the canonical form of a stored world is the
 * diff from the world a fresh load makes: an instance written only where it
 * differs from its declaration (a minted one always), a written record
 * holding only the fields that differ, keys in the stored schema's order, no
 * white space, whole numbers as digits, and the escapes JSON.stringify makes;
 * the text is taken once, at its size, from the caller's scratch. A turn's
 * changes are written the same way, each record read from the state.
 */
#include "corpus.h"
#include "state.h"

static sprout_str S(const char *text) {
  sprout_str s;
  s.bytes = text;
  s.length = strlen(text);
  return s;
}

static void an_empty_world_is_written_with_every_key_in_order(void) {
  test_heap heap;
  sprout_host host = test_host(&heap);
  sprout_state *state = NULL;
  const char *out;
  size_t length;
  sprout_arena scratch;
  CHECK_INT(sprout_state_empty(&host, "shop", &state), SPROUT_OK);
  CHECK_INT(test_state_write(state, &scratch, &out, &length), SPROUT_OK);
  CHECK_BYTES(out, length, "{\"world\":\"shop\",\"serial\":0,\"instances\":[],\"visitors\":[],\"tombstones\":[]}");
  sprout_arena_reset(&scratch);
  sprout_state_free(state);
  CHECK_INT(heap.pages, 0);
}

static void a_record_built_by_hand_is_written_as_the_schema_orders_it(void) {
  test_heap heap;
  sprout_host host = test_host(&heap);
  sprout_state *state = NULL;
  const char *out;
  size_t length;
  sprout_arena scratch;
  sprout_stored_instance *in;
  host.page_bytes = 4096;
  CHECK_INT(sprout_state_empty(&host, "shop", &state), SPROUT_OK);
  state->serial = 12;
  state->instances = (sprout_stored_instance *)sprout_arena_take(&state->arena, sizeof *in);
  state->instance_count = 1;
  in = &state->instances[0];
  in->id = S("shop#12");
  in->made = SPROUT_MADE_GIVEN;
  in->made_kind = S("shop.Lantern");
  in->path = (sprout_str *)sprout_arena_take(&state->arena, 2 * sizeof(sprout_str));
  in->path_count = 2;
  in->path[0] = S("wick");
  in->path[1] = S("flame");
  in->has_arrival = true;
  in->arrival = 12;
  in->has_last_tick = true;
  in->last_tick = 1790000000;
  CHECK_INT(test_state_write(state, &scratch, &out, &length), SPROUT_OK);
  CHECK_BYTES(out, length,
              "{\"world\":\"shop\",\"serial\":12,\"instances\":[{\"id\":\"shop#12\",\"made\":{\"from\":\"given\","
              "\"kind\":\"shop.Lantern\",\"path\":[\"wick\",\"flame\"]},\"arrival\":12,\"lastTick\":1790000000}],"
              "\"visitors\":[],\"tombstones\":[]}");
  sprout_arena_reset(&scratch);
  sprout_state_free(state);
}

/* The printers' shop opened on nothing stored: every instance at its declaration. */
static sprout_state *fresh_shop(const sprout_host *host, sprout_world *world) {
  sprout_state *state = NULL;
  sprout_refusal why;
  CHECK_INT(sprout_state_empty(host, "printers_shop", &state), SPROUT_OK);
  if (state == NULL) exit(2);
  CHECK_INT(sprout_state_open(state, world, &why), SPROUT_OK);
  return state;
}

static sprout_stored_instance *record(sprout_state *state, const char *id) {
  sprout_stored_instance *in = sprout_state_find(state, S(id));
  if (in == NULL) {
    fprintf(stderr, "no record for %s\n", id);
    exit(2);
  }
  return in;
}

/* Sets one property on a record by hand, as a turn's write would leave it. */
static void hold(sprout_state *state, sprout_stored_instance *in, const char *name, sprout_stored_value value) {
  sprout_stored_property *list = (sprout_stored_property *)sprout_arena_take(&state->arena, (in->property_count + 1) * sizeof *list);
  if (list == NULL) exit(2);
  if (in->property_count > 0) memcpy(list, in->properties, in->property_count * sizeof *list);
  memset(&list[in->property_count], 0, sizeof *list);
  list[in->property_count].name = S(name);
  list[in->property_count].value = value;
  in->properties = list;
  in->property_count++;
  CHECK_INT(sprout_stored_instance_order(&state->arena, in), SPROUT_OK);
}

static sprout_stored_value boolean(bool b) {
  sprout_stored_value v;
  memset(&v, 0, sizeof v);
  v.kind = SPROUT_BOOL;
  v.boolean = b;
  return v;
}

static sprout_stored_value number(double n) {
  sprout_stored_value v;
  memset(&v, 0, sizeof v);
  v.kind = SPROUT_NUMBER;
  v.number = n;
  return v;
}

/* The record's held property by name; the test stops where there is none. */
static sprout_stored_property *held(sprout_stored_instance *in, const char *name) {
  size_t i;
  for (i = 0; i < in->property_count; i++)
    if (sprout_str_is(in->properties[i].name, name)) return &in->properties[i];
  fprintf(stderr, "no property %s held\n", name);
  exit(2);
}

static sprout_stored_value string(const char *s) {
  sprout_stored_value v;
  memset(&v, 0, sizeof v);
  v.kind = SPROUT_STRING;
  v.string = S(s);
  return v;
}

static void a_fresh_world_is_written_as_nothing_and_a_changed_instance_as_only_what_changed(void) {
  test_heap heap;
  sprout_host host = corpus_host(&heap);
  sprout_world *world = corpus_load("printers_shop", &host);
  sprout_state *state = fresh_shop(&host, world);
  sprout_stored_instance *cabinet, *shop;
  const char *out;
  size_t length;
  sprout_arena scratch;
  CHECK(state->instance_count > 10);
  CHECK_INT(test_state_write(state, &scratch, &out, &length), SPROUT_OK);
  CHECK_BYTES(out, length, "{\"world\":\"printers_shop\",\"serial\":0,\"instances\":[],\"visitors\":[],\"tombstones\":[]}");
  sprout_arena_reset(&scratch);
  /* A property at its default is not written, whether the record kept it or not; one changed is, bare. */
  cabinet = record(state, "printers_shop.composing_room.cabinet");
  hold(state, cabinet, "open", boolean(false));
  hold(state, cabinet, "capacity", number(12));
  shop = record(state, "printers_shop");
  hold(state, shop, "season", string("autumn"));
  CHECK_INT(test_state_write(state, &scratch, &out, &length), SPROUT_OK);
  CHECK_BYTES(out, length, "{\"world\":\"printers_shop\",\"serial\":0,\"instances\":[],\"visitors\":[],\"tombstones\":[]}");
  sprout_arena_reset(&scratch);
  held(cabinet, "open")->value = boolean(true);
  hold(state, cabinet, "ward", string("iron"));
  held(shop, "season")->value = string("winter");
  CHECK_INT(test_state_write(state, &scratch, &out, &length), SPROUT_OK);
  CHECK_BYTES(out, length,
              "{\"world\":\"printers_shop\",\"serial\":0,\"instances\":[{\"id\":\"printers_shop\",\"properties\":{\"season\":\"winter\"}},"
              "{\"id\":\"printers_shop.composing_room.cabinet\",\"properties\":{\"open\":true,\"ward\":\"iron\"}}],"
              "\"visitors\":[],\"tombstones\":[]}");
  sprout_arena_reset(&scratch);
  sprout_state_free(state);
  sprout_world_free(world);
  CHECK_INT(heap.pages, 0);
}

static void a_list_default_is_compared_as_the_default_is_read_with_its_repeats_dropped(void) {
  test_heap heap;
  sprout_host host = corpus_host(&heap);
  sprout_world *world = corpus_load("printers_shop", &host);
  sprout_state *state = fresh_shop(&host, world);
  sprout_stored_instance *key = record(state, "printers_shop.composing_room.cabinet.shop_key");
  sprout_stored_value list, items[2];
  const char *out;
  size_t length;
  sprout_arena scratch;
  /* The shop key restates `:opens [brass, iron]`: that, and not `Key`'s `[brass]`, is its default. */
  items[0] = string("brass");
  items[1] = string("iron");
  memset(&list, 0, sizeof list);
  list.kind = SPROUT_LIST;
  list.count = 2;
  list.items = items;
  hold(state, key, "opens", list);
  CHECK_INT(test_state_write(state, &scratch, &out, &length), SPROUT_OK);
  CHECK(strstr(out, "shop_key") == NULL);
  sprout_arena_reset(&scratch);
  held(key, "opens")->value.count = 1;
  CHECK_INT(test_state_write(state, &scratch, &out, &length), SPROUT_OK);
  CHECK(strstr(out, "{\"id\":\"printers_shop.composing_room.cabinet.shop_key\",\"properties\":{\"opens\":[\"brass\"]}}") != NULL);
  sprout_arena_reset(&scratch);
  sprout_state_free(state);
  sprout_world_free(world);
}

static void a_moved_declared_object_writes_its_container_and_an_away_visitor_writes_none(void) {
  test_heap heap;
  sprout_host host = corpus_host(&heap);
  sprout_world *world = corpus_load("printers_shop", &host);
  sprout_state *state = fresh_shop(&host, world);
  sprout_stored_instance *key = record(state, "printers_shop.composing_room.cabinet.shop_key");
  sprout_stored_instance *room = record(state, "printers_shop.composing_room");
  sprout_stored_instance visitor;
  sprout_stored_instance *all;
  sprout_arena scratch;
  const char *out;
  size_t length;
  key->container = S("printers_shop.press_yard");
  key->has_arrival = true;
  key->arrival = 1;
  room->has_last_tick = true;
  room->last_tick = 7;
  memset(&visitor, 0, sizeof visitor);
  visitor.id = S("printers_shop#2");
  visitor.made = SPROUT_MADE_VISITOR;
  visitor.has_arrival = true;
  visitor.arrival = 2;
  visitor.kind = world->visitor_kind;
  all = (sprout_stored_instance *)sprout_arena_take(&state->arena, (state->instance_count + 1) * sizeof *all);
  CHECK(all != NULL);
  memcpy(all, state->instances, state->instance_count * sizeof *all);
  all[state->instance_count] = visitor;
  state->instances = all;
  state->instance_count++;
  state->serial = 2;
  CHECK_INT(sprout_state_sort(state, &state->arena), SPROUT_OK);
  CHECK_INT(test_state_write(state, &scratch, &out, &length), SPROUT_OK);
  CHECK_BYTES(out, length,
              "{\"world\":\"printers_shop\",\"serial\":2,\"instances\":["
              "{\"id\":\"printers_shop#2\",\"made\":{\"from\":\"visitor\"},\"arrival\":2},"
              "{\"id\":\"printers_shop.composing_room\",\"lastTick\":7},"
              "{\"id\":\"printers_shop.composing_room.cabinet.shop_key\",\"container\":\"printers_shop.press_yard\",\"arrival\":1}],"
              "\"visitors\":[],\"tombstones\":[]}");
  sprout_arena_reset(&scratch);
  sprout_state_free(state);
  sprout_world_free(world);
}

static void a_number_the_stored_form_does_not_write_is_refused(void) {
  test_heap heap;
  sprout_host host = test_host(&heap);
  sprout_state *state = NULL;
  sprout_stored_instance *in;
  sprout_stored_property *p;
  const char *out;
  size_t length;
  sprout_arena scratch;
  host.page_bytes = 4096;
  CHECK_INT(sprout_state_empty(&host, "shop", &state), SPROUT_OK);
  state->instances = (sprout_stored_instance *)sprout_arena_take(&state->arena, sizeof *in);
  state->instance_count = 1;
  in = &state->instances[0];
  in->id = S("shop");
  p = (sprout_stored_property *)sprout_arena_take(&state->arena, sizeof *p);
  p->name = S("half");
  p->value.kind = SPROUT_NUMBER;
  p->value.number = 0.5;
  in->properties = p;
  in->property_count = 1;
  CHECK_INT(test_state_write(state, &scratch, &out, &length), SPROUT_BAD_INPUT);
  sprout_arena_reset(&scratch);
  sprout_state_free(state);
}

static void the_text_is_taken_once_at_its_size(void) {
  test_heap heap;
  sprout_host host = test_host(&heap);
  sprout_state *state = NULL;
  const char *out;
  size_t length, i, n = 400;
  sprout_arena scratch;
  sprout_str *ids;
  CHECK_INT(sprout_state_empty(&host, "shop", &state), SPROUT_OK);
  /* Four hundred tombstones: a text of several pages, past where a buffer grown by doubling would have been taken twice. */
  ids = (sprout_str *)sprout_arena_take(&state->arena, n * sizeof *ids);
  CHECK(ids != NULL);
  for (i = 0; i < n; i++) {
    char *id = (char *)sprout_arena_take(&state->arena, 16);
    CHECK(id != NULL);
    snprintf(id, 16, "shop.t%04zu", i);
    ids[i].bytes = id;
    ids[i].length = strlen(id);
  }
  state->tombstones = ids;
  state->tombstone_count = n;
  CHECK_INT(test_state_write(state, &scratch, &out, &length), SPROUT_OK);
  CHECK(length > 4096);
  CHECK(out[length] == '\0' && strlen(out) == length);
  /* The scratch holds the text and its page's header, not a run of doublings. */
  CHECK(scratch.held < length + 1 + 256);
  sprout_arena_reset(&scratch);
  sprout_state_free(state);
  CHECK_INT(heap.pages, 0);
}

/* A string is escaped as JSON.stringify escapes it. */
static void a_string_is_escaped_as_json_stringify_does(void) {
  test_heap heap;
  sprout_host host = test_host(&heap);
  sprout_state *state = NULL;
  sprout_stored_instance *in;
  sprout_stored_property *p;
  const char *out;
  size_t length;
  sprout_arena scratch;
  host.page_bytes = 4096;
  CHECK_INT(sprout_state_empty(&host, "shop", &state), SPROUT_OK);
  state->instances = (sprout_stored_instance *)sprout_arena_take(&state->arena, sizeof *in);
  state->instance_count = 1;
  in = &state->instances[0];
  in->id = S("shop#1");
  in->made = SPROUT_MADE_SPAWNED;
  in->made_kind = S("shop.Box");
  p = (sprout_stored_property *)sprout_arena_take(&state->arena, sizeof *p);
  p->name = S("label");
  p->value.kind = SPROUT_STRING;
  p->value.string = S("a \"box\"\\ in\n\r\t\b\f\x01 \xc3\xa9");
  in->properties = p;
  in->property_count = 1;
  CHECK_INT(test_state_write(state, &scratch, &out, &length), SPROUT_OK);
  CHECK(strstr(out, "\"label\":\"a \\\"box\\\"\\\\ in\\n\\r\\t\\b\\f\\u0001 \xc3\xa9\"") != NULL);
  sprout_arena_reset(&scratch);
  sprout_state_free(state);
  CHECK_INT(heap.pages, 0);
}

static void a_host_that_runs_out_of_memory_while_writing_is_told_so(void) {
  test_heap heap;
  sprout_host host = test_host(&heap);
  sprout_state *state = NULL;
  const char *out;
  size_t length;
  sprout_arena scratch;
  host.page_bytes = 64;
  CHECK_INT(sprout_state_empty(&host, "shop", &state), SPROUT_OK);
  heap.refuse_after = heap.pages;
  CHECK_INT(test_state_write(state, &scratch, &out, &length), SPROUT_NO_MEMORY);
  heap.refuse_after = -1;
  sprout_arena_reset(&scratch);
  sprout_state_free(state);
  CHECK_INT(heap.pages, 0);
}

static void a_turns_changes_are_written_from_the_records_the_state_holds(void) {
  test_heap heap;
  sprout_host host = test_host(&heap);
  sprout_state *state = NULL;
  const char *out;
  size_t length;
  sprout_arena scratch;
  sprout_stored_instance *in;
  sprout_stored_changes changes;
  const sprout_str upsert[] = {{"shop#3", 6}}, remove[] = {{"shop.box", 8}}, stones[] = {{"shop.box", 8}};
  const sprout_str missing[] = {{"shop#4", 6}};
  host.page_bytes = 4096;
  CHECK_INT(sprout_state_empty(&host, "shop", &state), SPROUT_OK);
  state->serial = 3;
  state->instances = (sprout_stored_instance *)sprout_arena_take(&state->arena, sizeof *in);
  state->instance_count = 1;
  in = &state->instances[0];
  in->id = S("shop#3");
  in->made = SPROUT_MADE_SPAWNED;
  in->made_kind = S("shop.Box");
  in->has_container = true;
  in->container = S("shop");
  in->has_arrival = true;
  in->arrival = 3;
  memset(&changes, 0, sizeof changes);
  changes.serial = 3;
  changes.upsert = upsert;
  changes.upsert_count = 1;
  changes.remove = remove;
  changes.remove_count = 1;
  changes.tombstones = stones;
  changes.tombstone_count = 1;
  CHECK_INT(sprout_arena_init(&scratch, &host), SPROUT_OK);
  CHECK_INT(sprout_changes_write(state, &changes, &scratch, &out, &length), SPROUT_OK);
  CHECK_BYTES(out, length,
              "{\"serial\":3,\"upsert\":[{\"id\":\"shop#3\",\"made\":{\"from\":\"spawned\",\"kind\":\"shop.Box\"},"
              "\"container\":\"shop\",\"arrival\":3}],\"remove\":[\"shop.box\"],\"tombstones\":[\"shop.box\"],\"visitors\":[]}");
  /* A record the changes name that the state does not hold: these are not this state's changes. */
  changes.upsert = missing;
  CHECK_INT(sprout_changes_write(state, &changes, &scratch, &out, &length), SPROUT_BAD_INPUT);
  sprout_arena_reset(&scratch);
  sprout_state_free(state);
  CHECK_INT(heap.pages, 0);
}

/* A declared record a turn wrote back to its declaration is still upserted, as its id alone, so the store replaces it. */
static void a_changed_record_at_its_declaration_is_upserted_as_its_id_alone(void) {
  test_heap heap;
  sprout_host host = corpus_host(&heap);
  sprout_world *world = corpus_load("printers_shop", &host);
  sprout_state *state = fresh_shop(&host, world);
  const char *out;
  size_t length;
  sprout_arena scratch;
  sprout_stored_changes changes;
  const sprout_str upsert[] = {{"printers_shop.composing_room.cabinet", 36}};
  memset(&changes, 0, sizeof changes);
  changes.upsert = upsert;
  changes.upsert_count = 1;
  CHECK_INT(sprout_arena_init(&scratch, &host), SPROUT_OK);
  CHECK_INT(sprout_changes_write(state, &changes, &scratch, &out, &length), SPROUT_OK);
  CHECK_BYTES(out, length,
              "{\"serial\":0,\"upsert\":[{\"id\":\"printers_shop.composing_room.cabinet\"}],\"remove\":[],\"tombstones\":[],\"visitors\":[]}");
  sprout_arena_reset(&scratch);
  sprout_state_free(state);
  sprout_world_free(world);
}

int main(void) {
  RUN(an_empty_world_is_written_with_every_key_in_order);
  RUN(a_record_built_by_hand_is_written_as_the_schema_orders_it);
  RUN(a_fresh_world_is_written_as_nothing_and_a_changed_instance_as_only_what_changed);
  RUN(a_list_default_is_compared_as_the_default_is_read_with_its_repeats_dropped);
  RUN(a_moved_declared_object_writes_its_container_and_an_away_visitor_writes_none);
  RUN(a_number_the_stored_form_does_not_write_is_refused);
  RUN(the_text_is_taken_once_at_its_size);
  RUN(a_string_is_escaped_as_json_stringify_does);
  RUN(a_host_that_runs_out_of_memory_while_writing_is_told_so);
  RUN(a_turns_changes_are_written_from_the_records_the_state_holds);
  RUN(a_changed_record_at_its_declaration_is_upserted_as_its_id_alone);
  return REPORT();
}
