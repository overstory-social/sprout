/*
 * Tests for src/exec.c: every case the TypeScript runtime's goldens hold
 * (corpus/goldens/exec.json) is run here against the same cartridge and
 * stored worlds, and must end as the oracle did: the same committed state or
 * the same fault, the same steps, the same effects in the same order, the
 * same handlers run and descriptions owed. The nineteen kinds of statement
 * are all among them.
 */
#include "exec_fixture.h"

static void every_golden_case_ends_as_the_typescript_runtime_did(void) {
  exec_bench b;
  size_t replayed;
  exec_bench_open(&b);
  replayed = exec_replay_area(&b, NULL);
  CHECK(replayed > 90);
  exec_bench_close(&b);
  CHECK_INT(b.heap.pages, 0);
}

int main(void) {
  RUN(every_golden_case_ends_as_the_typescript_runtime_did);
  return REPORT();
}
