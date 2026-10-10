/*
 * The log tail the save keeps beside the stored world (the spec's The runtime > The log): the
 * last turns the player ran, one JSON text each, and the greatest host seconds seen, which the
 * clamp starts from when the world is opened again. The file is `saves/<hash>.log`; its first
 * line names the bundle it belongs to, and a log of another bundle is not read.
 */
#include <string.h>

#include "files.h"
#include "json.h"
#include "session_internal.h"
#include "text.h"

void savelog_clear(player_session *session) {
  size_t i;
  for (i = 0; i < session->log_count; i++) {
    player_free(session->pd, session->log[i]);
    session->log[i] = NULL;
  }
  session->log_count = 0;
}

void savelog_add(player_session *session, const char *entry, size_t length) {
  char *copy = (char *)player_alloc(session->pd, length + 1);
  if (copy == NULL) return;
  memcpy(copy, entry, length);
  copy[length] = '\0';
  if (session->log_count == LOG_KEEP) {
    player_free(session->pd, session->log[0]);
    memmove(session->log, session->log + 1, (LOG_KEEP - 1) * sizeof *session->log);
    session->log_count--;
  }
  session->log[session->log_count++] = copy;
}

/* The seconds the header line records, or false where it is not this bundle's header. */
static bool header_seconds(player_session *session, const char *line, size_t length, uint64_t *seconds) {
  sprout_arena arena;
  sprout_json *root = NULL;
  sprout_json_error error;
  const sprout_json *bundle, *last;
  bool mine = false;
  if (sprout_arena_init(&arena, &session->host.record) != SPROUT_OK) return false;
  if (sprout_json_read(&arena, line, length, &root, &error) == SPROUT_OK && root != NULL &&
      root->kind == SPROUT_JSON_OBJECT) {
    bundle = sprout_json_get(root, "bundle");
    last = sprout_json_get(root, "lastSeconds");
    mine = bundle != NULL && bundle->kind == SPROUT_JSON_STRING && strcmp(bundle->bytes, session->hash) == 0 &&
           last != NULL && last->kind == SPROUT_JSON_NUMBER && last->number >= 0;
    if (mine) *seconds = (uint64_t)last->number;
  }
  sprout_arena_reset(&arena);
  return mine;
}

void savelog_read(player_session *session) {
  size_t length = 0, at = 0, end;
  char *bytes = player_read_file(session->pd, session->log_path, &length);
  uint64_t seconds = 0;
  bool first = true;
  if (bytes == NULL) return;
  while (at < length) {
    end = at;
    while (end < length && bytes[end] != '\n') end++;
    if (end > at) {
      if (first) {
        if (!header_seconds(session, bytes + at, end - at, &seconds)) break;
        session->host.last_seconds = player_clamp(seconds, session->host.last_seconds);
        first = false;
      } else {
        savelog_add(session, bytes + at, end - at);
      }
    }
    at = end + 1;
  }
  player_free(session->pd, bytes);
}

bool savelog_write(player_session *session) {
  char header[200];
  text_buffer out;
  size_t total, i, at = 0;
  char *bytes;
  bool written;
  text_begin(&out, header, sizeof header);
  text_add(&out, "{\"format\":1,\"bundle\":\"");
  text_add(&out, session->hash);
  text_add(&out, "\",\"lastSeconds\":");
  text_add_number(&out, session->host.last_seconds);
  text_add(&out, "}\n");
  total = out.length;
  for (i = 0; i < session->log_count; i++) total += strlen(session->log[i]) + 1;
  bytes = (char *)player_alloc(session->pd, total);
  if (bytes == NULL) return false;
  memcpy(bytes, header, out.length);
  at = out.length;
  for (i = 0; i < session->log_count; i++) {
    size_t n = strlen(session->log[i]);
    memcpy(bytes + at, session->log[i], n);
    bytes[at + n] = '\n';
    at += n + 1;
  }
  written = player_write_file(session->pd, session->log_path, bytes, total);
  player_free(session->pd, bytes);
  return written;
}
