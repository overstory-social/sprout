/* Tests for host/host.c: the fake clock, the seed a script sets, the file of stored bytes and the printing emit. */
#include "host.h"
#include "check.h"

static void a_frozen_clock_reads_zero_until_the_script_moves_it_and_a_turn_counts_from_its_start(void) {
  sproutc_host host;
  sproutc_host_init(&host, stdout, NULL);
  CHECK_INT(host.record.now(host.record.ctx), 0);
  CHECK_INT(host.record.now(host.record.ctx), 0);
  host.clock_ms += 5000;
  CHECK_INT(host.record.now(host.record.ctx), 5000);
  sproutc_host_begin_turn(&host);
  CHECK_INT(host.record.now(host.record.ctx), 0);
  sproutc_host_close(&host);
}

static void a_ticking_clock_moves_on_by_its_step_at_each_read_and_a_new_turn_starts_again_from_zero(void) {
  sproutc_host host;
  sproutc_host_init(&host, stdout, NULL);
  host.step_ms = 7;
  CHECK_INT(host.record.now(host.record.ctx), 0);
  CHECK_INT(host.record.now(host.record.ctx), 7);
  CHECK_INT(host.record.now(host.record.ctx), 14);
  sproutc_host_begin_turn(&host);
  CHECK_INT(host.record.now(host.record.ctx), 0);
  CHECK_INT(host.record.now(host.record.ctx), 7);
  sproutc_host_close(&host);
}

static void the_script_sets_the_seed_and_the_time_and_the_runtime_reads_the_seed_it_was_given(void) {
  sproutc_host host;
  sproutc_host_init(&host, stdout, NULL);
  CHECK_INT(host.record.seed(host.record.ctx), 0);
  sproutc_host_set_seed(&host, 4294967295ULL);
  CHECK(host.record.seed(host.record.ctx) == 4294967295ULL);
  sproutc_host_set_time(&host, 2400);
  CHECK_INT(host.script_seconds, 2400);
  /* The seed and the time are the script's: a clock read moves neither. */
  host.record.now(host.record.ctx);
  CHECK(host.record.seed(host.record.ctx) == 4294967295ULL);
  CHECK_INT(host.script_seconds, 2400);
  sproutc_host_close(&host);
}

static void the_budgets_are_the_specs_defaults_and_the_rows_it_gives_no_figure_for_stay_unset(void) {
  sproutc_host host;
  const sprout_budgets *b;
  sproutc_host_init(&host, stdout, NULL);
  b = &host.record.budgets;
  CHECK(b->steps.set && b->steps.value == 50000);
  CHECK(b->poll_steps.set && b->poll_steps.value == 10000);
  CHECK(b->output.set && b->output.value == 8000);
  CHECK(b->shortest_wake_seconds.set && b->shortest_wake_seconds.value == 60);
  CHECK(!b->people_per_place.set);
  CHECK(!b->extension_effects.set);
  CHECK(!b->wall_clock_ms.set);
  sproutc_host_close(&host);
}

static void memory_comes_in_pages_and_every_page_is_given_back(void) {
  sproutc_host host;
  void *page;
  sproutc_host_init(&host, stdout, NULL);
  page = host.record.alloc(host.record.ctx, host.record.page_bytes);
  CHECK(page != NULL);
  CHECK_INT(host.pages, 1);
  host.record.release(host.record.ctx, page, host.record.page_bytes);
  CHECK_INT(host.pages, 0);
  sproutc_host_close(&host);
}

static void stored_bytes_live_in_a_file_and_a_host_with_no_file_holds_nothing(void) {
  sproutc_host host;
  const char *bytes = NULL;
  size_t length = 0;
  const char *path = "sproutc-host-test-state.json";
  sproutc_host_init(&host, stdout, path);
  CHECK(!host.record.read(host.record.ctx, "world", &bytes, &length));
  CHECK(host.record.write(host.record.ctx, "world", "{\"serial\":4}", 12));
  CHECK(host.record.read(host.record.ctx, "world", &bytes, &length));
  CHECK_BYTES(bytes, length, "{\"serial\":4}");
  CHECK(host.record.write(host.record.ctx, "log", "one", 3));
  CHECK(host.record.read(host.record.ctx, "log", &bytes, &length));
  CHECK_BYTES(bytes, length, "one");
  CHECK(!host.record.write(host.record.ctx, "../escape", "x", 1));
  remove(path);
  remove("sproutc-host-test-state.json.log");
  sproutc_host_close(&host);
  sproutc_host_init(&host, stdout, NULL);
  CHECK(!host.record.write(host.record.ctx, "world", "x", 1));
  CHECK(!host.record.read(host.record.ctx, "world", &bytes, &length));
  sproutc_host_close(&host);
}

static void emit_prints_one_line_for_one_recipient(void) {
  sproutc_host host;
  char text[256];
  size_t n;
  FILE *file = tmpfile();
  sproutc_host_init(&host, file, NULL);
  CHECK(host.record.emit(host.record.ctx, "Ines", 4, "A dank cave.", 12));
  CHECK(host.record.emit(host.record.ctx, "Marta", 5, "Marta arrives.", 14));
  fseek(file, 0, SEEK_SET);
  n = fread(text, 1, sizeof text - 1, file);
  text[n] = '\0';
  CHECK_STR(text, "Ines: A dank cave.\nMarta: Marta arrives.\n");
  fclose(file);
  sproutc_host_close(&host);
}

int main(void) {
  RUN(a_frozen_clock_reads_zero_until_the_script_moves_it_and_a_turn_counts_from_its_start);
  RUN(a_ticking_clock_moves_on_by_its_step_at_each_read_and_a_new_turn_starts_again_from_zero);
  RUN(the_script_sets_the_seed_and_the_time_and_the_runtime_reads_the_seed_it_was_given);
  RUN(the_budgets_are_the_specs_defaults_and_the_rows_it_gives_no_figure_for_stay_unset);
  RUN(memory_comes_in_pages_and_every_page_is_given_back);
  RUN(stored_bytes_live_in_a_file_and_a_host_with_no_file_holds_nothing);
  RUN(emit_prints_one_line_for_one_recipient);
  return REPORT();
}
