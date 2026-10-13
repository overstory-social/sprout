/*
 * Fetching over the SDK's HTTP API (`pd->network->http`, system software 2.7), Source/net.lua in
 * C, polled a frame at a time. A fetch asks the person's permission for its server first, with
 * a purpose string, and waits for the answer without holding up a frame; it hands each piece of
 * the body to a sink as it arrives, follows a redirect up to PLAYER_NET_MOST_REDIRECTS times, and
 * gives up on a server that stops answering. Every refusal is a sentence for the person holding
 * the device. Each call runs on the main stack, as the file calls do (stack.h).
 */
#ifndef PLAYER_NET_H
#define PLAYER_NET_H

#include <stdbool.h>
#include <stddef.h>
#include <stdint.h>

#include "pd_api.h"

#define PLAYER_URL_BYTES 512
#define PLAYER_SERVER_BYTES 128
#define PLAYER_NET_REASON_BYTES 384
#define PLAYER_NET_CHUNK 4096
#define PLAYER_NET_MOST_REDIRECTS 3
/* Seconds a server may take to accept the connection, and to go without sending a byte. */
#define PLAYER_NET_CONNECT_SECONDS 10
#define PLAYER_NET_STALL_SECONDS 20

/* An http or https address in parts. */
typedef struct player_url {
  bool ssl;
  int port;
  char server[PLAYER_SERVER_BYTES];
  char path[PLAYER_URL_BYTES];
} player_url;

/* The parts of `url`; false, with the reason in `why`, when it is not an http or https address this app can use. */
bool player_url_parse(const char *url, player_url *parts, char *why, size_t size);

/* `address` resolved against the address `base` it was found in, into `out`; false when it does not fit. */
bool player_url_resolve(const char *base, const char *address, char *out, size_t size);

/* Takes a piece of the body; false stops the fetch at once. */
typedef bool (*player_net_sink)(void *ctx, const char *bytes, size_t length);

typedef enum player_fetch_state {
  PLAYER_FETCH_RUNNING,
  PLAYER_FETCH_DONE,    /* the whole answer came: `status` is the server's */
  PLAYER_FETCH_FAILED,  /* `reason` says why */
  PLAYER_FETCH_STOPPED  /* the sink stopped it */
} player_fetch_state;

typedef struct player_fetch {
  PlaydateAPI *pd;
  const char *purpose;
  player_net_sink sink;
  void *sink_ctx;
  HTTPConnection *conn;
  char url[PLAYER_URL_BYTES];
  player_url parts;
  unsigned asked; /* the permission asked for and not yet answered, or 0 */
  int hops;
  bool finished; /* the system said the answer is complete or the connection closed */
  char location[PLAYER_URL_BYTES];
  uint64_t heard; /* seconds when the server last sent anything, or the fetch began */
  int status;
  char reason[PLAYER_NET_REASON_BYTES];
  char piece[PLAYER_NET_CHUNK];
} player_fetch;

/* Whether a fetch can be tried, asking the Wi-Fi to come up now since joining can take ten seconds; false with the reason. */
bool player_net_ready(PlaydateAPI *pd, char *why, size_t size);

/* The Wi-Fi is no longer needed, so it may sleep now rather than after the system's half a minute. */
void player_net_finish(PlaydateAPI *pd);

/*
 * Starts fetching `url` at `now` (seconds), `purpose` saying why when the person is asked; the
 * purpose is held, not copied. False, with `f->reason`, when it cannot start.
 */
bool player_fetch_start(player_fetch *f, PlaydateAPI *pd, const char *url, const char *purpose, player_net_sink sink,
                        void *sink_ctx, uint64_t now);

/* Moves the fetch on at `now`; it is over once this gives anything but PLAYER_FETCH_RUNNING. */
player_fetch_state player_fetch_poll(player_fetch *f, uint64_t now);

/* Stops the fetch, if it runs, and lets its connection go. */
void player_fetch_cancel(player_fetch *f);

#endif
