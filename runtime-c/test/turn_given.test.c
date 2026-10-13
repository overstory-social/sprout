/*
 * Tests for src/turn/given.c: what a turn gives a host beside its lines. A turn that wrote anything says what the
 * store writes, across every commit it made, under the world's serial; one that committed names every visit present
 * after it, whose views it made stale, and one that faulted names nobody (the spec's The runtime > Turns, The view;
 * The host contract > Storage).
 */
#include "turn_fixture.h"

static bool listed(const sprout_str *ids, size_t count, const char *id) {
  size_t i;
  for (i = 0; i < count; i++)
    if (ids[i].length == strlen(id) && memcmp(ids[i].bytes, id, ids[i].length) == 0) return true;
  return false;
}

static void a_committed_turn_gives_what_it_wrote_and_everyone_present(void) {
  turn_world w;
  sprout_outcome out;
  tw_open(&w, "turn-faults");
  tw_arrive(&w, "v-marta", "Marta", 0, &out);
  sprout_outcome_free(&out);
  tw_arrive(&w, "v-ines", "Ines", 0, &out);
  CHECK(out.has_changes);
  CHECK_INT(out.changes.visitor_count, 1);
  CHECK(listed(out.changes.visitors, out.changes.visitor_count, "v-ines"));
  sprout_outcome_free(&out);
  tw_do(&w, "v-marta", "crack", "porch.dud", 0, &out);
  CHECK(out.committed && out.has_changes);
  CHECK(listed(out.changes.upsert, out.changes.upsert_count, "turn_faults.porch.dud"));
  CHECK_INT(out.changes.remove_count, 0);
  CHECK_INT(out.changes.serial, w.state->serial);
  /* Every visit present, in code-unit order. */
  CHECK_INT(out.stale_count, 2);
  if (out.stale_count == 2) {
    CHECK_BYTES(out.stale[0].bytes, out.stale[0].length, "v-ines");
    CHECK_BYTES(out.stale[1].bytes, out.stale[1].length, "v-marta");
  }
  sprout_outcome_free(&out);
  tw_close(&w);
}

static void the_changes_are_the_records_a_store_writes_read_from_the_state(void) {
  turn_world w;
  sprout_outcome out;
  sprout_arena scratch;
  const char *bytes;
  size_t length;
  tw_open(&w, "turn-faults");
  tw_arrive(&w, "v-marta", "Marta", 0, &out);
  CHECK_INT(sprout_arena_init(&scratch, &w.host), SPROUT_OK);
  CHECK_INT(sprout_changes_write(w.state, &out.changes, &scratch, &bytes, &length), SPROUT_OK);
  CHECK(strncmp(bytes, "{\"serial\":2,\"upsert\":[{\"id\":\"turn_faults#1\",\"made\":{\"from\":\"visitor\"}", 64) == 0);
  CHECK(strstr(bytes, "\"remove\":[],\"tombstones\":[],\"visitors\":[{\"visit\":\"v-marta\",\"nickname\":\"Marta\"") != NULL);
  sprout_arena_reset(&scratch);
  sprout_outcome_free(&out);
  tw_close(&w);
}

static void a_turn_that_wrote_nothing_gives_neither(void) {
  turn_world w;
  sprout_outcome out;
  sprout_turn_input tick = tw_input(SPROUT_TURN_TICK, 0);
  tw_open(&w, "turn-faults");
  tick.place = "turn_faults.porch";
  /* Nobody stands on the porch: the tick has nothing to run. */
  CHECK_INT(tw_run(&w, tick, 0, &out), SPROUT_OK);
  CHECK_INT(out.result, SPROUT_RESULT_IDLE);
  CHECK(!out.has_changes && out.stale_count == 0 && out.stale == NULL);
  sprout_outcome_free(&out);
  tw_close(&w);
}

static void catch_up_with_nothing_due_gives_the_serial_and_no_records(void) {
  turn_world w;
  sprout_outcome out;
  tw_open(&w, "turn-faults");
  CHECK_INT(tw_run(&w, tw_input(SPROUT_TURN_MAINTENANCE, 0), 0, &out), SPROUT_OK);
  CHECK(out.committed && out.has_changes);
  CHECK_INT(out.changes.serial, 0);
  CHECK_INT(out.changes.upsert_count + out.changes.remove_count + out.changes.tombstone_count +
                out.changes.visitor_count + out.stale_count,
            0);
  sprout_outcome_free(&out);
  tw_close(&w);
}

static void a_faulted_wake_gives_its_consumption(void) {
  turn_world w;
  sprout_outcome out;
  sprout_turn_input wake = tw_input(SPROUT_TURN_WAKE, 100);
  tw_open(&w, "turn-faults");
  tw_arrive(&w, "v-marta", "Marta", 0, &out);
  sprout_outcome_free(&out);
  tw_do(&w, "v-marta", "crack", "porch.dud", 0, &out);
  sprout_outcome_free(&out);
  tw_do(&w, "v-marta", "light", "porch.dud", 0, &out);
  sprout_outcome_free(&out);
  wake.object = "turn_faults.porch.dud";
  wake.serial = tw_instance(&w, "turn_faults.porch.dud")->wakes[0].serial;
  CHECK_INT(tw_run(&w, wake, 0, &out), SPROUT_OK);
  CHECK(out.faulted && !out.committed && out.has_changes);
  CHECK_INT(out.changes.upsert_count, 1);
  CHECK(listed(out.changes.upsert, out.changes.upsert_count, "turn_faults.porch.dud"));
  /* A turn that faulted names nobody's view stale. */
  CHECK_INT(out.stale_count, 0);
  sprout_outcome_free(&out);
  tw_close(&w);
}

static void someone_who_left_holds_no_view(void) {
  turn_world w;
  sprout_outcome out;
  sprout_turn_input leave = tw_input(SPROUT_TURN_DEPARTURE, 0);
  tw_open(&w, "turn-faults");
  tw_arrive(&w, "v-marta", "Marta", 0, &out);
  sprout_outcome_free(&out);
  tw_arrive(&w, "v-ines", "Ines", 0, &out);
  sprout_outcome_free(&out);
  leave.visit = "v-ines";
  CHECK_INT(tw_run(&w, leave, 0, &out), SPROUT_OK);
  CHECK_INT(out.stale_count, 1);
  CHECK(listed(out.stale, out.stale_count, "v-marta"));
  CHECK(listed(out.changes.visitors, out.changes.visitor_count, "v-ines"));
  sprout_outcome_free(&out);
  tw_close(&w);
}

/* One commit's changes over the ids given, as sprout_draft_commit reports them. */
static sprout_changes commit_of(const sprout_str *written, size_t written_count, const sprout_str *removed,
                                size_t removed_count, const sprout_str *buried, size_t buried_count) {
  sprout_changes changes;
  memset(&changes, 0, sizeof changes);
  changes.written = written;
  changes.written_count = written_count;
  changes.removed = removed;
  changes.removed_count = removed_count;
  changes.tombstoned = buried;
  changes.tombstoned_count = buried_count;
  return changes;
}

static void across_commits_a_record_made_and_removed_is_in_neither_list(void) {
  turn_world w;
  sprout_outcome out;
  const sprout_str made = {"w#9", 3}, written[] = {{"w#9", 3}, {"w.box", 5}};
  const sprout_str removed[] = {{"w#9", 3}, {"w.box", 5}, {"w.lid", 5}}, buried[] = {{"w.box", 5}};
  sprout_changes first = commit_of(written, 2, NULL, 0, NULL, 0), second = commit_of(NULL, 0, removed, 3, buried, 1);
  tw_open(&w, "turn-faults");
  CHECK_INT(turn_outcome_begin(&w.host, &out), SPROUT_OK);
  /* The first commit adds `w#9` and rewrites `w.box`; the second removes both, and `w.lid`, stored before. */
  CHECK_INT(turn_changes_add(&out, &first, &made, 1), SPROUT_OK);
  CHECK_INT(turn_changes_add(&out, &second, NULL, 0), SPROUT_OK);
  CHECK_INT(turn_given(w.state, &out), SPROUT_OK);
  CHECK_INT(out.changes.upsert_count, 0);
  CHECK_INT(out.changes.remove_count, 2);
  if (out.changes.remove_count == 2) {
    CHECK_BYTES(out.changes.remove[0].bytes, out.changes.remove[0].length, "w.box");
    CHECK_BYTES(out.changes.remove[1].bytes, out.changes.remove[1].length, "w.lid");
  }
  CHECK_INT(out.changes.tombstone_count, 1);
  sprout_outcome_free(&out);
  tw_close(&w);
}

static void across_commits_a_record_written_twice_is_upserted_once(void) {
  turn_world w;
  sprout_outcome out;
  const sprout_str box[] = {{"w.box", 5}}, both[] = {{"w.box", 5}, {"w.ark", 5}};
  sprout_changes first = commit_of(box, 1, NULL, 0, NULL, 0), second = commit_of(both, 2, NULL, 0, NULL, 0);
  tw_open(&w, "turn-faults");
  CHECK_INT(turn_outcome_begin(&w.host, &out), SPROUT_OK);
  CHECK_INT(turn_changes_add(&out, &first, NULL, 0), SPROUT_OK);
  CHECK_INT(turn_changes_add(&out, &second, NULL, 0), SPROUT_OK);
  CHECK_INT(turn_given(w.state, &out), SPROUT_OK);
  CHECK_INT(out.changes.upsert_count, 2);
  if (out.changes.upsert_count == 2) {
    CHECK_BYTES(out.changes.upsert[0].bytes, out.changes.upsert[0].length, "w.ark");
    CHECK_BYTES(out.changes.upsert[1].bytes, out.changes.upsert[1].length, "w.box");
  }
  sprout_outcome_free(&out);
  tw_close(&w);
}

int main(void) {
  RUN(a_committed_turn_gives_what_it_wrote_and_everyone_present);
  RUN(the_changes_are_the_records_a_store_writes_read_from_the_state);
  RUN(a_turn_that_wrote_nothing_gives_neither);
  RUN(catch_up_with_nothing_due_gives_the_serial_and_no_records);
  RUN(a_faulted_wake_gives_its_consumption);
  RUN(someone_who_left_holds_no_view);
  RUN(across_commits_a_record_made_and_removed_is_in_neither_list);
  RUN(across_commits_a_record_written_twice_is_upserted_once);
  return REPORT();
}
