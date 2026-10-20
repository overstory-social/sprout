/*
 * The index of published worlds (sprout-player/index.schema.json; the design doc's Shipped worlds
 * and downloads): `{ worlds, signed }`, where `signed` is the hexadecimal Ed25519 signature, made
 * by the publisher's key, over the canonical text of `worlds` (canonical.h). Nothing in an index
 * is used before that signature verifies against the key baked into the app, and a world's bytes
 * are checked against the index's size and SHA-256 after they arrive. Which worlds an index lists
 * is the host's act (the spec's The host contract › Moderation and takedown). An index read offers
 * only the newest build of each world: of the builds with one title and author, the highest
 * version by semver.org's precedence (the spec's The manifest gives `version` as semver), and the
 * first listed among equals, since an index carries no publish order.
 */
#ifndef PLAYER_SIGNED_INDEX_H
#define PLAYER_SIGNED_INDEX_H

#include <stdbool.h>
#include <stddef.h>

#include "json.h"

/* The largest index text the app reads, in bytes. */
#define PLAYER_INDEX_MOST_BYTES 262144

/* Whether `signature_hex` is the trusted publisher's over the NUL-terminated `canonical`. */
typedef bool (*player_index_trusts)(void *ctx, const char *canonical, const char *signature_hex);

/* The app's check: `key_hex` is the publisher's public key as 64 hexadecimal digits. */
bool player_index_signed_by(void *key_hex, const char *canonical, const char *signature_hex);

/* An index read: its worlds (an array in the arena, the newest build of each) when `ok`, else the reason in words for the
 * person holding the device. */
typedef struct player_index {
  bool ok;
  const sprout_json *worlds;
  char reason[192];
} player_index;

/* Reads the `length` bytes at `text` as an index into `arena`, trusting a signature `trusts` accepts. */
player_index player_index_read(sprout_arena *arena, const char *text, size_t length, player_index_trusts trusts,
                               void *ctx);

/* A size for the person, into `out`: "812 bytes", "12.4 KB", "1.2 MB". */
void player_index_size(size_t bytes, char *out, size_t size);

#endif
