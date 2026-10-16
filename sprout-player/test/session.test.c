/* session.c: shelving a cartridge, opening it, reading and writing its save a slice at a time, starting it over, closing it. */
#include <stdlib.h>

#include "host/pd_host.h"
#include "session.h"
#include "state.h"
#include "support.h"

#define CHIP_TREE_HASH "4e4a61de55c37b876e24f777c5fe7da16f94a03e5635745342356f108c94dd59"

/* Whether `words` holds `word`. */
static bool has_word(const player_opening *answer, const char *word) {
  size_t i;
  for (i = 0; i < answer->word_count; i++)
    if (strcmp(answer->words[i], word) == 0) return true;
  return false;
}

/* Marta goes north from the hall. */
static player_told go_north(player_session *s) {
  sprout_filling way = fill_exit("way", "north", "to the yard", "chip_tree.yard");
  return turn_of(s, "sprout.go", NULL, 1, &way);
}

static player_told look(player_session *s) { return turn_of(s, "sprout.look", NULL, 0, NULL); }

static void the_shelf_asks_whether_each_cartridge_can_be_shelved(void) {
  player_session *s;
  player_opening answer;
  begin("inspect");
  s = session_new();
  write_text("garbage.sproutworld", "this is not a cartridge");
  answer = player_inspect(s, "chip-tree.sproutworld");
  CHECK(answer.ok && strcmp(answer.name, "chip_tree") == 0 && strcmp(answer.hash, CHIP_TREE_HASH) == 0 && answer.reason == NULL,
        "%s", answer.reason);
  answer = player_inspect(s, "garbage.sproutworld");
  CHECK(!answer.ok && HAS(answer.reason, "Sprout cartridge") && answer.name == NULL && answer.hash == NULL, "%s", answer.reason);
  answer = player_inspect(s, "absent.sproutworld");
  CHECK(!answer.ok && HAS(answer.reason, "cannot be read"), "%s", answer.reason);
  end();
}

static void opening_says_the_hash_and_the_words_a_nickname_may_not_be(void) {
  player_session *s;
  player_opening opened;
  begin("open");
  s = session_new();
  opened = player_open(s, "chip-tree.sproutworld");
  CHECK(opened.ok && strcmp(opened.name, "chip_tree") == 0 && strcmp(opened.hash, CHIP_TREE_HASH) == 0, "%s", opened.reason);
  CHECK(opened.reason == NULL && opened.word_count == 0, "the open reads the header alone");
  opened = player_step(s);
  CHECK(opened.ok && !opened.done && opened.counted > 0 && opened.read < opened.counted, "the first step of a few: %zu of %zu",
        opened.read, opened.counted);
  CHECK(opened.word_count == 0 && opened.name == NULL, "nothing more until the last step");
  while (opened.ok && !opened.done) opened = player_step(s);
  CHECK(opened.ok && opened.done && strcmp(opened.name, "chip_tree") == 0 && opened.read == opened.counted, "%s", opened.reason);
  CHECK(has_word(&opened, "guard") && has_word(&opened, "north") && has_word(&opened, "the"),
        "the word set comes with the last step: %zu words", opened.word_count);
  opened = player_open_whole(s, "absent.sproutworld");
  CHECK(!opened.ok && HAS(opened.reason, "cannot be read"), "%s", opened.reason);
  opened = player_step(s);
  CHECK(!opened.ok && strcmp(opened.reason, "No world is being opened.") == 0, "a step after a refused open has nothing to read");
  end();
}

static void nothing_open_says_so_in_words(void) {
  player_session *s;
  player_loaded loaded;
  player_result saved;
  player_told closed;
  begin("nothing");
  s = session_new();
  loaded = player_load(s);
  CHECK(!loaded.ok && strcmp(loaded.words, "No world is open.") == 0, "load");
  saved = player_save(s);
  CHECK(!saved.ok && strcmp(saved.words, "No world is open.") == 0, "save");
  closed = player_close(s);
  CHECK(closed.ok && closed.saved && closed.lines.count == 0, "close");
  end();
}

static void a_returning_visitor_finds_their_place_and_name(void) {
  player_session *s;
  player_loaded loaded;
  player_told told;
  const sprout_seen_view *view;
  const char *words;
  begin("return");
  s = session_new();
  player_open_whole(s, "chip-tree.sproutworld");
  loaded = player_load(s);
  CHECK(loaded.ok && loaded.fresh && loaded.nickname == NULL && loaded.last == 0, "a new world");
  player_admit(s, "Marta");
  go_north(s);
  told = player_close(s);
  CHECK(told_has(&told, "You leave, and take what you carry with you.") && told.saved, "leaving");

  player_open_whole(s, "chip-tree.sproutworld");
  loaded = player_load(s);
  CHECK(loaded.ok && !loaded.fresh && loaded.nickname != NULL && sprout_str_is(*loaded.nickname, "Marta") &&
            loaded.present_count == 0 && !loaded.recovered && strcmp(loaded.words, "") == 0 && loaded.last == 1000000,
        "%s", loaded.words);
  CHECK(player_admit(s, "Marta").admitted, "arriving again");
  view = player_view(s, &words);
  CHECK(view != NULL && sprout_str_is(view->place.id, "chip_tree.yard") && sprout_str_is(view->place.name, "a yard"),
        "back where they left: %s", words);
  end();
}

/* The app killed while a visitor stood in the world: the next opening puts them away, quietly. */
static void a_world_left_open_is_put_away_without_a_word(void) {
  player_session *s;
  char state_path[200], log_path[200];
  char *state, *log;
  player_loaded loaded;
  begin("killed");
  s = session_new();
  save_paths(player_open_whole(s, "chip-tree.sproutworld").hash, state_path, log_path, sizeof state_path);
  player_load(s);
  player_admit(s, "Marta");
  player_save(s);
  /* What the Data folder held at that moment is all a killed app leaves behind. */
  state = file_text(state_path);
  log = file_text(log_path);
  player_close(s);
  write_text(state_path, state);
  write_text(log_path, log);
  free(state);
  free(log);
  player_open_whole(s, "chip-tree.sproutworld");
  loaded = player_load(s);
  CHECK(loaded.ok && loaded.recovered && loaded.nickname != NULL && sprout_str_is(*loaded.nickname, "Marta"), "%s", loaded.words);
  CHECK(player_admit(s, "Marta").admitted, "and they can come in");
  end();
}

/* Time never runs back: a clock set earlier than the save's last seconds is read as the last. */
static void the_clock_going_back_is_clamped_to_the_save(void) {
  player_session *s;
  char state_path[200], log_path[200];
  char *log;
  player_loaded loaded;
  begin("clamp");
  s = session_new();
  fake->seconds = 5000000;
  save_paths(player_open_whole(s, "chip-tree.sproutworld").hash, state_path, log_path, sizeof state_path);
  player_load(s);
  player_admit(s, "Marta");
  fake->seconds = 100;
  look(s);
  log = file_text(log_path);
  CHECK(log != NULL && HAS(log, "\"lastSeconds\":5000000") && !HAS(log, "\"seconds\":100,"), "%s", log);
  free(log);
  player_close(s);

  player_open_whole(s, "chip-tree.sproutworld");
  loaded = player_load(s);
  CHECK(loaded.last == 5000000, "the save's last seconds: %llu", (unsigned long long)loaded.last);
  player_admit(s, "Marta");
  log = file_text(log_path);
  CHECK(log != NULL && !HAS(log, "\"seconds\":100,") && HAS(log, "\"seconds\":5000000,"), "%s", log);
  free(log);
  end();
}

/* A save the runtime cannot read is set aside and the world starts again, with the words saying so. */
static void a_damaged_save_is_set_aside_in_words(void) {
  player_session *s;
  char state_path[200], log_path[200], aside[260];
  player_loaded loaded;
  begin("damaged");
  s = session_new();
  save_paths(player_open_whole(s, "chip-tree.sproutworld").hash, state_path, log_path, sizeof state_path);
  fake->file.mkdir("saves");
  write_text(state_path, "{\"this\":\"is not a stored world\"}");
  loaded = player_load(s);
  CHECK(loaded.ok && loaded.fresh && HAS(loaded.words, "could not be read") && HAS(loaded.words, "set aside"), "%s", loaded.words);
  snprintf(aside, sizeof aside, "%s.damaged", state_path);
  CHECK(exists(aside), "the damaged save was not kept");
  CHECK(player_admit(s, "Marta").admitted, "the world starts again");
  end();
}

/* Every fault is told: a save that cannot be written says so, in the answer to save, to the turn and to close. */
static void a_save_that_cannot_be_written_is_told(void) {
  player_session *s;
  player_result saved;
  player_told closed;
  begin("full");
  s = session_new();
  player_open_whole(s, "chip-tree.sproutworld");
  player_load(s);
  player_admit(s, "Marta");
  fake->fail_writes = 1;
  saved = player_save(s);
  CHECK(!saved.ok && HAS(saved.words, "The save could not be written"), "%s", saved.words);
  CHECK(!look(s).saved, "the turn");
  closed = player_close(s);
  CHECK(!closed.saved, "close");
  fake->fail_writes = 0;
  player_open_whole(s, "chip-tree.sproutworld");
  player_load(s);
  saved = player_save(s);
  CHECK(saved.ok && strcmp(saved.words, "") == 0, "and once there is room it saves");
  end();
}

/*
 * Starting over removes the save and the log and any `.tmp` beside them, lets the state go while
 * the world stays read, and hands back the name the visitor had; the next load arrives fresh.
 */
static void starting_over_forgets_the_world_and_keeps_the_name(void) {
  player_session *s;
  char state_path[200], log_path[200], state_temp[220], log_temp[220];
  player_restart restart;
  player_loaded loaded;
  player_told admitted;
  const sprout_seen_view *view;
  const char *words;
  begin("restart");
  s = session_new();
  restart = player_start_over(s);
  CHECK(!restart.ok && strcmp(restart.reason, "No world is open.") == 0, "nothing open: %s", restart.reason);
  save_paths(player_open_whole(s, "chip-tree.sproutworld").hash, state_path, log_path, sizeof state_path);
  player_load(s);
  player_admit(s, "Marta");
  CHECK(go_north(s).saved && player_save_settle(s).ok && exists(state_path) && exists(log_path),
        "the visitor moved and the world is saved");
  snprintf(state_temp, sizeof state_temp, "%s.tmp", state_path);
  snprintf(log_temp, sizeof log_temp, "%s.tmp", log_path);
  write_text(state_temp, "a write cut short");
  write_text(log_temp, "a write cut short");

  restart = player_start_over(s);
  CHECK(restart.ok && restart.reason == NULL, "%s", restart.reason);
  CHECK(restart.nickname != NULL && sprout_str_is(*restart.nickname, "Marta"), "the name the visitor had is handed back");
  CHECK(strcmp(restart.name, "chip_tree") == 0 && restart.word_count > 0, "with the world's name and words: %zu words",
        restart.word_count);
  CHECK(!exists(state_path) && !exists(log_path) && !exists(state_temp) && !exists(log_temp),
        "the save, the log and what a cut-short write left are gone");
  CHECK(player_view(s, &words) == NULL, "the state is let go: nothing can be seen");
  admitted = player_admit(s, "Marta");
  CHECK(!admitted.ok && strcmp(admitted.words, "No world is open.") == 0, "and nobody can arrive until it loads: %s",
        admitted.words);
  CHECK(!player_start_over(s).ok, "starting over again before the load has no state to forget");

  loaded = player_load(s);
  CHECK(loaded.ok && loaded.fresh && !loaded.recovered && loaded.nickname == NULL && loaded.present_count == 0 &&
            loaded.last == 0,
        "the next load arrives fresh: %s", loaded.words);
  CHECK(!exists(state_path) && !exists(log_path), "a fresh world writes nothing until a turn commits");
  admitted = player_admit(s, "Marta");
  CHECK(admitted.admitted && admitted.saved, "%s", admitted.words);
  view = player_view(s, &words);
  CHECK(view != NULL && sprout_str_is(view->place.id, "chip_tree.hall"),
        "the visitor begins where the world begins, not where they left: %s", words);
  end();
}

#define SLICE 512

/* The stored state in the file at `path` reads whole, and stands its visitor in `place`. */
static bool saved_in(const char *path, const char *place) {
  sprout_state *state = NULL;
  sprout_refusal refusal;
  sprout_str key = {PLAYER_VISIT, sizeof PLAYER_VISIT - 1};
  const sprout_stored_visitor *visitor;
  const sprout_stored_instance *person;
  char *text = file_text(path);
  bool found = false;
  player_host host;
  if (text == NULL) return false;
  player_host_init(&host, &fake->api);
  if (sprout_state_read(&host.record, text, strlen(text), &state, &refusal) == SPROUT_OK) {
    visitor = sprout_state_find_visitor(state, key);
    person = visitor == NULL ? NULL : sprout_state_find(state, visitor->instance);
    found = person != NULL && person->has_container && sprout_str_is(person->container, place);
    sprout_state_free(state);
  }
  free(text);
  return found;
}

/*
 * A committed turn writes its log line at once and owes the state; each step makes a slice of it
 * and writes a slice to `.part`, the first steps measuring the text and writing nothing, and the
 * last turns the part into `.tmp` and the `.tmp` into the save, so the save on disk is only ever
 * replaced by a whole one.
 */
static void the_state_is_written_a_slice_a_step_after_the_turn(void) {
  player_session *s;
  char state_path[200], log_path[200], part[220], want[1200];
  char *log;
  int steps = 0, measuring = 0;
  begin("slices");
  s = session_new();
  save_paths(player_open_whole(s, "chip-tree.sproutworld").hash, state_path, log_path, sizeof state_path);
  snprintf(part, sizeof part, "%s.part", state_path);
  player_load(s);
  CHECK(!player_saving(s), "a fresh world owes nothing");
  CHECK(player_admit(s, "Marta").saved, "the arrival");
  log = file_text(log_path);
  CHECK(log != NULL && HAS(log, "\"kind\":\"arrival\""), "the log line is written with the turn");
  free(log);
  CHECK(!exists(state_path) && !exists(part) && player_saving(s), "and the state is owed, not yet begun");
  fake->writes = 0;
  fake->written = 0;
  CHECK(player_save_step(s, SLICE).ok && exists(part) && !exists(state_path) && fake->writes == 0,
        "the first step begins the writer and opens the part, writing nothing");
  fake->file_log[0] = '\0';
  while (player_saving(s) && steps < 10000) {
    CHECK(!exists(state_path), "no save until the part is whole, after %d slices", steps);
    CHECK(player_save_step(s, SLICE).ok, "a slice");
    steps++;
    if (fake->writes == 0) measuring = steps;
  }
  CHECK(measuring > 1 && steps > measuring + 1,
        "the text is measured over several steps, which write nothing, and made and written over several more: %d then %d",
        measuring, steps - measuring);
  CHECK(fake->writes > 2 && fake->written > 2 * SLICE, "the state takes several slices of %d bytes: %zu writes of %zu",
        SLICE, fake->writes, fake->written);
  snprintf(want, sizeof want, "unlink %s.tmp\nrename %s.part %s.tmp\nunlink %s\nrename %s.tmp %s\n", state_path, state_path,
           state_path, state_path, state_path, state_path);
  CHECK(strcmp(fake->file_log, want) == 0, "the part becomes the .tmp and the .tmp the save:\n%s", fake->file_log);
  CHECK(!exists(part) && saved_in(state_path, "chip_tree.hall"), "the save is whole");
  CHECK(player_save_step(s, SLICE).ok && !player_saving(s), "and nothing more is owed");
  end();
}

/*
 * A tick's save waits: the state a tick changed is owed only PLAYER_SAVE_WAIT_SECONDS after the last
 * save began, or at once at the visitor's next turn and when settling, as pausing does; a turn's own
 * save is immediate.
 */
static void a_ticks_save_waits_and_a_turns_does_not(void) {
  player_session *s;
  char state_path[200], log_path[200], part[220];
  begin("tick-wait");
  s = session_new();
  fake->seconds = 1000;
  save_paths(player_open_whole(s, "ticks.sproutworld").hash, state_path, log_path, sizeof state_path);
  snprintf(part, sizeof part, "%s.part", state_path);
  player_load(s);
  CHECK(player_admit(s, "Marta").saved && player_save_settle(s).ok && exists(state_path), "the arrival's save is at once");
  fake->seconds = 1010;
  CHECK(player_tick(s).saved && player_saving(s), "a tick changed the state: a save is owed");
  CHECK(player_save_step(s, SLICE).ok && !exists(part), "but not begun");
  fake->seconds = 1000 + PLAYER_SAVE_WAIT_SECONDS - 1;
  CHECK(player_save_step(s, SLICE).ok && !exists(part) && player_saving(s), "nor a second short of the wait");
  fake->seconds = 1000 + PLAYER_SAVE_WAIT_SECONDS;
  CHECK(player_save_step(s, SLICE).ok && exists(part), "the wait since the last save began has passed: it begins");
  CHECK(player_save_settle(s).ok && !player_saving(s) && !exists(part), "and is written");
  fake->seconds += 10;
  CHECK(player_tick(s).saved && player_save_step(s, SLICE).ok && !exists(part) && player_saving(s), "the next tick's save waits");
  CHECK(look(s).saved, "the visitor's turn");
  CHECK(player_save_step(s, SLICE).ok && exists(part), "begins the save at once, the tick's change with it");
  CHECK(player_save_settle(s).ok && !player_saving(s), "written");
  fake->seconds += 10;
  CHECK(player_tick(s).saved && player_save_step(s, SLICE).ok && !exists(part) && player_saving(s), "a tick's save waits");
  CHECK(player_save_settle(s).ok && !player_saving(s) && !exists(part), "settling, as pausing does, writes it at once");
  fake->seconds += 10;
  CHECK(player_tick(s).saved && player_saving(s), "a tick's save waits");
  CHECK(player_close(s).saved && !exists(part), "and leaving the world writes it");
  end();
}

/* A turn asked while the state is being written waits for the rest of it, so it runs on a state that is whole on disk. */
static void a_turn_during_the_save_waits_for_it(void) {
  player_session *s;
  char state_path[200], log_path[200], part[220];
  const sprout_seen_view *view;
  const char *words;
  begin("waits");
  s = session_new();
  save_paths(player_open_whole(s, "chip-tree.sproutworld").hash, state_path, log_path, sizeof state_path);
  snprintf(part, sizeof part, "%s.part", state_path);
  player_load(s);
  player_admit(s, "Marta");
  CHECK(player_save_settle(s).ok && saved_in(state_path, "chip_tree.hall"), "settled, the arrival is on disk");
  CHECK(go_north(s).committed, "the visitor goes north");
  player_save_step(s, SLICE);
  player_save_step(s, SLICE);
  CHECK(exists(part) && saved_in(state_path, "chip_tree.hall"), "part way through the save of the move");
  CHECK(look(s).saved, "a turn asked now");
  CHECK(!exists(part) && saved_in(state_path, "chip_tree.yard"), "found the move's save finished before it ran");
  view = player_view(s, &words);
  CHECK(view != NULL && sprout_str_is(view->place.id, "chip_tree.yard"), "and ran where the visitor stands: %s", words);
  CHECK(go_north(s).saved, "another move");
  CHECK(player_close(s).saved && !exists(part), "closing writes what is owed, whole");
  end();
}

/* A slice that cannot be written stops play: the step says so, and so does the next turn. */
static void a_step_that_cannot_write_is_told(void) {
  player_session *s;
  player_result step;
  begin("stepfails");
  s = session_new();
  player_open_whole(s, "chip-tree.sproutworld");
  player_load(s);
  player_admit(s, "Marta");
  fake->fail_writes = 1;
  step = player_save_step(s, SLICE);
  CHECK(!step.ok && HAS(step.words, "The save could not be written"), "%s", step.words);
  CHECK(!look(s).saved, "the next turn says the save is not kept");
  fake->fail_writes = 0;
  CHECK(player_save_settle(s).ok && !player_saving(s), "once there is room, settling writes it");
  end();
}

/* What a call hands back lives until the next call on the session, which releases it. */
static void an_answer_lives_until_the_next_call(void) {
  player_session *s;
  player_opening inspected;
  int pages;
  begin("answer");
  s = session_new();
  inspected = player_inspect(s, "absent.sproutworld");
  CHECK(!inspected.ok && HAS(inspected.reason, "absent.sproutworld"), "the reason is the session's copy: %s", inspected.reason);
  pages = fake->pages;
  player_inspect(s, "absent.sproutworld");
  CHECK(fake->pages == pages, "the next call released the last answer before making its own: %d then %d", pages, fake->pages);
  end();
}

static void a_cartridge_that_cannot_be_read_part_way_is_told_in_words(void) {
  player_session *s;
  player_opening opened;
  begin("unreadable");
  s = session_new();
  opened = player_open(s, "chip-tree.sproutworld");
  CHECK(opened.ok, "%s", opened.reason);
  fake->fail_reads = 1;
  while (opened.ok && !opened.done) opened = player_step(s);
  fake->fail_reads = 0;
  CHECK(!opened.ok && strcmp(opened.reason, "This cartridge cannot be read: its file could not be read to the end.") == 0,
        "%s", opened.reason ? opened.reason : "(opened)");
  opened = player_step(s);
  CHECK(!opened.ok && strcmp(opened.reason, "No world is being opened.") == 0, "the failed load is let go");
  opened = player_open_whole(s, "chip-tree.sproutworld");
  CHECK(opened.ok && opened.done, "it opens once the file reads again: %s", opened.reason ? opened.reason : "");
  end();
}

static void the_load_reads_the_file_a_piece_at_a_time(void) {
  player_session *s;
  player_opening opened;
  begin("pieces");
  s = session_new();
  opened = player_open(s, "chip-tree.sproutworld");
  CHECK(opened.ok, "%s", opened.reason);
  fake->reads = 0;
  fake->read_largest = 0;
  while (opened.ok && !opened.done) opened = player_step(s);
  CHECK(opened.ok && opened.done, "%s", opened.reason ? opened.reason : "");
  CHECK(fake->reads > 0 && fake->read_largest <= 32768, "%zu reads, the largest %zu bytes", fake->reads, fake->read_largest);
  end();
}

int main(void) {
  test_program("session");
  a_cartridge_that_cannot_be_read_part_way_is_told_in_words();
  the_load_reads_the_file_a_piece_at_a_time();
  the_shelf_asks_whether_each_cartridge_can_be_shelved();
  opening_says_the_hash_and_the_words_a_nickname_may_not_be();
  nothing_open_says_so_in_words();
  a_returning_visitor_finds_their_place_and_name();
  a_world_left_open_is_put_away_without_a_word();
  the_clock_going_back_is_clamped_to_the_save();
  a_damaged_save_is_set_aside_in_words();
  a_save_that_cannot_be_written_is_told();
  starting_over_forgets_the_world_and_keeps_the_name();
  the_state_is_written_a_slice_a_step_after_the_turn();
  a_ticks_save_waits_and_a_turns_does_not();
  a_turn_during_the_save_waits_for_it();
  a_step_that_cannot_write_is_told();
  an_answer_lives_until_the_next_call();
  return finish();
}
