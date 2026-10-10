/* session.c: shelving a cartridge, opening it, reading and writing its save, closing it. */
#include <stdlib.h>

#include "session.h"
#include "support.h"

#define MARTA_GOES_NORTH                                                                              \
  "{\"verb\":\"sprout.go\",\"fillers\":[{\"role\":\"way\",\"binds\":\"exit\",\"direction\":\"north\"," \
  "\"label\":\"to the yard\",\"to\":\"chip_tree.yard\"}]}"

static void the_shelf_asks_whether_each_cartridge_can_be_shelved(void) {
  player_session *s;
  char *good, *garbage, *missing;
  begin("inspect");
  s = session_new();
  write_text("garbage.sproutworld", "this is not a cartridge");
  good = keep(player_inspect(s, "chip-tree.sproutworld"));
  CHECK(HAS(good, "\"ok\":true") && HAS(good, "\"name\":\"chip_tree\"") && HAS(good, "\"reason\":null"), "%s", good);
  garbage = keep(player_inspect(s, "garbage.sproutworld"));
  CHECK(HAS(garbage, "\"ok\":false") && HAS(garbage, "Sprout cartridge"), "%s", garbage);
  missing = keep(player_inspect(s, "absent.sproutworld"));
  CHECK(HAS(missing, "\"ok\":false") && HAS(missing, "cannot be read"), "%s", missing);
  end();
}

static void opening_says_the_hash_and_the_words_a_nickname_may_not_be(void) {
  player_session *s;
  char *opened;
  begin("open");
  s = session_new();
  opened = keep(player_open(s, "chip-tree.sproutworld"));
  CHECK(HAS(opened, "\"ok\":true") && HAS(opened, "\"name\":\"chip_tree\"") &&
            HAS(opened, "\"hash\":\"5a9a634cc7238c010d5129c9c325867cbb023b6afee053f396fb0e121c069346\""), "%.200s", opened);
  CHECK(HAS(opened, "\"guard\"") && HAS(opened, "\"north\"") && HAS(opened, "\"the\""), "the word set");
  opened = keep(player_open(s, "absent.sproutworld"));
  CHECK(HAS(opened, "\"ok\":false") && HAS(opened, "cannot be read"), "%s", opened);
  end();
}

static void nothing_open_says_so_in_words(void) {
  player_session *s;
  begin("nothing");
  s = session_new();
  CHECK(HAS(keep(player_load(s)), "No world is open."), "load");
  CHECK(HAS(keep(player_save(s)), "No world is open."), "save");
  CHECK(HAS(keep(player_close(s)), "\"lines\":[]"), "close");
  end();
}

static void a_returning_visitor_finds_their_place_and_name(void) {
  player_session *s;
  char *loaded, *view;
  begin("return");
  s = session_new();
  player_open(s, "chip-tree.sproutworld");
  player_load(s);
  player_admit(s, "Marta");
  player_turn(s, MARTA_GOES_NORTH);
  CHECK(HAS(keep(player_close(s)), "You leave, and take what you carry with you."), "leaving");

  player_open(s, "chip-tree.sproutworld");
  loaded = keep(player_load(s));
  CHECK(HAS(loaded, "\"fresh\":false") && HAS(loaded, "\"nickname\":\"Marta\"") && HAS(loaded, "\"present\":[]") &&
            HAS(loaded, "\"recovered\":false") && HAS(loaded, "\"words\":\"\""), "%s", loaded);
  CHECK(HAS(keep(player_admit(s, "Marta")), "\"admitted\":true"), "arriving again");
  view = keep(player_view(s));
  CHECK(HAS(view, "\"place\":\"chip_tree.yard\""), "back where they left: %.120s", view);
  end();
}

/* The app killed while a visitor stood in the world: the next opening puts them away, quietly. */
static void a_world_left_open_is_put_away_without_a_word(void) {
  player_session *s;
  char state_path[200], log_path[200];
  char *opened, *loaded, *state, *log;
  begin("killed");
  s = session_new();
  opened = keep(player_open(s, "chip-tree.sproutworld"));
  save_paths(opened, state_path, log_path, sizeof state_path);
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
  player_open(s, "chip-tree.sproutworld");
  loaded = keep(player_load(s));
  CHECK(HAS(loaded, "\"recovered\":true") && HAS(loaded, "\"nickname\":\"Marta\""), "%s", loaded);
  CHECK(HAS(keep(player_admit(s, "Marta")), "\"admitted\":true"), "and they can come in");
  end();
}

/* Time never runs back: a clock set earlier than the save's last seconds is read as the last. */
static void the_clock_going_back_is_clamped_to_the_save(void) {
  player_session *s;
  char state_path[200], log_path[200];
  char *opened, *log, *loaded;
  begin("clamp");
  s = session_new();
  fake->seconds = 5000000;
  opened = keep(player_open(s, "chip-tree.sproutworld"));
  save_paths(opened, state_path, log_path, sizeof state_path);
  player_load(s);
  player_admit(s, "Marta");
  fake->seconds = 100;
  player_turn(s, "{\"verb\":\"sprout.look\",\"fillers\":[]}");
  log = file_text(log_path);
  CHECK(log != NULL && HAS(log, "\"lastSeconds\":5000000") && !HAS(log, "\"seconds\":100,"), "%s", log);
  free(log);
  player_close(s);

  player_open(s, "chip-tree.sproutworld");
  loaded = keep(player_load(s));
  CHECK(HAS(loaded, "\"last\":5000000"), "the save's last seconds: %s", loaded);
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
  char *opened, *loaded;
  begin("damaged");
  s = session_new();
  opened = keep(player_open(s, "chip-tree.sproutworld"));
  save_paths(opened, state_path, log_path, sizeof state_path);
  fake->file.mkdir("saves");
  write_text(state_path, "{\"this\":\"is not a stored world\"}");
  loaded = keep(player_load(s));
  CHECK(HAS(loaded, "\"ok\":true") && HAS(loaded, "\"fresh\":true") && HAS(loaded, "could not be read") &&
            HAS(loaded, "set aside"), "%s", loaded);
  snprintf(aside, sizeof aside, "%s.damaged", state_path);
  CHECK(exists(aside), "the damaged save was not kept");
  CHECK(HAS(keep(player_admit(s, "Marta")), "\"admitted\":true"), "the world starts again");
  end();
}

/* Every fault is told: a save that cannot be written says so, in the reply to save, to the turn and to close. */
static void a_save_that_cannot_be_written_is_told(void) {
  player_session *s;
  char *saved, *closed;
  begin("full");
  s = session_new();
  player_open(s, "chip-tree.sproutworld");
  player_load(s);
  player_admit(s, "Marta");
  fake->fail_writes = 1;
  saved = keep(player_save(s));
  CHECK(HAS(saved, "\"ok\":false") && HAS(saved, "The save could not be written"), "%s", saved);
  player_turn(s, "{\"verb\":\"sprout.look\",\"fillers\":[]}");
  closed = keep(player_close(s));
  CHECK(HAS(closed, "\"saved\":false"), "close: %s", closed);
  fake->fail_writes = 0;
  player_open(s, "chip-tree.sproutworld");
  player_load(s);
  CHECK(HAS(keep(player_save(s)), "\"ok\":true"), "and once there is room it saves");
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
  return finish();
}
