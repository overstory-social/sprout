/*
 * What the shelf's download screen asks of C: whether the signature on an index is the signer's,
 * and the digest of a file written to the Data folder. Signatures and keys are hexadecimal text
 * (128 and 64 digits); each answer is NULL when all is well, or the words for what is wrong.
 */
#ifndef PLAYER_SHIPPING_H
#define PLAYER_SHIPPING_H

#include <stddef.h>

#include "pd_api.h"

/* Whether `signature_hex` is the signature `key_hex` makes over `message`. */
const char *player_verify(const char *message, const char *signature_hex, const char *key_hex);

/* The SHA-256 of the file at `path` as 64 lowercase hexadecimal digits, and its size in bytes. */
const char *player_digest(PlaydateAPI *pd, const char *path, char sha256[65], size_t *bytes);

#endif
