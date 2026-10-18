/* shipping.c: the signature check and the file digest the download screen asks for. */
#include <stdlib.h>

#include "seeds.h"
#include "shipping.h"
#include "support.h"

#define SIGNATURE_2                                                                                                  \
  "92a009a9f0d4cab8720e820b5f642540a2b27b5416503f8fb3762223ebdb69da085ac1e43e15996e458f3613d0f11d8c387b2eaeb4302aee" \
  "b00d291612bb0c00"
#define KEY_2 "3d4017c3e843895a92b70aa74d1b7ebc9c982ccf2ec4968cc0cd55f12af4660c"

/* The text of a fixture file, without its trailing newline. */
static char *fixture(const char *name, char *out, size_t size) {
  char path[600];
  FILE *file;
  size_t got;
  snprintf(path, sizeof path, "%s/%s", PLAYER_FIXTURES, name);
  file = fopen(path, "rb");
  CHECK(file != NULL, "the fixture %s", path);
  if (file == NULL) {
    out[0] = '\0';
    return out;
  }
  got = fread(out, 1, size - 1, file);
  fclose(file);
  while (got > 0 && out[got - 1] == '\n') got--;
  out[got] = '\0';
  return out;
}

static void the_signature_node_made_over_an_index_verifies_here(void) {
  static char canonical[4096], signature[200], key[100], tampered[4096];
  const char *why;
  begin("fixture");
  fixture("index.canonical.txt", canonical, sizeof canonical);
  fixture("index.signature.txt", signature, sizeof signature);
  snprintf(key, sizeof key, "%s", "");
  {
    char path[600];
    FILE *file;
    snprintf(path, sizeof path, "%s/../index-test.pub", PLAYER_FIXTURES);
    file = fopen(path, "rb");
    CHECK(file != NULL, "the test public key");
    if (file != NULL) {
      size_t got = fread(key, 1, sizeof key - 1, file);
      fclose(file);
      while (got > 0 && key[got - 1] == '\n') got--;
      key[got] = '\0';
    }
  }
  why = player_verify(canonical, signature, key);
  CHECK(why == NULL, "the signed index text: %s", why);
  snprintf(tampered, sizeof tampered, "%s", canonical);
  tampered[strlen("[{\"author\":\"Ada \\\\ Bo\",\"bytes\":2")] = '7';
  CHECK(player_verify(tampered, signature, key) != NULL, "one digit of a size changed");
  end();
}

static void the_published_signature_is_accepted_and_a_changed_text_is_refused(void) {
  const char *why;
  begin("verify");
  /* RFC 8032 section 7.1, test 2: the message is the single byte 0x72, the letter r. */
  why = player_verify("r", SIGNATURE_2, KEY_2);
  CHECK(why == NULL, "%s", why);
  why = player_verify("s", SIGNATURE_2, KEY_2);
  CHECK(why != NULL && strcmp(why, "The signature is not the one the key makes for this text.") == 0, "%s", why);
  CHECK(player_verify("", SIGNATURE_2, KEY_2) != NULL, "an empty text");
  end();
}

static void a_signature_or_key_that_is_not_hexadecimal_of_the_right_length_is_refused_in_words(void) {
  const char *why;
  char not_hex[sizeof SIGNATURE_2];
  begin("hex");
  why = player_verify("r", "92a0", KEY_2);
  CHECK(why != NULL && HAS(why, "128 hexadecimal digits"), "%s", why);
  why = player_verify("r", SIGNATURE_2, "3d40");
  CHECK(why != NULL && HAS(why, "64 hexadecimal digits"), "%s", why);
  memcpy(not_hex, SIGNATURE_2, sizeof SIGNATURE_2);
  not_hex[0] = 'z';
  why = player_verify("r", not_hex, KEY_2);
  CHECK(why != NULL && HAS(why, "128 hexadecimal digits"), "%s", why);
  CHECK(player_verify("", "", "") != NULL, "nothing at all");
  end();
}

static void a_file_in_the_data_folder_has_its_sha256_and_size_told(void) {
  char sha256[65];
  size_t bytes = 99;
  const char *why;
  begin("digest");
  write_text("abc.txt", "abc");
  why = player_digest(&fake->api, "abc.txt", sha256, &bytes);
  CHECK(why == NULL && strcmp(sha256, "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad") == 0 && bytes == 3,
        "%s %zu", sha256, bytes);
  write_text("empty.txt", "");
  why = player_digest(&fake->api, "empty.txt", sha256, &bytes);
  CHECK(why == NULL && strcmp(sha256, "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855") == 0 && bytes == 0,
        "%s %zu", sha256, bytes);
  why = player_digest(&fake->api, "absent.txt", sha256, &bytes);
  CHECK(why != NULL && strcmp(why, "The file cannot be read.") == 0, "%s", why);
  end();
}

static void a_file_far_larger_than_memory_allows_is_digested_a_chunk_at_a_time(void) {
  enum { SIZE = 4 * 1024 * 1024 + 123 };
  char full[1000], expected[65], sha256[65];
  size_t length = 0;
  unsigned char digest[32];
  char *bytes = (char *)malloc(SIZE);
  FILE *file;
  size_t i;
  begin("large");
  for (i = 0; i < SIZE; i++) bytes[i] = (char)((i * 31 + (i >> 8)) & 255);
  snprintf(full, sizeof full, "%s/large.bin", fake->data);
  file = fopen(full, "wb");
  CHECK(file != NULL && fwrite(bytes, 1, SIZE, file) == SIZE, "writing the large file");
  if (file != NULL) fclose(file);
  sprout_sha256(bytes, SIZE, digest);
  for (i = 0; i < 32; i++) snprintf(expected + 2 * i, 3, "%02x", digest[i]);
  free(bytes);
  fake->largest = 0;
  CHECK(player_digest(&fake->api, "large.bin", sha256, &length) == NULL && strcmp(sha256, expected) == 0 && length == 4194427,
        "%s %zu", sha256, length);
  CHECK(fake->largest < 256 * 1024, "the largest block asked for was %zu bytes, not the file's", fake->largest);
  end();
}

static void a_cartridge_in_the_app_folder_is_digested_too(void) {
  char sha256[65];
  size_t bytes = 0;
  begin("app");
  CHECK(player_digest(&fake->api, "chip-tree.sproutworld", sha256, &bytes) == NULL && strlen(sha256) == 64 && bytes > 0,
        "%s", sha256);
  end();
}

int main(void) {
  test_program("shipping");
  the_published_signature_is_accepted_and_a_changed_text_is_refused();
  the_signature_node_made_over_an_index_verifies_here();
  a_signature_or_key_that_is_not_hexadecimal_of_the_right_length_is_refused_in_words();
  a_file_in_the_data_folder_has_its_sha256_and_size_told();
  a_file_far_larger_than_memory_allows_is_digested_a_chunk_at_a_time();
  a_cartridge_in_the_app_folder_is_digested_too();
  return finish();
}
