/* session.c: shelving a cartridge, opening it, reading and writing its save, starting it over, closing it. */
#include <stdlib.h>

#include "session.h"
#include "state.h"
#include "support.h"

#define CHIP_TREE_HASH "5a9a634cc7238c010d5129c9c325867cbb023b6afee053f396fb0e121c069346"

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
  CHECK(go_north(s).saved && exists(state_path) && exists(log_path), "the visitor moved and the world is saved");
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

int main(void) {
  test_program("session");
  the_shelf_asks_whether_each_cartridge_can_be_shelved();
  opening_says_the_hash_and_the_words_a_nickname_may_not_be();
  nothing_open_says_so_in_words();
  a_returning_visitor_finds_their_place_and_name();
  a_world_left_open_is_put_away_without_a_word();
  the_clock_going_back_is_clamped_to_the_save();
  a_damaged_save_is_set_aside_in_words();
  a_save_that_cannot_be_written_is_told();
  starting_over_forgets_the_world_and_keeps_the_name();
  an_answer_lives_until_the_next_call();
  return finish();
}
