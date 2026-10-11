/*
 * Tests for src/stream.c: a body's JSON text is walked member by member over
 * the inflater, a value captured whole for the reader however the inflater's
 * pieces fall, and a text that ends or breaks mid-way is refused in words.
 */
#include "stream.h"
#include "check.h"
#include "json.h"

/* `text` as one gzip member of stored blocks, each at most 65535 bytes, malloc'd. */
static unsigned char *stored_gzip(const char *text, size_t n, size_t *length) {
  size_t blocks = n / 65535 + 1, at = 10, i, done = 0;
  unsigned char *out = (unsigned char *)malloc(10 + blocks * 5 + n + 8);
  uint32_t crc = sprout_crc32(0, (const unsigned char *)text, n);
  static const unsigned char gz[10] = {0x1f, 0x8b, 8, 0, 0, 0, 0, 0, 0, 3};
  memcpy(out, gz, 10);
  for (i = 0; i < blocks; i++) {
    size_t len = n - done < 65535 ? n - done : 65535;
    out[at++] = i + 1 == blocks ? 1 : 0;
    out[at++] = (unsigned char)(len & 255);
    out[at++] = (unsigned char)(len >> 8);
    out[at++] = (unsigned char)(~len & 255);
    out[at++] = (unsigned char)((~len >> 8) & 255);
    memcpy(out + at, text + done, len);
    at += len;
    done += len;
  }
  out[at++] = (unsigned char)crc;
  out[at++] = (unsigned char)(crc >> 8);
  out[at++] = (unsigned char)(crc >> 16);
  out[at++] = (unsigned char)(crc >> 24);
  out[at++] = (unsigned char)n;
  out[at++] = (unsigned char)(n >> 8);
  out[at++] = (unsigned char)(n >> 16);
  out[at++] = (unsigned char)(n >> 24);
  *length = at;
  return out;
}

static void a_body_is_walked_member_by_member_and_each_value_captured_whole(void) {
  test_heap heap;
  sprout_host host = test_host(&heap);
  sprout_arena scratch;
  sprout_stream stream;
  size_t length, n;
  const char *text = " {\"a\" : [1, {\"b\":\"x]\\\"\"}], \"c\":\"s\\\\\", \"d\":true,\"e\":-7 } ";
  unsigned char *gz = stored_gzip(text, strlen(text), &length);
  char key[16], *value;
  sprout_json *tree;
  sprout_json_error e;
  sprout_arena_init(&scratch, &host);
  CHECK_INT(sprout_stream_begin(&stream, &scratch, gz, length), SPROUT_OK);
  CHECK(sprout_stream_take(&stream, '{'));
  CHECK_INT(sprout_stream_key(&stream, key, sizeof key), SPROUT_OK);
  CHECK_STR(key, "a");
  CHECK(sprout_stream_take(&stream, ':'));
  CHECK_INT(sprout_stream_capture(&stream, &scratch, &value, &n), SPROUT_OK);
  CHECK_STR(value, "[1, {\"b\":\"x]\\\"\"}]");
  CHECK_INT(n, strlen(value));
  CHECK_INT(sprout_json_read(&scratch, value, n, &tree, &e), SPROUT_OK);
  CHECK_INT(tree->count, 2);
  CHECK(sprout_stream_take(&stream, ','));
  CHECK_INT(sprout_stream_key(&stream, key, sizeof key), SPROUT_OK);
  CHECK_STR(key, "c");
  CHECK(sprout_stream_take(&stream, ':'));
  CHECK_INT(sprout_stream_capture(&stream, &scratch, &value, &n), SPROUT_OK);
  CHECK_STR(value, "\"s\\\\\"");
  CHECK(sprout_stream_take(&stream, ','));
  CHECK_INT(sprout_stream_key(&stream, key, sizeof key), SPROUT_OK);
  CHECK_STR(key, "d");
  CHECK(sprout_stream_take(&stream, ':'));
  CHECK_INT(sprout_stream_capture(&stream, &scratch, &value, &n), SPROUT_OK);
  CHECK_STR(value, "true");
  CHECK(sprout_stream_take(&stream, ','));
  CHECK_INT(sprout_stream_key(&stream, key, sizeof key), SPROUT_OK);
  CHECK(sprout_stream_take(&stream, ':'));
  CHECK_INT(sprout_stream_capture(&stream, &scratch, &value, &n), SPROUT_OK);
  CHECK_STR(value, "-7");
  CHECK(!sprout_stream_take(&stream, ','));
  CHECK(sprout_stream_take(&stream, '}'));
  CHECK(sprout_stream_ended(&stream));
  CHECK_INT(sprout_stream_peek(&stream), -1);
  sprout_arena_reset(&scratch);
  free(gz);
  CHECK_INT(heap.pages, 0);
}

static void a_value_longer_than_the_buffer_is_captured_across_the_inflaters_pieces(void) {
  test_heap heap;
  sprout_host host = test_host(&heap);
  sprout_arena scratch;
  sprout_stream stream;
  size_t n = 3 * SPROUT_STREAM_BUFFER + 17, length, got, i;
  char *text = (char *)malloc(n + 32);
  char *value;
  unsigned char *gz;
  char key[8];
  memcpy(text, "{\"big\":\"", 8);
  for (i = 0; i < n; i++) text[8 + i] = (char)('a' + i % 26);
  memcpy(text + 8 + n, "\",\"n\":1}", 9);
  gz = stored_gzip(text, strlen(text), &length);
  sprout_arena_init(&scratch, &host);
  CHECK_INT(sprout_stream_begin(&stream, &scratch, gz, length), SPROUT_OK);
  CHECK(sprout_stream_take(&stream, '{'));
  CHECK_INT(sprout_stream_key(&stream, key, sizeof key), SPROUT_OK);
  CHECK(sprout_stream_take(&stream, ':'));
  CHECK_INT(sprout_stream_capture(&stream, &scratch, &value, &got), SPROUT_OK);
  CHECK_INT(got, n + 2);
  CHECK(value[0] == '"' && value[n + 1] == '"' && memcmp(value + 1, text + 8, n) == 0);
  CHECK(sprout_stream_take(&stream, ','));
  CHECK_INT(sprout_stream_key(&stream, key, sizeof key), SPROUT_OK);
  CHECK_STR(key, "n");
  sprout_arena_reset(&scratch);
  free(gz);
  free(text);
  CHECK_INT(heap.pages, 0);
}

static void refused(const char *text, const char *walk, const char *why) {
  test_heap heap;
  sprout_host host = test_host(&heap);
  sprout_arena scratch;
  sprout_stream stream;
  size_t length, n;
  unsigned char *gz = stored_gzip(text, strlen(text), &length);
  char key[8], *value;
  sprout_status status = SPROUT_OK;
  sprout_arena_init(&scratch, &host);
  CHECK_INT(sprout_stream_begin(&stream, &scratch, gz, length), SPROUT_OK);
  for (; *walk != '\0' && status == SPROUT_OK; walk++) {
    if (*walk == 'k') status = sprout_stream_key(&stream, key, sizeof key);
    else if (*walk == 'v') status = sprout_stream_capture(&stream, &scratch, &value, &n);
    else CHECK(sprout_stream_take(&stream, *walk));
  }
  CHECK_INT(status, SPROUT_BAD_INPUT);
  CHECK_STR(stream.why, why);
  sprout_arena_reset(&scratch);
  free(gz);
  CHECK_INT(heap.pages, 0);
}

static void a_text_that_ends_or_breaks_is_refused_in_words(void) {
  refused("{\"a\":\"unclosed", "{k:v", "the text ends inside a string");
  refused("{\"a\":[1,2", "{k:v", "the text ends inside an object or array");
  refused("{\"a\":", "{k:v", "the text ends where a value was expected");
  refused("{\"a\":}", "{k:v", "a value was expected here");
  refused("{a:1}", "{k", "an object's member starts with its name in quotes");
  refused("{\"abcdefghijklmnop\":1}", "{k", "a member's name is longer than a cartridge's are");
  refused("{\"ab", "{k", "the text ends inside a name");
}

static void a_damaged_member_is_the_inflaters_refusal(void) {
  test_heap heap;
  sprout_host host = test_host(&heap);
  sprout_arena scratch;
  sprout_stream stream;
  size_t length, n;
  const char *text = "{\"a\":1}";
  unsigned char *gz = stored_gzip(text, strlen(text), &length);
  char *value;
  /* A flipped checksum byte: the member inflates whole into the first buffer, so the first read sees it. */
  gz[length - 5] ^= 1;
  sprout_arena_init(&scratch, &host);
  CHECK_INT(sprout_stream_begin(&stream, &scratch, gz, length), SPROUT_OK);
  CHECK(!sprout_stream_take(&stream, '{'));
  CHECK_INT(sprout_stream_peek(&stream), -2);
  CHECK_INT(sprout_stream_capture(&stream, &scratch, &value, &n), SPROUT_BAD_INPUT);
  CHECK_STR(stream.why, "the compressed data does not match its checksum");
  gz[length - 5] ^= 1;
  gz[2] = 9;
  CHECK_INT(sprout_stream_begin(&stream, &scratch, gz, length), SPROUT_BAD_INPUT);
  CHECK_STR(stream.why, "the data is gzip with a method other than deflate");
  sprout_arena_reset(&scratch);
  free(gz);
  CHECK_INT(heap.pages, 0);
}

int main(void) {
  RUN(a_body_is_walked_member_by_member_and_each_value_captured_whole);
  RUN(a_value_longer_than_the_buffer_is_captured_across_the_inflaters_pieces);
  RUN(a_text_that_ends_or_breaks_is_refused_in_words);
  RUN(a_damaged_member_is_the_inflaters_refusal);
  return REPORT();
}
