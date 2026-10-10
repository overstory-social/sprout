/*
 * Tests for src/nickname.c: every nickname the TypeScript runtime was asked about (corpus/goldens/nicknames.json,
 * against the harbour cartridge and a stored world with people standing, away and called alike) is admitted or
 * refused here for the same reason, in the same words, naming the same collisions; and the folding that decides
 * when two nicknames are one is held to what JavaScript's `toLowerCase` makes of them.
 */
#include "check.h"
#include "json.h"
#include "nickname.h"
#include "state.h"
#include "world.h"

static sprout_host big_host(test_heap *heap) {
  sprout_host host = test_host(heap);
  host.page_bytes = 65536;
  return host;
}

static sprout_nickname_reason reason_named(const char *name) {
  static const struct {
    const char *name;
    sprout_nickname_reason reason;
  } reasons[] = {{"empty", SPROUT_NICKNAME_EMPTY},         {"not-words", SPROUT_NICKNAME_NOT_WORDS},
                 {"too-long", SPROUT_NICKNAME_TOO_LONG},   {"source-shaped", SPROUT_NICKNAME_SOURCE_SHAPED},
                 {"world-word", SPROUT_NICKNAME_WORLD_WORD}, {"reserved", SPROUT_NICKNAME_RESERVED},
                 {"held", SPROUT_NICKNAME_HELD}};
  for (size_t i = 0; i < sizeof reasons / sizeof reasons[0]; i++)
    if (strcmp(reasons[i].name, name) == 0) return reasons[i].reason;
  fprintf(stderr, "the golden has a reason `%s`\n", name);
  exit(2);
}

static void every_nickname_in_the_golden_is_admitted_or_refused_as_the_typescript_runtime_did(void) {
  test_heap heap;
  sprout_host host = big_host(&heap);
  sprout_arena arena;
  sprout_json *root;
  sprout_json_error error;
  size_t length, cartridge_length, stored_length;
  char *text = test_golden("nicknames.json", &length), *cartridge = test_golden("nicknames.sproutworld", &cartridge_length);
  const char *stored;
  const sprout_json *cases;
  sprout_world *world;
  sprout_state *state;
  sprout_refusal refusal;
  size_t refused = 0, admitted = 0, i;
  sprout_arena_init(&arena, &host);
  CHECK_INT(sprout_json_read(&arena, text, length, &root, &error), SPROUT_OK);
  CHECK_INT(sprout_load_explained(&host, cartridge, cartridge_length, &world, &refusal), SPROUT_OK);
  CHECK_INT(sprout_json_write_value(&arena, sprout_json_get(root, "world"), &stored, &stored_length), SPROUT_OK);
  CHECK_INT(sprout_state_read(&host, stored, stored_length, &state, &refusal), SPROUT_OK);
  CHECK_INT(sprout_state_open(state, world, NULL, &refusal), SPROUT_OK);
  cases = sprout_json_get(root, "cases");
  CHECK(cases != NULL && cases->count > 300);
  for (i = 0; cases != NULL && i < cases->count; i++) {
    const sprout_json *one = cases->items[i], *nickname = sprout_json_get(one, "nickname"),
                      *want = sprout_json_get(one, "refused");
    sprout_admission admission;
    sprout_host asked = host;
    asked.budgets.nickname_characters = (sprout_limit){true, (uint64_t)sprout_json_get(one, "cap")->number};
    CHECK_INT(sprout_admit(world, state, &asked, sprout_json_get(one, "visit")->bytes, nickname->bytes, nickname->length,
                           &admission),
              SPROUT_OK);
    if (want->kind == SPROUT_JSON_NULL) {
      admitted++;
      CHECK_INT(admission.reason, SPROUT_NICKNAME_OK);
    } else {
      const sprout_json *collides = sprout_json_get(want, "collides"), *words = sprout_json_get(want, "words");
      size_t c;
      refused++;
      CHECK_INT(admission.reason, reason_named(sprout_json_get(want, "reason")->bytes));
      CHECK_BYTES(admission.words.bytes, admission.words.length, words->bytes);
      CHECK_INT(admission.collide_count, collides->count);
      for (c = 0; c < collides->count && c < admission.collide_count; c++)
        CHECK_BYTES(admission.collides[c].bytes, admission.collides[c].length, collides->items[c]->bytes);
    }
    if (check_failures > 0) fprintf(stderr, "  in case %zu: %s asks %s\n", i, sprout_json_get(one, "visit")->bytes, nickname->bytes);
    sprout_admission_free(&admission);
    if (check_failures > 0) break;
  }
  CHECK(refused > 100 && admitted > 100);
  CHECK_INT(heap.pages > 0 ? 1 : 0, 1);
  sprout_state_free(state);
  sprout_world_free(world);
  sprout_arena_reset(&arena);
  free(text);
  free(cartridge);
}

static void a_nickname_is_kept_as_its_words_single_spaced_and_folded_as_javascript_folds_it(void) {
  test_heap heap;
  sprout_host host = test_host(&heap);
  sprout_arena arena;
  sprout_str kept, *words;
  size_t count;
  sprout_arena_init(&arena, &host);
  CHECK(nickname_kept(&arena, (sprout_str){"  Marta \t B\n", 12}, &kept));
  CHECK_BYTES(kept.bytes, kept.length, "Marta B");
  CHECK(nickname_kept(&arena, (sprout_str){"\xC2\xA0 x \xE3\x80\x80 y", 10}, &kept));
  CHECK_BYTES(kept.bytes, kept.length, "x y");
  CHECK_INT(nickname_typed_words(&arena, (sprout_str){"A, b", 4}, &words, &count), SPROUT_OK);
  CHECK_INT(count, 3);
  CHECK_BYTES(words[0].bytes, words[0].length, "a");
  CHECK_BYTES(words[1].bytes, words[1].length, ",");
  CHECK_BYTES(words[2].bytes, words[2].length, "b");
  /* A capital sigma that ends a word after a letter is a final sigma; anywhere else it is not. */
  CHECK_INT(nickname_typed_words(&arena, (sprout_str){"\xCE\x91\xCE\xA3 \xCE\xA3\xCE\x91\xCE\xA3", 11}, &words, &count), SPROUT_OK);
  CHECK_INT(count, 2);
  CHECK_BYTES(words[0].bytes, words[0].length, "\xCE\xB1\xCF\x82");
  CHECK_BYTES(words[1].bytes, words[1].length, "\xCF\x83\xCE\xB1\xCF\x82");
  /* A capital I with a dot above lower-cases to two code points. */
  CHECK_INT(nickname_typed_words(&arena, (sprout_str){"\xC4\xB0", 2}, &words, &count), SPROUT_OK);
  CHECK_BYTES(words[0].bytes, words[0].length, "i\xCC\x87");
  sprout_arena_reset(&arena);
}

static void a_host_that_cannot_give_memory_is_told_so_not_misled(void) {
  test_heap heap;
  sprout_host host = test_host(&heap);
  sprout_admission admission;
  size_t length, cartridge_length;
  char *cartridge = test_golden("nicknames.sproutworld", &cartridge_length), *text = test_golden("nicknames.json", &length);
  sprout_world *world;
  sprout_state *state;
  sprout_refusal refusal;
  host.page_bytes = 65536;
  CHECK_INT(sprout_load_explained(&host, cartridge, cartridge_length, &world, &refusal), SPROUT_OK);
  CHECK_INT(sprout_state_empty(&host, "harbour", &state), SPROUT_OK);
  CHECK_INT(sprout_state_open(state, world, NULL, &refusal), SPROUT_OK);
  heap.refuse_after = heap.pages;
  CHECK_INT(sprout_admit(world, state, &host, "v-new", "Marta", 5, &admission), SPROUT_NO_MEMORY);
  CHECK(admission.held == NULL);
  heap.refuse_after = -1;
  CHECK_INT(sprout_admit(NULL, state, &host, "v-new", "Marta", 5, &admission), SPROUT_BAD_INPUT);
  CHECK_INT(sprout_admit(world, state, &host, "v-new", "Marta", 5, NULL), SPROUT_BAD_HOST);
  CHECK_INT(sprout_admit(world, state, &host, "v-new", "Marta", 5, &admission), SPROUT_OK);
  CHECK_INT(admission.reason, SPROUT_NICKNAME_OK);
  sprout_admission_free(&admission);
  sprout_admission_free(&admission);
  sprout_state_free(state);
  sprout_world_free(world);
  free(cartridge);
  free(text);
}

int main(void) {
  RUN(every_nickname_in_the_golden_is_admitted_or_refused_as_the_typescript_runtime_did);
  RUN(a_nickname_is_kept_as_its_words_single_spaced_and_folded_as_javascript_folds_it);
  RUN(a_host_that_cannot_give_memory_is_told_so_not_misled);
  return REPORT();
}
