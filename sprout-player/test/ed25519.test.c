/* ed25519.c: SHA-512 and signature verification against RFC 8032 section 7.1. */
#include <stdlib.h>

#include "ed25519.h"
#include "support.h"

static int hex_digit(char c) { return c <= '9' ? c - '0' : c - 'a' + 10; }

/* Decodes `text` (an even count of lowercase digits) into `out`; the byte count. */
static size_t unhex(const char *text, unsigned char *out) {
  size_t n = strlen(text) / 2, i;
  for (i = 0; i < n; i++) out[i] = (unsigned char)(hex_digit(text[2 * i]) * 16 + hex_digit(text[2 * i + 1]));
  return n;
}

typedef struct vector {
  const char *key, *message, *signature;
} vector;

/* RFC 8032 section 7.1, tests 1 to 3. */
static const vector VECTORS[] = {
    {"d75a980182b10ab7d54bfed3c964073a0ee172f3daa62325af021a68f707511a", "",
     "e5564300c360ac729086e2cc806e828a84877f1eb8e5d974d873e065224901555fb8821590a33bacc61e39701cf9b46bd25bf5f0595bbe24"
     "655141438e7a100b"},
    {"3d4017c3e843895a92b70aa74d1b7ebc9c982ccf2ec4968cc0cd55f12af4660c", "72",
     "92a009a9f0d4cab8720e820b5f642540a2b27b5416503f8fb3762223ebdb69da085ac1e43e15996e458f3613d0f11d8c387b2eaeb4302aee"
     "b00d291612bb0c00"},
    {"fc51cd8e6218a1a38da47ed00230f0580816ed13ba3303ac5deb911548908025", "af82",
     "6291d657deec24024827e69c3abe01a30ce548a284743a445e3680d7db5ac3ac18ff9b538d16f290ae67f760984dc6594a7c15e9716ed28d"
     "c027beceea1ec40a"},
};

static void sha512_of_abc_is_the_published_digest(void) {
  unsigned char digest[64], expected[64];
  unhex("ddaf35a193617abacc417349ae20413112e6fa4e89a97ea20a9eeee64b55d39a2192992a274fc1a836ba3c23a3feebbd454d4423643ce80e2a9ac94fa54ca49f",
        expected);
  player_sha512((const unsigned char *)"abc", 3, digest);
  CHECK(memcmp(digest, expected, 64) == 0, "SHA-512 of abc");
}

static void each_published_signature_verifies(void) {
  size_t i;
  for (i = 0; i < sizeof VECTORS / sizeof *VECTORS; i++) {
    unsigned char key[32], message[8], signature[64];
    size_t length;
    unhex(VECTORS[i].key, key);
    length = unhex(VECTORS[i].message, message);
    unhex(VECTORS[i].signature, signature);
    CHECK(player_ed25519_verify(signature, message, length, key), "vector %zu verifies", i + 1);
  }
}

static void a_message_longer_than_a_hash_block_verifies(void) {
  unsigned char key[32], signature[64], message[1000];
  size_t i;
  unhex("3d4017c3e843895a92b70aa74d1b7ebc9c982ccf2ec4968cc0cd55f12af4660c", key);
  unhex("886a68bd48048abb1e43cb1c509cb12f6d4babff5da6476466b8507cd6fc1023602b08ab523ed9f81a59c9844df1f92d36d9db311be04dc634a9a4c2b56fe308",
        signature);
  for (i = 0; i < sizeof message; i++) message[i] = (unsigned char)((i * 7 + 3) & 255);
  CHECK(player_ed25519_verify(signature, message, sizeof message, key), "a 1000 byte message");
  message[999] ^= 1;
  CHECK(!player_ed25519_verify(signature, message, sizeof message, key), "its last bit changed");
}

static void any_change_to_the_message_signature_or_key_is_refused(void) {
  unsigned char key[32], other[32], message[2], signature[64], altered[64];
  size_t length, bit;
  unhex(VECTORS[2].key, key);
  unhex(VECTORS[1].key, other);
  length = unhex(VECTORS[2].message, message);
  unhex(VECTORS[2].signature, signature);
  CHECK(player_ed25519_verify(signature, message, length, key), "the original");
  CHECK(!player_ed25519_verify(signature, message, length, other), "another key");
  CHECK(!player_ed25519_verify(signature, message, length - 1, key), "a shorter message");
  for (bit = 0; bit < 16; bit++) {
    unsigned char changed[2];
    memcpy(changed, message, 2);
    changed[bit / 8] ^= (unsigned char)(1u << (bit % 8));
    CHECK(!player_ed25519_verify(signature, changed, length, key), "message bit %zu", bit);
  }
  for (bit = 0; bit < 512; bit += 7) {
    memcpy(altered, signature, 64);
    altered[bit / 8] ^= (unsigned char)(1u << (bit % 8));
    CHECK(!player_ed25519_verify(altered, message, length, key), "signature bit %zu", bit);
  }
}

static void a_signature_whose_s_is_not_below_the_group_order_is_refused(void) {
  /* S + L names the same point, so only the range check refuses it. */
  static const unsigned char L[32] = {0xed, 0xd3, 0xf5, 0x5c, 0x1a, 0x63, 0x12, 0x58, 0xd6, 0x9c, 0xf7,
                                      0xa2, 0xde, 0xf9, 0xde, 0x14, 0,    0,    0,    0,    0,    0,
                                      0,    0,    0,    0,    0,    0,    0,    0,    0,    0x10};
  unsigned char key[32], message[1], signature[64];
  unsigned carry = 0;
  size_t length, i;
  unhex(VECTORS[1].key, key);
  length = unhex(VECTORS[1].message, message);
  unhex(VECTORS[1].signature, signature);
  for (i = 0; i < 32; i++) {
    unsigned sum = signature[32 + i] + L[i] + carry;
    signature[32 + i] = (unsigned char)(sum & 255);
    carry = sum >> 8;
  }
  CHECK(carry == 0, "S plus L still fits in 32 bytes");
  CHECK(!player_ed25519_verify(signature, message, length, key), "S plus L");
}

static void a_key_that_is_not_a_point_is_refused(void) {
  unsigned char key[32], message[1], signature[64];
  size_t length;
  unhex(VECTORS[1].key, key);
  length = unhex(VECTORS[1].message, message);
  unhex(VECTORS[1].signature, signature);
  memset(key, 0xff, sizeof key);
  key[31] = 0x7f;
  CHECK(!player_ed25519_verify(signature, message, length, key), "a y that is not on the curve or not canonical");
  memset(key, 2, sizeof key);
  CHECK(!player_ed25519_verify(signature, message, length, key), "another that is not a point");
}

int main(void) {
  test_program("ed25519");
  sha512_of_abc_is_the_published_digest();
  each_published_signature_verifies();
  a_message_longer_than_a_hash_block_verifies();
  any_change_to_the_message_signature_or_key_is_refused();
  a_signature_whose_s_is_not_below_the_group_order_is_refused();
  a_key_that_is_not_a_point_is_refused();
  return finish();
}
