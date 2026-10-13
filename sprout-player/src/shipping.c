/* Signature checks and file digests for the download screen; see shipping.h. */
#include "shipping.h"

#include <string.h>

#include "ed25519.h"
#include "host/files.h"

/* The value of one hexadecimal digit, or -1. */
static int digit_value(char c) {
  if (c >= '0' && c <= '9') return c - '0';
  if (c >= 'a' && c <= 'f') return c - 'a' + 10;
  if (c >= 'A' && c <= 'F') return c - 'A' + 10;
  return -1;
}

/* Decodes exactly `bytes` bytes from `text`; false when it is another length or not hexadecimal. */
static bool unhex(const char *text, unsigned char *out, size_t bytes) {
  size_t i;
  if (strlen(text) != bytes * 2) return false;
  for (i = 0; i < bytes; i++) {
    int high = digit_value(text[2 * i]), low = digit_value(text[2 * i + 1]);
    if (high < 0 || low < 0) return false;
    out[i] = (unsigned char)(high * 16 + low);
  }
  return true;
}

const char *player_verify(const char *message, const char *signature_hex, const char *key_hex) {
  unsigned char signature[64], key[32];
  if (!unhex(signature_hex, signature, sizeof signature)) return "The signature is not 128 hexadecimal digits.";
  if (!unhex(key_hex, key, sizeof key)) return "The public key is not 64 hexadecimal digits.";
  if (!player_ed25519_verify(signature, (const unsigned char *)message, strlen(message), key))
    return "The signature is not the one the key makes for this text.";
  return NULL;
}

const char *player_digest(PlaydateAPI *pd, const char *path, char sha256[65], size_t *bytes) {
  static const char DIGITS[] = "0123456789abcdef";
  unsigned char digest[32];
  size_t i;
  *bytes = 0;
  sha256[0] = '\0';
  if (!player_hash_file(pd, path, digest, bytes)) return "The file cannot be read.";
  for (i = 0; i < 32; i++) {
    sha256[2 * i] = DIGITS[digest[i] >> 4];
    sha256[2 * i + 1] = DIGITS[digest[i] & 15];
  }
  sha256[64] = '\0';
  return NULL;
}
