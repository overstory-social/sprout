/*
 * The download screen (the design doc's Shipped worlds and downloads): the signed index fetched (host/net.h) and read
 * (signed_index.h), its worlds offered as the words of a wheel (wheel.h) by title, one already on
 * the shelf greyed, and the one chosen downloaded into the Data folder's `worlds/`, where the shelf
 * finds it.
 *
 * Nothing listed is used until the index's signature verifies against the key the build baked in
 * (the generated `publickey.h`). Each file is written as `<name>.part`, counted as it arrives (one
 * longer than listed is dropped at once), checked against the size and SHA-256 the index gives,
 * and only then moved into place; the cartridge goes last, once the engine has said whether it can
 * be shelved and, if it can, that its bundle hash is the one listed. One the engine refuses is
 * kept and shelved greyed with the engine's reason. What stops a fetch is said in words, and
 * leaving the screen tells the shelf what happened to the list.
 */
#ifndef PLAYER_UI_DOWNLOADS_H
#define PLAYER_UI_DOWNLOADS_H

#include <stdbool.h>
#include <stddef.h>

#include "app.h"
#include "host/net.h"
#include "host/pd_host.h"
#include "shelf.h"
#include "signed_index.h"
#include "wheel.h"
#include "wrap.h"

/*
 * Where the list of worlds is, unless the Data folder's `downloads.json` says
 * `{ "indexUrl": "https://..." }`: a placeholder that names no server (`.invalid` never resolves),
 * until a real one is chosen.
 */
#define PLAYER_INDEX_URL "https://worlds.example.invalid/sprout/index.json"
#define PLAYER_DOWNLOADS_SETTINGS "downloads.json"

/* What the system's permission dialog says the network is for. */
#define PLAYER_NETWORK_PURPOSE \
  "Sprout fetches the list of published worlds, and the worlds you choose from it, from this server."

typedef enum downloads_phase {
  DOWNLOADS_INDEX,  /* the list is being fetched */
  DOWNLOADS_LIST,   /* the list is shown */
  DOWNLOADS_WORLD,  /* a world is being downloaded */
  DOWNLOADS_FAILED  /* the list could not be had: `failure` says why */
} downloads_phase;

/* One file of the world being downloaded: the cartridge first, then each asset beside it. */
typedef struct download_file {
  bool asset;
  const char *label; /* the world's title or the asset's path, from the index */
  const char *url;   /* as the index gives it */
  const char *sha256;
  size_t bytes;
  char final[PLAYER_PATH_BYTES];
  char part[PLAYER_PATH_BYTES + 8];
} download_file;

typedef struct player_downloads {
  player_app *app;
  downloads_phase phase;
  player_host host; /* for the arena the index is read into */
  sprout_arena arena;
  const sprout_json *worlds; /* the index's worlds, in the arena, once read */
  size_t selected;
  wheel wheel;              /* the worlds' titles */
  unsigned long words_made; /* counts the changes to what the wheel's words say */
  char index_url[PLAYER_URL_BYTES];
  player_index_trusts trusts; /* the signature check: the baked key's, unless a test says otherwise */
  void *trust_ctx;
  player_fetch fetch;
  bool fetching;
  /* the index as it arrives */
  char *text;
  size_t length, room;
  bool too_big, short_of_memory;
  /* the world being downloaded */
  const sprout_json *world;
  download_file *files;
  size_t file_count, at; /* `at` is the file being fetched */
  SDFile *file;
  size_t written;
  bool overrun, write_failed;
  /* the words under the list */
  char failure[PLAYER_REASON_BYTES + 128];
  char notice[PLAYER_REASON_BYTES + 128];
  char panel_said[PLAYER_REASON_BYTES + 256];
  wrapped panel;
} player_downloads;

extern const player_screen player_downloads_screen;

/* Opens the download screen from the shelf and starts fetching the list; where there is no memory for it, says so. */
void player_downloads_open(player_app *app);

/* A file-name stem from a world's title: lower-case letters and digits joined by hyphens, at most 24 long, else `world`. */
void player_downloads_stem(const char *title, char *out, size_t size);

#endif
