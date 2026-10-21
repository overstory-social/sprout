/* savelog.c: the log tail the save keeps beside the stored world, read under the bundle it names, and its turn and redeploy entries. */
#include <stdlib.h>

#include "host/files.h"
#include "session_internal.h"
#include "support.h"

/* A session with a bundle hash and a log path, and no world: all the log tail needs. */
static player_session *logged(const char *hash) {
  player_session *session = session_new();
  snprintf(session->hash, sizeof session->hash, "%s", hash);
  snprintf(session->log_path, sizeof session->log_path, "saves/%s.log", hash);
  fake->file.mkdir("saves");
  return session;
}

static void the_tail_keeps_the_last_entries_and_drops_the_oldest(void) {
  player_session *session;
  char entry[40];
  int i;
  begin("ring");
  session = logged("abc");
  for (i = 0; i < LOG_KEEP + 5; i++) {
    snprintf(entry, sizeof entry, "{\"n\":%d}", i);
    savelog_add(session, entry, strlen(entry));
  }
  CHECK(session->log_count == LOG_KEEP, "%zu entries", session->log_count);
  CHECK(strcmp(session->log[0], "{\"n\":5}") == 0, "the oldest kept is %s", session->log[0]);
  CHECK(strcmp(session->log[LOG_KEEP - 1], "{\"n\":36}") == 0, "the newest is last");
  savelog_clear(session);
  CHECK(session->log_count == 0, "cleared");
  end();
}

static void the_tail_and_the_clamps_seconds_are_written_and_read_back(void) {
  player_session *session;
  char *text;
  begin("roundtrip");
  session = logged("abc");
  session->host.last_seconds = 123456;
  savelog_add(session, "{\"kind\":\"arrival\"}", 18);
  savelog_add(session, "{\"kind\":\"command\"}", 18);
  CHECK(savelog_write(session), "writing");
  text = file_text("saves/abc.log");
  CHECK(text != NULL && strcmp(text, "{\"format\":1,\"bundle\":\"abc\",\"lastSeconds\":123456}\n"
                                     "{\"kind\":\"arrival\"}\n{\"kind\":\"command\"}\n") == 0, "%s", text);
  free(text);
  savelog_clear(session);
  session->host.last_seconds = 50;
  savelog_read(session, session->log_path, session->hash);
  CHECK(session->host.last_seconds == 123456, "the clamp starts from what was recorded");
  CHECK(session->log_count == 2 && strcmp(session->log[1], "{\"kind\":\"command\"}") == 0, "the entries");
  /* A recorded time earlier than the clock already seen never moves it back. */
  session->host.last_seconds = 999999;
  savelog_clear(session);
  savelog_read(session, session->log_path, session->hash);
  CHECK(session->host.last_seconds == 999999, "never back");
  end();
}

/* How far host seconds run ahead of the device's, for time commands asked to pass, is kept, and read back. */
static void the_time_passed_ahead_of_the_device_is_written_and_read_back(void) {
  player_session *session;
  char *text;
  begin("ahead");
  session = logged("abc");
  session->host.last_seconds = 123456;
  session->host.ahead_seconds = 3690;
  CHECK(savelog_write(session), "writing");
  text = file_text("saves/abc.log");
  CHECK(text != NULL && strcmp(text, "{\"format\":1,\"bundle\":\"abc\",\"lastSeconds\":123456,\"aheadSeconds\":3690}\n") == 0,
        "%s", text);
  free(text);
  session->host.ahead_seconds = 0;
  savelog_read(session, session->log_path, session->hash);
  CHECK(session->host.ahead_seconds == 3690, "read back: %llu", (unsigned long long)session->host.ahead_seconds);
  /* A save made before any time passed has none, and reads as none. */
  session->host.ahead_seconds = 0;
  write_text("saves/abc.log", "{\"format\":1,\"bundle\":\"abc\",\"lastSeconds\":5}\n");
  savelog_read(session, session->log_path, session->hash);
  CHECK(session->host.ahead_seconds == 0, "none recorded");
  end();
}

static void a_log_of_another_bundle_or_a_damaged_one_is_not_read(void) {
  player_session *session;
  begin("other");
  session = logged("abc");
  write_text("saves/abc.log", "{\"format\":1,\"bundle\":\"zzz\",\"lastSeconds\":777}\n{\"kind\":\"command\"}\n");
  savelog_read(session, session->log_path, session->hash);
  CHECK(session->log_count == 0 && session->host.last_seconds == 0, "another bundle's log");
  write_text("saves/abc.log", "this is not JSON\n{\"kind\":\"command\"}\n");
  savelog_read(session, session->log_path, session->hash);
  CHECK(session->log_count == 0 && session->host.last_seconds == 0, "a damaged header");
  write_text("saves/abc.log", "{\"format\":1,\"bundle\":\"abc\",\"lastSeconds\":-4}\n");
  savelog_read(session, session->log_path, session->hash);
  CHECK(session->host.last_seconds == 0, "a negative time");
  savelog_clear(session);
  CHECK(session->log_count == 0, "nothing to read from a missing file");
  end();
}

/* Another bundle's log is read where it is named, as a save carried to a later build reads the earlier's. */
static void a_log_named_with_its_bundle_is_read_and_a_redeploy_is_its_entry(void) {
  player_session *session;
  begin("named");
  session = logged("abc");
  write_text("saves/zzz.log", "{\"format\":1,\"bundle\":\"zzz\",\"lastSeconds\":777}\n{\"kind\":\"command\"}\n");
  savelog_read(session, "saves/zzz.log", "abc");
  CHECK(session->log_count == 0 && session->host.last_seconds == 0, "not under another bundle's name");
  savelog_read(session, "saves/zzz.log", "zzz");
  CHECK(session->log_count == 1 && session->host.last_seconds == 777, "under its own: %zu", session->log_count);
  savelog_redeploy(session, true);
  savelog_redeploy(session, false);
  CHECK(session->log_count == 3 && strcmp(session->log[1], "{\"kind\":\"redeploy\",\"bundle\":\"abc\",\"kept\":true}") == 0 &&
            strcmp(session->log[2], "{\"kind\":\"redeploy\",\"bundle\":\"abc\",\"kept\":false}") == 0,
        "a redeploy names this bundle and whether it kept the state: %s", session->log_count > 1 ? session->log[1] : "");
  savelog_clear(session);
  end();
}

static void a_turn_that_ran_is_kept_as_its_entry_and_one_that_kept_nothing_is_not(void) {
  player_session *session;
  sprout_turn_input input;
  sprout_outcome outcome;
  begin("entry");
  session = logged("abc");
  memset(&input, 0, sizeof input);
  memset(&outcome, 0, sizeof outcome);
  input.text = "ask guard about weather and more";
  input.text_length = 23;
  outcome.has_log = true;
  outcome.result = SPROUT_RESULT_DONE;
  outcome.log.kind = SPROUT_TURN_COMMAND;
  outcome.log.seed = 42;
  outcome.log.seconds = 1000;
  outcome.log.serial = 7;
  outcome.log.who = (sprout_str){"visit:player", 12};
  savelog_turn(session, &input, &outcome);
  CHECK(session->log_count == 1 &&
            strcmp(session->log[0], "{\"kind\":\"command\",\"seed\":42,\"seconds\":1000,\"who\":\"visit:player\","
                                    "\"outcome\":\"done\",\"fault\":null,\"serial\":7,\"text\":\"ask guard about weather\"}") == 0,
        "%s", session->log_count > 0 ? session->log[0] : "");
  memset(&input, 0, sizeof input);
  outcome.result = SPROUT_RESULT_FAULTED;
  outcome.log.kind = SPROUT_TURN_MAINTENANCE;
  outcome.log.who = (sprout_str){"", 0};
  outcome.log.faulted = true;
  outcome.log.fault_name = "BudgetExhausted";
  savelog_turn(session, &input, &outcome);
  CHECK(session->log_count == 2 && HAS(session->log[1], "\"kind\":\"maintenance\"") && HAS(session->log[1], "\"who\":null") &&
            HAS(session->log[1], "\"fault\":\"BudgetExhausted\"") && HAS(session->log[1], "\"text\":null"),
        "catch-up names nobody and its fault: %s", session->log_count > 1 ? session->log[1] : "");
  outcome.has_log = false;
  savelog_turn(session, &input, &outcome);
  CHECK(session->log_count == 2, "a turn the runtime logged nothing of adds nothing");
  savelog_clear(session);
  end();
}

int main(void) {
  test_program("savelog");
  the_tail_keeps_the_last_entries_and_drops_the_oldest();
  the_tail_and_the_clamps_seconds_are_written_and_read_back();
  the_time_passed_ahead_of_the_device_is_written_and_read_back();
  a_log_of_another_bundle_or_a_damaged_one_is_not_read();
  a_log_named_with_its_bundle_is_read_and_a_redeploy_is_its_entry();
  a_turn_that_ran_is_kept_as_its_entry_and_one_that_kept_nothing_is_not();
  return finish();
}
