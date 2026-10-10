/* savelog.c: the log tail the save keeps beside the stored world. */
#include <stdlib.h>

#include "files.h"
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
  savelog_read(session);
  CHECK(session->host.last_seconds == 123456, "the clamp starts from what was recorded");
  CHECK(session->log_count == 2 && strcmp(session->log[1], "{\"kind\":\"command\"}") == 0, "the entries");
  /* A recorded time earlier than the clock already seen never moves it back. */
  session->host.last_seconds = 999999;
  savelog_clear(session);
  savelog_read(session);
  CHECK(session->host.last_seconds == 999999, "never back");
  end();
}

static void a_log_of_another_bundle_or_a_damaged_one_is_not_read(void) {
  player_session *session;
  begin("other");
  session = logged("abc");
  write_text("saves/abc.log", "{\"format\":1,\"bundle\":\"zzz\",\"lastSeconds\":777}\n{\"kind\":\"command\"}\n");
  savelog_read(session);
  CHECK(session->log_count == 0 && session->host.last_seconds == 0, "another bundle's log");
  write_text("saves/abc.log", "this is not JSON\n{\"kind\":\"command\"}\n");
  savelog_read(session);
  CHECK(session->log_count == 0 && session->host.last_seconds == 0, "a damaged header");
  write_text("saves/abc.log", "{\"format\":1,\"bundle\":\"abc\",\"lastSeconds\":-4}\n");
  savelog_read(session);
  CHECK(session->host.last_seconds == 0, "a negative time");
  savelog_clear(session);
  CHECK(session->log_count == 0, "nothing to read from a missing file");
  end();
}

int main(void) {
  test_program("savelog");
  the_tail_keeps_the_last_entries_and_drops_the_oldest();
  the_tail_and_the_clamps_seconds_are_written_and_read_back();
  a_log_of_another_bundle_or_a_damaged_one_is_not_read();
  return finish();
}
