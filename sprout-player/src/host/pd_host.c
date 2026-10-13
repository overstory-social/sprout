/* The Playdate's side of the host contract; see pd_host.h. */
#include "pd_host.h"

#include <string.h>

#include "budgets.h"
#include "seeds.h"

#define PAGE_BYTES (32u * 1024u)

static player_host *self(void *ctx) { return (player_host *)ctx; }

static void *host_alloc(void *ctx, size_t bytes) {
  player_host *host = self(ctx);
  void *block = host->pd->system->realloc(NULL, bytes);
  if (block != NULL) host->pages++;
  return block;
}

static void host_release(void *ctx, void *block, size_t bytes) {
  player_host *host = self(ctx);
  (void)bytes;
  host->pages--;
  host->pd->system->realloc(block, 0);
}

/* Milliseconds since the turn began: the only clock the runtime reads, for its wall-clock backstop. */
static uint64_t host_now(void *ctx) {
  player_host *host = self(ctx);
  return (uint64_t)(unsigned)(host->pd->system->getCurrentTimeMilliseconds() - host->turn_started_ms);
}

static uint64_t host_seed(void *ctx) { return self(ctx)->step_seed; }

/* The player keeps its own files (see session.c); the runtime asks the host for no stored bytes. */
static bool host_read(void *ctx, const char *key, const char **bytes, size_t *length) {
  (void)ctx;
  (void)key;
  (void)bytes;
  (void)length;
  return false;
}

static bool host_write(void *ctx, const char *key, const char *bytes, size_t length) {
  (void)ctx;
  (void)key;
  (void)bytes;
  (void)length;
  return false;
}

/* Lines reach the reader through the turn's outcome, not through emit. */
static bool host_emit(void *ctx, const char *recipient, size_t recipient_length, const char *text,
                      size_t text_length) {
  (void)ctx;
  (void)recipient;
  (void)recipient_length;
  (void)text;
  (void)text_length;
  return true;
}

void player_host_init(player_host *host, PlaydateAPI *pd) {
  memset(host, 0, sizeof *host);
  host->pd = pd;
  host->record.ctx = host;
  host->record.page_bytes = PAGE_BYTES;
  host->record.alloc = host_alloc;
  host->record.release = host_release;
  host->record.now = host_now;
  host->record.seed = host_seed;
  host->record.read = host_read;
  host->record.write = host_write;
  host->record.emit = host_emit;
  player_budgets(&host->record.budgets);
}

uint64_t player_clamp(uint64_t seconds, uint64_t last) { return seconds < last ? last : seconds; }

uint64_t player_host_seconds(player_host *host) {
  host->last_seconds = player_clamp((uint64_t)host->pd->system->getSecondsSinceEpoch(NULL), host->last_seconds);
  return host->last_seconds;
}

void player_host_begin_step(player_host *host) {
  unsigned milliseconds = 0;
  uint64_t seconds = host->pd->system->getSecondsSinceEpoch(&milliseconds);
  uint64_t drawn = seconds * 1000u + milliseconds;
  /* The step's seed is the clock's, mixed by the same rule a tick's or a wake's is made from, so
   * the draws of two steps a millisecond apart are not alike. A seed is 0 to 2^32 - 1. */
  host->step_seed = sprout_turn_seed(drawn, "step", 4, host->drawn++);
  host->turn_started_ms = host->pd->system->getCurrentTimeMilliseconds();
}
