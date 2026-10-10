/*
 * What the shelf's download screen asks of C: whether the signature on an index is the signer's,
 * and the digest of a file written to the Data folder. Each takes strings and returns one JSON
 * string, as the other bridge functions do:
 *
 *   verify  { ok, reason }                  `reason` says why the signature was refused
 *   digest  { ok, sha256, bytes, reason }   SHA-256 of the file at `path`, as hexadecimal
 *
 * Signatures and keys are hexadecimal text (128 and 64 digits).
 */
#ifndef PLAYER_SHIPPING_H
#define PLAYER_SHIPPING_H

#include "session.h"

const char *player_verify(player_session *session, const char *message, const char *signature_hex,
                          const char *key_hex);
const char *player_digest(player_session *session, const char *path);

#endif
