/* turns.c: arrival and the catch-up before it, a command, the ticks and wakes, and the log. */
#include <stdlib.h>

#include "session.h"
#include "support.h"

#define GO_NORTH                                                                                      \
  "{\"verb\":\"sprout.go\",\"fillers\":[{\"role\":\"way\",\"binds\":\"exit\",\"direction\":\"north\"," \
  "\"label\":\"to the yard\",\"to\":\"chip_tree.yard\"}]}"

static void a_word_of_the_world_is_not_a_name_and_nobody_arrives(void) {
  player_session *s;
  char *refused;
  begin("name");
  s = session_new();
  player_open(s, "chip-tree.sproutworld");
  player_load(s);
  refused = keep(player_admit(s, "guard"));
  CHECK(HAS(refused, "\"admitted\":false") && HAS(refused, "guard") && HAS(refused, "\"lines\":[]"), "%s", refused);
  CHECK(HAS(keep(player_view(s)), "You are not in a world."), "and they are not in");
  end();
}

/* chip-tree: the transcript the TypeScript player wrote, played through the turn call. */
static void chip_tree_plays_as_its_transcript_does(void) {
  player_session *s;
  char state_path[200], log_path[200];
  char *opened, *admitted, *told, *log;
  const sprout_json *reply;
  begin("transcript");
  json_begin();
  s = session_new();
  opened = keep(player_open(s, "chip-tree.sproutworld"));
  save_paths(opened, state_path, log_path, sizeof state_path);
  player_load(s);
  admitted = keep(player_admit(s, "Marta"));
  reply = parse(admitted);
  CHECK(HAS(admitted, "\"admitted\":true") && HAS(admitted, "\"saved\":true"), "%s", admitted);
  CHECK(line_count(reply) == 1 && strcmp(line_kind(reply, 0), "described") == 0 &&
            strcmp(line_text(reply, 0), "There is nothing special about a hall.") == 0, "%s", admitted);

  told = keep(player_turn(s, "{\"verb\":\"sprout.ask\",\"text\":\"ask guard about weather\",\"fillers\":["
                             "{\"role\":\"target\",\"binds\":\"object\",\"id\":\"chip_tree.hall.guard\"},"
                             "{\"role\":\"topic\",\"binds\":\"value\",\"value\":\"weather\"}]}"));
  reply = parse(told);
  CHECK(HAS(told, "\"committed\":true") && strcmp(line_kind(reply, 0), "said") == 0 &&
            strcmp(line_text(reply, 0), "The guard nods.") == 0, "%s", told);
  told = keep(player_turn(s, "{\"verb\":\"chip_tree.turn\",\"fillers\":[{\"role\":\"knob\",\"binds\":\"object\","
                             "\"id\":\"chip_tree.hall.dial\"},{\"role\":\"notch\",\"binds\":\"value\",\"value\":3}]}"));
  CHECK(strcmp(line_text(parse(told), 0), "Click.") == 0, "%s", told);
  told = keep(player_turn(s, "{\"verb\":\"chip_tree.juggle\",\"fillers\":[{\"role\":\"things\",\"binds\":\"set\","
                             "\"ids\":[\"chip_tree.hall.pebble\"]}]}"));
  CHECK(strcmp(line_text(parse(told), 0), "Nothing much comes of that.") == 0, "%s", told);
  /* take pebble: the roles the chip tree leaves out are left unbound, and the engine takes the reading */
  told = keep(player_turn(s, "{\"verb\":\"sprout.take\",\"fillers\":[{\"role\":\"target\",\"binds\":\"object\","
                             "\"id\":\"chip_tree.hall.pebble\"}]}"));
  reply = parse(told);
  CHECK(HAS(told, "\"committed\":true") && HAS(told, "\"result\":\"done\"") && line_count(reply) >= 1, "%s", told);
  CHECK(HAS(keep(player_view(s)), "\"carried\":[{\"id\":\"chip_tree.hall.pebble\""), "the pebble is carried");
  told = keep(player_turn(s, GO_NORTH));
  reply = parse(told);
  CHECK(strcmp(line_kind(reply, 0), "described") == 0 && strcmp(line_text(reply, 0), "There is nothing special about a yard.") == 0,
        "%s", told);

  /* the log tail carries each turn's seed; the seeds are in range and differ from turn to turn */
  log = file_text(log_path);
  {
    const char *at = log;
    unsigned long long previous = ~0ULL;
    int seen = 0;
    CHECK(log != NULL && HAS(log, "\"bundle\":\"5a9a634c"), "the log tail: %s", log);
    for (; at != NULL && (at = strstr(at, "\"seed\":")) != NULL; seen++) {
      unsigned long long seed = strtoull(at + 7, NULL, 10);
      CHECK(seed <= 4294967295ULL && seed != previous, "seed %llu", seed);
      previous = seed;
      at += 7;
    }
    CHECK(seen >= 7, "only %d seeds in the log", seen);
    CHECK(HAS(log, "\"text\":\"ask guard about weather\""), "the line typed is logged");
  }
  free(log);
  json_end();
  end();
}

static void a_reading_the_world_cannot_take_is_told_in_words_and_writes_nothing(void) {
  player_session *s;
  char state_path[200], log_path[200];
  char *opened, *told, *before, *after;
  const sprout_json *reply;
  begin("refused");
  json_begin();
  s = session_new();
  opened = keep(player_open(s, "chip-tree.sproutworld"));
  save_paths(opened, state_path, log_path, sizeof state_path);
  player_load(s);
  player_admit(s, "Marta");
  before = file_text(state_path);
  told = keep(player_turn(s, "{\"verb\":\"sprout.nonesuch\",\"fillers\":[]}"));
  reply = parse(told);
  CHECK(HAS(told, "\"committed\":false") && line_count(reply) == 1 && strcmp(line_kind(reply, 0), "notice") == 0 &&
            strlen(line_text(reply, 0)) > 0, "%s", told);
  told = keep(player_turn(s, "not json at all"));
  CHECK(HAS(told, "\"committed\":false") && HAS(told, "not written as the player writes one"), "%s", told);
  told = keep(player_turn(s, "{\"verb\":\"sprout.look\"}"));
  CHECK(HAS(told, "\"committed\":false") && HAS(told, "no list of what fills its roles"), "%s", told);
  after = file_text(state_path);
  CHECK(before != NULL && after != NULL && strcmp(before, after) == 0, "nothing was written");
  free(before);
  free(after);
  json_end();
  end();
}

/* Every fault is told: a turn whose save cannot be written says so, and the reader stops play. */
static void a_turn_whose_save_cannot_be_written_says_so(void) {
  player_session *s;
  char *told;
  begin("full");
  s = session_new();
  player_open(s, "chip-tree.sproutworld");
  player_load(s);
  CHECK(HAS(keep(player_admit(s, "Marta")), "\"saved\":true"), "arriving saves");
  fake->fail_writes = 1;
  told = keep(player_turn(s, "{\"verb\":\"sprout.ask\",\"fillers\":[{\"role\":\"target\",\"binds\":\"object\","
                             "\"id\":\"chip_tree.hall.guard\"},{\"role\":\"topic\",\"binds\":\"value\",\"value\":\"weather\"}]}"));
  CHECK(HAS(told, "\"committed\":true") && HAS(told, "\"saved\":false"), "%s", told);
  CHECK(HAS(keep(player_tick(s)), "\"saved\":false"), "the tick's save is told too");
  fake->fail_writes = 0;
  CHECK(HAS(keep(player_turn(s, "{\"verb\":\"sprout.wait\",\"fillers\":[]}")), "\"saved\":true"), "and once there is room it saves");
  end();
}

/* The wakes world: a kiln fired, the player closed, four hours on. Catch-up says nothing. */
static void catching_up_after_an_absence_narrates_nothing(void) {
  player_session *s;
  char state_path[200], log_path[200], reading[2000];
  char *opened, *view, *told, *before, *after, *admitted, *log;
  const sprout_json *reply;
  begin("catch-up");
  json_begin();
  s = session_new();
  opened = keep(player_open(s, "wakes.sproutworld"));
  save_paths(opened, state_path, log_path, sizeof state_path);
  player_load(s);
  player_admit(s, "Marta");
  view = keep(player_view(s));
  reading_from(view, "fire", "a kiln", reading, sizeof reading);
  told = keep(player_turn(s, reading));
  CHECK(HAS(told, "The chamber takes the flame."), "%s", told);
  player_close(s);
  before = file_text(state_path);
  CHECK(before != NULL && HAS(before, "firing"), "the kiln is firing");

  fake->seconds += 4 * 3600;
  player_open(s, "wakes.sproutworld");
  player_load(s);
  admitted = keep(player_admit(s, "Marta"));
  reply = parse(admitted);
  CHECK(HAS(admitted, "\"admitted\":true") && line_count(reply) == 1 && strcmp(line_kind(reply, 0), "described") == 0,
        "the arrival is all that is told: %s", admitted);
  CHECK(!HAS(admitted, "chamber") && !HAS(admitted, "seedling"), "the catch-up narrated: %s", admitted);
  after = file_text(state_path);
  CHECK(after != NULL && !HAS(after, "firing") && HAS(after, "cool"), "the kiln cooled in the catch-up");
  log = file_text(log_path);
  CHECK(log != NULL && HAS(log, "\"kind\":\"maintenance\"") && HAS(log, "\"outcome\":\"done\""), "the catch-up is in the log: %s", log);
  free(before);
  free(after);
  free(log);
  json_end();
  end();
}

/* The ticks world: a tick turn is run for the place the visitor stands in, and what it tells is told. */
static void a_tick_tells_what_the_place_says(void) {
  player_session *s;
  char *ticked;
  begin("tick");
  s = session_new();
  player_open(s, "ticks.sproutworld");
  player_load(s);
  CHECK(HAS(keep(player_tick(s)), "You are not in a world."), "before arriving");
  player_admit(s, "Marta");
  ticked = keep(player_tick(s));
  CHECK(HAS(ticked, "\"ran\":") && HAS(ticked, "\"lines\":") && HAS(ticked, "\"saved\":true"), "%s", ticked);
  fake->seconds += 40;
  ticked = keep(player_tick(s));
  CHECK(HAS(ticked, "\"ran\":true") && HAS(ticked, "The wind picks up in the eaves."), "%s", ticked);
  end();
}

int main(void) {
  test_program("turns");
  a_word_of_the_world_is_not_a_name_and_nobody_arrives();
  chip_tree_plays_as_its_transcript_does();
  a_reading_the_world_cannot_take_is_told_in_words_and_writes_nothing();
  a_turn_whose_save_cannot_be_written_says_so();
  catching_up_after_an_absence_narrates_nothing();
  a_tick_tells_what_the_place_says();
  return finish();
}
