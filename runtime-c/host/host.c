/* The desktop host's side of the contract; see host.h. */
#include "host.h"

#include <stdlib.h>
#include <string.h>

static sproutc_host *self(void *ctx) { return (sproutc_host *)ctx; }

static void *host_alloc(void *ctx, size_t bytes) {
  void *block = malloc(bytes);
  if (block != NULL) self(ctx)->pages++;
  return block;
}

static void host_release(void *ctx, void *block, size_t bytes) {
  (void)bytes;
  self(ctx)->pages--;
  free(block);
}

static uint64_t host_now(void *ctx) {
  sproutc_host *host = self(ctx);
  uint64_t elapsed = host->clock_ms - host->turn_started_ms;
  host->clock_ms += host->step_ms;
  return elapsed;
}

static uint64_t host_seed(void *ctx) { return self(ctx)->turn_seed; }

/* The stored world lives at `state`; any other key lives at `state.<key>`. */
static bool path_of(const sproutc_host *host, const char *key, char *path, size_t size) {
  int written;
  if (host->state == NULL || strchr(key, '/') != NULL) return false;
  if (strcmp(key, "world") == 0) {
    written = snprintf(path, size, "%s", host->state);
  } else {
    written = snprintf(path, size, "%s.%s", host->state, key);
  }
  return written > 0 && (size_t)written < size;
}

static bool host_read(void *ctx, const char *key, const char **bytes, size_t *length) {
  sproutc_host *host = self(ctx);
  char path[1024];
  FILE *file;
  long size;
  if (!path_of(host, key, path, sizeof path)) return false;
  file = fopen(path, "rb");
  if (file == NULL) return false;
  fseek(file, 0, SEEK_END);
  size = ftell(file);
  fseek(file, 0, SEEK_SET);
  free(host->held);
  host->held = (char *)malloc((size_t)size + 1);
  if (host->held == NULL || fread(host->held, 1, (size_t)size, file) != (size_t)size) {
    fclose(file);
    free(host->held);
    host->held = NULL;
    return false;
  }
  host->held[size] = '\0';
  fclose(file);
  *bytes = host->held;
  *length = (size_t)size;
  return true;
}

static bool host_write(void *ctx, const char *key, const char *bytes, size_t length) {
  char path[1024];
  FILE *file;
  bool whole;
  if (!path_of(self(ctx), key, path, sizeof path)) return false;
  file = fopen(path, "wb");
  if (file == NULL) return false;
  whole = fwrite(bytes, 1, length, file) == length;
  return fclose(file) == 0 && whole;
}

static bool host_emit(void *ctx, const char *recipient, size_t recipient_length, const char *text,
                      size_t text_length) {
  FILE *out = self(ctx)->out;
  return fprintf(out, "%.*s: %.*s\n", (int)recipient_length, recipient, (int)text_length, text) >= 0;
}

void sproutc_host_init(sproutc_host *host, FILE *out, const char *state) {
  sprout_budgets *b;
  memset(host, 0, sizeof *host);
  host->out = out;
  host->state = state;
  host->record.ctx = host;
  host->record.page_bytes = 64 * 1024;
  host->record.alloc = host_alloc;
  host->record.release = host_release;
  host->record.now = host_now;
  host->record.seed = host_seed;
  host->record.read = host_read;
  host->record.write = host_write;
  host->record.emit = host_emit;
  /* The spec's Runtime budgets table; a row it gives no figure for stays unset. */
  b = &host->record.budgets;
  b->steps = (sprout_limit){true, 50000};
  b->poll_steps = (sprout_limit){true, 10000};
  b->output = (sprout_limit){true, 8000};
  b->events = (sprout_limit){true, 256};
  b->cascade_depth = (sprout_limit){true, 20};
  b->passage_depth = (sprout_limit){true, 8};
  b->set_role_objects = (sprout_limit){true, 8};
  b->spawns = (sprout_limit){true, 8};
  b->shortest_wake_seconds = (sprout_limit){true, 60};
  b->pending_wakes = (sprout_limit){true, 1};
  b->nickname_characters = (sprout_limit){true, 24};
  b->list_elements = (sprout_limit){true, 16};
}

void sproutc_host_close(sproutc_host *host) {
  free(host->held);
  host->held = NULL;
}

void sproutc_host_set_time(sproutc_host *host, uint64_t seconds) { host->script_seconds = seconds; }

void sproutc_host_set_seed(sproutc_host *host, uint64_t seed) { host->turn_seed = seed; }

void sproutc_host_begin_turn(sproutc_host *host) { host->turn_started_ms = host->clock_ms; }
