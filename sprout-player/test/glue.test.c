/*
 * The glue end to end, through the registered functions as Lua calls them: a world played from
 * the shelf's questions to the departure and back, against the transcript the TypeScript player
 * wrote, and the saves a built turn leaves, which `scripts/playdate-player.mjs` then plays through
 * `sproutc`. The modules' own tests are beside them.
 */
#include <stdlib.h>

#include "support.h"

#define GO_NORTH                                                                                      \
  "{\"verb\":\"sprout.go\",\"fillers\":[{\"role\":\"way\",\"binds\":\"exit\",\"direction\":\"north\"," \
  "\"label\":\"to the yard\",\"to\":\"chip_tree.yard\"}]}"

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
  char *opened, *told, *view;
  const sprout_json *reply;
  begin_bridge("transcript");
  json_begin();
  opened = call("sprout.open", "chip-tree.sproutworld");
  save_paths(opened, state_path, log_path, sizeof state_path);
  CHECK(HAS(call("sprout.load", NULL), "\"fresh\":true"), "a new world");
  reply = parse(call("sprout.admit", "Marta"));
  CHECK(strcmp(line_text(reply, 0), "There is nothing special about a hall.") == 0 && strcmp(line_kind(reply, 0), "described") == 0,
        "the arrival");
  told = call("sprout.turn", "{\"verb\":\"sprout.ask\",\"fillers\":[{\"role\":\"target\",\"binds\":\"object\","
                             "\"id\":\"chip_tree.hall.guard\"},{\"role\":\"topic\",\"binds\":\"value\",\"value\":\"weather\"}]}");
  CHECK(strcmp(line_text(parse(told), 0), "The guard nods.") == 0, "%s", told);
  told = call("sprout.turn", "{\"verb\":\"chip_tree.turn\",\"fillers\":[{\"role\":\"knob\",\"binds\":\"object\","
                             "\"id\":\"chip_tree.hall.dial\"},{\"role\":\"notch\",\"binds\":\"value\",\"value\":3}]}");
  CHECK(strcmp(line_text(parse(told), 0), "Click.") == 0, "%s", told);
  told = call("sprout.turn", "{\"verb\":\"chip_tree.juggle\",\"fillers\":[{\"role\":\"things\",\"binds\":\"set\","
                             "\"ids\":[\"chip_tree.hall.pebble\"]}]}");
  CHECK(strcmp(line_text(parse(told), 0), "Nothing much comes of that.") == 0, "%s", told);
  told = call("sprout.turn", GO_NORTH);
  CHECK(strcmp(line_text(parse(told), 0), "There is nothing special about a yard.") == 0, "%s", told);
  view = call("sprout.view", NULL);
  CHECK(HAS(view, "\"place\":{\"id\":\"chip_tree.yard\",\"name\":\"a yard\"}"), "%.100s", view);
  CHECK(HAS(call("sprout.close", NULL), "You leave, and take what you carry with you."), "leaving");
  keep_copy(state_path, "chip-tree.save.json");
  json_end();
  end();
}

/*
 * A turn built from the view's chips leaves the same stored world as the line typed: the
 * reading binds the role a thing fills before the value role, though the verb declares the number
 * first, as the parser binds them. The save is kept while the visitor is in the world, as the script
 * that plays the typed line through `sproutc` leaves it.
 */
static void a_built_turn_leaves_the_stored_world_a_typed_line_does(void) {
  char state_path[200], log_path[200];
  char *opened, *view, *told;
  begin_bridge("value-first");
  opened = call("sprout.open", "value-first.sproutworld");
  save_paths(opened, state_path, log_path, sizeof state_path);
  call("sprout.load", NULL);
  CHECK(HAS(call("sprout.admit", "player"), "\"admitted\":true"), "arriving");
  view = call("sprout.view", NULL);
  CHECK(HAS(view, "\"verb\":\"value_first.tune\""), "the verb is offered: %.100s", view);
  told = call("sprout.turn", "{\"verb\":\"value_first.tune\",\"text\":\"tune 4 on dial\",\"fillers\":["
                             "{\"role\":\"knob\",\"binds\":\"object\",\"id\":\"value_first.hall.dial\"},"
                             "{\"role\":\"notch\",\"binds\":\"value\",\"value\":4}]}");
  CHECK(HAS(told, "\"committed\":true") && HAS(told, "Tuned."), "%s", told);
  CHECK(HAS(call("sprout.save", NULL), "\"ok\":true"), "saving");
  keep_copy(state_path, "value-first.built.json");
  end();
}

/*
 * The same for a world with a symbol role, a number role, a role the chip tree leaves out
 * (`take`'s source) and a set: what the sentence builder hands over is stored as what the parser reads.
 */
static void built_turns_leave_the_stored_world_the_typed_lines_do(void) {
  char state_path[200], log_path[200];
  char *opened;
  begin_bridge("chip-tree-built");
  opened = call("sprout.open", "chip-tree.sproutworld");
  save_paths(opened, state_path, log_path, sizeof state_path);
  call("sprout.load", NULL);
  call("sprout.admit", "player");
  call("sprout.turn", "{\"verb\":\"sprout.ask\",\"fillers\":[{\"role\":\"target\",\"binds\":\"object\","
                      "\"id\":\"chip_tree.hall.guard\"},{\"role\":\"topic\",\"binds\":\"value\",\"value\":\"weather\"}]}");
  call("sprout.turn", "{\"verb\":\"chip_tree.turn\",\"fillers\":[{\"role\":\"knob\",\"binds\":\"object\","
                      "\"id\":\"chip_tree.hall.dial\"},{\"role\":\"notch\",\"binds\":\"value\",\"value\":3}]}");
  call("sprout.turn", "{\"verb\":\"chip_tree.juggle\",\"fillers\":[{\"role\":\"things\",\"binds\":\"set\","
                      "\"ids\":[\"chip_tree.hall.shell\"]}]}");
  call("sprout.turn", "{\"verb\":\"sprout.take\",\"fillers\":[{\"role\":\"target\",\"binds\":\"object\","
                      "\"id\":\"chip_tree.hall.pebble\"}]}");
  CHECK(HAS(call("sprout.save", NULL), "\"ok\":true"), "saving");
  keep_copy(state_path, "chip-tree.built.json");
  end();
}

int main(void) {
  test_program("glue");
  chip_tree_plays_as_its_transcript_does();
  a_built_turn_leaves_the_stored_world_a_typed_line_does();
  built_turns_leave_the_stored_world_the_typed_lines_do();
  return finish();
}
