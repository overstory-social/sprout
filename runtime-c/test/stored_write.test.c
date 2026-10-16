/*
 * Tests for src/stored_write.c: the canonical form of a stored world: keys in
 * the stored schema's order, members as held, no white space, whole numbers
 * as digits, and the escapes JSON.stringify makes; the text is taken once, at
 * its size, from the caller's scratch, and a host may make it a few instances
 * a step. A turn's changes are written the same way, each record read from
 * the state.
 */
#include "check.h"
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
              "\"kind\":\"shop.Lantern\",\"path\":[\"wick\",\"flame\"]},\"container\":null,\"arrival\":12,"
              "\"properties\":{},\"links\":{},\"wakes\":[],\"memory\":{},\"lastTick\":1790000000}],"
              "\"visitors\":[],\"tombstones\":[]}");
  sprout_arena_reset(&scratch);
  sprout_state_free(state);
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
  p->type = S("integer");
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

/* A state of `n` records built by hand, each with a string that needs escaping and a number. */
static sprout_state *hand_built(sprout_host *host, size_t n) {
  sprout_state *state = NULL;
  size_t i;
  CHECK_INT(sprout_state_empty(host, "shop", &state), SPROUT_OK);
  state->serial = n;
  state->instances = (sprout_stored_instance *)sprout_arena_take(&state->arena, n * sizeof *state->instances);
  state->instance_count = n;
  for (i = 0; i < n; i++) {
    sprout_stored_instance *in = &state->instances[i];
    sprout_stored_property *p = (sprout_stored_property *)sprout_arena_take(&state->arena, sizeof *p);
    char *id = (char *)sprout_arena_take(&state->arena, 16);
    snprintf(id, 16, "shop#%04u", (unsigned)(i + 1) % 10000u);
    in->id = S(id);
    in->made = SPROUT_MADE_SPAWNED;
    in->made_kind = S("shop.Box");
    in->has_arrival = true;
    in->arrival = i + 1;
    p->name = S("label");
    p->type = S("string");
    p->value.kind = SPROUT_STRING;
    p->value.string = S("a \"box\"\n\x01");
    in->properties = p;
    in->property_count = 1;
  }
  return state;
}

/*
 * A host steps the writer: the text is measured over the steps first, then taken at its size and
 * made over as many again, whole instances at a time and at least one a step, and is the text the
 * one call makes.
 */
static void a_host_may_make_the_text_a_few_instances_a_step(void) {
  test_heap heap;
  sprout_host host = test_host(&heap);
  sprout_state *state = hand_built(&host, 7);
  const char *whole;
  size_t length, steps = 0, measuring = 0, grown = 0, last = 0;
  sprout_arena scratch, piecewise;
  sprout_state_writer w;
  CHECK_INT(test_state_write(state, &scratch, &whole, &length), SPROUT_OK);
  CHECK(strstr(whole, "\"label\":{\"type\":\"string\",\"value\":\"a \\\"box\\\"\\n\\u0001\"}") != NULL);
  CHECK_INT(sprout_arena_init(&piecewise, &host), SPROUT_OK);
  sprout_state_write_begin(state, &piecewise, &w);
  CHECK(w.text.bytes == NULL && w.text.length == 0 && !w.done);
  while (!w.done) {
    bool was_measuring = w.text.bytes == NULL;
    CHECK_INT(sprout_state_write_step(&w, 0), SPROUT_OK);
    steps++;
    if (was_measuring) {
      measuring++;
      CHECK(w.text.length > last || w.text.bytes != NULL); /* every measuring step counts, until the text is taken */
    } else if (!w.done) {
      CHECK(w.text.length > last);
      grown++;
    }
    last = w.text.length;
  }
  /* With no budget a step makes one instance: the head with the first, then one each, then the tail, twice over. */
  CHECK_INT(measuring, 8);
  CHECK_INT(steps, 16);
  CHECK_INT(grown, 7);
  CHECK_BYTES(w.text.bytes, w.text.length, whole);
  CHECK(w.text.bytes[w.text.length] == '\0');
  CHECK(piecewise.held < length + 1 + 256);
  CHECK_INT(sprout_state_write_step(&w, 0), SPROUT_OK); /* done stays done */
  CHECK_BYTES(w.text.bytes, w.text.length, whole);
  sprout_arena_reset(&piecewise);
  sprout_arena_reset(&scratch);
  sprout_state_free(state);
  CHECK_INT(heap.pages, 0);
}

/* A step makes about the bytes asked for, and a budget past the whole makes it in two steps: one measuring, one writing. */
static void a_step_makes_about_the_bytes_asked_for(void) {
  test_heap heap;
  sprout_host host = test_host(&heap);
  sprout_state *state = hand_built(&host, 40);
  const char *whole;
  size_t length, steps = 0, last = 0;
  sprout_arena scratch, piecewise;
  sprout_state_writer w;
  CHECK_INT(test_state_write(state, &scratch, &whole, &length), SPROUT_OK);
  CHECK_INT(sprout_arena_init(&piecewise, &host), SPROUT_OK);
  sprout_state_write_begin(state, &piecewise, &w);
  while (w.text.bytes == NULL) CHECK_INT(sprout_state_write_step(&w, 1000), SPROUT_OK);
  while (!w.done) {
    CHECK_INT(sprout_state_write_step(&w, 1000), SPROUT_OK);
    if (!w.done) CHECK(w.text.length - last >= 1000 && w.text.length - last < 1000 + 300);
    last = w.text.length;
    steps++;
  }
  CHECK(steps > 3 && steps < 10);
  CHECK_BYTES(w.text.bytes, w.text.length, whole);
  sprout_arena_reset(&piecewise);
  CHECK_INT(sprout_arena_init(&piecewise, &host), SPROUT_OK);
  sprout_state_write_begin(state, &piecewise, &w);
  CHECK_INT(sprout_state_write_step(&w, (size_t)-1), SPROUT_OK);
  CHECK(w.text.bytes != NULL && w.text.length == 0 && !w.done);
  CHECK_INT(sprout_state_write_step(&w, (size_t)-1), SPROUT_OK);
  CHECK(w.done);
  CHECK_BYTES(w.text.bytes, w.text.length, whole);
  sprout_arena_reset(&piecewise);
  sprout_arena_reset(&scratch);
  sprout_state_free(state);
  CHECK_INT(heap.pages, 0);
}

/* A number the stored form does not write is refused at the step that reaches it, while measuring. */
static void a_step_that_reaches_an_unwritable_number_is_refused(void) {
  test_heap heap;
  sprout_host host = test_host(&heap);
  sprout_state *state = hand_built(&host, 3);
  sprout_arena piecewise;
  sprout_state_writer w;
  state->instances[2].properties[0].value.kind = SPROUT_NUMBER;
  state->instances[2].properties[0].value.number = 0.5;
  CHECK_INT(sprout_arena_init(&piecewise, &host), SPROUT_OK);
  sprout_state_write_begin(state, &piecewise, &w);
  CHECK_INT(sprout_state_write_step(&w, 0), SPROUT_OK);
  CHECK_INT(sprout_state_write_step(&w, 0), SPROUT_OK);
  CHECK_INT(sprout_state_write_step(&w, 0), SPROUT_BAD_INPUT);
  CHECK(w.text.bytes == NULL && !w.done);
  sprout_arena_reset(&piecewise);
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
              "\"container\":\"shop\",\"arrival\":3,\"properties\":{},\"links\":{},\"wakes\":[],\"memory\":{},"
              "\"lastTick\":null}],\"remove\":[\"shop.box\"],\"tombstones\":[\"shop.box\"],\"visitors\":[]}");
  /* A record the changes name that the state does not hold: these are not this state's changes. */
  changes.upsert = missing;
  CHECK_INT(sprout_changes_write(state, &changes, &scratch, &out, &length), SPROUT_BAD_INPUT);
  sprout_arena_reset(&scratch);
  sprout_state_free(state);
  CHECK_INT(heap.pages, 0);
}

int main(void) {
  RUN(an_empty_world_is_written_with_every_key_in_order);
  RUN(a_record_built_by_hand_is_written_as_the_schema_orders_it);
  RUN(a_number_the_stored_form_does_not_write_is_refused);
  RUN(the_text_is_taken_once_at_its_size);
  RUN(a_host_may_make_the_text_a_few_instances_a_step);
  RUN(a_step_makes_about_the_bytes_asked_for);
  RUN(a_step_that_reaches_an_unwritable_number_is_refused);
  RUN(a_host_that_runs_out_of_memory_while_writing_is_told_so);
  RUN(a_turns_changes_are_written_from_the_records_the_state_holds);
  return REPORT();
}
