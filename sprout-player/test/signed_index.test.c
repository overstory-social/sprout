/*
 * signed_index.c: reading the index of published worlds. The index the publisher signed is
 * accepted under the test key and lists its worlds; a byte changed after signing, another key,
 * no signature, text that is not an index, or one too large is refused in words with nothing
 * used; and an entry the signer vouched for that the app cannot use names its field. Of the builds
 * of one world (one title and author) only the newest is offered: the highest version by
 * semver.org's precedence, a number compared by value (0.10.0 is above 0.9.0), and the first
 * listed among equals (test/fixtures/builds.json, signed under the test key). An index
 * `sprout index` wrote (PLAYER_SIGNED_INDEX, under the key PLAYER_SIGNED_INDEX_KEY names) is
 * accepted, and each cartridge beside it is named as the app names a download and is the size and
 * SHA-256 it lists.
 */
#include <stdlib.h>

#include "host/pd_host.h"
#include "shipping.h"
#include "signed_index.h"
#include "support.h"
#include "ui/downloads.h"

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

static void the_index_the_publisher_signed_is_accepted_and_lists_its_worlds(void) {
  player_index read;
  const sprout_json *first;
  open_arena("accepted");
  read = read_index(signed_text);
  CHECK(read.ok, "%s", read.reason);
  CHECK(read.ok && read.worlds->count == 2, "two worlds");
  if (read.ok && read.worlds->count == 2) {
    first = read.worlds->items[0];
    CHECK(strcmp(string_at(first, "title"), "Caf\xc3\xa9 \"Moss\"\tTea") == 0, "%s", string_at(first, "title"));
    CHECK(strcmp(string_at(read.worlds->items[1], "url"), "/sprout/bell.sproutworld") == 0, "the second world's address");
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
  read = read_index(replaced(signed_text, "\"signed\": \"cadd", "\"signed\": \"zzdd"));
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

static const char *url_of(const player_index *read, size_t n) {
  return read->ok && n < read->worlds->count ? string_at(read->worlds->items[n], "url") : "(none)";
}

static void only_the_newest_build_of_each_world_is_offered(void) {
  static const char *const SHOWN[] = {"/sprout/caverns-0-10-0.sproutworld", "/sprout/bell.sproutworld",
                                      "/sprout/moss-first.sproutworld", "/sprout/caverns-ada.sproutworld"};
  char *builds = fixture_text("builds.json");
  player_index read;
  size_t i;
  open_arena("newest");
  read = read_index(builds);
  CHECK(read.ok, "%s", read.reason);
  CHECK(read.ok && read.worlds->count == 4, "eight builds of four worlds offer four: %zu", read.ok ? read.worlds->count : 0);
  for (i = 0; read.ok && i < 4; i++) {
    CHECK(strcmp(url_of(&read, i), SHOWN[i]) == 0, "world %zu is %s, not %s", i + 1, SHOWN[i], url_of(&read, i));
    CHECK(read.worlds->items[i]->index == i, "world %zu knows its place", i + 1);
  }
  CHECK(read.ok && strcmp(string_at(read.worlds->items[0], "version"), "0.10.0") == 0, "0.10.0 is above 0.9.0");
  CHECK(read.ok && strcmp(string_at(read.worlds->items[3], "author"), "Ada") == 0,
        "the same title by another author is another world");
  read = read_index(signed_text);
  CHECK(read.ok && read.worlds->count == 2 && strcmp(url_of(&read, 1), "/sprout/bell.sproutworld") == 0,
        "worlds with one build each are offered as listed");
  close_arena();
  free(builds);
}

/* An index, under no signature, of two builds of one world at versions `first` and `second`; which was offered. */
static const char *newer_of(const char *first, const char *second) {
  static char text[1024];
  static const char ENTRY[] = "{\"title\":\"Moss\",\"author\":\"Bo\",\"version\":\"%s\",\"bytes\":1,\"hash\":\"%064d\","
                              "\"sha256\":\"%064d\",\"url\":\"%s\"}";
  char one[400], two[400];
  player_index read;
  snprintf(one, sizeof one, ENTRY, first, 0, 0, "first");
  snprintf(two, sizeof two, ENTRY, second, 0, 0, "second");
  snprintf(text, sizeof text, "{\"worlds\":[%s,%s],\"signed\":\"00\"}", one, two);
  read = player_index_read(&arena, text, strlen(text), trusts_anything, NULL);
  CHECK(read.ok && read.worlds->count == 1, "%s and %s are one world: %s", first, second, read.reason);
  return url_of(&read, 0);
}

static void versions_are_ordered_part_by_part_as_semver_orders_them(void) {
  static const char *const CASES[][3] = {
      {"0.9.0", "0.10.0", "second"},
      {"0.10.0", "0.9.0", "first"},
      {"1.0.0", "0.99.99", "first"},
      {"1.2.9", "1.10.0", "second"},
      {"1.2.3", "1.2.10", "second"},
      {"9.0.0", "12345678901234567890.0.0", "second"},
      {"1.0.0-alpha", "1.0.0", "second"},
      {"1.0.0", "1.0.0-rc.1", "first"},
      {"1.0.0-alpha", "1.0.0-alpha.1", "second"},
      {"1.0.0-alpha.1", "1.0.0-alpha.beta", "second"},
      {"1.0.0-beta.2", "1.0.0-beta.11", "second"},
      {"1.0.0-beta", "1.0.0-alpha.9", "first"},
      {"1.0.0-rc.1", "1.0.0-RC.1", "first"},
      {"0.1.0", "0.1.0", "first"},
      {"1.0.0+build.1", "1.0.0+build.2", "first"},
      {"1.0.0+b", "1.0.0", "first"},
      {"not a version", "0.0.1", "second"},
      {"01.0.0", "0.1.0", "second"},
      {"1.0", "0.0.1", "second"},
      {"1.0.0-", "0.0.1", "second"},
      {"1.0.0-01", "0.0.1", "second"},
      {"1..0", "1.0", "first"},
  };
  size_t i;
  open_arena("versions");
  for (i = 0; i < sizeof CASES / sizeof CASES[0]; i++) {
    const char *offered = newer_of(CASES[i][0], CASES[i][1]);
    CHECK(strcmp(offered, CASES[i][2]) == 0, "of %s then %s, the %s is offered, not the %s", CASES[i][0], CASES[i][1],
          CASES[i][2], offered);
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

/* The whole of the file at `path`, without its trailing newlines, from malloc; NULL where it cannot be read. */
static char *whole_file(const char *path) {
  FILE *file = fopen(path, "rb");
  long size;
  char *text;
  if (file == NULL) return NULL;
  fseek(file, 0, SEEK_END);
  size = ftell(file);
  fseek(file, 0, SEEK_SET);
  text = (char *)malloc((size_t)size + 1);
  if (fread(text, 1, (size_t)size, file) != (size_t)size) size = 0;
  while (size > 0 && text[size - 1] == '\n') size--;
  text[size] = '\0';
  fclose(file);
  return text;
}

static void the_index_sprout_index_wrote_is_accepted_with_its_cartridges_beside_it(const char *index_path,
                                                                                 const char *key_path) {
  char *text = whole_file(index_path), *published_key = whole_file(key_path), folder[600], command[2000];
  const char *slash = strrchr(index_path, '/');
  player_index read;
  size_t i, accepted;
  CHECK(text != NULL && published_key != NULL, "reading %s and %s", index_path, key_path);
  if (text == NULL || published_key == NULL) {
    free(text);
    free(published_key);
    return;
  }
  snprintf(folder, sizeof folder, "%.*s", slash == NULL ? 1 : (int)(slash - index_path), slash == NULL ? "." : index_path);
  open_arena("published");
  read = player_index_read(&arena, text, strlen(text), player_index_signed_by, published_key);
  CHECK(read.ok && read.worlds->count > 0, "the index sprout index wrote: %s", read.reason);
  for (i = 0; read.ok && i < read.worlds->count; i++) {
    const sprout_json *world = read.worlds->items[i];
    const char *url = string_at(world, "url"), *name = strrchr(url, '/');
    char stem[32], wanted[64], sha256[65], beside[700];
    size_t bytes = 0;
    player_downloads_stem(string_at(world, "title"), stem, sizeof stem);
    snprintf(wanted, sizeof wanted, "/%s-%.8s.sproutworld", stem, string_at(world, "hash"));
    CHECK(name != NULL && strcmp(name, wanted) == 0, "%s is published as %s", string_at(world, "title"), url);
    if (name == NULL) continue;
    snprintf(beside, sizeof beside, "beside%s", name);
    snprintf(command, sizeof command, "mkdir -p '%s/beside' && cp '%s%s' '%s/%s'", fake->data, folder, name, fake->data, beside);
    CHECK(system(command) == 0, "%s", command);
    CHECK(player_digest(&fake->api, beside, sha256, &bytes) == NULL, "the digest of %s", beside);
    CHECK(strcmp(sha256, string_at(world, "sha256")) == 0, "%s has the SHA-256 listed", name + 1);
    CHECK(bytes == (size_t)sprout_json_get(world, "bytes")->number, "%s is the size listed", name + 1);
  }
  accepted = read.ok ? read.worlds->count : 0;
  close_arena();
  printf("signed_index: %zu worlds sprout index wrote are accepted\n", accepted);
  free(text);
  free(published_key);
}

int main(void) {
  const char *published = getenv("PLAYER_SIGNED_INDEX"), *published_key = getenv("PLAYER_SIGNED_INDEX_KEY");
  test_program("signed_index");
  signed_text = fixture_text("index.json");
  key = fixture_text("../index-test.pub");
  the_index_the_publisher_signed_is_accepted_and_lists_its_worlds();
  an_index_changed_after_signing_or_signed_by_another_key_is_refused();
  an_index_unsigned_unreadable_or_too_large_is_refused_in_words();
  a_signed_entry_the_app_cannot_use_names_its_field();
  only_the_newest_build_of_each_world_is_offered();
  versions_are_ordered_part_by_part_as_semver_orders_them();
  sizes_are_told_for_a_person();
  if (published != NULL && published[0] != '\0')
    the_index_sprout_index_wrote_is_accepted_with_its_cartridges_beside_it(published, published_key == NULL ? "" : published_key);
  else
    printf("signed_index: PLAYER_SIGNED_INDEX is not set, no index from sprout index to check\n");
  free(signed_text);
  free(key);
  return finish();
}
