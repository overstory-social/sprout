/*
 * signed_index.c: reading the index of published worlds. The index the publisher signed is
 * accepted under the test key and lists its worlds; a byte changed after signing, another key,
 * no signature, text that is not an index, or one too large is refused in words with nothing
 * used; and an entry the signer vouched for that the app cannot use names its field.
 */
#include <stdlib.h>

#include "host/pd_host.h"
#include "signed_index.h"
#include "support.h"

static const char NOT_TRUSTED[] =
    "The list of worlds did not pass its signature check, so nothing in it was used. "
    "It was changed on the way, or it was not signed by the publisher this app trusts.";

static player_host host;
static sprout_arena arena;
static char *signed_text, *key;

static void open_arena(const char *scenario) {
  begin(scenario);
  player_host_init(&host, &fake->api);
  sprout_arena_init(&arena, &host.record);
}

static void close_arena(void) {
  sprout_arena_reset(&arena);
  end();
}

static player_index read_index(const char *text) {
  return player_index_read(&arena, text, strlen(text), player_index_signed_by, key);
}

/* A verifier that vouches for anything, for entries the signer vouched for but the app cannot use. */
static bool trusts_anything(void *ctx, const char *canonical, const char *signature) {
  (void)ctx;
  (void)canonical;
  (void)signature;
  return true;
}

/* `text` with the first `from` replaced by `to`, in a buffer the next call reuses. */
static const char *replaced(const char *text, const char *from, const char *to) {
  static char out[8192];
  const char *at = strstr(text, from);
  CHECK(at != NULL, "the fixture has %s", from);
  if (at == NULL) return text;
  snprintf(out, sizeof out, "%.*s%s%s", (int)(at - text), text, to, at + strlen(from));
  return out;
}

static const sprout_json *member(const sprout_json *node, const char *name) {
  return node != NULL ? sprout_json_get(node, name) : NULL;
}

static void the_index_the_publisher_signed_is_accepted_and_lists_its_worlds(void) {
  player_index read;
  const sprout_json *first, *assets;
  open_arena("accepted");
  read = read_index(signed_text);
  CHECK(read.ok, "%s", read.reason);
  CHECK(read.ok && read.worlds->count == 2, "two worlds");
  if (read.ok && read.worlds->count == 2) {
    first = read.worlds->items[0];
    CHECK(strcmp(string_at(first, "title"), "Caf\xc3\xa9 \"Moss\"\tTea") == 0, "%s", string_at(first, "title"));
    assets = member(first, "assets");
    CHECK(assets != NULL && assets->count == 2 && strcmp(string_at(assets->items[1], "path"), "pictures/the cabinet.png") == 0,
          "the second asset's path");
    CHECK(member(read.worlds->items[1], "assets") == NULL, "the second world has no assets");
  }
  close_arena();
}

static void an_index_changed_after_signing_or_signed_by_another_key_is_refused(void) {
  player_index read;
  static char other_key[] = "3d4017c3e843895a92b70aa74d1b7ebc9c982ccf2ec4968cc0cd55f12af4660c";
  open_arena("tampered");
  read = read_index(replaced(signed_text, "\"bytes\": 26989", "\"bytes\": 26990"));
  CHECK(!read.ok && read.worlds == NULL && strcmp(read.reason, NOT_TRUSTED) == 0, "a changed size: %s", read.reason);
  read = read_index(replaced(signed_text, "https://worlds.example/sprout/cafe-moss", "https://elsewhere.example/cafe-moss"));
  CHECK(!read.ok && strcmp(read.reason, NOT_TRUSTED) == 0, "a changed address: %s", read.reason);
  read = read_index(replaced(signed_text, "\"title\": \"Bell\"", "\"title\": \"Bell\", \"extra\": 1"));
  CHECK(!read.ok && strcmp(read.reason, NOT_TRUSTED) == 0, "a member added: %s", read.reason);
  read = player_index_read(&arena, signed_text, strlen(signed_text), player_index_signed_by, other_key);
  CHECK(!read.ok && strcmp(read.reason, NOT_TRUSTED) == 0, "another key: %s", read.reason);
  read = read_index(replaced(signed_text, "\"signed\": \"1e4a", "\"signed\": \"zz4a"));
  CHECK(!read.ok && strcmp(read.reason, NOT_TRUSTED) == 0, "a signature that is not hexadecimal: %s", read.reason);
  read = read_index(replaced(signed_text, "{\n      \"title\": \"Bell\"", "{\n      \"title\": \"Bell\", \"title\": \"Bell\""));
  CHECK(!read.ok && strcmp(read.reason, NOT_TRUSTED) == 0, "a member named twice: %s", read.reason);
  close_arena();
}

static void an_index_unsigned_unreadable_or_too_large_is_refused_in_words(void) {
  player_index read;
  char *huge;
  open_arena("unread");
  read = read_index(replaced(signed_text, "\"signed\"", "\"unsigned\""));
  CHECK(!read.ok && strcmp(read.reason, "The list of worlds is not signed, so it was not used.") == 0, "%s", read.reason);
  read = read_index(replaced(signed_text, "\"signed\": \"", "\"signed\": 7, \"x\": \""));
  CHECK(!read.ok && strcmp(read.reason, "The list of worlds is not signed, so it was not used.") == 0, "a number: %s",
        read.reason);
  read = read_index("<html>Not found</html>");
  CHECK(!read.ok && strcmp(read.reason, "The list of worlds could not be read, so it was not used.") == 0, "%s", read.reason);
  read = read_index("[]");
  CHECK(!read.ok && strcmp(read.reason, "The list of worlds could not be read, so it was not used.") == 0, "%s", read.reason);
  read = read_index("{\"worlds\": {}, \"signed\": \"00\"}");
  CHECK(!read.ok && strcmp(read.reason, "The list of worlds could not be read, so it was not used.") == 0, "%s", read.reason);
  huge = (char *)malloc(PLAYER_INDEX_MOST_BYTES + 2);
  memset(huge, ' ', PLAYER_INDEX_MOST_BYTES + 1);
  huge[PLAYER_INDEX_MOST_BYTES + 1] = '\0';
  read = read_index(huge);
  CHECK(!read.ok && strcmp(read.reason, "The list of worlds is larger than this app reads, so it was not used.") == 0, "%s",
        read.reason);
  free(huge);
  close_arena();
}

static void a_signed_entry_the_app_cannot_use_names_its_field(void) {
  static const char *const CASES[][3] = {
      {"\"title\": \"Caf", "\"title\": \"\", \"x\": \"Caf", "World 1 in the list of worlds has no usable title, so the list was not used."},
      {"\"bytes\": 4096", "\"bytes\": -1", "World 2 in the list of worlds has no usable bytes, so the list was not used."},
      {"\"hash\": \"aaaa", "\"hash\": \"xyz\", \"x\": \"aaaa", "World 1 in the list of worlds has no usable hash, so the list was not used."},
      {"\"sha256\": \"bbbb", "\"sha256\": \"BBBB", "World 1 in the list of worlds has no usable sha256, so the list was not used."},
      {"\"url\": \"https://worlds.example/sprout/cafe-moss.sproutworld\"", "\"uri\": \"x\"",
       "World 1 in the list of worlds has no usable url, so the list was not used."},
      {"\"path\": \"cellar.png\"", "\"path\": \"../cellar.png\"",
       "World 1 in the list of worlds has no usable assets path, so the list was not used."},
      {"\"path\": \"cellar.png\"", "\"path\": \"/etc/passwd\"",
       "World 1 in the list of worlds has no usable assets path, so the list was not used."},
      {"\"path\": \"cellar.png\"", "\"path\": \"a//b.png\"",
       "World 1 in the list of worlds has no usable assets path, so the list was not used."},
      {"\"path\": \"cellar.png\"", "\"path\": \"a\\\\b.png\"",
       "World 1 in the list of worlds has no usable assets path, so the list was not used."},
      {"\"path\": \"cellar.png\"", "\"path\": \"a/./b.png\"",
       "World 1 in the list of worlds has no usable assets path, so the list was not used."},
      {"\"path\": \"cellar.png\"", "\"path\": \"c:cellar.png\"",
       "World 1 in the list of worlds has no usable assets path, so the list was not used."},
      {"\"sha256\": \"dddd", "\"sha256\": \"00\", \"x\": \"dddd",
       "World 1 in the list of worlds has no usable assets sha256, so the list was not used."},
      {"\"bytes\": 80", "\"bytes\": \"80\"", "World 1 in the list of worlds has no usable assets bytes, so the list was not used."},
      {"\"title\": \"Bell\",", "\"title\": [\"Bell\"],", "World 2 in the list of worlds has no usable title, so the list was not used."},
  };
  size_t i;
  open_arena("fields");
  for (i = 0; i < sizeof CASES / sizeof CASES[0]; i++) {
    const char *text = replaced(signed_text, CASES[i][0], CASES[i][1]);
    player_index read = player_index_read(&arena, text, strlen(text), trusts_anything, NULL);
    CHECK(!read.ok && strcmp(read.reason, CASES[i][2]) == 0, "case %zu: %s", i, read.reason);
  }
  {
    const char *text = replaced(signed_text, "\"worlds\": [", "\"worlds\": [ 3,");
    player_index read = player_index_read(&arena, text, strlen(text), trusts_anything, NULL);
    CHECK(!read.ok && strcmp(read.reason, "World 1 in the list of worlds is not an entry this app reads, so the list was not used.") == 0,
          "an entry that is not an object: %s", read.reason);
  }
  close_arena();
}

static void sizes_are_told_for_a_person(void) {
  char said[32];
  begin("sizes");
  player_index_size(812, said, sizeof said);
  CHECK(strcmp(said, "812 bytes") == 0, "%s", said);
  player_index_size(26989, said, sizeof said);
  CHECK(strcmp(said, "26.4 KB") == 0, "%s", said);
  player_index_size(3 * 1024 * 1024, said, sizeof said);
  CHECK(strcmp(said, "3.0 MB") == 0, "%s", said);
  player_index_size(1024, said, sizeof said);
  CHECK(strcmp(said, "1.0 KB") == 0, "%s", said);
  end();
}

int main(void) {
  test_program("signed_index");
  signed_text = fixture_text("index.json");
  key = fixture_text("../index-test.pub");
  the_index_the_publisher_signed_is_accepted_and_lists_its_worlds();
  an_index_changed_after_signing_or_signed_by_another_key_is_refused();
  an_index_unsigned_unreadable_or_too_large_is_refused_in_words();
  a_signed_entry_the_app_cannot_use_names_its_field();
  sizes_are_told_for_a_person();
  free(signed_text);
  free(key);
  return finish();
}
