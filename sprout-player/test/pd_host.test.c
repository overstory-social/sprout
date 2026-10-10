/* pd_host.c: the host record, the clock and the seeds. */
#include "pd_host.h"
#include "support.h"

static void the_clamp_never_goes_below_what_was_seen(void) {
  CHECK(player_clamp(100, 50) == 100, "forward");
  CHECK(player_clamp(40, 50) == 50, "back");
  CHECK(player_clamp(50, 50) == 50, "still");
}

static void a_clock_set_back_is_read_as_the_greatest_time_seen(void) {
  player_host host;
  begin("clock");
  player_host_init(&host, &fake->api);
  fake->seconds = 5000;
  CHECK(player_host_seconds(&host) == 5000, "first");
  fake->seconds = 100;
  CHECK(player_host_seconds(&host) == 5000, "set back");
  host.last_seconds = 9000;
  CHECK(player_host_seconds(&host) == 9000, "the save's seconds");
  fake->seconds = 9001;
  CHECK(player_host_seconds(&host) == 9001, "forward again");
  end();
}

static void each_step_draws_a_seed_in_range_and_no_two_alike(void) {
  player_host host, again;
  unsigned long long seen[64];
  int i, j;
  begin("seeds");
  player_host_init(&host, &fake->api);
  /* The clock is frozen: the seeds still differ, since each is mixed with how many came before. */
  for (i = 0; i < 64; i++) {
    player_host_begin_step(&host);
    seen[i] = host.record.seed(host.record.ctx);
    CHECK(seen[i] <= 4294967295ULL, "seed %llu out of range", seen[i]);
    for (j = 0; j < i; j++) CHECK(seen[i] != seen[j], "seed %llu twice", seen[i]);
  }
  /* The same clock and count give the same seed: the draw is a rule, not a roll. */
  player_host_init(&again, &fake->api);
  player_host_begin_step(&again);
  CHECK(again.record.seed(again.record.ctx) == seen[0], "the rule is deterministic");
  end();
}

static void the_host_record_is_complete_and_hands_the_runtime_no_stored_bytes(void) {
  player_host host;
  uint64_t first;
  begin("record");
  player_host_init(&host, &fake->api);
  CHECK(host.record.alloc && host.record.release && host.record.now && host.record.seed && host.record.read &&
            host.record.write && host.record.emit, "every callback");
  CHECK(host.record.page_bytes > 0, "a page size");
  player_host_begin_step(&host);
  first = host.record.now(host.record.ctx);
  CHECK(first < 100, "%llu ms", (unsigned long long)first);
  CHECK(host.record.now(host.record.ctx) > first, "the wall clock moves on");
  CHECK(!host.record.read(host.record.ctx, "world", NULL, NULL), "the runtime is handed no stored bytes");
  CHECK(!host.record.write(host.record.ctx, "world", "x", 1), "and keeps none");
  CHECK(host.record.emit(host.record.ctx, "r", 1, "t", 1), "emit takes a line and drops it");
  {
    void *page = host.record.alloc(host.record.ctx, 64);
    CHECK(page != NULL && host.pages == 1, "a page from the device's allocator");
    host.record.release(host.record.ctx, page, 64);
    CHECK(host.pages == 0, "and back");
  }
  end();
}

int main(void) {
  test_program("pd_host");
  the_clamp_never_goes_below_what_was_seen();
  a_clock_set_back_is_read_as_the_greatest_time_seen();
  each_step_draws_a_seed_in_range_and_no_two_alike();
  the_host_record_is_complete_and_hands_the_runtime_no_stored_bytes();
  return finish();
}
