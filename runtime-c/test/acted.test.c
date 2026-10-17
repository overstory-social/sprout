/*
 * Tests for src/acted.c: the engine's `acted` is the line someone typed as another reads it, named for that
 * reader, in the standard library's words where nothing writes it; it draws nothing and writes nothing, a
 * rendering that spends the poll's budget is told as faulted with no words, and a visit the world does not hold
 * is refused. The world is the harbour of corpus/goldens/nicknames.json, where Ines and the visitor called ΑΣ
 * stand on the quay.
 */
#include "check.h"
#include "json.h"
#include "state.h"
#include "world.h"

typedef struct harbour {
  test_heap heap;
  sprout_host host;
  sprout_arena json, keep;
  char *cartridge, *text;
  sprout_world *world;
  sprout_state *state;
} harbour;

static void harbour_open(harbour *h) {
  size_t length, cartridge_length, stored_length;
  sprout_json *root;
  sprout_json_error error;
  sprout_refusal refusal;
  const char *stored;
  memset(h, 0, sizeof *h);
  h->host = test_host(&h->heap);
  h->host.page_bytes = 65536;
  h->text = test_golden("nicknames.json", &length);
  h->cartridge = test_golden("nicknames.sproutworld", &cartridge_length);
  sprout_arena_init(&h->json, &h->host);
  sprout_arena_init(&h->keep, &h->host);
  CHECK_INT(sprout_json_read(&h->json, h->text, length, &root, &error), SPROUT_OK);
  CHECK_INT(sprout_load_explained(&h->host, h->cartridge, cartridge_length, &h->world, &refusal), SPROUT_OK);
  CHECK_INT(sprout_json_write_value(&h->json, sprout_json_get(root, "world"), &stored, &stored_length), SPROUT_OK);
  CHECK_INT(sprout_state_read(&h->host, stored, stored_length, &h->state, &refusal), SPROUT_OK);
  CHECK_INT(sprout_state_open(h->state, h->world, &refusal), SPROUT_OK);
}

static void harbour_close(harbour *h) {
  sprout_state_free(h->state);
  sprout_world_free(h->world);
  sprout_arena_reset(&h->keep);
  sprout_arena_reset(&h->json);
  free(h->text);
  free(h->cartridge);
  CHECK_INT(h->heap.pages, 0);
}

static void it_reads_as_the_actor_trying_the_line_named_for_the_reader(void) {
  harbour h;
  sprout_acted_line line;
  harbour_open(&h);
  CHECK_INT(sprout_acted(h.world, h.state, &h.host, "v-pell", "v-ines", "take gull", 9, &h.keep, &line), SPROUT_OK);
  CHECK(!line.faulted);
  CHECK_INT(line.paragraph_count, 1);
  CHECK_BYTES(line.paragraphs[0].bytes, line.paragraphs[0].length, "Ines tries to take gull.");
  /* And the other way about, the reader's nickname as the world keeps it. */
  CHECK_INT(sprout_acted(h.world, h.state, &h.host, "v-ines", "v-pell", "look", 4, &h.keep, &line), SPROUT_OK);
  CHECK_INT(line.paragraph_count, 1);
  CHECK_BYTES(line.paragraphs[0].bytes, line.paragraphs[0].length, "\xCE\x91\xCE\xA3 tries to look.");
  harbour_close(&h);
}

static void it_writes_nothing(void) {
  harbour h;
  sprout_acted_line line;
  sprout_arena scratch;
  const char *before, *after;
  size_t before_length, after_length;
  harbour_open(&h);
  sprout_arena_init(&scratch, &h.host);
  CHECK_INT(sprout_state_write(h.state, &scratch, &before, &before_length), SPROUT_OK);
  CHECK_INT(sprout_acted(h.world, h.state, &h.host, "v-pell", "v-ines", "take gull", 9, &h.keep, &line), SPROUT_OK);
  CHECK_INT(sprout_state_write(h.state, &scratch, &after, &after_length), SPROUT_OK);
  CHECK_BYTES(after, after_length, before);
  sprout_arena_reset(&scratch);
  harbour_close(&h);
}

static void a_rendering_that_spends_the_polls_budget_is_faulted_with_no_words(void) {
  harbour h;
  sprout_acted_line line;
  sprout_host tight;
  harbour_open(&h);
  tight = h.host;
  tight.budgets.poll_steps = (sprout_limit){true, 1};
  CHECK_INT(sprout_acted(h.world, h.state, &tight, "v-pell", "v-ines", "take gull", 9, &h.keep, &line), SPROUT_OK);
  CHECK(line.faulted);
  CHECK_INT(line.paragraph_count, 0);
  harbour_close(&h);
}

static void a_visit_the_world_does_not_hold_is_refused(void) {
  harbour h;
  sprout_acted_line line;
  harbour_open(&h);
  CHECK_INT(sprout_acted(h.world, h.state, &h.host, "v-nobody", "v-ines", "look", 4, &h.keep, &line), SPROUT_BAD_INPUT);
  CHECK_INT(sprout_acted(h.world, h.state, &h.host, "v-pell", "v-nobody", "look", 4, &h.keep, &line), SPROUT_BAD_INPUT);
  CHECK_INT(sprout_acted(h.world, h.state, &h.host, "v-pell", "v-ines", "look", 4, NULL, &line), SPROUT_BAD_HOST);
  CHECK_INT(sprout_acted(h.world, h.state, &h.host, "v-pell", "v-ines", "look", 4, &h.keep, NULL), SPROUT_BAD_HOST);
  harbour_close(&h);
}

int main(void) {
  RUN(it_reads_as_the_actor_trying_the_line_named_for_the_reader);
  RUN(it_writes_nothing);
  RUN(a_rendering_that_spends_the_polls_budget_is_faulted_with_no_words);
  RUN(a_visit_the_world_does_not_hold_is_refused);
  return REPORT();
}
