/*
 * ui/downloads.c: the download screen, driven through the app a frame at a time over the fake's
 * canned server. The rules: "more worlds..." fetches the index the Data folder's settings name,
 * asking permission with the app's purpose; an index is listed only once its signature verifies
 * against the baked key, and one that does not is refused in words that the shelf repeats; a
 * world chosen arrives whole, its files checked against the index and put in place, the cartridge
 * last, and is shelved; and a world whose bytes are not the ones listed (another checksum, more
 * bytes, a missing file, another build) is refused in words and leaves nothing behind. Every way
 * the network fails is said, and leaving mid-download leaves nothing half written or open.
 */
#include <stdlib.h>

#include "shipping.h"
#include "support.h"
#include "ui/app.h"
#include "ui/downloads.h"
#include "ui/shelf.h"

#define LINE FAKE_LINE
#define ROW(n) (LINE + 4 + 2 + (n) * LINE)
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

static const char *row(int n) {
  const fake_run *run = fake_run_at(fake, PLAYER_MARGIN, ROW(n));
  return run != NULL ? run->text : "";
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

/* ---- a world to download: teashop and one picture, served from the test's own copies ---- */

typedef struct served {
  char hash[65], sha[65], picture_sha[65];
  char *cartridge, *picture;
  size_t cartridge_bytes, picture_bytes;
  char index[4096];
  char final[256];
} served;

static served world;

static void forget_teashop(void) {
  free(world.cartridge);
  free(world.picture);
  world.cartridge = world.picture = NULL;
}

/* Lists teashop under the title "Tea Shop", with `hash` (NULL: its own) and the cartridge's true size and checksum. */
static void list_teashop(const char *hash) {
  char command[1200];
  size_t bytes = 0;
  player_opening seen;
  forget_teashop();
  snprintf(command, sizeof command, "mkdir -p '%s/served' && cp '%s/teashop.sproutworld' '%s/served/'", fake->data,
           PLAYER_CARTRIDGES, fake->data);
  CHECK(system(command) == 0, "%s", command);
  write_text("served/cellar.png", "not really a picture, but bytes all the same");
  seen = player_inspect(app->session, "served/teashop.sproutworld");
  CHECK(seen.ok && seen.hash != NULL, "%s", seen.reason);
  snprintf(world.hash, sizeof world.hash, "%s", seen.ok ? seen.hash : "");
  CHECK(player_digest(&fake->api, "served/teashop.sproutworld", world.sha, &bytes) == NULL, "the digest");
  CHECK(player_digest(&fake->api, "served/cellar.png", world.picture_sha, &bytes) == NULL, "the picture's digest");
  world.cartridge = bytes_of("served/teashop.sproutworld", &world.cartridge_bytes);
  world.picture = bytes_of("served/cellar.png", &world.picture_bytes);
  snprintf(world.index, sizeof world.index,
           "{\"worlds\":[{\"title\":\"Tea Shop\",\"author\":\"Ada\",\"version\":\"1.0.0\",\"bytes\":%zu,\"hash\":\"%s\","
           "\"sha256\":\"%s\",\"url\":\"teashop.sproutworld\",\"assets\":[{\"path\":\"pictures/cellar.png\",\"bytes\":%zu,"
           "\"sha256\":\"%s\",\"url\":\"/files/cellar.png\"}]}],\"signed\":\"00\"}",
           world.cartridge_bytes, hash != NULL ? hash : world.hash, world.sha, world.picture_bytes, world.picture_sha);
  snprintf(world.final, sizeof world.final, "worlds/tea-shop-%.8s.sproutworld", world.hash);
  fake_serve(fake, INDEX_URL, 200, world.index, strlen(world.index));
}

/* Whether nothing of the world is in worlds/: no part, no cartridge, no assets folder. */
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
  CHECK(strcmp(row(0), "> Caf\xc3\xa9 \"Moss\"\tTea  1.2.0  26.4 KB") == 0, "%s", row(0));
  CHECK(strcmp(row(1), "  Bell  0.1.0  4.0 KB") == 0, "%s", row(1));
  CHECK(strcmp(panel(), "by Ada \\ Bo, version 1.2.0, 26.4 KB. A downloads it.") == 0, "%s", panel());
  fake_frame(fake, kButtonDown, 0);
  CHECK(strcmp(row(1), "> Bell  0.1.0  4.0 KB") == 0 && HAS(panel(), "by Eve"), "down selects the next: %s", panel());
  fake_frame(fake, 0, 24.0f);
  CHECK(strcmp(row(0), "> Caf\xc3\xa9 \"Moss\"\tTea  1.2.0  26.4 KB") == 0, "the crank wraps round: %s", row(0));
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
  CHECK(HAS(panel(), NOT_TRUSTED) && strcmp(row(0), "") == 0, "refused with nothing listed: %s", panel());
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
  char asset[400], part[300];
  start("arrives");
  list_teashop(NULL);
  fake_serve(fake, "https://w.example/sprout/teashop.sproutworld", 200, world.cartridge, world.cartridge_bytes);
  fake_serve(fake, "https://w.example/files/cellar.png", 200, world.picture, world.picture_bytes);
  CHECK(open_listed() != NULL, "the screen");
  CHECK(HAS(row(0), "> Tea Shop  1.0.0  ") && !HAS(row(0), "on your shelf"), "%s", row(0));
  fake->piece = 4096;
  fake_frame(fake, kButtonA, 0);
  CHECK(HAS(panel(), "Downloading Tea Shop: file 1 of 2 (Tea Shop, "), "progress: %s", panel());
  fake_frame(fake, 0, 0);
  CHECK(HAS(panel(), "%. B stops.") && !HAS(panel(), " 0%"), "the share arrived so far: %s", panel());
  CHECK(frames_until("Tea Shop is on your shelf.", 400), "%s", panel());
  snprintf(asset, sizeof asset, "%s.assets/pictures/cellar.png", world.final);
  snprintf(part, sizeof part, "%s.part", world.final);
  CHECK(exists(world.final) && exists(asset) && !exists(part), "the cartridge %s and its picture are in place, no part left",
        world.final);
  {
    size_t length = 0;
    char *got = bytes_of(world.final, &length);
    CHECK(length == world.cartridge_bytes && memcmp(got, world.cartridge, length) == 0, "the bytes are the ones served");
    free(got);
  }
  CHECK(HAS(row(0), "(on your shelf)"), "the list marks it: %s", row(0));
  fake_frame(fake, kButtonA, 0);
  CHECK(strcmp(panel(), "Tea Shop is already on your shelf.") == 0, "%s", panel());
  fake_frame(fake, kButtonB, 0);
  CHECK(app->screen == &player_shelf_screen && strcmp(row(0), "> Teashop") == 0, "the shelf lists it: %s", row(0));
  stop();
  forget_teashop();
}

/* Runs a download of the listed world to its refusal; the panel's words. */
static const char *refused_download(void) {
  CHECK(open_listed() != NULL, "the screen");
  fake_frame(fake, kButtonA, 0);
  CHECK(frames_until("Could not download Tea Shop. ", 400), "%s", panel());
  return panel();
}

static void a_world_whose_bytes_are_not_the_listed_ones_is_refused_and_leaves_nothing(void) {
  char *changed;
  start("checksum");
  list_teashop(NULL);
  changed = (char *)malloc(world.cartridge_bytes + 1);
  memcpy(changed, world.cartridge, world.cartridge_bytes);
  changed[world.cartridge_bytes / 2] ^= 0x20;
  fake_serve(fake, "https://w.example/sprout/teashop.sproutworld", 200, changed, world.cartridge_bytes);
  CHECK(strcmp(refused_download(),
               "Could not download Tea Shop. Tea Shop does not match the checksum in the list, so it was thrown away.") == 0,
        "%s", panel());
  CHECK(nothing_left(), "nothing is left in worlds/");
  stop();

  start("longer");
  list_teashop(NULL);
  memcpy(changed, world.cartridge, world.cartridge_bytes);
  changed[world.cartridge_bytes] = 'x';
  fake_serve(fake, "https://w.example/sprout/teashop.sproutworld", 200, changed, world.cartridge_bytes + 1);
  CHECK(strcmp(refused_download(),
               "Could not download Tea Shop. Tea Shop is longer than the list says it is, so it was thrown away.") == 0,
        "%s", panel());
  CHECK(nothing_left(), "nothing is left in worlds/");
  stop();

  start("missing");
  list_teashop(NULL);
  fake_serve(fake, "https://w.example/sprout/teashop.sproutworld", 200, world.cartridge, world.cartridge_bytes);
  CHECK(strcmp(refused_download(), "Could not download Tea Shop. There is no pictures/cellar.png at that address (the "
                                   "server answered 404).") == 0,
        "%s", panel());
  CHECK(nothing_left(), "the cartridge's part and the assets folder are gone");
  stop();

  start("another-build");
  list_teashop("0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef");
  fake_serve(fake, "https://w.example/sprout/teashop.sproutworld", 200, world.cartridge, world.cartridge_bytes);
  fake_serve(fake, "https://w.example/files/cellar.png", 200, world.picture, world.picture_bytes);
  CHECK(strcmp(refused_download(), "Could not download Tea Shop. The cartridge that arrived is not the build the list "
                                   "describes (its bundle hash differs), so it was thrown away.") == 0,
        "%s", panel());
  CHECK(nothing_left(), "the picture put in place is taken away with the cartridge");
  fake_frame(fake, kButtonDown, 0);
  CHECK(HAS(panel(), "A downloads it."), "moving on clears the refusal: %s", panel());
  stop();
  free(changed);
  forget_teashop();
}

static void leaving_mid_download_leaves_nothing_behind(void) {
  fake_answer *slow;
  start("leaving");
  list_teashop(NULL);
  slow = fake_serve(fake, "https://w.example/sprout/teashop.sproutworld", 200, world.cartridge, world.cartridge_bytes);
  slow->silent = 1;
  CHECK(open_listed() != NULL, "the screen");
  fake_frame(fake, kButtonA, 0);
  fake_frame(fake, kButtonDown, 0);
  CHECK(HAS(panel(), "Downloading Tea Shop") && HAS(panel(), "B stops."), "the d-pad does nothing while it runs: %s", panel());
  fake->seconds += PLAYER_NET_STALL_SECONDS + 1;
  CHECK(frames_until("stopped answering", 3), "a silent server is given up on: %s", panel());
  CHECK(strcmp(panel(), "Could not download Tea Shop. w.example stopped answering. Check the Wi-Fi and try again.") == 0, "%s",
        panel());
  CHECK(nothing_left(), "nothing is left after the stall");
  fake_frame(fake, kButtonA, 0);
  fake_frame(fake, 0, 0);
  fake_frame(fake, kButtonB, 0);
  CHECK(app->screen == &player_shelf_screen && fake->connections_live == 0 && nothing_left(),
        "B mid-download goes back to the shelf with nothing open and nothing written");
  stop();
  forget_teashop();
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

int main(void) {
  test_program("downloads");
  the_signed_index_is_listed_and_one_changed_is_refused();
  a_chosen_world_arrives_whole_and_is_shelved();
  a_world_whose_bytes_are_not_the_listed_ones_is_refused_and_leaves_nothing();
  leaving_mid_download_leaves_nothing_behind();
  every_way_the_list_cannot_be_had_is_said();
  return finish();
}
