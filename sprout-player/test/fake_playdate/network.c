/* The fake's network: canned answers served a piece a frame, behind the permission a test says the person gives; see fake_playdate.h. */
#include "fake.h"

#include <stdio.h>
#include <stdlib.h>
#include <string.h>

static fake_connection *connection_of(HTTPConnection *conn) {
  fake_connection *c = (fake_connection *)conn;
  int index = (int)(c - fake_current->connections);
  if (index < 0 || index >= fake_current->connection_count || !c->live) abort();
  return c;
}

fake_answer *fake_serve(fake_playdate *fake, const char *url, int status, const char *body, size_t length) {
  fake_answer *answer;
  if (fake->answer_count == FAKE_ANSWERS) abort();
  answer = &fake->answers[fake->answer_count++];
  memset(answer, 0, sizeof *answer);
  snprintf(answer->url, sizeof answer->url, "%s", url);
  answer->status = status;
  answer->body = body;
  answer->length = length;
  return answer;
}

static WifiStatus fake_wifi_status(void) { return fake_current->wifi; }

static void fake_set_enabled(bool flag, void (*callback)(PDNetErr err)) {
  fake_current->wifi_enabled = flag;
  if (flag && callback != NULL) callback(NET_OK);
}

static enum accessReply fake_request_access(const char *server, int port, bool usessl, const char *purpose,
                                            AccessRequestCallback *callback, void *userdata) {
  (void)server;
  (void)port;
  (void)usessl;
  fake_current->asks++;
  snprintf(fake_current->asked_purpose, sizeof fake_current->asked_purpose, "%s", purpose != NULL ? purpose : "");
  if (fake_current->access == kAccessAsk) {
    fake_current->asked_pending = 1;
    fake_current->ask_callback = callback;
    fake_current->ask_userdata = userdata;
  }
  return fake_current->access;
}

static int access_given(void) {
  return fake_current->access == kAccessAllow || (fake_current->access == kAccessAsk && fake_current->allow_when_asked);
}

static HTTPConnection *fake_new_connection(const char *server, int port, bool usessl) {
  fake_connection *c;
  if (!access_given()) return NULL;
  if (fake_current->connection_count == FAKE_CONNECTIONS) abort();
  c = &fake_current->connections[fake_current->connection_count++];
  memset(c, 0, sizeof *c);
  c->live = 1;
  snprintf(c->server, sizeof c->server, "%s", server);
  c->port = port;
  c->ssl = usessl;
  fake_current->connections_live++;
  return (HTTPConnection *)c;
}

static HTTPConnection *fake_retain(HTTPConnection *conn) { return conn; }

static void fake_release(HTTPConnection *conn) {
  connection_of(conn)->live = 0;
  fake_current->connections_live--;
}

static void fake_set_connect_timeout(HTTPConnection *conn, int ms) {
  connection_of(conn);
  if (ms <= 0) abort();
}

static void fake_set_userdata(HTTPConnection *conn, void *userdata) { connection_of(conn)->userdata = userdata; }
static void *fake_get_userdata(HTTPConnection *conn) { return connection_of(conn)->userdata; }

static void fake_on_header(HTTPConnection *conn, HTTPHeaderCallback *callback) { connection_of(conn)->on_header = callback; }
static void fake_on_complete(HTTPConnection *conn, HTTPConnectionCallback *callback) {
  connection_of(conn)->on_complete = callback;
}
static void fake_on_closed(HTTPConnection *conn, HTTPConnectionCallback *callback) { connection_of(conn)->on_closed = callback; }

static PDNetErr fake_get(HTTPConnection *conn, const char *path, const char *headers, size_t headerlen) {
  fake_connection *c = connection_of(conn);
  char url[1100];
  int i;
  (void)headers;
  (void)headerlen;
  if (c->answer != NULL) abort(); /* one request a connection */
  snprintf(c->path, sizeof c->path, "%s", path);
  if (c->port == (c->ssl ? 443 : 80))
    snprintf(url, sizeof url, "%s://%s%s", c->ssl ? "https" : "http", c->server, path);
  else
    snprintf(url, sizeof url, "%s://%s:%d%s", c->ssl ? "https" : "http", c->server, c->port, path);
  for (i = 0; i < fake_current->answer_count; i++)
    if (strcmp(fake_current->answers[i].url, url) == 0) c->answer = &fake_current->answers[i];
  if (c->answer == NULL) {
    snprintf(c->missing.url, sizeof c->missing.url, "%s", url);
    c->missing.status = 404;
    c->missing.body = "";
    c->answer = &c->missing;
  }
  return NET_OK;
}

static PDNetErr fake_get_error(HTTPConnection *conn) {
  connection_of(conn);
  return NET_OK;
}

static int fake_response_status(HTTPConnection *conn) {
  fake_connection *c = connection_of(conn);
  return c->answer != NULL && (c->sent > 0 || c->complete) ? c->answer->status : 0;
}

static size_t fake_bytes_available(HTTPConnection *conn) {
  fake_connection *c = connection_of(conn);
  return c->sent - c->read;
}

static int fake_net_read(HTTPConnection *conn, void *buffer, unsigned int length) {
  fake_connection *c = connection_of(conn);
  size_t n = c->sent - c->read;
  if (length < n) n = length;
  if (n > 0) memcpy(buffer, c->answer->body + c->read, n);
  c->read += n;
  return (int)n;
}

static void fake_net_close(HTTPConnection *conn) { connection_of(conn); }

void fake_network_step(fake_playdate *fake) {
  int i;
  fake_current = fake;
  if (fake->asked_pending) {
    fake->asked_pending = 0;
    fake->ask_callback(fake->allow_when_asked != 0, fake->ask_userdata);
  }
  for (i = 0; i < fake->connection_count; i++) {
    fake_connection *c = &fake->connections[i];
    size_t piece;
    if (!c->live || c->answer == NULL || c->complete || c->answer->silent) continue;
    if (c->sent == 0 && c->answer->location != NULL && c->on_header != NULL)
      c->on_header((HTTPConnection *)c, "Location", c->answer->location);
    piece = c->answer->length - c->sent < fake->piece ? c->answer->length - c->sent : fake->piece;
    c->sent += piece;
    if (c->sent == c->answer->length) {
      c->complete = 1;
      if (c->on_complete != NULL) c->on_complete((HTTPConnection *)c);
    }
  }
}

void fake_install_network(fake_playdate *fake) {
  fake->wifi = kWifiConnected;
  fake->access = kAccessAllow;
  fake->piece = 1024;
  fake->network.http = &fake->http;
  fake->network.getStatus = fake_wifi_status;
  fake->network.setEnabled = fake_set_enabled;
  fake->http.requestAccess = fake_request_access;
  fake->http.newConnection = fake_new_connection;
  fake->http.retain = fake_retain;
  fake->http.release = fake_release;
  fake->http.setConnectTimeout = fake_set_connect_timeout;
  fake->http.setUserdata = fake_set_userdata;
  fake->http.getUserdata = fake_get_userdata;
  fake->http.get = fake_get;
  fake->http.getError = fake_get_error;
  fake->http.getResponseStatus = fake_response_status;
  fake->http.getBytesAvailable = fake_bytes_available;
  fake->http.read = fake_net_read;
  fake->http.close = fake_net_close;
  fake->http.setHeaderReceivedCallback = fake_on_header;
  fake->http.setRequestCompleteCallback = fake_on_complete;
  fake->http.setConnectionClosedCallback = fake_on_closed;
}
