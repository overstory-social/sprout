/*
 * Ed25519 signature verification (RFC 8032, section 5.1.7) over string.h alone: the field and
 * group arithmetic are those of the public-domain TweetNaCl, with SHA-512 beside them. Only
 * verification is here; the player never signs. The signature `index.json` carries is checked
 * with it against the public key baked into the app (the spec's The host contract >
 * Moderation and takedown leaves who may publish to the host).
 */
#ifndef PLAYER_ED25519_H
#define PLAYER_ED25519_H

#include <stddef.h>

/* SHA-512 of `length` bytes into `digest`. */
void player_sha512(const unsigned char *bytes, size_t length, unsigned char digest[64]);

/*
 * Whether `signature` (64 bytes: R then S) signs the `length` bytes of `message` under
 * `public_key` (32 bytes). False for any signature whose S is not below the group order, whose R
 * is not the point the message hashes to, or whose key is not a point on the curve.
 */
int player_ed25519_verify(const unsigned char signature[64], const unsigned char *message, size_t length,
                          const unsigned char public_key[32]);

#endif
