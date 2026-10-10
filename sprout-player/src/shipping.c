/* Signature checks and file digests for the download screen; see shipping.h. */
#include "shipping.h"

#include <string.h>

#include "ed25519.h"
#include "files.h"
#include "seeds.h"
#include "session_internal.h"

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

/* A reply { ok, <key>: text } or, with no `key`, { ok }. */
static const char *answer(player_session *session, bool ok, const char *key, const char *text) {
  sprout_arena arena;
  jb builder;
  sprout_json *root;
  if (!session_reply_begin(session, &arena, &builder)) return session_reply_end(session, &arena, &builder, NULL);
  root = jb_object(&builder, 2);
  jb_set(&builder, root, "ok", jb_bool(&builder, ok));
  if (key != NULL) jb_set(&builder, root, key, jb_string(&builder, text));
  return session_reply_end(session, &arena, &builder, root);
}

const char *player_verify(player_session *session, const char *message, const char *signature_hex,
                          const char *key_hex) {
  unsigned char signature[64], key[32];
  if (!unhex(signature_hex, signature, sizeof signature))
    return answer(session, false, "reason", "The signature is not 128 hexadecimal digits.");
  if (!unhex(key_hex, key, sizeof key))
    return answer(session, false, "reason", "The public key is not 64 hexadecimal digits.");
  if (!player_ed25519_verify(signature, (const unsigned char *)message, strlen(message), key))
    return answer(session, false, "reason", "The signature is not the one the key makes for this text.");
  return answer(session, true, NULL, NULL);
}

const char *player_digest(player_session *session, const char *path) {
  static const char DIGITS[] = "0123456789abcdef";
  sprout_arena arena;
  jb builder;
  sprout_json *root;
  unsigned char digest[32];
  char hex[65];
  size_t length = 0, i;
  char *bytes = player_read_file(session->pd, path, &length);
  if (bytes == NULL) return answer(session, false, "reason", "The file cannot be read.");
  sprout_sha256(bytes, length, digest);
  player_free(session->pd, bytes);
  for (i = 0; i < 32; i++) {
    hex[2 * i] = DIGITS[digest[i] >> 4];
    hex[2 * i + 1] = DIGITS[digest[i] & 15];
  }
  hex[64] = '\0';
  if (!session_reply_begin(session, &arena, &builder)) return session_reply_end(session, &arena, &builder, NULL);
  root = jb_object(&builder, 3);
  jb_set(&builder, root, "ok", jb_bool(&builder, true));
  jb_set(&builder, root, "sha256", jb_string(&builder, hex));
  jb_set(&builder, root, "bytes", jb_number(&builder, (double)length));
  return session_reply_end(session, &arena, &builder, root);
}
