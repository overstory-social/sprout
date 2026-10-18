/*
 * Tests for src/load.c: a cartridge is refused in the words the
 * language's cartridge reader uses when it is not one, was made for another format or
 * a newer language level, or is damaged; a host that runs out of memory part
 * way is told so and left holding nothing; a load steps across calls by
 * bytes, reading its source a piece at a time and never past the body into
 * the assets, can be abandoned, and a peek inflates only as far as the
 * preamble.
 */
#include "load.h"
#include "corpus.h"
#include "inflate.h"

/* A table of no nodes: its counts, then the one string offset and the one shape offset, each padded. */
static const unsigned char EMPTY_TABLE[64] = {'T', 'B', 'L', '4'};

/* The header's bytes, then `preamble`, padded to eight, and `table` as one stored gzip member, and no assets. */
static char *cartridge_with(const char *preamble, const unsigned char *table, size_t table_length, size_t *length) {
  size_t text = strlen(preamble), table_at = (text + 7) & ~(size_t)7, n = table_at + table_length, at;
  unsigned char *body = (unsigned char *)calloc(n, 1);
  unsigned char *out = (unsigned char *)malloc(SPROUT_CARTRIDGE_HEADER_BYTES + 10 + 5 + n + 8);
  uint32_t crc;
  memcpy(body, preamble, text);
  if (table_length > 0) memcpy(body + table_at, table, table_length);
  crc = sprout_crc32(0, body, n);
  memset(out, 0, SPROUT_CARTRIDGE_HEADER_BYTES);
  memcpy(out, "SPRT", 4);
  out[4] = SPROUT_CARTRIDGE_FORMAT;
  out[6] = 1;
  out[8] = (unsigned char)n, out[9] = (unsigned char)(n >> 8), out[10] = (unsigned char)(n >> 16), out[11] = (unsigned char)(n >> 24);
  out[12] = (unsigned char)table_at, out[13] = (unsigned char)(table_at >> 8), out[14] = (unsigned char)(table_at >> 16),
  out[15] = (unsigned char)(table_at >> 24);
  at = SPROUT_CARTRIDGE_HEADER_BYTES;
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
  out[16] = (unsigned char)at, out[17] = (unsigned char)(at >> 8), out[18] = (unsigned char)(at >> 16),
  out[19] = (unsigned char)(at >> 24);
  *length = at;
  free(body);
  return (char *)out;
}

static char *cartridge_of(const char *preamble, size_t *length) {
  return cartridge_with(preamble, EMPTY_TABLE, sizeof EMPTY_TABLE, length);
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
  bytes[4] = 6;
  refuses(bytes, length,
          "This cartridge is format version 6, and this runtime reads up to version 5. Update the runtime, or pack the world again with this one.");
  bytes[4] = 5;
  bytes[6] = 7;
  refuses(bytes, length,
          "This cartridge was made for language level 7, and this runtime reads up to level 1. Update the runtime, or pack the world again with this one.");
  bytes[6] = 1;
  bytes[4] = 0;
  refuses(bytes, length, "This cartridge says it is format version 0, and versions begin at 1. It is damaged.");
  bytes[4] = 4;
  refuses(bytes, length,
          "This cartridge is format version 4, and this runtime reads version 5. Pack the world again with `sprout pack`.");
  free(bytes);
}

static void a_file_that_is_not_a_cartridge_is_refused(void) {
  const char *words = "This is not a Sprout cartridge: it does not begin with `SPRT`. Pack a world with `sprout pack`.";
  refuses("SPRT", 4, words);
  refuses("NOPE0123456789abcdef", 20, words);
  refuses(NULL, 0, words);
}

#define ALL_CAPS "\"caps\":{\"optionsPerEnum\":1,\"rolesPerVerb\":1,\"phrasesPerVerb\":1,\"stepsPerIntent\":1,\"phraseCharacters\":1,\"nounsPerObject\":1,\"nounCharacters\":1,\"exitsPerPlace\":1,\"literalCharacters\":1,\"listElements\":1,\"places\":null,\"objects\":null,\"kinds\":null,\"files\":null,\"sourceBytes\":null}"
#define TITLED_HEADER(title) "\"header\":{\"name\":\"late\",\"title\":" title ",\"namespace\":\"late\",\"version\":\"1.0.0\",\"author\":\"a\",\"license\":\"MIT\",\"level\":1,\"hash\":\"h\",\"files\":[],\"libraries\":[]}"
#define A_HEADER "\"header\":{\"name\":\"late\",\"namespace\":\"late\",\"version\":\"1.0.0\",\"author\":\"a\",\"license\":\"MIT\",\"level\":1,\"hash\":\"h\",\"files\":[],\"libraries\":[]}"

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
  /* The header's sizes and the body disagree. */
  bytes[length / 2] ^= 0x55;
  bytes[8] ^= 1;
  refuses(bytes, length, "This cartridge cannot be read: its body is not the size its header says.");
  bytes[8] ^= 1;
  bytes[12] = 4;
  refuses(bytes, length, "This cartridge cannot be read: its body is not the size its header says.");
  free(bytes);
  /* The file and where the header says its assets are disagree, or the assets begin inside the header. */
  bytes = corpus_cartridge("printers_shop", &length);
  refuses(bytes, length - 1, "This cartridge cannot be read: it is not the size its header says.");
  bytes[20] = 1;
  refuses(bytes, length, "This cartridge cannot be read: it is not the size its header says.");
  bytes[20] = 0;
  memset(bytes + 16, 0, 4);
  refuses(bytes, length, "This cartridge cannot be read: it is not the size its header says.");
  free(bytes);
  good = cartridge_of("not json at all", &length);
  refuses(good, length, "This cartridge cannot be read: its preamble is not JSON.");
  free(good);
  good = cartridge_of("[]", &length);
  refuses(good, length, "This cartridge is not shaped as a cartridge is: its preamble is not an object.");
  free(good);
  good = cartridge_of("{}", &length);
  refuses(good, length, "This cartridge is not shaped as a cartridge is at `table.files`: it is not what a cartridge holds there.");
  free(good);
  good = cartridge_of("{\"table\":{\"files\":[]}}", &length);
  refuses(good, length, "This cartridge is not shaped as a cartridge is at `header`: it is not what a cartridge holds there.");
  free(good);
  good = cartridge_with("{\"table\":{\"files\":[]}}", (const unsigned char *)"not a table at all", 18, &length);
  refuses(good, length,
          "This cartridge is not shaped as a cartridge is: the cartridge's table is not one this runtime reads: it does not begin with `TBL4`");
  free(good);
}

static void a_load_that_runs_out_of_memory_says_so_and_holds_nothing(void) {
  size_t length;
  char *bytes = corpus_cartridge("printers_shop", &length);
  long pages, refused = 0;
  for (pages = 0; pages < 400; pages += 1) {
    test_heap heap;
    sprout_host host = test_host(&heap);
    sprout_world *world = NULL;
    sprout_status status;
    host.page_bytes = 8192;
    heap.refuse_after = pages;
    status = sprout_load(&host, bytes, length, &world);
    if (status == SPROUT_OK) {
      CHECK(world != NULL);
      sprout_world_free(world);
      CHECK_INT(heap.pages, 0);
      break;
    }
    CHECK_INT(status, SPROUT_NO_MEMORY);
    CHECK(world == NULL);
    CHECK_INT(heap.pages, 0);
    refused++;
  }
  CHECK(refused > 3 && pages < 400);
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
  CHECK(world->graph.count > 1000);
  sprout_world_free(world);
  CHECK_INT(heap.pages, 0);
}

static void a_load_steps_across_calls_by_bytes_and_tells_its_progress(void) {
  test_heap heap;
  sprout_host host = corpus_host(&heap);
  size_t length, read = 0, counted = 0, steps = 0, last = 0;
  char *bytes = corpus_cartridge("printers_shop", &length);
  sprout_loading *loading = NULL;
  sprout_refusal why;
  sprout_world *world, *whole;
  bool done = false;
  test_source t;
  sprout_source source = test_source_of(&t, bytes, length, 0);
  CHECK_INT(sprout_load_begin(&host, &source, &loading, &why), SPROUT_OK);
  sprout_load_progress(loading, &read, &counted);
  CHECK_INT(read, 0);
  CHECK(counted > 10000);
  CHECK(sprout_load_finish(loading) == NULL);
  while (!done) {
    CHECK_INT(sprout_load_step(loading, 4096, &done, &why), SPROUT_OK);
    sprout_load_progress(loading, &read, &counted);
    CHECK(read >= last && read - last <= 4096);
    last = read;
    steps++;
  }
  CHECK(steps > 10);
  CHECK(read == counted);
  CHECK_INT(sprout_load_step(loading, 7, &done, &why), SPROUT_OK);
  CHECK(done);
  world = sprout_load_finish(loading);
  CHECK(world != NULL && !sprout_world_peeked(world));
  CHECK_STR(world->header.name, "printers_shop");
  CHECK_INT(sprout_load_explained(&host, bytes, length, &whole, &why), SPROUT_OK);
  CHECK_INT(whole->graph.count, world->graph.count);
  CHECK_INT(whole->word_count, world->word_count);
  sprout_world_free(whole);
  sprout_world_free(world);
  CHECK_INT(heap.pages, 0);
  free(bytes);
}

static void a_load_abandoned_part_way_leaves_nothing(void) {
  test_heap heap;
  sprout_host host = corpus_host(&heap);
  size_t length;
  char *bytes = corpus_cartridge("printers_shop", &length);
  sprout_loading *loading = NULL;
  sprout_refusal why;
  bool done = false;
  test_source t;
  sprout_source source = test_source_of(&t, bytes, length, 0);
  CHECK_INT(sprout_load_begin(&host, &source, &loading, &why), SPROUT_OK);
  CHECK_INT(sprout_load_step(loading, 40, &done, &why), SPROUT_OK);
  CHECK(!done);
  sprout_load_abandon(loading);
  CHECK_INT(heap.pages, 0);
  /* A step that fails has freed the load itself. */
  bytes[length / 2] ^= 0x55;
  source = test_source_of(&t, bytes, length, 0);
  CHECK_INT(sprout_load_begin(&host, &source, &loading, &why), SPROUT_OK);
  CHECK(sprout_load_step(loading, (size_t)-1, &done, &why) == SPROUT_BAD_INPUT);
  CHECK(strncmp(why.text, "This cartridge cannot be read: ", 31) == 0);
  CHECK_INT(heap.pages, 0);
  free(bytes);
}

static void a_peek_reads_the_preamble_and_nothing_else(void) {
  test_heap heap;
  sprout_host host = corpus_host(&heap);
  size_t length, read = 0, counted = 0;
  char *bytes = corpus_cartridge("printers_shop", &length);
  sprout_world *world = NULL;
  sprout_loading *loading = NULL;
  sprout_refusal why;
  long before;
  test_source t, peeked;
  sprout_source source = test_source_of(&t, bytes, length, 0);
  sprout_source peeking = test_source_of(&peeked, bytes, length, 1024);
  CHECK_INT(sprout_peek(&host, &peeking, &world, &why), SPROUT_OK);
  CHECK(world != NULL && sprout_world_peeked(world));
  CHECK(peeked.at < length / 4); /* the preamble is read, and the source no further */
  CHECK_STR(world->header.name, "printers_shop");
  CHECK(world->header.title == NULL); /* its manifest gives none */
  CHECK_INT(strlen(world->header.hash), 64);
  CHECK(world->caps.options_per_enum > 0);
  CHECK_INT(world->graph.count, 0);
  CHECK_INT(world->word_count, 0);
  before = heap.pages;
  CHECK(before < 8);
  sprout_world_free(world);
  CHECK_INT(heap.pages, 0);
  /* The table is never reached: a cartridge whose table is damaged still peeks. */
  CHECK_INT(sprout_load_begin(&host, &source, &loading, &why), SPROUT_OK);
  sprout_load_progress(loading, &read, &counted);
  CHECK(counted > 20000);
  sprout_load_abandon(loading);
  free(bytes);
  bytes = cartridge_with("{" A_HEADER "," ALL_CAPS ",\"extensions\":[]}", (const unsigned char *)"garbage!", 8, &length);
  peeking = test_source_of(&peeked, bytes, length, 0);
  CHECK_INT(sprout_peek(&host, &peeking, &world, &why), SPROUT_OK);
  CHECK(world != NULL && sprout_world_peeked(world));
  CHECK_STR(world->header.name, "late");
  sprout_world_free(world);
  CHECK_INT(heap.pages, 0);
  free(bytes);
  /* A title the manifest gave is read; one that is not text is said so. */
  bytes = corpus_cartridge("titled", &length);
  peeking = test_source_of(&peeked, bytes, length, 1024);
  CHECK_INT(sprout_peek(&host, &peeking, &world, &why), SPROUT_OK);
  CHECK_STR(world->header.title, "Titled: A World Shown by Its Title");
  sprout_world_free(world);
  free(bytes);
  bytes = cartridge_with("{" TITLED_HEADER("\"Late: The Hour\"") "," ALL_CAPS ",\"extensions\":[]}", (const unsigned char *)"garbage!",
                         8, &length);
  peeking = test_source_of(&peeked, bytes, length, 0);
  CHECK_INT(sprout_peek(&host, &peeking, &world, &why), SPROUT_OK);
  CHECK_STR(world->header.title, "Late: The Hour");
  sprout_world_free(world);
  free(bytes);
  bytes = cartridge_with("{" TITLED_HEADER("3") "," ALL_CAPS ",\"extensions\":[]}", (const unsigned char *)"garbage!", 8,
                         &length);
  peeking = test_source_of(&peeked, bytes, length, 0);
  CHECK_INT(sprout_peek(&host, &peeking, &world, &why), SPROUT_BAD_INPUT);
  CHECK_STR(why.text, "This cartridge is not shaped as a cartridge is at `header.title`: it is not what a cartridge holds there.");
  CHECK_INT(heap.pages, 0);
  free(bytes);
  /* A body with no caps is said so. */
  bytes = cartridge_of("{" A_HEADER "}", &length);
  peeking = test_source_of(&peeked, bytes, length, 0);
  CHECK_INT(sprout_peek(&host, &peeking, &world, &why), SPROUT_BAD_INPUT);
  CHECK_STR(why.text, "This cartridge is not shaped as a cartridge is at `caps`: it is not what a cartridge holds there.");
  CHECK_INT(heap.pages, 0);
  free(bytes);
}

static void a_stepping_load_that_runs_out_of_memory_at_any_point_holds_nothing(void) {
  size_t length;
  char *bytes = corpus_cartridge("printers_shop", &length);
  long pages;
  for (pages = 0; pages < 60; pages += 2) {
    test_heap heap;
    sprout_host host = test_host(&heap);
    sprout_loading *loading = NULL;
    sprout_refusal why;
    sprout_status status;
    bool done = false;
    test_source t;
    sprout_source source = test_source_of(&t, bytes, length, 0);
    host.page_bytes = 8192;
    heap.refuse_after = pages;
    status = sprout_load_begin(&host, &source, &loading, &why);
    while (status == SPROUT_OK && !done) status = sprout_load_step(loading, 5000, &done, &why);
    if (status == SPROUT_OK) {
      sprout_world *world = sprout_load_finish(loading);
      CHECK(world != NULL);
      sprout_world_free(world);
    } else {
      CHECK_INT(status, SPROUT_NO_MEMORY);
      CHECK_STR(why.text, sprout_status_text(SPROUT_NO_MEMORY));
    }
    CHECK_INT(heap.pages, 0);
  }
  free(bytes);
}

/* Loads the cartridge from a source giving `piece` bytes a read, stepping `budget` at a time. */
static sprout_world *load_in_pieces(const sprout_host *host, const char *bytes, size_t length, size_t piece,
                                    size_t budget, test_source *t) {
  sprout_source source = test_source_of(t, bytes, length, piece);
  sprout_loading *loading = NULL;
  sprout_refusal why;
  sprout_status status;
  bool done = false;
  status = sprout_load_begin(host, &source, &loading, &why);
  while (status == SPROUT_OK && !done) status = sprout_load_step(loading, budget, &done, &why);
  CHECK_INT(status, SPROUT_OK);
  return status == SPROUT_OK ? sprout_load_finish(loading) : NULL;
}

static void a_load_fed_in_pieces_smaller_than_an_entry_builds_the_world_a_whole_load_does(void) {
  test_heap heap;
  sprout_host host = corpus_host(&heap);
  size_t length, i;
  char *bytes = corpus_cartridge("printers_shop", &length);
  sprout_world *whole = NULL;
  sprout_refusal why;
  static const size_t pieces[] = {1, 7, 100, 4093};
  CHECK_INT(sprout_load_explained(&host, bytes, length, &whole, &why), SPROUT_OK);
  for (i = 0; i < sizeof pieces / sizeof pieces[0]; i++) {
    test_source t;
    sprout_world *world = load_in_pieces(&host, bytes, length, pieces[i], 3000, &t);
    CHECK(world != NULL);
    if (world == NULL) continue;
    /* Every byte was read, no more than a piece at a time. */
    CHECK_INT(t.at, length);
    CHECK(t.reads >= (long)(length / pieces[i]));
    CHECK_INT(world->graph.count, whole->graph.count);
    CHECK_INT(world->word_count, whole->word_count);
    CHECK_STR(world->header.hash, whole->header.hash);
    sprout_world_free(world);
  }
  sprout_world_free(whole);
  CHECK_INT(heap.pages, 0);
  free(bytes);
}

static void a_source_that_fails_part_way_refuses_the_load_in_words_and_holds_nothing(void) {
  test_heap heap;
  sprout_host host = corpus_host(&heap);
  size_t length, i;
  char *bytes = corpus_cartridge("printers_shop", &length);
  long fails[6];
  fails[0] = 0, fails[1] = 9, fails[2] = 20, fails[3] = 300, fails[4] = (long)length / 2, fails[5] = (long)length - 1;
  for (i = 0; i < 6; i++) {
    test_source t;
    sprout_source source = test_source_of(&t, bytes, length, 500);
    sprout_loading *loading = NULL;
    sprout_refusal why;
    sprout_status status;
    bool done = false;
    t.fail_at = fails[i];
    status = sprout_load_begin(&host, &source, &loading, &why);
    while (status == SPROUT_OK && !done) status = sprout_load_step(loading, 4096, &done, &why);
    CHECK_INT(status, SPROUT_BAD_INPUT);
    CHECK_STR(why.text, "This cartridge cannot be read: its file could not be read to the end.");
    CHECK_INT(heap.pages, 0);
  }
  free(bytes);
}

static void a_source_that_ends_early_or_runs_on_is_refused(void) {
  test_heap heap;
  sprout_host host = corpus_host(&heap);
  size_t length;
  char *bytes = corpus_cartridge("printers_shop", &length);
  char *longer = (char *)malloc(length + 3);
  test_source t;
  sprout_source source;
  sprout_loading *loading = NULL;
  sprout_refusal why;
  sprout_status status;
  bool done = false;
  source = test_source_of(&t, bytes, length - 5, 64);
  status = sprout_load_begin(&host, &source, &loading, &why);
  while (status == SPROUT_OK && !done) status = sprout_load_step(loading, 4096, &done, &why);
  CHECK_INT(status, SPROUT_BAD_INPUT);
  CHECK_STR(why.text, "This cartridge cannot be read: the compressed data ends early.");
  /* Bytes between the body's end and where the header says the assets begin. */
  memcpy(longer, bytes, length);
  memcpy(longer + length, "abc", 3);
  longer[16] = (char)(length + 3), longer[17] = (char)((length + 3) >> 8), longer[18] = (char)((length + 3) >> 16),
  longer[19] = (char)((length + 3) >> 24);
  done = false;
  source = test_source_of(&t, longer, length + 3, 64);
  status = sprout_load_begin(&host, &source, &loading, &why);
  while (status == SPROUT_OK && !done) status = sprout_load_step(loading, 4096, &done, &why);
  CHECK_INT(status, SPROUT_BAD_INPUT);
  CHECK_STR(why.text, "This cartridge cannot be read: the compressed data goes on past its end.");
  /* Too short to hold a header at all. */
  source = test_source_of(&t, bytes, 9, 64);
  CHECK_INT(sprout_load_begin(&host, &source, &loading, &why), SPROUT_BAD_INPUT);
  CHECK(strncmp(why.text, "This is not a Sprout cartridge", 30) == 0);
  CHECK_INT(heap.pages, 0);
  free(longer);
  free(bytes);
}

static void a_cartridge_carrying_assets_loads_its_body_and_reads_no_further(void) {
  test_heap heap;
  sprout_host host = corpus_host(&heap);
  size_t length;
  char *bytes = corpus_cartridge("media-room", &length);
  sprout_world *world = NULL;
  sprout_loading *loading = NULL;
  sprout_refusal why;
  sprout_status status;
  bool done = false;
  test_source t;
  sprout_source source = test_source_of(&t, bytes, length, 100);
  size_t assets_at = (unsigned char)bytes[16] | ((size_t)(unsigned char)bytes[17] << 8) |
                     ((size_t)(unsigned char)bytes[18] << 16) | ((size_t)(unsigned char)bytes[19] << 24);
  CHECK(assets_at < length);
  CHECK_INT(sprout_load_explained(&host, bytes, length, &world, &why), SPROUT_OK);
  CHECK_STR(world->header.name, "media_room");
  sprout_world_free(world);
  status = sprout_load_begin(&host, &source, &loading, &why);
  while (status == SPROUT_OK && !done) status = sprout_load_step(loading, 4096, &done, &why);
  CHECK_INT(status, SPROUT_OK);
  CHECK(t.at <= assets_at); /* the assets are never read by a load */
  world = sprout_load_finish(loading);
  CHECK_STR(world->header.name, "media_room");
  sprout_world_free(world);
  CHECK_INT(heap.pages, 0);
  free(bytes);
}

int main(void) {
  RUN(a_cartridge_carrying_assets_loads_its_body_and_reads_no_further);
  RUN(a_load_fed_in_pieces_smaller_than_an_entry_builds_the_world_a_whole_load_does);
  RUN(a_source_that_fails_part_way_refuses_the_load_in_words_and_holds_nothing);
  RUN(a_source_that_ends_early_or_runs_on_is_refused);
  RUN(a_load_steps_across_calls_by_bytes_and_tells_its_progress);
  RUN(a_stepping_load_that_runs_out_of_memory_at_any_point_holds_nothing);
  RUN(a_load_abandoned_part_way_leaves_nothing);
  RUN(a_peek_reads_the_preamble_and_nothing_else);
  RUN(a_newer_format_or_level_is_refused_naming_the_number);
  RUN(a_file_that_is_not_a_cartridge_is_refused);
  RUN(a_damaged_body_is_refused_in_words);
  RUN(a_load_that_runs_out_of_memory_says_so_and_holds_nothing);
  RUN(a_host_without_memory_is_a_bad_host);
  RUN(a_loaded_world_keeps_the_header_the_cartridge_recorded);
  return REPORT();
}
