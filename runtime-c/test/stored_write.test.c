/*
 * Tests for src/stored_write.c: the canonical form of a stored world: keys in
 * the stored schema's order, members as held, no white space, whole numbers
 * as digits, and the escapes JSON.stringify makes.
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
  CHECK_INT(sprout_state_empty(&host, "shop", &state), SPROUT_OK);
  CHECK_INT(sprout_state_write(state, &out, &length), SPROUT_OK);
  CHECK_BYTES(out, length, "{\"world\":\"shop\",\"serial\":0,\"instances\":[],\"visitors\":[],\"tombstones\":[]}");
  sprout_state_free(state);
  CHECK_INT(heap.pages, 0);
}

static void a_record_built_by_hand_is_written_as_the_schema_orders_it(void) {
  test_heap heap;
  sprout_host host = test_host(&heap);
  sprout_state *state = NULL;
  const char *out;
  size_t length;
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
  CHECK_INT(sprout_state_write(state, &out, &length), SPROUT_OK);
  CHECK_BYTES(out, length,
              "{\"world\":\"shop\",\"serial\":12,\"instances\":[{\"id\":\"shop#12\",\"made\":{\"from\":\"given\","
              "\"kind\":\"shop.Lantern\",\"path\":[\"wick\",\"flame\"]},\"container\":null,\"arrival\":12,"
              "\"properties\":{},\"links\":{},\"wakes\":[],\"memory\":{},\"lastTick\":1790000000}],"
              "\"visitors\":[],\"tombstones\":[]}");
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
  CHECK_INT(sprout_state_write(state, &out, &length), SPROUT_BAD_INPUT);
  sprout_state_free(state);
}

static void a_host_that_runs_out_of_memory_while_writing_is_told_so(void) {
  test_heap heap;
  sprout_host host = test_host(&heap);
  sprout_state *state = NULL;
  const char *out;
  size_t length;
  host.page_bytes = 64;
  CHECK_INT(sprout_state_empty(&host, "shop", &state), SPROUT_OK);
  heap.refuse_after = heap.pages;
  CHECK_INT(sprout_state_write(state, &out, &length), SPROUT_NO_MEMORY);
  heap.refuse_after = -1;
  sprout_state_free(state);
  CHECK_INT(heap.pages, 0);
}

int main(void) {
  RUN(an_empty_world_is_written_with_every_key_in_order);
  RUN(a_record_built_by_hand_is_written_as_the_schema_orders_it);
  RUN(a_number_the_stored_form_does_not_write_is_refused);
  RUN(a_host_that_runs_out_of_memory_while_writing_is_told_so);
  return REPORT();
}
