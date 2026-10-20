/*
 * host/net.c: fetching over the SDK's HTTP API, against the fake's canned server. The rules: an
 * address is taken apart and resolved as a browser would; a fetch asks permission for its server
 * with the purpose it was given, waits for the person's answer and is refused in words when it is
 * not given; the body reaches the sink whole and in order, whatever the pieces; a redirect is
 * followed, to another server and to a signed address over a kilobyte long, and a chain too long or
 * an address past PLAYER_URL_BYTES refused; a server that falls silent is given up on; a sink that
 * refuses stops the fetch; and every fetch, however it ends, lets its connection go.
 */
#include "host/net.h"
#include "support.h"

static const char PURPOSE[] = "to test";

typedef struct taken {
  char bytes[1 << 16];
  size_t length, pieces, most;
} taken;

static bool take(void *ctx, const char *bytes, size_t length) {
  taken *t = (taken *)ctx;
  if (t->most != 0 && t->length + length > t->most) return false;
  memcpy(t->bytes + t->length, bytes, length);
  t->length += length;
  t->pieces++;
  return true;
}

/* Runs the fetch to its end, a network step and a second at a time; the state it ended in. */
static player_fetch_state run(player_fetch *f, int most) {
  player_fetch_state state = PLAYER_FETCH_RUNNING;
  int i;
  for (i = 0; i < most && state == PLAYER_FETCH_RUNNING; i++) {
    fake_network_step(fake);
    fake->seconds++;
    state = player_fetch_poll(f, fake->seconds);
  }
  return state;
}

static void addresses_are_taken_apart_and_resolved(void) {
  player_url parts;
  char why[256], out[PLAYER_URL_BYTES];
  begin("addresses");
  CHECK(player_url_parse("https://worlds.example/sprout/index.json", &parts, why, sizeof why) && parts.ssl &&
            parts.port == 443 && strcmp(parts.server, "worlds.example") == 0 && strcmp(parts.path, "/sprout/index.json") == 0,
        "%s %d %s", parts.server, parts.port, parts.path);
  CHECK(player_url_parse("http://localhost:8080", &parts, why, sizeof why) && !parts.ssl && parts.port == 8080 &&
            strcmp(parts.server, "localhost") == 0 && strcmp(parts.path, "/") == 0,
        "%s %d %s", parts.server, parts.port, parts.path);
  CHECK(player_url_parse("http://a.example?x=1", &parts, why, sizeof why) && strcmp(parts.path, "/?x=1") == 0, "%s", parts.path);
  CHECK(!player_url_parse("ftp://worlds.example/x", &parts, why, sizeof why) &&
            strcmp(why, "The address ftp://worlds.example/x is not an http or https address.") == 0,
        "%s", why);
  CHECK(!player_url_parse("https:///x", &parts, why, sizeof why) && HAS(why, "names no server"), "%s", why);
  CHECK(!player_url_parse("https://me@worlds.example/x", &parts, why, sizeof why) && HAS(why, "names no server"), "%s", why);
  CHECK(player_url_resolve("https://w.example/sprout/index.json", "bell.sproutworld", out, sizeof out) &&
            strcmp(out, "https://w.example/sprout/bell.sproutworld") == 0,
        "%s", out);
  CHECK(player_url_resolve("https://w.example/sprout/index.json?v=2", "a/b%20c.png", out, sizeof out) &&
            strcmp(out, "https://w.example/sprout/a/b%20c.png") == 0,
        "%s", out);
  CHECK(player_url_resolve("http://w.example:8080/sprout/index.json", "/top.sproutworld", out, sizeof out) &&
            strcmp(out, "http://w.example:8080/top.sproutworld") == 0,
        "%s", out);
  CHECK(player_url_resolve("https://w.example/sprout/index.json", "http://other.example/x", out, sizeof out) &&
            strcmp(out, "http://other.example/x") == 0,
        "%s", out);
  CHECK(player_url_resolve("https://w.example?v=2", "bell.sproutworld", out, sizeof out) &&
            strcmp(out, "https://w.example/bell.sproutworld") == 0,
        "%s", out);
  CHECK(!player_url_resolve("https://w.example/sprout/index.json", "bell.sproutworld", out, 20), "too long for its room");
  end();
}

static void a_body_reaches_the_sink_whole_whatever_the_pieces(void) {
  static char body[20000];
  static taken t;
  player_fetch f;
  size_t i;
  begin("body");
  for (i = 0; i < sizeof body; i++) body[i] = (char)('a' + i % 26);
  fake_serve(fake, "https://w.example/sprout/index.json", 200, body, sizeof body);
  fake->piece = 3001;
  memset(&t, 0, sizeof t);
  CHECK(player_net_ready(&fake->api, t.bytes, sizeof t.bytes) && fake->wifi_enabled, "the Wi-Fi is asked to come up");
  CHECK(player_fetch_start(&f, &fake->api, "https://w.example/sprout/index.json", PURPOSE, take, &t, fake->seconds), "%s",
        f.reason);
  CHECK(fake->asks == 1 && strcmp(fake->asked_purpose, PURPOSE) == 0, "permission is asked with the purpose");
  CHECK(run(&f, 100) == PLAYER_FETCH_DONE && f.status == 200, "%s", f.reason);
  CHECK(t.length == sizeof body && memcmp(t.bytes, body, sizeof body) == 0 && t.pieces > 1, "the body whole, in %zu pieces",
        t.pieces);
  CHECK(fake->connections_live == 0, "the connection is let go");
  player_net_finish(&fake->api);
  CHECK(!fake->wifi_enabled, "and the Wi-Fi may sleep");
  end();
}

static void a_status_is_handed_back_and_a_redirect_followed(void) {
  static taken t;
  player_fetch f;
  fake_answer *moved;
  begin("redirect");
  memset(&t, 0, sizeof t);
  CHECK(player_fetch_start(&f, &fake->api, "https://w.example/missing", PURPOSE, take, &t, fake->seconds), "%s", f.reason);
  CHECK(run(&f, 10) == PLAYER_FETCH_DONE && f.status == 404, "an unknown address is a 404: %d", f.status);
  moved = fake_serve(fake, "https://w.example/old/index.json", 302, "moved", 5);
  moved->location = "/new/index.json";
  fake_serve(fake, "https://w.example/new/index.json", 200, "{}", 2);
  memset(&t, 0, sizeof t);
  CHECK(player_fetch_start(&f, &fake->api, "https://w.example/old/index.json", PURPOSE, take, &t, fake->seconds), "%s", f.reason);
  CHECK(run(&f, 20) == PLAYER_FETCH_DONE && f.status == 200 && t.length == 2 && memcmp(t.bytes, "{}", 2) == 0,
        "the redirect is followed and its own body never reaches the sink: %d %zu", f.status, t.length);
  CHECK(strcmp(f.url, "https://w.example/new/index.json") == 0, "%s", f.url);
  moved = fake_serve(fake, "https://w.example/loop", 301, "", 0);
  moved->location = "/loop";
  CHECK(player_fetch_start(&f, &fake->api, "https://w.example/loop", PURPOSE, take, &t, fake->seconds), "%s", f.reason);
  CHECK(run(&f, 50) == PLAYER_FETCH_FAILED &&
            strcmp(f.reason, "w.example sent the app on to another address too many times, or to none.") == 0,
        "%s", f.reason);
  CHECK(fake->connections_live == 0, "every connection is let go");
  end();
}

/* A signed download address, as a release asset's redirect gives: `https://assets.example/a/b.sproutworld?` and a query, `length` long in all. */
static void signed_address(char *out, size_t length) {
  static const char start[] = "https://assets.example/a/b.sproutworld?X-Signature=";
  size_t i;
  memcpy(out, start, sizeof start - 1);
  for (i = sizeof start - 1; i < length; i++) out[i] = (char)('a' + i % 26);
  out[length] = '\0';
}

static void a_redirect_to_a_long_address_on_another_server_is_followed(void) {
  static taken t;
  static char signed_url[PLAYER_URL_BYTES + 64];
  player_fetch f;
  fake_answer *moved;
  int asks;
  begin("long redirect");
  signed_address(signed_url, 1200);
  moved = fake_serve(fake, "https://w.example/release/b.sproutworld", 302, "", 0);
  moved->location = signed_url;
  fake_serve(fake, signed_url, 200, "world", 5);
  memset(&t, 0, sizeof t);
  asks = fake->asks;
  CHECK(player_fetch_start(&f, &fake->api, "https://w.example/release/b.sproutworld", PURPOSE, take, &t, fake->seconds), "%s",
        f.reason);
  CHECK(run(&f, 20) == PLAYER_FETCH_DONE && f.status == 200 && t.length == 5 && memcmp(t.bytes, "world", 5) == 0,
        "a Location of 1200 bytes is followed: %d %s", f.status, f.reason);
  CHECK(strcmp(f.url, signed_url) == 0 && strcmp(f.parts.server, "assets.example") == 0, "%s", f.parts.server);
  CHECK(fake->asks == asks + 2, "the new server is asked for again: %d", fake->asks - asks);

  signed_address(signed_url, PLAYER_URL_BYTES);
  moved = fake_serve(fake, "https://w.example/release/c.sproutworld", 302, "", 0);
  moved->location = signed_url;
  CHECK(player_fetch_start(&f, &fake->api, "https://w.example/release/c.sproutworld", PURPOSE, take, &t, fake->seconds), "%s",
        f.reason);
  CHECK(run(&f, 20) == PLAYER_FETCH_FAILED &&
            strcmp(f.reason, "w.example sent the app on to an address longer than this app reads.") == 0,
        "%s", f.reason);
  CHECK(fake->connections_live == 0, "every connection is let go");
  end();
}

static void permission_is_asked_and_its_refusal_said(void) {
  static taken t;
  player_fetch f;
  begin("permission");
  fake_serve(fake, "http://w.example/index.json", 200, "{}", 2);
  fake->access = kAccessAsk;
  fake->allow_when_asked = 1;
  CHECK(player_fetch_start(&f, &fake->api, "http://w.example/index.json", PURPOSE, take, &t, fake->seconds), "%s", f.reason);
  CHECK(f.asked != 0 && fake->connection_count == 0, "nothing is opened until the person answers");
  fake->seconds += 600;
  CHECK(player_fetch_poll(&f, fake->seconds) == PLAYER_FETCH_RUNNING, "the person may take their time");
  CHECK(run(&f, 10) == PLAYER_FETCH_DONE && f.status == 200, "allowed, it runs: %s", f.reason);

  fake->allow_when_asked = 0;
  CHECK(player_fetch_start(&f, &fake->api, "http://w.example/index.json", PURPOSE, take, &t, fake->seconds), "%s", f.reason);
  CHECK(run(&f, 10) == PLAYER_FETCH_FAILED &&
            strcmp(f.reason, "This app was not allowed to use the network for w.example. Choose \"more worlds...\" again "
                             "and allow it, or leave the shelf as it is.") == 0,
        "%s", f.reason);
  fake->access = kAccessDeny;
  CHECK(!player_fetch_start(&f, &fake->api, "http://w.example/index.json", PURPOSE, take, &t, fake->seconds) &&
            HAS(f.reason, "was not allowed to use the network for w.example"),
        "refused outright: %s", f.reason);
  CHECK(fake->connections_live == 0, "nothing is left open");
  end();
}

static void no_network_no_wifi_and_a_silent_server_are_told(void) {
  static taken t;
  char why[PLAYER_NET_REASON_BYTES];
  player_fetch f;
  fake_answer *silent;
  begin("unreachable");
  fake->wifi = kWifiNotAvailable;
  CHECK(!player_net_ready(&fake->api, why, sizeof why) && HAS(why, "No Wi-Fi network is set up on this Playdate"), "%s", why);
  fake->wifi = kWifiConnected;
  fake->api.network = NULL;
  CHECK(!player_net_ready(&fake->api, why, sizeof why) && HAS(why, "no network support"), "%s", why);
  CHECK(!player_fetch_start(&f, &fake->api, "http://w.example/", PURPOSE, take, &t, fake->seconds) &&
            HAS(f.reason, "no network support"),
        "%s", f.reason);
  fake->api.network = &fake->network;
  silent = fake_serve(fake, "http://w.example/slow", 200, "never", 5);
  silent->silent = 1;
  CHECK(player_fetch_start(&f, &fake->api, "http://w.example/slow", PURPOSE, take, &t, fake->seconds), "%s", f.reason);
  CHECK(run(&f, PLAYER_NET_STALL_SECONDS) == PLAYER_FETCH_RUNNING, "it waits as long as a server may be quiet");
  CHECK(run(&f, 5) == PLAYER_FETCH_FAILED && strcmp(f.reason, "w.example stopped answering. Check the Wi-Fi and try again.") == 0,
        "%s", f.reason);
  CHECK(fake->connections_live == 0, "and lets it go");
  end();
}

static void a_sink_that_refuses_stops_the_fetch_and_cancel_lets_go(void) {
  static char body[8000];
  static taken t;
  player_fetch f;
  begin("stopped");
  memset(body, 'x', sizeof body);
  fake_serve(fake, "http://w.example/big", 200, body, sizeof body);
  memset(&t, 0, sizeof t);
  t.most = 2000;
  CHECK(player_fetch_start(&f, &fake->api, "http://w.example/big", PURPOSE, take, &t, fake->seconds), "%s", f.reason);
  CHECK(run(&f, 20) == PLAYER_FETCH_STOPPED && t.length <= 2000 && f.status == 200, "stopped at %zu bytes, status %d",
        t.length, f.status);
  CHECK(fake->connections_live == 0, "the connection is let go");
  CHECK(player_fetch_start(&f, &fake->api, "http://w.example/big", PURPOSE, take, &t, fake->seconds), "%s", f.reason);
  fake_network_step(fake);
  player_fetch_cancel(&f);
  CHECK(fake->connections_live == 0 && f.conn == NULL, "cancelled, nothing is left open");
  player_fetch_cancel(&f);
  end();
}

int main(void) {
  test_program("net");
  addresses_are_taken_apart_and_resolved();
  a_body_reaches_the_sink_whole_whatever_the_pieces();
  a_status_is_handed_back_and_a_redirect_followed();
  a_redirect_to_a_long_address_on_another_server_is_followed();
  permission_is_asked_and_its_refusal_said();
  no_network_no_wifi_and_a_silent_server_are_told();
  a_sink_that_refuses_stops_the_fetch_and_cancel_lets_go();
  return finish();
}
