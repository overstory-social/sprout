/*
 * ui/downloads.c: the download screen, driven through the app a frame at a time over the fake's
 * canned server. The rules: "more worlds..." fetches the index the Data folder's settings name,
 * asking permission with the app's purpose; an index is listed only once its signature verifies
 * against the baked key, and one that does not is refused in words that the shelf repeats; a
 * world chosen arrives whole as one file, its pictures inside it, checked against the index and
 * put in place, and is shelved; and a world whose bytes are not the ones listed (another checksum,
 * more bytes, a missing file, another build) is refused in words and leaves nothing behind. Every way
 * the network fails is said, and leaving mid-download leaves nothing half written or open. The
 * worlds are the words of a wheel by title, turned by the crank and the d-pad and wrapping, one on
 * the shelf already greyed with the panel saying so; of several builds of one world only the newest is a word, and the
 * panel and the download are that build's. A file is named for its title as the publisher
 * names it (test/fixtures/stems.json, which `sprout index`'s spec holds to the same names).
 */
#include <stdlib.h>

#include "host/pd_host.h"
#include "shipping.h"
#include "support.h"
#include "ui/app.h"
#include "ui/downloads.h"
#include "ui/images.h"
#include "ui/shelf.h"
#include "wheel_support.h"

#define LINE FAKE_SERIF_LINE
#define PANEL (240 - (LINE * 3 + 8) + 2)
#define INDEX_URL "https://w.example/sprout/index.json"

static const char NOT_TRUSTED[] =
    "The list of worlds did not pass its signature check, so nothing in it was used. "
    "It was changed on the way, or it was not signed by the publisher this app trusts.";

static player_app *app;

static void start(const char *scenario) {
  const char *why = NULL;
  begin(scenario);
  app_folder("app");
  write_text(PLAYER_DOWNLOADS_SETTINGS, "{ \"indexUrl\": \"" INDEX_URL "\" }");
  fake->piece = 65536;
  app = player_app_new(&fake->api, &why);
  CHECK(app != NULL, "%s", why);
  fake->api.system->setUpdateCallback(player_app_update, app);
}

static void stop(void) {
  player_app_free(app);
  CHECK(fake->connections_live == 0, "%d connections left open", fake->connections_live);
  end();
}


/* The panel's lines this frame, joined by spaces. */
static const char *panel(void) {
  static char joined[4096];
  int y;
  joined[0] = '\0';
  for (y = PANEL; y < 240; y += LINE) {
    const fake_run *run = fake_run_at(fake, PLAYER_MARGIN, y);
    if (run == NULL) break;
    if (joined[0] != '\0') strcat(joined, " ");
    strcat(joined, run->text);
  }
  return joined;
}

static player_downloads *screen(void) {
  return app->screen == &player_downloads_screen ? (player_downloads *)app->ctx : NULL;
}

/* The wheel of the screen up: the download list's or the shelf's. */
static const wheel *wheel_up(void) {
  if (screen() != NULL) return &screen()->wheel;
  return app->screen == &player_shelf_screen ? &app->shelf->wheel : NULL;
}

/* The word at the front of the wheel up, drawn last frame. */
static const char *front(void) { return wheel_up() != NULL ? wheel_front(wheel_up()) : "(no wheel)"; }

/* The label of entry `n` on the wheel up, drawn last frame, or NULL; its word, and whether it is greyed. */
static const wheel_label *label(size_t n) {
  int at = wheel_up() != NULL ? wheel_placed_entry(wheel_up(), n) : -1;
  return at >= 0 ? wheel_placed(wheel_up(), at) : NULL;
}

static const char *word(size_t n) { return label(n) != NULL ? wheel_label_text(label(n)) : ""; }

static bool greyed(size_t n) { return label(n) != NULL && wheel_label_greyed(label(n)); }

/* Runs frames until the panel holds `words` or `most` have run; whether it came to. */
static bool frames_until(const char *words, int most) {
  int n;
  for (n = 0; n < most; n++) {
    fake_frame(fake, 0, 0);
    if (HAS(panel(), words)) return true;
  }
  return false;
}

static bool trusts_anything(void *ctx, const char *canonical, const char *signature) {
  (void)ctx;
  (void)canonical;
  (void)signature;
  return true;
}

/* From the shelf, A on "more worlds..." (the last row); the screen it opened. */
static player_downloads *open_more(void) {
  fake_frame(fake, 0, 0);
  fake_frame(fake, kButtonUp, 0);
  fake_frame(fake, kButtonA, 0);
  CHECK(screen() != NULL, "A on more worlds opens the download screen");
  return screen();
}

/* The bytes of the file at `path` under the Data folder, from malloc. */
static char *bytes_of(const char *path, size_t *length) {
  char full[1200];
  FILE *file;
  char *bytes;
  long size;
  snprintf(full, sizeof full, "%s/%s", fake->data, path);
  file = fopen(full, "rb");
  CHECK(file != NULL, "%s", full);
  if (file == NULL) return calloc(1, 1);
  fseek(file, 0, SEEK_END);
  size = ftell(file);
  fseek(file, 0, SEEK_SET);
  bytes = (char *)malloc((size_t)size + 1);
  CHECK(fread(bytes, 1, (size_t)size, file) == (size_t)size, "reading %s", full);
  fclose(file);
  *length = (size_t)size;
  return bytes;
}

/* ---- a world to download: the media room, whose cartridge carries its pictures, served from the test's own copy ---- */

typedef struct served {
  char hash[65], sha[65];
  char *cartridge;
  size_t cartridge_bytes;
  char index[4096];
  char final[256];
} served;

static served world;

static void forget_world(void) {
  free(world.cartridge);
  world.cartridge = NULL;
}

/* Lists the media room under the title "Media Room", with `hash` (NULL: its own) and the cartridge's true size and checksum. */
static void list_world(const char *hash) {
  char command[1200];
  size_t bytes = 0;
  player_opening seen;
  forget_world();
  snprintf(command, sizeof command, "mkdir -p '%s/served' && cp '%s/media-room.sproutworld' '%s/served/'", fake->data,
           PLAYER_CARTRIDGES, fake->data);
  CHECK(system(command) == 0, "%s", command);
  seen = player_inspect(app->session, "served/media-room.sproutworld");
  CHECK(seen.ok && seen.hash != NULL, "%s", seen.reason);
  snprintf(world.hash, sizeof world.hash, "%s", seen.ok ? seen.hash : "");
  CHECK(player_digest(&fake->api, "served/media-room.sproutworld", world.sha, &bytes) == NULL, "the digest");
  world.cartridge = bytes_of("served/media-room.sproutworld", &world.cartridge_bytes);
  snprintf(world.index, sizeof world.index,
           "{\"worlds\":[{\"title\":\"Media Room\",\"author\":\"Ada\",\"version\":\"1.0.0\",\"bytes\":%zu,\"hash\":\"%s\","
           "\"sha256\":\"%s\",\"url\":\"media-room.sproutworld\"}],\"signed\":\"00\"}",
           world.cartridge_bytes, hash != NULL ? hash : world.hash, world.sha);
  snprintf(world.final, sizeof world.final, "worlds/media-room-%.8s.sproutworld", world.hash);
  fake_serve(fake, INDEX_URL, 200, world.index, strlen(world.index));
}

/* Whether nothing of the world is in worlds/: no part and no cartridge. */
static bool nothing_left(void) {
  char command[1200];
  snprintf(command, sizeof command, "test -z \"$(ls -A '%s/worlds' 2>/dev/null)\"", fake->data);
  return system(command) == 0;
}

/* Opens the screen trusting any signature (the index above is not signed), and waits for the list. */
static player_downloads *open_listed(void) {
  player_downloads *d = open_more();
  if (d != NULL) d->trusts = trusts_anything;
  CHECK(frames_until("A downloads it.", 20), "the list: %s", panel());
  return d;
}

/* Lists the media room as three builds: 1.10.0 itself, an older one before it and one of the same version after it,
 * the other two at addresses the fake does not serve. */
static void list_builds(void) {
  static const char BUILD[] = "{\"title\":\"Media Room\",\"author\":\"Ada\",\"version\":\"%s\",\"bytes\":%zu,\"hash\":\"%s\","
                              "\"sha256\":\"%s\",\"url\":\"%s\"}";
  static const char OTHER_HASH[] = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
  char older[600], newest[600], same[600];
  list_world(NULL);
  snprintf(older, sizeof older, BUILD, "1.9.0", world.cartridge_bytes, OTHER_HASH, world.sha, "media-room-older.sproutworld");
  snprintf(newest, sizeof newest, BUILD, "1.10.0", world.cartridge_bytes, world.hash, world.sha, "media-room.sproutworld");
  snprintf(same, sizeof same, BUILD, "1.10.0", world.cartridge_bytes, OTHER_HASH, world.sha, "media-room-again.sproutworld");
  snprintf(world.index, sizeof world.index, "{\"worlds\":[%s,%s,%s],\"signed\":\"00\"}", older, newest, same);
  fake_serve(fake, INDEX_URL, 200, world.index, strlen(world.index));
}

/* ---- the scenarios ---- */

static void the_signed_index_is_listed_and_one_changed_is_refused(void) {
  char *signed_text = fixture_text("index.json"), *tampered = NULL, *at;
  start("index");
  fake_serve(fake, INDEX_URL, 200, signed_text, strlen(signed_text));
  CHECK(open_more() != NULL, "the screen");
  CHECK(fake->asks == 1 && strcmp(fake->asked_purpose, PLAYER_NETWORK_PURPOSE) == 0, "asked with the purpose: %s",
        fake->asked_purpose);
  CHECK(fake->wifi_enabled, "the Wi-Fi is asked to come up");
  CHECK(frames_until("A downloads it.", 20), "the list under the baked key: %s", panel());
  CHECK(strcmp(front(), "Caf\xc3\xa9 \"Moss\"\tTea") == 0 && strcmp(word(0), front()) == 0, "each world is its title: %s", front());
  CHECK(strcmp(word(1), "Bell") == 0 && !greyed(0) && !greyed(1) && fake->placed_count == 2, "the next a sector below: %s", word(1));
  CHECK(strcmp(panel(), "by Ada \\ Bo, version 1.2.0, 26.4 KB. A downloads it.") == 0, "%s", panel());
  fake_frame(fake, kButtonDown, 0);
  CHECK(strcmp(front(), "Bell") == 0 && HAS(panel(), "by Eve"), "down selects the next: %s", panel());
  fake->note_count = 0;
  fake_frame(fake, 0, 13.0f);
  CHECK(strcmp(front(), word(0)) == 0 && screen()->selected == 0, "the crank past halfway wraps round: %s", front());
  CHECK(fake->note_count == 1, "with a tick: %d notes", fake->note_count);
  fake_frame(fake, kButtonB, 0);
  CHECK(app->screen == &player_shelf_screen && !fake->wifi_enabled, "B goes back to the shelf and lets the Wi-Fi sleep");
  CHECK(strcmp(panel(), "No worlds are on the shelf. A looks for more worlds to download.") == 0,
        "the shelf is as it was: %s", panel());

  tampered = (char *)malloc(strlen(signed_text) + 2);
  strcpy(tampered, signed_text);
  at = strstr(tampered, "26989");
  CHECK(at != NULL, "the fixture lists 26989 bytes");
  if (at != NULL) at[4] = '0';
  fake->answers[0].body = tampered;
  fake_frame(fake, kButtonA, 0);
  CHECK(frames_until("A tries again, B goes back.", 20), "%s", panel());
  CHECK(HAS(panel(), NOT_TRUSTED) && fake->placed_count == 0, "refused with nothing listed: %s", panel());
  fake_frame(fake, kButtonB, 0);
  fake_frame(fake, 0, 0);
  CHECK(app->screen == &player_shelf_screen && strncmp(panel(), NOT_TRUSTED, strlen(NOT_TRUSTED)) == 0 &&
            strcmp(panel() + strlen(NOT_TRUSTED), " A tries again.") == 0,
        "the shelf says why: %s", panel());
  fake->answers[0].body = signed_text;
  fake_frame(fake, kButtonA, 0);
  CHECK(frames_until("A downloads it.", 20), "tried again from the shelf: %s", panel());
  stop();
  free(signed_text);
  free(tampered);
}

static void a_chosen_world_arrives_whole_and_is_shelved(void) {
  char part[300];
  start("arrives");
  list_world(NULL);
  fake_serve(fake, "https://w.example/sprout/media-room.sproutworld", 200, world.cartridge, world.cartridge_bytes);
  CHECK(open_listed() != NULL, "the screen");
  CHECK(strcmp(front(), "Media Room") == 0 && !greyed(0) && !HAS(panel(), "on your shelf"), "%s", front());
  fake->piece = 1024;
  fake_frame(fake, kButtonA, 0);
  CHECK(HAS(panel(), "Downloading Media Room ("), "progress: %s", panel());
  fake_frame(fake, 0, 0);
  CHECK(HAS(panel(), "%. B stops.") && !HAS(panel(), " 0%"), "the share arrived so far: %s", panel());
  CHECK(frames_until("Media Room is on your shelf.", 400), "%s", panel());
  snprintf(part, sizeof part, "%s.part", world.final);
  CHECK(exists(world.final) && !exists(part), "the cartridge %s is in place, no part left", world.final);
  CHECK(images_has(&fake->api, world.final, "pictures/cabinet.png"), "its pictures came inside it");
  {
    size_t length = 0;
    char *got = bytes_of(world.final, &length);
    CHECK(length == world.cartridge_bytes && memcmp(got, world.cartridge, length) == 0, "the bytes are the ones served");
    free(got);
  }
  fake_frame(fake, kButtonDown, 0);
  CHECK(strcmp(front(), "Media Room") == 0 && greyed(0) && HAS(panel(), "It is on your shelf."), "the list greys it, the panel says why: %s",
        panel());
  fake_frame(fake, kButtonA, 0);
  CHECK(strcmp(panel(), "Media Room is already on your shelf.") == 0, "%s", panel());
  fake_frame(fake, kButtonB, 0);
  CHECK(app->screen == &player_shelf_screen && strcmp(front(), "Media Room") == 0, "the shelf lists it: %s", front());
  stop();
  forget_world();
}

/* Runs a download of the listed world to its refusal; the panel's words. */
static const char *refused_download(void) {
  CHECK(open_listed() != NULL, "the screen");
  fake_frame(fake, kButtonA, 0);
  CHECK(frames_until("Could not download Media Room. ", 400), "%s", panel());
  return panel();
}

static void a_world_whose_bytes_are_not_the_listed_ones_is_refused_and_leaves_nothing(void) {
  char *changed;
  start("checksum");
  list_world(NULL);
  changed = (char *)malloc(world.cartridge_bytes + 1);
  memcpy(changed, world.cartridge, world.cartridge_bytes);
  changed[world.cartridge_bytes / 2] ^= 0x20;
  fake_serve(fake, "https://w.example/sprout/media-room.sproutworld", 200, changed, world.cartridge_bytes);
  CHECK(strcmp(refused_download(),
               "Could not download Media Room. Media Room does not match the checksum in the list, so it was thrown away.") == 0,
        "%s", panel());
  CHECK(nothing_left(), "nothing is left in worlds/");
  stop();

  start("longer");
  list_world(NULL);
  memcpy(changed, world.cartridge, world.cartridge_bytes);
  changed[world.cartridge_bytes] = 'x';
  fake_serve(fake, "https://w.example/sprout/media-room.sproutworld", 200, changed, world.cartridge_bytes + 1);
  CHECK(strcmp(refused_download(),
               "Could not download Media Room. Media Room is longer than the list says it is, so it was thrown away.") == 0,
        "%s", panel());
  CHECK(nothing_left(), "nothing is left in worlds/");
  stop();

  start("missing");
  list_world(NULL);
  CHECK(strcmp(refused_download(), "Could not download Media Room. There is no Media Room at that address (the "
                                   "server answered 404).") == 0,
        "%s", panel());
  CHECK(nothing_left(), "the cartridge's part is gone");
  stop();

  start("missing-page");
  list_world(NULL);
  {
    static char page[1 << 16];
    memset(page, '<', sizeof page);
    CHECK(sizeof page > world.cartridge_bytes, "the page is longer than the cartridge");
    fake_serve(fake, "https://w.example/sprout/media-room.sproutworld", 404, page, sizeof page);
  }
  CHECK(strcmp(refused_download(), "Could not download Media Room. There is no Media Room at that address (the "
                                   "server answered 404).") == 0,
        "a 404 page longer than the file is still a 404: %s", panel());
  CHECK(nothing_left(), "nothing is left in worlds/");
  stop();

  start("another-build");
  list_world("0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef");
  fake_serve(fake, "https://w.example/sprout/media-room.sproutworld", 200, world.cartridge, world.cartridge_bytes);
  CHECK(strcmp(refused_download(), "Could not download Media Room. The cartridge that arrived is not the build the list "
                                   "describes (its bundle hash differs), so it was thrown away.") == 0,
        "%s", panel());
  CHECK(nothing_left(), "the cartridge is taken away");
  fake_frame(fake, kButtonDown, 0);
  CHECK(HAS(panel(), "A downloads it."), "moving on clears the refusal: %s", panel());
  stop();
  free(changed);
  forget_world();
}

static void of_several_builds_the_newest_is_offered_and_downloaded(void) {
  start("newest");
  list_builds();
  fake_serve(fake, "https://w.example/sprout/media-room.sproutworld", 200, world.cartridge, world.cartridge_bytes);
  CHECK(open_listed() != NULL, "the screen");
  CHECK(strcmp(front(), "Media Room") == 0 && wheel_placed_entry(wheel_up(), 1) < 0 && screen()->worlds->count == 1,
        "three builds are one word: %s", word(1));
  CHECK(HAS(panel(), "by Ada, version 1.10.0, "), "the panel is the newest build's: %s", panel());
  fake_frame(fake, kButtonA, 0);
  CHECK(frames_until("Media Room is on your shelf.", 400), "the newest build is the one fetched: %s", panel());
  CHECK(exists(world.final), "the cartridge %s is in place", world.final);
  stop();
  forget_world();
}

static void leaving_mid_download_leaves_nothing_behind(void) {
  fake_answer *slow;
  start("leaving");
  list_world(NULL);
  slow = fake_serve(fake, "https://w.example/sprout/media-room.sproutworld", 200, world.cartridge, world.cartridge_bytes);
  slow->silent = 1;
  CHECK(open_listed() != NULL, "the screen");
  fake_frame(fake, kButtonA, 0);
  fake_frame(fake, kButtonDown, 0);
  CHECK(HAS(panel(), "Downloading Media Room") && HAS(panel(), "B stops."), "the d-pad does nothing while it runs: %s", panel());
  fake->seconds += PLAYER_NET_STALL_SECONDS + 1;
  CHECK(frames_until("stopped answering", 3), "a silent server is given up on: %s", panel());
  CHECK(strcmp(panel(), "Could not download Media Room. w.example stopped answering. Check the Wi-Fi and try again.") == 0, "%s",
        panel());
  CHECK(nothing_left(), "nothing is left after the stall");
  fake_frame(fake, kButtonA, 0);
  fake_frame(fake, 0, 0);
  fake_frame(fake, kButtonB, 0);
  CHECK(app->screen == &player_shelf_screen && fake->connections_live == 0 && nothing_left(),
        "B mid-download goes back to the shelf with nothing open and nothing written");
  stop();
  forget_world();
}

static void every_way_the_list_cannot_be_had_is_said(void) {
  start("unreachable");
  fake->wifi = kWifiNotAvailable;
  CHECK(open_more() != NULL, "the screen");
  fake_frame(fake, 0, 0);
  CHECK(HAS(panel(), "No Wi-Fi network is set up on this Playdate") && HAS(panel(), "A tries again, B goes back."),
        "%s", panel());
  fake->wifi = kWifiConnected;
  fake->access = kAccessAsk;
  fake->allow_when_asked = 0;
  fake_frame(fake, kButtonA, 0);
  CHECK(HAS(panel(), "Asking your permission to reach w.example... B stops."), "%s", panel());
  CHECK(frames_until("was not allowed to use the network for w.example", 5), "%s", panel());
  fake->access = kAccessAllow;
  fake_frame(fake, kButtonA, 0);
  CHECK(HAS(panel(), "Asking for the list of worlds... B stops."), "%s", panel());
  CHECK(frames_until("There is no list of worlds at that address (the server answered 404).", 5), "%s", panel());
  fake->api.network = NULL;
  fake_frame(fake, kButtonA, 0);
  CHECK(HAS(panel(), "no network support"), "%s", panel());
  fake->api.network = &fake->network;
  fake_serve(fake, INDEX_URL, 200, "{\"worlds\":[],\"signed\":\"00\"}", 27);
  fake_frame(fake, kButtonA, 0);
  screen()->trusts = trusts_anything;
  CHECK(frames_until("The list of worlds has none in it. B goes back to the shelf.", 5), "an empty list is said: %s", panel());
  stop();
}

static void a_file_is_named_for_its_title_as_the_publisher_names_it(void) {
  player_host host;
  sprout_arena arena;
  sprout_json *pairs = NULL;
  sprout_json_error error;
  char *text = fixture_text("stems.json");
  size_t i;
  begin("stems");
  player_host_init(&host, &fake->api);
  sprout_arena_init(&arena, &host.record);
  CHECK(sprout_json_read(&arena, text, strlen(text), &pairs, &error) == SPROUT_OK, "stems.json: %s", error.text);
  CHECK(pairs != NULL && pairs->kind == SPROUT_JSON_ARRAY && pairs->count > 0, "stems.json lists titles");
  for (i = 0; pairs != NULL && i < pairs->count; i++) {
    const sprout_json *pair = pairs->items[i];
    char stem[32];
    player_downloads_stem(pair->items[0]->bytes, stem, sizeof stem);
    CHECK(strcmp(stem, pair->items[1]->bytes) == 0, "\"%s\" is %s, not %s", pair->items[0]->bytes, stem,
          pair->items[1]->bytes);
  }
  sprout_arena_reset(&arena);
  free(text);
  end();
}

int main(void) {
  test_program("downloads");
  a_file_is_named_for_its_title_as_the_publisher_names_it();
  the_signed_index_is_listed_and_one_changed_is_refused();
  a_chosen_world_arrives_whole_and_is_shelved();
  of_several_builds_the_newest_is_offered_and_downloaded();
  a_world_whose_bytes_are_not_the_listed_ones_is_refused_and_leaves_nothing();
  leaving_mid_download_leaves_nothing_behind();
  every_way_the_list_cannot_be_had_is_said();
  return finish();
}
