/* Fetching over the SDK's HTTP API; see net.h. */
#include "net.h"

#include <string.h>

#include "stack.h"
#include "text.h"

/* The most bytes a poll reads, so one frame is never held up by a fast server. */
#define MOST_PER_POLL 65536u

/* ---- addresses ---- */

static bool is_letter(char c) { return (c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z'); }

/* The length of the scheme of `url` and its `://`, or 0 when it has none. */
static size_t scheme_length(const char *url) {
  size_t n = 0;
  while (is_letter(url[n])) n++;
  return n > 0 && strncmp(url + n, "://", 3) == 0 ? n + 3 : 0;
}

static void say(char *out, size_t size, const char *a, const char *b, const char *c) {
  text_buffer words;
  text_begin(&words, out, size);
  text_add(&words, a);
  text_add(&words, b);
  text_add(&words, c);
}

bool player_url_parse(const char *url, player_url *parts, char *why, size_t size) {
  size_t scheme = scheme_length(url), authority, host, i;
  unsigned long port = 0;
  memset(parts, 0, sizeof *parts);
  if (scheme == 0 || !((scheme == 7 && strncmp(url, "http", 4) == 0) || (scheme == 8 && strncmp(url, "https", 5) == 0))) {
    say(why, size, "The address ", url, " is not an http or https address.");
    return false;
  }
  parts->ssl = scheme == 8;
  url += scheme;
  authority = strcspn(url, "/?#");
  host = authority;
  for (i = authority; i > 0 && url[i - 1] >= '0' && url[i - 1] <= '9'; i--) continue;
  if (i < authority && i > 0 && url[i - 1] == ':') {
    host = i - 1;
    for (; i < authority && port <= 65535; i++) port = port * 10 + (unsigned long)(url[i] - '0');
  }
  for (i = 0; i < host; i++)
    if (url[i] == '@' || url[i] == ':' || url[i] == ' ' || url[i] == '\t' || url[i] == '\n' || url[i] == '\r') break;
  if (host == 0 || i < host || host >= sizeof parts->server || port > 65535) {
    say(why, size, "The address ", url - scheme, " names no server this app can reach.");
    return false;
  }
  memcpy(parts->server, url, host);
  parts->server[host] = '\0';
  parts->port = port != 0 ? (int)port : parts->ssl ? 443 : 80;
  url += authority;
  if (strlen(url) + 2 > sizeof parts->path) {
    say(why, size, "The address ", url - authority - scheme, " is longer than this app reads.");
    return false;
  }
  if (url[0] != '/') parts->path[0] = '/';
  strcat(parts->path, url);
  return true;
}

bool player_url_resolve(const char *base, const char *address, char *out, size_t size) {
  size_t keep = 0, n = strlen(address);
  bool slash = false;
  if (scheme_length(address) == 0 && scheme_length(base) > 0) {
    const char *path = base + scheme_length(base);
    path += strcspn(path, "/?#");
    keep = (size_t)(path - base);
    if (address[0] != '/') {
      /* The folder of the base's path: up to its last `/` before any query or fragment, or `/` where it has none. */
      size_t folder = strcspn(path, "?#");
      while (folder > 0 && path[folder - 1] != '/') folder--;
      keep += folder;
      slash = folder == 0;
    }
  }
  if (keep + (slash ? 1 : 0) + n >= size) return false;
  memcpy(out, base, keep);
  if (slash) out[keep++] = '/';
  memcpy(out + keep, address, n + 1);
  return true;
}

/* ---- the system's answers, which come by callback ---- */

static const struct playdate_http *http_api;
static unsigned asks;              /* the permissions asked for so far, so each has a number */
static unsigned answered;          /* the number of the last answered, 0 when none */
static bool answered_allowed;
static PDNetErr wifi_error = NET_OK;

static void access_answered(bool allowed, void *userdata) {
  answered = (unsigned)(uintptr_t)userdata;
  answered_allowed = allowed;
}

static void wifi_answered(PDNetErr error) { wifi_error = error; }

static void request_over(HTTPConnection *conn) {
  player_fetch *f = (player_fetch *)http_api->getUserdata(conn);
  if (f != NULL) f->finished = true;
}

static bool same_name(const char *a, const char *b) {
  for (; *a != '\0' && *b != '\0'; a++, b++) {
    char x = *a >= 'A' && *a <= 'Z' ? (char)(*a - 'A' + 'a') : *a, y = *b >= 'A' && *b <= 'Z' ? (char)(*b - 'A' + 'a') : *b;
    if (x != y) return false;
  }
  return *a == *b;
}

static void header_read(HTTPConnection *conn, const char *key, const char *value) {
  player_fetch *f = (player_fetch *)http_api->getUserdata(conn);
  size_t n = strlen(value);
  if (f == NULL || !same_name(key, "location")) return;
  f->location_too_long = n >= sizeof f->location;
  if (!f->location_too_long) memcpy(f->location, value, n + 1);
}

/* ---- words ---- */

static const char *error_words(PDNetErr error) {
  switch (error) {
    case NET_NO_DEVICE: return "this Playdate has no network device";
    case NET_BUSY: return "the network was busy";
    case NET_WRITE_ERROR: case NET_WRITE_BUSY: return "the request could not be sent";
    case NET_WRITE_TIMEOUT: case NET_READ_TIMEOUT: case NET_RESET_TIMEOUT: return "it took too long";
    case NET_READ_ERROR: case NET_READ_BUSY: case NET_READ_OVERFLOW: return "the answer could not be received";
    case NET_FRAME_ERROR: case NET_BAD_RESPONSE: case NET_ERROR_RESPONSE: case NET_UNEXPECTED_RESPONSE:
      return "the answer could not be read";
    case NET_BUFFER_TOO_SMALL: return "the answer was too large to take in";
    case NET_NOT_CONNECTED_TO_AP: return "the Playdate is not connected to Wi-Fi";
    case NET_NOT_IMPLEMENTED: return "this Playdate cannot make that request";
    case NET_CONNECTION_CLOSED: return "the server closed the connection";
    default: return "the network gave an error";
  }
}

static void fail_with(player_fetch *f, const char *a, const char *b, const char *c) {
  say(f->reason, sizeof f->reason, a, b, c);
}

/* Adds `text` to the end of the reason. */
static void fail_more(player_fetch *f, const char *text) {
  size_t n = strlen(f->reason);
  text_buffer more;
  text_begin(&more, f->reason + n, sizeof f->reason - n);
  text_add(&more, text);
}

/* ---- the connection ---- */

static void let_go(player_fetch *f) {
  if (f->conn == NULL) return;
  http_api->setUserdata(f->conn, NULL);
  http_api->close(f->conn);
  http_api->release(f->conn);
  f->conn = NULL;
}

static const char NOT_ALLOWED_TAIL[] = ". Choose \"more worlds...\" again and allow it, or leave the shelf as it is.";

/* Opens the connection for the address in `f->parts`, permission given, and sends the request. */
static bool open_connection(player_fetch *f) {
  PDNetErr sent;
  f->conn = http_api->newConnection(f->parts.server, f->parts.port, f->parts.ssl);
  if (f->conn == NULL) {
    fail_with(f, "This app was not allowed to use the network for ", f->parts.server, NOT_ALLOWED_TAIL);
    return false;
  }
  http_api->setUserdata(f->conn, f);
  http_api->setConnectTimeout(f->conn, PLAYER_NET_CONNECT_SECONDS * 1000);
  http_api->setHeaderReceivedCallback(f->conn, header_read);
  http_api->setRequestCompleteCallback(f->conn, request_over);
  http_api->setConnectionClosedCallback(f->conn, request_over);
  sent = http_api->get(f->conn, f->parts.path, NULL, 0);
  if (sent != NET_OK) {
    let_go(f);
    fail_with(f, "The request to ", f->parts.server, " could not be made: ");
    fail_more(f, error_words(sent));
    fail_more(f, ".");
    return false;
  }
  return true;
}

/* Asks permission for the server of `url` and, where it is given now, connects; false with the reason. */
static bool connect_to(player_fetch *f, const char *url) {
  enum accessReply reply;
  unsigned ask;
  if (strlen(url) >= sizeof f->url) {
    fail_with(f, "An address in the list of worlds is longer than this app reads.", "", "");
    return false;
  }
  memmove(f->url, url, strlen(url) + 1);
  if (!player_url_parse(f->url, &f->parts, f->reason, sizeof f->reason)) return false;
  f->finished = false;
  f->location[0] = '\0';
  f->location_too_long = false;
  f->status = 0;
  ask = ++asks;
  if (ask == 0) ask = ++asks;
  reply = http_api->requestAccess(f->parts.server, f->parts.port, f->parts.ssl, f->purpose, access_answered,
                                  (void *)(uintptr_t)ask);
  if (reply == kAccessAsk && answered != ask) {
    f->asked = ask;
    return true;
  }
  if (reply == kAccessDeny || (reply == kAccessAsk && !answered_allowed)) {
    fail_with(f, "This app was not allowed to use the network for ", f->parts.server, NOT_ALLOWED_TAIL);
    return false;
  }
  return open_connection(f);
}

/* Moves on to the address a redirect named; the fetch carries on there. */
static player_fetch_state follow(player_fetch *f) {
  bool resolved = !f->location_too_long && f->location[0] != '\0' &&
                  player_url_resolve(f->url, f->location, f->next, sizeof f->next);
  let_go(f);
  if (!resolved && (f->location_too_long || f->location[0] != '\0')) {
    fail_with(f, f->parts.server, " sent the app on to an address longer than this app reads.", "");
    return PLAYER_FETCH_FAILED;
  }
  if (!resolved || f->hops >= PLAYER_NET_MOST_REDIRECTS) {
    fail_with(f, f->parts.server, " sent the app on to another address too many times, or to none.", "");
    return PLAYER_FETCH_FAILED;
  }
  f->hops++;
  return connect_to(f, f->next) ? PLAYER_FETCH_RUNNING : PLAYER_FETCH_FAILED;
}

static bool is_redirect(int status) {
  return status == 301 || status == 302 || status == 303 || status == 307 || status == 308;
}

static player_fetch_state poll_now(player_fetch *f, uint64_t now) {
  int status;
  size_t available, taken = 0;
  bool redirecting;
  PDNetErr error;
  if (f->asked != 0) {
    if (answered != f->asked) return PLAYER_FETCH_RUNNING;
    f->asked = 0;
    f->heard = now;
    if (!answered_allowed) {
      fail_with(f, "This app was not allowed to use the network for ", f->parts.server, NOT_ALLOWED_TAIL);
      return PLAYER_FETCH_FAILED;
    }
    return open_connection(f) ? PLAYER_FETCH_RUNNING : PLAYER_FETCH_FAILED;
  }
  if (f->conn == NULL) return PLAYER_FETCH_FAILED;
  status = http_api->getResponseStatus(f->conn);
  redirecting = is_redirect(status);
  available = http_api->getBytesAvailable(f->conn);
  while (available > 0 && taken < MOST_PER_POLL) {
    int got = http_api->read(f->conn, f->piece, (unsigned)(available < sizeof f->piece ? available : sizeof f->piece));
    if (got <= 0) break;
    f->heard = now;
    taken += (size_t)got;
    if (!redirecting && !f->sink(f->sink_ctx, f->piece, (size_t)got)) {
      f->status = status;
      let_go(f);
      return PLAYER_FETCH_STOPPED;
    }
    available = http_api->getBytesAvailable(f->conn);
  }
  if (available > 0) return PLAYER_FETCH_RUNNING; /* the rest next frame */
  error = http_api->getError(f->conn);
  if (error != NET_OK && !(f->finished && error == NET_CONNECTION_CLOSED)) {
    fail_with(f, "The connection to ", f->parts.server, " failed: ");
    fail_more(f, error_words(error));
    if (wifi_error != NET_OK) {
      fail_more(f, " (Wi-Fi: ");
      fail_more(f, error_words(wifi_error));
      fail_more(f, ")");
    }
    fail_more(f, ".");
    let_go(f);
    return PLAYER_FETCH_FAILED;
  }
  if (f->finished) {
    if (status == 0) {
      fail_with(f, f->parts.server, " sent no answer.", "");
      let_go(f);
      return PLAYER_FETCH_FAILED;
    }
    if (redirecting) return follow(f);
    f->status = status;
    let_go(f);
    return PLAYER_FETCH_DONE;
  }
  if (now > f->heard && now - f->heard > PLAYER_NET_STALL_SECONDS) {
    fail_with(f, f->parts.server, " stopped answering. Check the Wi-Fi and try again.", "");
    let_go(f);
    return PLAYER_FETCH_FAILED;
  }
  return PLAYER_FETCH_RUNNING;
}

/* ---- on the main stack ---- */

typedef struct net_call {
  PlaydateAPI *pd;
  player_fetch *f;
  const char *url;
  uint64_t now;
  char *why;
  size_t size;
} net_call;

static bool has_http(PlaydateAPI *pd) { return pd->network != NULL && pd->network->http != NULL; }

static void *ready_thunk(void *ctx) {
  net_call *c = (net_call *)ctx;
  if (!has_http(c->pd)) {
    say(c->why, c->size, "This Playdate's system software has no network support. Update it to 2.7 or later.", "", "");
    return (void *)(intptr_t) false;
  }
  if (c->pd->network->getStatus() == kWifiNotAvailable) {
    say(c->why, c->size,
        "No Wi-Fi network is set up on this Playdate, so there is no way to reach the list of worlds. ",
        "Add one in the Playdate's Settings, then try again.", "");
    return (void *)(intptr_t) false;
  }
  wifi_error = NET_OK;
  c->pd->network->setEnabled(true, wifi_answered);
  return (void *)(intptr_t) true;
}

static void *finish_thunk(void *ctx) {
  net_call *c = (net_call *)ctx;
  if (has_http(c->pd)) c->pd->network->setEnabled(false, NULL);
  return NULL;
}

static void *start_thunk(void *ctx) {
  net_call *c = (net_call *)ctx;
  if (!has_http(c->pd)) {
    fail_with(c->f, "This Playdate's system software has no network support. Update it to 2.7 or later.", "", "");
    return (void *)(intptr_t) false;
  }
  http_api = c->pd->network->http;
  return (void *)(intptr_t)connect_to(c->f, c->url);
}

static void *poll_thunk(void *ctx) {
  net_call *c = (net_call *)ctx;
  return (void *)(intptr_t)poll_now(c->f, c->now);
}

static void *cancel_thunk(void *ctx) {
  net_call *c = (net_call *)ctx;
  c->f->asked = 0;
  let_go(c->f);
  return NULL;
}

bool player_net_ready(PlaydateAPI *pd, char *why, size_t size) {
  net_call c = {pd, NULL, NULL, 0, why, size};
  return (bool)(intptr_t)player_on_main_stack(ready_thunk, &c);
}

void player_net_finish(PlaydateAPI *pd) {
  net_call c = {pd, NULL, NULL, 0, NULL, 0};
  player_on_main_stack(finish_thunk, &c);
}

bool player_fetch_start(player_fetch *f, PlaydateAPI *pd, const char *url, const char *purpose, player_net_sink sink,
                        void *sink_ctx, uint64_t now) {
  net_call c = {pd, f, url, now, NULL, 0};
  memset(f, 0, sizeof *f);
  f->pd = pd;
  f->purpose = purpose;
  f->sink = sink;
  f->sink_ctx = sink_ctx;
  f->heard = now;
  return (bool)(intptr_t)player_on_main_stack(start_thunk, &c);
}

player_fetch_state player_fetch_poll(player_fetch *f, uint64_t now) {
  net_call c = {f->pd, f, NULL, now, NULL, 0};
  return (player_fetch_state)(intptr_t)player_on_main_stack(poll_thunk, &c);
}

void player_fetch_cancel(player_fetch *f) {
  net_call c = {f->pd, f, NULL, 0, NULL, 0};
  if (f->pd == NULL || (f->conn == NULL && f->asked == 0)) return;
  player_on_main_stack(cancel_thunk, &c);
}
