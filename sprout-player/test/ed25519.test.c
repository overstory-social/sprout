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

/* RFC 8032 section 7.1, TEST 1 to TEST 3. */
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

/* RFC 8032 section 7.1, TEST 1024 (a 1023 byte message) and TEST SHA(abc) (the 64 byte SHA-512 of
   "abc" as the message). */
static const char *const LONG_KEY = "278117fc144c72340f67d0f2316e8386ceffbf2b2428c9c51fef7c597f1d426e";
static const char *const LONG_MESSAGE =
     "08b8b2b733424243760fe426a4b54908632110a66c2f6591eabd3345e3e4eb98fa6e264bf09efe12ee50f8f54e9f77b1e355"
     "f6c50544e23fb1433ddf73be84d879de7c0046dc4996d9e773f4bc9efe5738829adb26c81b37c93a1b270b20329d658675fc"
     "6ea534e0810a4432826bf58c941efb65d57a338bbd2e26640f89ffbc1a858efcb8550ee3a5e1998bd177e93a7363c344fe6b"
     "199ee5d02e82d522c4feba15452f80288a821a579116ec6dad2b3b310da903401aa62100ab5d1a36553e06203b33890cc9b8"
     "32f79ef80560ccb9a39ce767967ed628c6ad573cb116dbefefd75499da96bd68a8a97b928a8bbc103b6621fcde2beca1231d"
     "206be6cd9ec7aff6f6c94fcd7204ed3455c68c83f4a41da4af2b74ef5c53f1d8ac70bdcb7ed185ce81bd84359d44254d9562"
     "9e9855a94a7c1958d1f8ada5d0532ed8a5aa3fb2d17ba70eb6248e594e1a2297acbbb39d502f1a8c6eb6f1ce22b3de1a1f40"
     "cc24554119a831a9aad6079cad88425de6bde1a9187ebb6092cf67bf2b13fd65f27088d78b7e883c8759d2c4f5c65adb7553"
     "878ad575f9fad878e80a0c9ba63bcbcc2732e69485bbc9c90bfbd62481d9089beccf80cfe2df16a2cf65bd92dd597b0707e0"
     "917af48bbb75fed413d238f5555a7a569d80c3414a8d0859dc65a46128bab27af87a71314f318c782b23ebfe808b82b0ce26"
     "401d2e22f04d83d1255dc51addd3b75a2b1ae0784504df543af8969be3ea7082ff7fc9888c144da2af58429ec96031dbcad3"
     "dad9af0dcbaaaf268cb8fcffead94f3c7ca495e056a9b47acdb751fb73e666c6c655ade8297297d07ad1ba5e43f1bca32301"
     "651339e22904cc8c42f58c30c04aafdb038dda0847dd988dcda6f3bfd15c4b4c4525004aa06eeff8ca61783aacec57fb3d1f"
     "92b0fe2fd1a85f6724517b65e614ad6808d6f6ee34dff7310fdc82aebfd904b01e1dc54b2927094b2db68d6f903b68401ade"
     "bf5a7e08d78ff4ef5d63653a65040cf9bfd4aca7984a74d37145986780fc0b16ac451649de6188a7dbdf191f64b5fc5e2ab4"
     "7b57f7f7276cd419c17a3ca8e1b939ae49e488acba6b965610b5480109c8b17b80e1b7b750dfc7598d5d5011fd2dcc5600a3"
     "2ef5b52a1ecc820e308aa342721aac0943bf6686b64b2579376504ccc493d97e6aed3fb0f9cd71a43dd497f01f17c0e2cb37"
     "97aa2a2f256656168e6c496afc5fb93246f6b1116398a346f1a641f3b041e989f7914f90cc2c7fff357876e506b50d334ba7"
     "7c225bc307ba537152f3f1610e4eafe595f6d9d90d11faa933a15ef1369546868a7f3a45a96768d40fd9d03412c091c6315c"
     "f4fde7cb68606937380db2eaaa707b4c4185c32eddcdd306705e4dc1ffc872eeee475a64dfac86aba41c0618983f8741c5ef"
     "68d3a101e8a3b8cac60c905c15fc910840b94c00a0b9d0";
static const char *const LONG_SIGNATURE =
     "0aab4c900501b3e24d7cdf4663326a3a87df5e4843b2cbdb67cbf6e460fec350aa5371b1508f9f4528ecea23c436d94b5e8f"
     "cd4f681e30a6ac00a9704a188a03";
static const char *const SHA_KEY = "ec172b93ad5e563bf4932c70e1245034c35467ef2efd4d64ebf819683467e2bf";
static const char *const SHA_MESSAGE =
     "ddaf35a193617abacc417349ae20413112e6fa4e89a97ea20a9eeee64b55d39a2192992a274fc1a836ba3c23a3feebbd454d"
     "4423643ce80e2a9ac94fa54ca49f";
static const char *const SHA_SIGNATURE =
     "dc2a4459e7369633a52b1bf277839a00201009a3efbf3ecb69bea2186c26b58909351fc9ac90b3ecfdfbc7c66431e0303dca"
     "179c138ac17ad9bef1177331a704";

static void the_last_two_published_vectors_verify(void) {
  static unsigned char message[1024];
  unsigned char key[32], signature[64];
  size_t length;
  unhex(LONG_KEY, key);
  length = unhex(LONG_MESSAGE, message);
  unhex(LONG_SIGNATURE, signature);
  CHECK(length == 1023, "TEST 1024 has a 1023 byte message");
  CHECK(player_ed25519_verify(signature, message, length, key), "TEST 1024 verifies");
  unhex(SHA_KEY, key);
  length = unhex(SHA_MESSAGE, message);
  unhex(SHA_SIGNATURE, signature);
  CHECK(length == 64, "TEST SHA(abc) has a 64 byte message");
  CHECK(player_ed25519_verify(signature, message, length, key), "TEST SHA(abc) verifies");
}

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

/* The signature is Node's crypto.sign over the message below with the secret key of RFC 8032 section
   7.1 TEST 2 (4ccd089b28ff96da9db6c346ec114e0f5b8a319f35aba624da8cf6ed4fb8a6fb), whose public key is
   the one used; it is not a published vector, only a message past one SHA-512 block. */
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

static void a_key_or_r_that_is_not_strict_is_refused(void) {
  /* With R the identity and S zero, the equation holds for any message under a key of small order,
     so only strict verification refuses these. */
  static const char *const SMALL_ORDER[] = {
      "0100000000000000000000000000000000000000000000000000000000000000",
      "ecffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff7f",
      "0000000000000000000000000000000000000000000000000000000000000000",
      "26e8958fc2b227b045c3f489f2ef98f0d5dfac05d3c63339b13802886d53fc05",
      "c7176a703d4dd84fba3c0b760d10670f2a2053fa2c39ccc64ec7fd7792ac037a",
  };
  unsigned char key[32], signature[64], message[1];
  size_t i;
  memset(signature, 0, sizeof signature);
  signature[0] = 1;
  message[0] = 0x72;
  unhex(SMALL_ORDER[0], key);
  CHECK(!player_ed25519_verify(signature, message, 1, key), "identity key, identity R");
  for (i = 0; i < sizeof SMALL_ORDER / sizeof *SMALL_ORDER; i++) {
    unhex(SMALL_ORDER[i], key);
    CHECK(!player_ed25519_verify(signature, message, 1, key), "small-order key %zu", i);
  }
  /* A real key and message with R of small order. */
  unhex(VECTORS[1].key, key);
  unhex(VECTORS[1].signature, signature);
  unhex(SMALL_ORDER[1], signature);
  CHECK(!player_ed25519_verify(signature, message, 1, key), "small-order R");
}

static void a_non_canonical_encoding_is_refused(void) {
  unsigned char key[32], signature[64], message[1];
  memset(signature, 0, sizeof signature);
  message[0] = 0x72;
  /* y = p + 1 names the identity a second way. */
  unhex("eeffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff7f", key);
  signature[0] = 1;
  CHECK(!player_ed25519_verify(signature, message, 1, key), "y = p + 1 as the key");
  /* x = 0 with its sign bit set is no canonical encoding. */
  unhex("0100000000000000000000000000000000000000000000000000000000000080", key);
  CHECK(!player_ed25519_verify(signature, message, 1, key), "x = 0 with the sign bit set");
  /* The same two as R under a real key. */
  unhex(VECTORS[1].key, key);
  unhex("eeffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff7f", signature);
  CHECK(!player_ed25519_verify(signature, message, 1, key), "y = p + 1 as R");
}

int main(void) {
  test_program("ed25519");
  sha512_of_abc_is_the_published_digest();
  each_published_signature_verifies();
  the_last_two_published_vectors_verify();
  a_message_longer_than_a_hash_block_verifies();
  any_change_to_the_message_signature_or_key_is_refused();
  a_signature_whose_s_is_not_below_the_group_order_is_refused();
  a_key_that_is_not_a_point_is_refused();
  a_key_or_r_that_is_not_strict_is_refused();
  a_non_canonical_encoding_is_refused();
  return finish();
}
