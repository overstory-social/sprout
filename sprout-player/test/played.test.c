/*
 * The session end to end, as the screens drive it: a world played from opening to the departure,
 * against the transcript the TypeScript player wrote, and the saves turns built from readings
 * leave, which `scripts/playdate-player.mjs` then plays through `sproutc`. The modules' own tests
 * are beside them.
 */
#include <stdlib.h>

#include "state.h"
#include "support.h"

/* Writes the Data folder's copy of a file to PLAYER_KEEP_DIR, where the script that built the test finds it. */
static void keep_copy(const char *path, const char *name) {
  const char *dir = getenv("PLAYER_KEEP_DIR");
  char *text = file_text(path), target[600];
  FILE *out;
  CHECK(text != NULL, "no %s to keep", path);
  if (dir != NULL && text != NULL) {
    snprintf(target, sizeof target, "%s/%s", dir, name);
    out = fopen(target, "wb");
    CHECK(out != NULL, "writing %s", target);
    if (out != NULL) {
      fputs(text, out);
      fclose(out);
    }
  }
  free(text);
}

/* chip-tree: the transcript the TypeScript player wrote (corpus/good/chip-tree/transcripts/chips.json). */
static void chip_tree_plays_as_its_transcript_does(void) {
  char state_path[200], log_path[200];
  player_session *s;
  player_loaded loaded;
  player_told told;
  const sprout_seen_view *view;
  const char *words = NULL;
  begin("transcript");
  s = session_new();
  save_paths(player_open_whole(s, "chip-tree.sproutworld").hash, state_path, log_path, sizeof state_path);
  loaded = player_load(s);
  CHECK(loaded.ok && loaded.fresh, "a new world: %s", loaded.words);
  told = player_admit(s, "Marta");
  CHECK(strcmp(told_text(&told, 0), "There is nothing special about a hall.") == 0 && strcmp(told_kind(&told, 0), "described") == 0,
        "the arrival: %s", told_text(&told, 0));
  {
    sprout_filling ask[2];
    ask[0] = fill_object("target", "chip_tree.hall.guard");
    ask[1] = fill_word("topic", "weather");
    told = turn_of(s, "sprout.ask", NULL, 2, ask);
    CHECK(strcmp(told_text(&told, 0), "The guard nods.") == 0, "%s", told_text(&told, 0));
  }
  {
    sprout_filling turn[2];
    turn[0] = fill_object("knob", "chip_tree.hall.dial");
    turn[1] = fill_number("notch", 3);
    told = turn_of(s, "chip_tree.turn", NULL, 2, turn);
    CHECK(strcmp(told_text(&told, 0), "Click.") == 0, "%s", told_text(&told, 0));
  }
  {
    static const char *const pebble[1] = {"chip_tree.hall.pebble"};
    sprout_filling things = fill_set("things", 1, pebble);
    told = turn_of(s, "chip_tree.juggle", NULL, 1, &things);
    CHECK(strcmp(told_text(&told, 0), "Nothing much comes of that.") == 0, "%s", told_text(&told, 0));
  }
  {
    sprout_filling way = fill_exit("way", "north", "to the yard", "chip_tree.yard");
    told = turn_of(s, "sprout.go", NULL, 1, &way);
    CHECK(strcmp(told_text(&told, 0), "There is nothing special about a yard.") == 0, "%s", told_text(&told, 0));
  }
  view = player_view(s, &words);
  CHECK(view != NULL && sprout_str_is(view->place.id, "chip_tree.yard") && sprout_str_is(view->place.name, "a yard"),
        "the view is of the yard: %s", words);
  told = player_close(s);
  CHECK(told_has(&told, "You leave, and take what you carry with you."), "leaving");
  keep_copy(state_path, "chip-tree.save.json");
  end();
}

/* Whether the last view's verbs, asked for at the root of the chip tree, offer `verb`. */
static bool offers(player_session *s, const char *verb) {
  player_chip_level root = player_chips(s, NULL, 0);
  size_t v;
  for (v = 0; root.ok && v < root.choice_count; v++)
    if (strcmp(root.choices[v].verb, verb) == 0) return true;
  return false;
}

/*
 * A turn built from the view's chips leaves the same stored world as the line typed: the
 * reading binds the role a thing fills before the value role, though the verb declares the number
 * first, as the parser binds them. The save is kept while the visitor is in the world, as the script
 * that plays the typed line through `sproutc` leaves it.
 */
static void a_built_turn_leaves_the_stored_world_a_typed_line_does(void) {
  char state_path[200], log_path[200];
  player_session *s;
  player_told told;
  player_result saved;
  const char *words = NULL;
  sprout_filling tune[2];
  begin("value-first");
  s = session_new();
  save_paths(player_open_whole(s, "value-first.sproutworld").hash, state_path, log_path, sizeof state_path);
  player_load(s);
  CHECK(player_admit(s, "player").admitted, "arriving");
  CHECK(player_view(s, &words) != NULL, "the view: %s", words);
  CHECK(offers(s, "value_first.tune"), "the verb is offered a level at a time");
  tune[0] = fill_object("knob", "value_first.hall.dial");
  tune[1] = fill_number("notch", 4);
  told = turn_of(s, "value_first.tune", "tune 4 on dial", 2, tune);
  CHECK(told.committed && told_has(&told, "Tuned."), "%s", told_text(&told, 0));
  saved = player_save(s);
  CHECK(saved.ok, "saving: %s", saved.words);
  keep_copy(state_path, "value-first.built.json");
  end();
}

/*
 * The same for a world with a symbol role, a number role, a role the chip tree leaves out
 * (`take`'s source) and a set: what the sentence builder hands over is stored as what the parser reads.
 */
static void built_turns_leave_the_stored_world_the_typed_lines_do(void) {
  char state_path[200], log_path[200];
  player_session *s;
  player_result saved;
  static const char *const shell[1] = {"chip_tree.hall.shell"};
  sprout_filling ask[2], turn[2], things, target;
  begin("chip-tree-built");
  s = session_new();
  save_paths(player_open_whole(s, "chip-tree.sproutworld").hash, state_path, log_path, sizeof state_path);
  player_load(s);
  player_admit(s, "player");
  ask[0] = fill_object("target", "chip_tree.hall.guard");
  ask[1] = fill_word("topic", "weather");
  turn_of(s, "sprout.ask", NULL, 2, ask);
  turn[0] = fill_object("knob", "chip_tree.hall.dial");
  turn[1] = fill_number("notch", 3);
  turn_of(s, "chip_tree.turn", NULL, 2, turn);
  things = fill_set("things", 1, shell);
  turn_of(s, "chip_tree.juggle", NULL, 1, &things);
  target = fill_object("target", "chip_tree.hall.pebble");
  turn_of(s, "sprout.take", NULL, 1, &target);
  saved = player_save(s);
  CHECK(saved.ok, "saving: %s", saved.words);
  keep_copy(state_path, "chip-tree.built.json");
  end();
}

int main(void) {
  test_program("played");
  chip_tree_plays_as_its_transcript_does();
  a_built_turn_leaves_the_stored_world_a_typed_line_does();
  built_turns_leave_the_stored_world_the_typed_lines_do();
  return finish();
}
