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

/* What is wrong with a listed world, as a field name ("" when it is not an object), or NULL. */
static const char *world_fault(const sprout_json *world) {
  static const char *const TEXTS[] = {"title", "author", "version", "url"};
  size_t i;
  if (world->kind != SPROUT_JSON_OBJECT) return "";
  for (i = 0; i < sizeof TEXTS / sizeof TEXTS[0]; i++)
    if (!is_text(sprout_json_get(world, TEXTS[i]))) return TEXTS[i];
  if (!is_count(sprout_json_get(world, "bytes"))) return "bytes";
  if (!is_digest(sprout_json_get(world, "hash"))) return "hash";
  if (!is_digest(sprout_json_get(world, "sha256"))) return "sha256";
  return NULL;
}

/* ---- the newest build of each world ---- */

/* A run of text that is not NUL-terminated: a version's identifiers, or one of them. */
typedef struct version_text {
  const char *at;
  size_t length;
} version_text;

/* A version as semver.org writes one: its three numbers and its pre-release identifiers (none when `pre.length` is 0). */
typedef struct version {
  bool ok;
  version_text core, pre;
} version;

/* The identifier at the front of `rest`, taking it and the dot after it off `rest`. */
static version_text next_identifier(version_text *rest) {
  version_text id;
  const char *dot = (const char *)memchr(rest->at, '.', rest->length);
  id.at = rest->at;
  id.length = dot != NULL ? (size_t)(dot - rest->at) : rest->length;
  rest->at += dot != NULL ? id.length + 1 : id.length;
  rest->length -= dot != NULL ? id.length + 1 : id.length;
  return id;
}

static bool is_number(version_text id) {
  size_t i;
  for (i = 0; i < id.length; i++)
    if (id.at[i] < '0' || id.at[i] > '9') return false;
  return id.length > 0;
}

/* Letters, digits and hyphens, at least one. */
static bool is_identifier(version_text id) {
  size_t i;
  for (i = 0; i < id.length; i++) {
    char c = id.at[i];
    if (!((c >= '0' && c <= '9') || (c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') || c == '-')) return false;
  }
  return id.length > 0;
}

/* Whether `run` is dot-separated identifiers, how many, numbers only where `numbers` says, and a number with a leading
 * zero only where `zeros` allows one. */
static bool run_of(version_text run, bool numbers, bool zeros, size_t *count) {
  *count = 0;
  if (run.length == 0 || run.at[run.length - 1] == '.') return false;
  while (run.length > 0) {
    version_text id = next_identifier(&run);
    if (!is_identifier(id) || (numbers && !is_number(id))) return false;
    if (!zeros && is_number(id) && id.length > 1 && id.at[0] == '0') return false;
    (*count)++;
  }
  return true;
}

/* `text` read by semver.org's grammar: MAJOR.MINOR.PATCH, then `-` and a pre-release, then `+` and build metadata. */
static version read_version(const char *text, size_t length) {
  version read;
  const char *plus = (const char *)memchr(text, '+', length), *end = plus != NULL ? plus : text + length;
  const char *dash = (const char *)memchr(text, '-', (size_t)(end - text));
  size_t count = 0, build = 0;
  version_text after;
  read.core.at = text;
  read.core.length = (size_t)((dash != NULL ? dash : end) - text);
  read.pre.at = dash != NULL ? dash + 1 : end;
  read.pre.length = dash != NULL ? (size_t)(end - dash - 1) : 0;
  after.at = plus != NULL ? plus + 1 : end;
  after.length = plus != NULL ? (size_t)(text + length - plus - 1) : 0;
  read.ok = run_of(read.core, true, false, &count) && count == 3 &&
            (dash == NULL || run_of(read.pre, false, false, &count)) && (plus == NULL || run_of(after, false, true, &build));
  return read;
}

/* semver.org's precedence of two identifiers: numbers by value and below words, words in ASCII order. */
static int compare_identifier(version_text a, version_text b) {
  bool a_number = is_number(a), b_number = is_number(b);
  int bytes;
  if (a_number && b_number && a.length != b.length) return a.length < b.length ? -1 : 1;
  if (a_number != b_number) return a_number ? -1 : 1;
  bytes = memcmp(a.at, b.at, a.length < b.length ? a.length : b.length);
  if (bytes != 0) return bytes < 0 ? -1 : 1;
  return a.length == b.length ? 0 : (a.length < b.length ? -1 : 1);
}

/* The first identifiers that differ decide, else the longer run is the higher. */
static int compare_run(version_text a, version_text b) {
  while (a.length > 0 && b.length > 0) {
    int order = compare_identifier(next_identifier(&a), next_identifier(&b));
    if (order != 0) return order;
  }
  return (a.length > 0) - (b.length > 0);
}

/* semver.org's precedence, where a version that is not semver is below one that is; build metadata never decides. */
static int compare_versions(const sprout_json *a, const sprout_json *b) {
  version x = read_version(a->bytes, a->length), y = read_version(b->bytes, b->length);
  int order;
  if (!x.ok || !y.ok) return x.ok - y.ok;
  order = compare_run(x.core, y.core);
  if (order != 0) return order;
  if (x.pre.length == 0 || y.pre.length == 0) return (x.pre.length == 0) - (y.pre.length == 0);
  return compare_run(x.pre, y.pre);
}

static bool same_text(const sprout_json *a, const sprout_json *b) {
  return a->length == b->length && memcmp(a->bytes, b->bytes, a->length) == 0;
}

/* Whether two listed builds are of one world: the same title and the same author. */
static bool same_world(const sprout_json *a, const sprout_json *b) {
  return same_text(sprout_json_get(a, "title"), sprout_json_get(b, "title")) &&
         same_text(sprout_json_get(a, "author"), sprout_json_get(b, "author"));
}

/* Where among the first `kept` of `worlds` a build of `build`'s world is, or `kept` when none is. */
static size_t kept_at(const sprout_json *worlds, size_t kept, const sprout_json *build) {
  size_t j = 0;
  while (j < kept && !same_world(worlds->items[j], build)) j++;
  return j;
}

/* Leaves in `worlds` one build of each world, the highest version and the first listed among equals, where that world
 * was first listed. */
static void keep_newest(sprout_json *worlds) {
  size_t kept = 0, i;
  for (i = 0; i < worlds->count; i++) {
    sprout_json *build = worlds->items[i];
    size_t j = kept_at(worlds, kept, build);
    if (j == kept) kept++;
    else if (compare_versions(sprout_json_get(build, "version"), sprout_json_get(worlds->items[j], "version")) <= 0)
      continue;
    worlds->items[j] = build;
    build->index = j;
  }
  worlds->count = kept;
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
  keep_newest(worlds);
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
