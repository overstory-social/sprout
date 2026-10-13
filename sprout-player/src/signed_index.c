/* The index of published worlds; see signed_index.h. */
#include "signed_index.h"

#include <string.h>

#include "canonical.h"
#include "shipping.h"
#include "text.h"

static const char TOO_BIG[] = "The list of worlds is larger than this app reads, so it was not used.";
static const char UNREADABLE[] = "The list of worlds could not be read, so it was not used.";
static const char UNSIGNED[] = "The list of worlds is not signed, so it was not used.";
static const char NOT_TRUSTED[] =
    "The list of worlds did not pass its signature check, so nothing in it was used. "
    "It was changed on the way, or it was not signed by the publisher this app trusts.";
static const char NO_MEMORY[] = "The player ran out of memory reading the list of worlds, so it was not used.";

bool player_index_signed_by(void *key_hex, const char *canonical, const char *signature_hex) {
  return player_verify(canonical, signature_hex, (const char *)key_hex) == NULL;
}

static bool is_text(const sprout_json *value) { return value != NULL && value->kind == SPROUT_JSON_STRING && value->length > 0; }

/* A whole number of bytes. */
static bool is_count(const sprout_json *value) {
  return value != NULL && value->kind == SPROUT_JSON_NUMBER && value->number >= 0;
}

static bool is_digest(const sprout_json *value) {
  size_t i;
  if (value == NULL || value->kind != SPROUT_JSON_STRING || value->length != 64) return false;
  for (i = 0; i < 64; i++) {
    char c = value->bytes[i];
    if (!((c >= '0' && c <= '9') || (c >= 'a' && c <= 'f'))) return false;
  }
  return true;
}

/* A path inside a cartridge's assets folder: relative, with no `..`, `.` or empty part, no backslash, colon or control character. */
static bool is_asset_path(const sprout_json *value) {
  size_t i, part = 0;
  if (!is_text(value) || value->bytes[0] == '/') return false;
  for (i = 0; i <= value->length; i++) {
    unsigned char c = i < value->length ? (unsigned char)value->bytes[i] : '/';
    if (c < 0x20 || c == 0x7F || c == '\\' || c == ':') return false;
    if (c != '/') continue;
    if (i == part || (i - part == 1 && value->bytes[part] == '.') ||
        (i - part == 2 && value->bytes[part] == '.' && value->bytes[part + 1] == '.'))
      return false;
    part = i + 1;
  }
  return true;
}

/* What is wrong with a listed asset, as a field name, or NULL. */
static const char *asset_fault(const sprout_json *asset) {
  if (asset->kind != SPROUT_JSON_OBJECT) return "assets";
  if (!is_asset_path(sprout_json_get(asset, "path"))) return "assets path";
  if (!is_count(sprout_json_get(asset, "bytes"))) return "assets bytes";
  if (!is_digest(sprout_json_get(asset, "sha256"))) return "assets sha256";
  if (!is_text(sprout_json_get(asset, "url"))) return "assets url";
  return NULL;
}

/* What is wrong with a listed world, as a field name ("" when it is not an object), or NULL. */
static const char *world_fault(const sprout_json *world) {
  static const char *const TEXTS[] = {"title", "author", "version", "url"};
  const sprout_json *assets;
  size_t i;
  if (world->kind != SPROUT_JSON_OBJECT) return "";
  for (i = 0; i < sizeof TEXTS / sizeof TEXTS[0]; i++)
    if (!is_text(sprout_json_get(world, TEXTS[i]))) return TEXTS[i];
  if (!is_count(sprout_json_get(world, "bytes"))) return "bytes";
  if (!is_digest(sprout_json_get(world, "hash"))) return "hash";
  if (!is_digest(sprout_json_get(world, "sha256"))) return "sha256";
  assets = sprout_json_get(world, "assets");
  if (assets == NULL) return NULL;
  if (assets->kind != SPROUT_JSON_ARRAY) return "assets";
  for (i = 0; i < assets->count; i++) {
    const char *fault = asset_fault(assets->items[i]);
    if (fault != NULL) return fault;
  }
  return NULL;
}

static player_index refused(const char *reason) {
  player_index read;
  text_buffer said;
  memset(&read, 0, sizeof read);
  text_begin(&said, read.reason, sizeof read.reason);
  text_add(&said, reason);
  return read;
}

player_index player_index_read(sprout_arena *arena, const char *text, size_t length, player_index_trusts trusts,
                               void *ctx) {
  sprout_json *root = NULL;
  sprout_json_error error;
  sprout_status status;
  const sprout_json *signature;
  sprout_json *worlds;
  const char *canonical = NULL;
  size_t canonical_length = 0, i;
  player_index read;
  if (length > PLAYER_INDEX_MOST_BYTES) return refused(TOO_BIG);
  status = sprout_json_read(arena, text, length, &root, &error);
  if (status == SPROUT_NO_MEMORY) return refused(NO_MEMORY);
  worlds = status == SPROUT_OK ? (sprout_json *)sprout_json_get(root, "worlds") : NULL;
  if (worlds == NULL || worlds->kind != SPROUT_JSON_ARRAY) return refused(UNREADABLE);
  signature = sprout_json_get(root, "signed");
  if (!is_text(signature)) return refused(UNSIGNED);
  if (player_canonical(arena, worlds, &canonical, &canonical_length) != NULL || !trusts(ctx, canonical, signature->bytes))
    return refused(NOT_TRUSTED);
  for (i = 0; i < worlds->count; i++) {
    const char *fault = world_fault(worlds->items[i]);
    if (fault != NULL) {
      text_buffer said;
      read = refused("");
      text_begin(&said, read.reason, sizeof read.reason);
      text_add(&said, "World ");
      text_add_number(&said, i + 1);
      if (fault[0] == '\0') {
        text_add(&said, " in the list of worlds is not an entry this app reads, so the list was not used.");
      } else {
        text_add(&said, " in the list of worlds has no usable ");
        text_add(&said, fault);
        text_add(&said, ", so the list was not used.");
      }
      return read;
    }
  }
  memset(&read, 0, sizeof read);
  read.ok = true;
  read.worlds = worlds;
  return read;
}

void player_index_size(size_t bytes, char *out, size_t size) {
  text_buffer said;
  uint64_t unit = bytes < 1024u * 1024u ? 1024u : 1024u * 1024u, tenths;
  text_begin(&said, out, size);
  if (bytes < 1024) {
    text_add_number(&said, bytes);
    text_add(&said, " bytes");
    return;
  }
  tenths = ((uint64_t)bytes * 10 + unit / 2) / unit;
  text_add_number(&said, tenths / 10);
  text_add(&said, ".");
  text_add_number(&said, tenths % 10);
  text_add(&said, unit == 1024u ? " KB" : " MB");
}
