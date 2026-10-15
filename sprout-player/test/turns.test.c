/* turns.c: arrival and the catch-up before it, a command, the ticks and wakes, and the log. */
#include <stdlib.h>

#include "session.h"
#include "state.h"
#include "support.h"

static player_told ask_guard(player_session *s, const char *text) {
  sprout_filling fillings[2];
  fillings[0] = fill_object("target", "chip_tree.hall.guard");
  fillings[1] = fill_word("topic", "weather");
  return turn_of(s, "sprout.ask", text, 2, fillings);
}

static void a_word_of_the_world_is_not_a_name_and_nobody_arrives(void) {
  player_session *s;
  player_told refused;
  const char *words;
  begin("name");
  s = session_new();
  refused = player_admit(s, "Marta");
  CHECK(!refused.ok && !refused.admitted && strcmp(refused.words, "No world is open.") == 0 && refused.lines.count == 0,
        "before a world is open: %s", refused.words);
  player_open_whole(s, "chip-tree.sproutworld");
  player_load(s);
  refused = player_admit(s, "guard");
  CHECK(refused.ok && !refused.admitted && HAS(refused.words, "\"guard\" is a word this world already reads") &&
            refused.lines.count == 0 && refused.saved,
        "%s", refused.words);
  CHECK(player_view(s, &words) == NULL && strcmp(words, "You are not in a world.") == 0, "and they are not in");
  end();
}

/* chip-tree: the transcript the TypeScript player wrote, played through the turn call. */
static void chip_tree_plays_as_its_transcript_does(void) {
  player_session *s;
  char state_path[200], log_path[200], *log;
  player_told told;
  const sprout_seen_view *view;
  const char *words;
  begin("transcript");
  s = session_new();
  save_paths(player_open_whole(s, "chip-tree.sproutworld").hash, state_path, log_path, sizeof state_path);
  player_load(s);
  told = player_admit(s, "Marta");
  CHECK(told.ok && told.admitted && told.saved && strcmp(told.words, "") == 0, "%s", told.words);
  CHECK(told.lines.count == 1 && strcmp(told_kind(&told, 0), "described") == 0 &&
            strcmp(told_text(&told, 0), "There is nothing special about a hall.") == 0 &&
            strcmp(told.lines.items[0].reader, PLAYER_VISIT) == 0,
        "%s", told_text(&told, 0));

  told = ask_guard(s, "ask guard about weather");
  CHECK(told.ok && told.committed && told.result == SPROUT_RESULT_DONE && told.words == NULL &&
            strcmp(told_kind(&told, 0), "said") == 0 && strcmp(told_text(&told, 0), "The guard nods.") == 0,
        "%s", told_text(&told, 0));
  {
    sprout_filling fillings[2];
    fillings[0] = fill_object("knob", "chip_tree.hall.dial");
    fillings[1] = fill_number("notch", 3);
    told = turn_of(s, "chip_tree.turn", NULL, 2, fillings);
    CHECK(strcmp(told_text(&told, 0), "Click.") == 0, "%s", told_text(&told, 0));
  }
  {
    static const char *const pebble[] = {"chip_tree.hall.pebble"};
    sprout_filling things = fill_set("things", 1, pebble);
    told = turn_of(s, "chip_tree.juggle", NULL, 1, &things);
    CHECK(strcmp(told_text(&told, 0), "Nothing much comes of that.") == 0, "%s", told_text(&told, 0));
  }
  {
    /* take pebble: the roles the chip tree leaves out are left unbound, and the engine takes the reading */
    sprout_filling target = fill_object("target", "chip_tree.hall.pebble");
    told = turn_of(s, "sprout.take", NULL, 1, &target);
    CHECK(told.committed && told.result == SPROUT_RESULT_DONE && told.lines.count >= 1, "%s", told_text(&told, 0));
  }
  view = player_view(s, &words);
  CHECK(view != NULL && view->carried_count == 1 && sprout_str_is(view->carried[0].id, "chip_tree.hall.pebble"), "the pebble is carried");
  {
    sprout_filling way = fill_exit("way", "north", "to the yard", "chip_tree.yard");
    told = turn_of(s, "sprout.go", NULL, 1, &way);
    CHECK(strcmp(told_kind(&told, 0), "described") == 0 && strcmp(told_text(&told, 0), "There is nothing special about a yard.") == 0,
          "%s", told_text(&told, 0));
  }

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
  end();
}

static void a_reading_the_world_cannot_take_is_told_in_words_and_writes_nothing(void) {
  player_session *s;
  char state_path[200], log_path[200], *before, *after;
  player_told told;
  begin("refused");
  s = session_new();
  save_paths(player_open_whole(s, "chip-tree.sproutworld").hash, state_path, log_path, sizeof state_path);
  player_load(s);
  player_admit(s, "Marta");
  player_save_settle(s);
  before = file_text(state_path);
  told = turn_of(s, "sprout.nonesuch", NULL, 0, NULL);
  CHECK(told.ok && !told.committed && told.result == SPROUT_RESULT_REFUSED && told.words != NULL && told.lines.count == 1 &&
            strcmp(told_kind(&told, 0), "notice") == 0 && strcmp(told_text(&told, 0), told.words) == 0 && strlen(told.words) > 0,
        "%s", told.words);
  told = player_misread(s, "The reading was not written as the player writes one.");
  CHECK(told.ok && !told.committed && told.result == SPROUT_RESULT_REFUSED && told.saved && told.lines.count == 1 &&
            strcmp(told_kind(&told, 0), "notice") == 0 &&
            strcmp(told.words, "The reading was not written as the player writes one.") == 0,
        "a reading the UI could not make: %s", told.words);
  CHECK(!player_saving(s), "nothing is owed");
  player_save_settle(s);
  after = file_text(state_path);
  CHECK(before != NULL && after != NULL && strcmp(before, after) == 0, "nothing was written");
  free(before);
  free(after);
  end();
}

static void a_command_or_tick_outside_the_world_runs_nothing(void) {
  player_session *s;
  player_told told;
  begin("outside");
  s = session_new();
  told = ask_guard(s, NULL);
  CHECK(!told.ok && !told.committed && strcmp(told.words, "You are not in a world.") == 0 && told.lines.count == 0, "no world");
  told = player_misread(s, "anything");
  CHECK(!told.ok && strcmp(told.words, "You are not in a world.") == 0, "a misread outside the world says where they are first");
  player_open_whole(s, "chip-tree.sproutworld");
  player_load(s);
  told = player_tick(s);
  CHECK(!told.ok && !told.ran && strcmp(told.words, "You are not in a world.") == 0, "not yet arrived");
  end();
}

/* Every fault is told: a turn whose save cannot be written says so, and the reader stops play. */
static void a_turn_whose_save_cannot_be_written_says_so(void) {
  player_session *s;
  player_told told;
  begin("full");
  s = session_new();
  player_open_whole(s, "chip-tree.sproutworld");
  player_load(s);
  CHECK(player_admit(s, "Marta").saved, "arriving saves");
  fake->fail_writes = 1;
  told = ask_guard(s, NULL);
  CHECK(told.committed && !told.saved, "the turn");
  CHECK(!player_tick(s).saved, "the tick's save is told too");
  fake->fail_writes = 0;
  CHECK(turn_of(s, "sprout.wait", NULL, 0, NULL).saved, "and once there is room it saves");
  end();
}

/* How many state writes the fake's file log records: each opens `<state>.part`. */
static int state_writes(void) {
  const char *at = fake->file_log;
  int count = 0;
  while ((at = strstr(at, ".json.part\n")) != NULL) {
    const char *line = at;
    while (line > fake->file_log && line[-1] != '\n') line--;
    count += strncmp(line, "write ", 6) == 0;
    at++;
  }
  return count;
}

/* The guard asked about the weather as a step of a line: `continues` past its first. */
static player_told ask_in_line(player_session *s, bool continues) {
  sprout_filling fillings[2];
  sprout_reading reading;
  fillings[0] = fill_object("target", "chip_tree.hall.guard");
  fillings[1] = fill_word("topic", "weather");
  memset(&reading, 0, sizeof reading);
  reading.verb = "sprout.ask";
  reading.filling_count = 2;
  reading.fillings = fillings;
  return player_turn(s, &reading, "ask -> everything", continues);
}

/*
 * One input is one save: the later steps of a line leave the state owed and write the log tail each, so the line
 * writes the state once; the first step of the next line writes what that one owed before it runs.
 */
static void a_line_of_turns_owes_the_state_once(void) {
  player_session *s;
  int k;
  begin("line");
  s = session_new();
  player_open_whole(s, "chip-tree.sproutworld");
  player_load(s);
  CHECK(player_admit(s, "Marta").saved && player_save_settle(s).ok, "arrived, and nothing is owed");
  fake->file_log[0] = '\0';
  for (k = 0; k < 4; k++) {
    player_told told = ask_in_line(s, k > 0);
    CHECK(told.committed && told.saved, "step %d", k);
  }
  CHECK(state_writes() == 0 && player_saving(s), "four steps write none of the state, and owe it:\n%s", fake->file_log);
  CHECK(player_save_settle(s).ok && state_writes() == 1, "settled, it is written once:\n%s", fake->file_log);
  ask_in_line(s, false);
  ask_in_line(s, true);
  fake->file_log[0] = '\0';
  CHECK(ask_in_line(s, false).saved && state_writes() == 1, "the next line's first step writes what this one owed:\n%s",
        fake->file_log);
  CHECK(player_save_step(s, (size_t)-1).ok && player_save_step(s, (size_t)-1).ok && state_writes() == 2,
        "and its own is written after:\n%s", fake->file_log);
  end();
}

/* The wakes world: a kiln fired, the player closed, four hours on. Catch-up says nothing. */
static void catching_up_after_an_absence_narrates_nothing(void) {
  player_session *s;
  char state_path[200], log_path[200], *before, *after, *log;
  sprout_reading reading;
  player_told told;
  const char *words;
  begin("catch-up");
  s = session_new();
  save_paths(player_open_whole(s, "wakes.sproutworld").hash, state_path, log_path, sizeof state_path);
  player_load(s);
  player_admit(s, "Marta");
  CHECK(player_view(s, &words) != NULL, "the view: %s", words);
  CHECK(reading_from(s, "fire", "a kiln", &reading), "a reading from the chips");
  told = player_turn(s, &reading, NULL, false);
  CHECK(told_has(&told, "The chamber takes the flame."), "%s", told_text(&told, 0));
  player_close(s);
  before = file_text(state_path);
  CHECK(before != NULL && HAS(before, "firing"), "the kiln is firing");

  fake->seconds += 4 * 3600;
  player_open_whole(s, "wakes.sproutworld");
  player_load(s);
  told = player_admit(s, "Marta");
  CHECK(told.admitted && told.lines.count == 1 && strcmp(told_kind(&told, 0), "described") == 0,
        "the arrival is all that is told: %s", told_text(&told, 0));
  CHECK(!told_has(&told, "chamber") && !told_has(&told, "seedling"), "the catch-up narrated: %s", told_text(&told, 0));
  CHECK(player_save_settle(s).ok, "the arrival's save is written");
  after = file_text(state_path);
  CHECK(after != NULL && !HAS(after, "firing") && HAS(after, "cool"), "the kiln cooled in the catch-up");
  log = file_text(log_path);
  CHECK(log != NULL && HAS(log, "\"kind\":\"maintenance\"") && HAS(log, "\"outcome\":\"done\""), "the catch-up is in the log: %s", log);
  free(before);
  free(after);
  free(log);
  end();
}

/* The ticks world: a tick turn is run for the place the visitor stands in, and what it tells is told. */
static void a_tick_tells_what_the_place_says(void) {
  player_session *s;
  player_told ticked;
  begin("tick");
  s = session_new();
  player_open_whole(s, "ticks.sproutworld");
  player_load(s);
  player_admit(s, "Marta");
  ticked = player_tick(s);
  CHECK(ticked.ok && ticked.saved, "a tick");
  fake->seconds += 40;
  ticked = player_tick(s);
  CHECK(ticked.ran && told_has(&ticked, "The wind picks up in the eaves.") && strcmp(told_kind(&ticked, 0), "told") == 0,
        "%s", told_text(&ticked, 0));
  end();
}

int main(void) {
  test_program("turns");
  a_word_of_the_world_is_not_a_name_and_nobody_arrives();
  chip_tree_plays_as_its_transcript_does();
  a_reading_the_world_cannot_take_is_told_in_words_and_writes_nothing();
  a_command_or_tick_outside_the_world_runs_nothing();
  a_turn_whose_save_cannot_be_written_says_so();
  a_line_of_turns_owes_the_state_once();
  catching_up_after_an_absence_narrates_nothing();
  a_tick_tells_what_the_place_says();
  return finish();
}
