/* Tests for src/seeds.c: SHA-256 against the published vectors, and the turn seed against the player's golden. */
#include "check.h"
#include "json.h"
#include "seeds.h"

static void hex_of(const unsigned char digest[32], char out[65]) {
  static const char DIGITS[] = "0123456789abcdef";
  for (int i = 0; i < 32; i++) {
    out[2 * i] = DIGITS[digest[i] >> 4];
    out[2 * i + 1] = DIGITS[digest[i] & 15];
  }
  out[64] = '\0';
}

static void sha256_is_sha256_against_the_published_vectors(void) {
  unsigned char digest[32];
  char hex[65];
  char thousand[1000];
  sprout_sha256("", 0, digest);
  hex_of(digest, hex);
  CHECK_STR(hex, "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855");
  sprout_sha256("abc", 3, digest);
  hex_of(digest, hex);
  CHECK_STR(hex, "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
  sprout_sha256("abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq", 56, digest);
  hex_of(digest, hex);
  CHECK_STR(hex, "248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1");
  /* A thousand bytes cross sixteen blocks and a padded tail. */
  memset(thousand, 'a', sizeof thousand);
  sprout_sha256(thousand, 1000, digest);
  hex_of(digest, hex);
  CHECK_STR(hex, "41edece42d63e8d9bf515a9ba6932e1c20cbc9f5a5d134645adb5db1b9737ea3");
}

static void a_turn_seed_is_the_first_32_bits_of_the_hash_of_the_three(void) {
  unsigned char digest[32];
  uint32_t first;
  sprout_sha256("0 yard.kiln 0", 13, digest);
  first = (uint32_t)digest[0] << 24 | (uint32_t)digest[1] << 16 | (uint32_t)digest[2] << 8 | digest[3];
  CHECK_INT(sprout_turn_seed(0, "yard.kiln", 9, 0), first);
}

static void every_case_of_the_players_golden_is_reproduced(void) {
  test_heap heap;
  sprout_host host = test_host(&heap);
  sprout_arena arena;
  sprout_json *root;
  sprout_json_error error;
  size_t length;
  char *text = test_golden("seeds.json", &length);
  const sprout_json *cases;
  sprout_arena_init(&arena, &host);
  CHECK_INT(sprout_json_read(&arena, text, length, &root, &error), SPROUT_OK);
  cases = sprout_json_get(root, "cases");
  CHECK(cases != NULL && cases->count >= 8);
  for (size_t i = 0; cases != NULL && i < cases->count; i++) {
    const sprout_json *one = cases->items[i];
    const sprout_json *path = sprout_json_get(one, "path");
    CHECK_INT(sprout_turn_seed((uint64_t)sprout_json_get(one, "seed")->number, path->bytes, path->length,
                               (uint64_t)sprout_json_get(one, "nth")->number),
              (long long)sprout_json_get(one, "turn")->number);
  }
  sprout_arena_reset(&arena);
  free(text);
}

static void a_seed_is_a_seed_and_differs_by_thing_count_and_step(void) {
  uint32_t a = sprout_turn_seed(0, "yard.kiln", 9, 0), b = sprout_turn_seed(1, "yard.kiln", 9, 0),
           c = sprout_turn_seed(0, "yard.oven", 9, 0), d = sprout_turn_seed(0, "yard.kiln", 9, 1);
  CHECK(a != b && a != c && a != d && b != c && b != d && c != d);
  CHECK_INT(sprout_turn_seed(5, "yard.kiln", 9, 2), sprout_turn_seed(5, "yard.kiln", 9, 2));
}

int main(void) {
  RUN(sha256_is_sha256_against_the_published_vectors);
  RUN(a_turn_seed_is_the_first_32_bits_of_the_hash_of_the_three);
  RUN(every_case_of_the_players_golden_is_reproduced);
  RUN(a_seed_is_a_seed_and_differs_by_thing_count_and_step);
  return REPORT();
}
