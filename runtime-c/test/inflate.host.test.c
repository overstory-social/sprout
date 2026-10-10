/* Tests for host/inflate.c: a dynamic-block gzip from zlib reads back to the golden, and damage is refused in words. */
#include "inflate.h"
#include "check.h"

static unsigned char *golden_gz(size_t *length) {
  return (unsigned char *)test_golden("stored-canon.json.gz", length);
}

static void a_dynamic_block_gzip_reads_back_to_the_golden_byte_for_byte(void) {
  size_t gz_length, json_length, out_length;
  unsigned char *gz = golden_gz(&gz_length);
  char *json = test_golden("stored-canon.json", &json_length);
  char *out = NULL;
  CHECK(sproutc_gunzip(gz, gz_length, &out, &out_length) == NULL);
  CHECK_INT(out_length, json_length);
  CHECK(out != NULL && memcmp(out, json, json_length) == 0);
  free(out);
  free(gz);
  free(json);
}

static void a_flipped_byte_is_refused_by_the_checksum_or_the_stream(void) {
  size_t gz_length, out_length;
  unsigned char *gz = golden_gz(&gz_length);
  char *out = NULL;
  gz[gz_length / 2] ^= 0x55;
  CHECK(sproutc_gunzip(gz, gz_length, &out, &out_length) != NULL);
  CHECK(out == NULL);
  free(gz);
}

static void a_truncated_file_and_a_non_gzip_file_are_refused_in_words(void) {
  size_t gz_length, out_length;
  unsigned char *gz = golden_gz(&gz_length);
  char *out = NULL;
  const char *why = sproutc_gunzip(gz, gz_length / 2, &out, &out_length);
  CHECK(why != NULL);
  why = sproutc_gunzip((const unsigned char *)"plain text, not gzip at all", 27, &out, &out_length);
  CHECK(why != NULL && strstr(why, "not gzip") != NULL);
  free(gz);
}

static void the_crc_is_the_one_gzip_writes(void) {
  CHECK(sproutc_crc32((const unsigned char *)"123456789", 9) == 0xcbf43926UL);
}

int main(void) {
  RUN(a_dynamic_block_gzip_reads_back_to_the_golden_byte_for_byte);
  RUN(a_flipped_byte_is_refused_by_the_checksum_or_the_stream);
  RUN(a_truncated_file_and_a_non_gzip_file_are_refused_in_words);
  RUN(the_crc_is_the_one_gzip_writes);
  return REPORT();
}
