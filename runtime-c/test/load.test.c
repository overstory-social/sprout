/*
 * Tests for src/load.c: a cartridge is refused in the words the
 * TypeScript loader uses when it is not one, was made for a newer format or
 * language level, or is damaged; a host that runs out of memory part way is
 * told so and left holding nothing.
 */
#include "load.h"
#include "corpus.h"
#include "inflate.h"

/* 16 header bytes, then `body` as one stored gzip member. */
static char *cartridge_of(const char *body, size_t *length) {
  size_t n = strlen(body), at;
  unsigned char *out = (unsigned char *)malloc(16 + 10 + 5 + n + 8);
  uint32_t crc = sprout_crc32(0, (const unsigned char *)body, n);
  memset(out, 0, 16);
  memcpy(out, "SPRT", 4);
  out[4] = 1;
  out[6] = 1;
  at = 16;
  {
    static const unsigned char gz[10] = {0x1f, 0x8b, 8, 0, 0, 0, 0, 0, 0, 3};
    memcpy(out + at, gz, 10);
    at += 10;
  }
  out[at++] = 1; /* final stored block */
  out[at++] = (unsigned char)(n & 255);
  out[at++] = (unsigned char)(n >> 8);
  out[at++] = (unsigned char)(~n & 255);
  out[at++] = (unsigned char)((~n >> 8) & 255);
  memcpy(out + at, body, n);
  at += n;
  out[at++] = (unsigned char)crc;
  out[at++] = (unsigned char)(crc >> 8);
  out[at++] = (unsigned char)(crc >> 16);
  out[at++] = (unsigned char)(crc >> 24);
  out[at++] = (unsigned char)n;
  out[at++] = (unsigned char)(n >> 8);
  out[at++] = 0;
  out[at++] = 0;
  *length = at;
  return (char *)out;
}

static void refuses(const char *bytes, size_t length, const char *words) {
  test_heap heap;
  sprout_host host = corpus_host(&heap);
  sprout_world *world = (sprout_world *)1;
  sprout_refusal why;
  CHECK_INT(sprout_load_explained(&host, bytes, length, &world, &why), SPROUT_BAD_INPUT);
  CHECK(world == NULL);
  CHECK_STR(why.text, words);
  CHECK_INT(heap.pages, 0);
}

static void a_newer_format_or_level_is_refused_naming_the_number(void) {
  size_t length;
  char *bytes = corpus_cartridge("printers_shop", &length);
  bytes[4] = 2;
  refuses(bytes, length,
          "This cartridge is format version 2, and this runtime reads up to version 1. Update the runtime, or pack the world again with this one.");
  bytes[4] = 1;
  bytes[6] = 7;
  refuses(bytes, length,
          "This cartridge was made for language level 7, and this runtime reads up to level 1. Update the runtime, or pack the world again with this one.");
  bytes[6] = 1;
  bytes[4] = 0;
  refuses(bytes, length, "This cartridge says it is format version 0, and versions begin at 1. It is damaged.");
  free(bytes);
}

static void a_file_that_is_not_a_cartridge_is_refused(void) {
  const char *words = "This is not a Sprout cartridge: it does not begin with `SPRT`. Pack a world with `sprout pack`.";
  refuses("SPRT", 4, words);
  refuses("NOPE0123456789abcdef", 20, words);
  refuses(NULL, 0, words);
}

static void a_damaged_body_is_refused_in_words(void) {
  size_t length;
  char *bytes = corpus_cartridge("printers_shop", &length);
  char *good;
  bytes[length / 2] ^= 0x55;
  {
    test_heap heap;
    sprout_host host = corpus_host(&heap);
    sprout_world *world = NULL;
    sprout_refusal why;
    CHECK_INT(sprout_load_explained(&host, bytes, length, &world, &why), SPROUT_BAD_INPUT);
    CHECK(strncmp(why.text, "This cartridge cannot be read: ", 31) == 0);
    CHECK_INT(heap.pages, 0);
  }
  free(bytes);
  good = cartridge_of("not json at all", &length);
  refuses(good, length, "This cartridge cannot be read: its body is not JSON.");
  free(good);
  good = cartridge_of("[]", &length);
  refuses(good, length, "This cartridge is not shaped as a cartridge is: its body is not an object.");
  free(good);
  good = cartridge_of("{}", &length);
  refuses(good, length,
          "This cartridge is not shaped as a cartridge is at `table`: it is missing the entries it refers to.");
  free(good);
}

static void a_body_missing_a_section_is_refused_where_it_goes_wrong(void) {
  size_t length;
  char *bytes = cartridge_of("{\"table\":{\"files\":[],\"entries\":[]},\"prose\":{\"entries\":[]},\"bodies\":{\"entries\":[]}}", &length);
  refuses(bytes, length, "This cartridge is not shaped as a cartridge is at `header`: it is not what a cartridge holds there.");
  free(bytes);
}

static void a_load_that_runs_out_of_memory_says_so_and_holds_nothing(void) {
  size_t length;
  char *bytes = corpus_cartridge("printers_shop", &length);
  long pages;
  for (pages = 0; pages < 40; pages += 3) {
    test_heap heap;
    sprout_host host = test_host(&heap);
    sprout_world *world = NULL;
    sprout_status status;
    host.page_bytes = 8192;
    heap.refuse_after = pages;
    status = sprout_load(&host, bytes, length, &world);
    CHECK_INT(status, SPROUT_NO_MEMORY);
    CHECK(world == NULL);
    CHECK_INT(heap.pages, 0);
  }
  free(bytes);
}

static void a_host_without_memory_is_a_bad_host(void) {
  sprout_host host;
  sprout_world *world = NULL;
  memset(&host, 0, sizeof host);
  CHECK_INT(sprout_load(&host, "SPRT", 4, &world), SPROUT_BAD_HOST);
  CHECK_INT(sprout_load(NULL, "SPRT", 4, &world), SPROUT_BAD_HOST);
  {
    size_t length;
    char *bytes = corpus_cartridge("printers_shop", &length);
    CHECK_INT(sprout_load(&host, bytes, length, &world), SPROUT_BAD_HOST);
    free(bytes);
  }
}

static void a_loaded_world_keeps_the_header_the_cartridge_recorded(void) {
  test_heap heap;
  sprout_host host = corpus_host(&heap);
  sprout_world *world = corpus_load("printers_shop", &host);
  CHECK_STR(world->header.name, "printers_shop");
  CHECK_INT(world->header.level, 1);
  CHECK(world->header.file_count > 3);
  CHECK(world->header.library_count >= 1);
  CHECK_STR(world->header.libraries[0].name, "sprout");
  CHECK_INT(strlen(world->header.hash), 64);
  sprout_world_free(world);
  CHECK_INT(heap.pages, 0);
}

int main(void) {
  RUN(a_newer_format_or_level_is_refused_naming_the_number);
  RUN(a_file_that_is_not_a_cartridge_is_refused);
  RUN(a_damaged_body_is_refused_in_words);
  RUN(a_body_missing_a_section_is_refused_where_it_goes_wrong);
  RUN(a_load_that_runs_out_of_memory_says_so_and_holds_nothing);
  RUN(a_host_without_memory_is_a_bad_host);
  RUN(a_loaded_world_keeps_the_header_the_cartridge_recorded);
  return REPORT();
}
