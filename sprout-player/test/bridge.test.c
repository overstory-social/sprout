/* bridge.c: the functions registered with the Lua runtime, called as Lua calls them. */
#include <stdlib.h>

#include "bridge.h"
#include "support.h"

static void every_function_is_registered_under_sprout(void) {
  static const char *const names[] = {"sprout.inspect", "sprout.open", "sprout.step", "sprout.load", "sprout.admit",
                                      "sprout.view",    "sprout.chips", "sprout.turn", "sprout.tick", "sprout.save", "sprout.close",
                                      "sprout.verify",  "sprout.digest"};
  size_t i;
  begin_bridge("register");
  CHECK(fake->function_count == 13, "registered %d functions", fake->function_count);
  for (i = 0; i < sizeof names / sizeof *names; i++) {
    int j;
    bool found = false;
    for (j = 0; j < fake->function_count; j++) found = found || strcmp(fake->names[j], names[i]) == 0;
    CHECK(found, "%s is not registered", names[i]);
  }
  end();
}

static void each_function_hands_lua_one_json_string_and_reads_its_argument(void) {
  begin_bridge("arguments");
  CHECK(HAS(call("sprout.inspect", "chip-tree.sproutworld"), "\"name\":\"chip_tree\""), "inspect reads the path");
  CHECK(HAS(call("sprout.open", "chip-tree.sproutworld"), "\"ok\":true"), "open reads the path");
  CHECK(HAS(open_world("chip-tree.sproutworld"), "\"done\":true"), "step reads on until the world is open");
  CHECK(HAS(call("sprout.load", NULL), "\"fresh\":true"), "load takes none");
  CHECK(HAS(call("sprout.admit", "Marta"), "\"admitted\":true"), "admit reads the nickname");
  CHECK(HAS(call("sprout.view", NULL), "\"place\":{\"id\":\"chip_tree.hall\",\"name\":\"a hall\"}"), "view takes none");
  CHECK(HAS(call("sprout.turn", "{\"verb\":\"sprout.look\",\"fillers\":[]}"), "\"committed\":true"), "turn reads the reading");
  CHECK(HAS(call("sprout.tick", NULL), "\"ran\":"), "tick takes none");
  CHECK(HAS(call("sprout.save", NULL), "\"ok\":true"), "save takes none");
  CHECK(HAS(call("sprout.close", NULL), "\"saved\":true"), "close takes none");
  end();
}

static void a_missing_argument_is_an_empty_one_and_never_a_crash(void) {
  begin_bridge("missing");
  CHECK(HAS(call("sprout.open", NULL), "\"ok\":false"), "open with no path");
  CHECK(HAS(call("sprout.step", NULL), "No world is being opened."), "step with nothing opening");
  CHECK(HAS(call("sprout.admit", NULL), "No world is open."), "admit with no name");
  CHECK(HAS(call("sprout.turn", NULL), "You are not in a world."), "turn with no reading");
  end();
}

static void the_player_shutting_down_puts_a_visitor_away_and_saves_and_refuses_what_comes_after(void) {
  char state_path[200], log_path[200];
  char *opened;
  begin_bridge("shutdown");
  opened = call("sprout.open", "chip-tree.sproutworld");
  save_paths(opened, state_path, log_path, sizeof state_path);
  open_world("chip-tree.sproutworld");
  call("sprout.load", NULL);
  call("sprout.admit", "Marta");
  player_shutdown();
  CHECK(exists(state_path), "the save was written");
  {
    char *text = file_text(state_path);
    CHECK(text != NULL && HAS(text, "Marta"), "with the visitor in it");
    free(text);
  }
  /* The Lua side may still run a frame after the system's terminate: a call then is refused, not run. */
  CHECK(HAS(call("sprout.tick", NULL), "\"ok\":false,\"reason\":\"The engine has shut down.\""), "a tick after shutdown is refused");
  CHECK(HAS(call("sprout.view", NULL), "\"place\":{\"id\":\"\",\"name\":\"\"}") && HAS(call("sprout.view", NULL), "\"occupants\":[]") &&
            HAS(call("sprout.view", NULL), "\"words\":\"The engine has shut down.\""),
        "a view after shutdown is the empty view, in its own shape, with the words");
  CHECK(HAS(call("sprout.open", "chip-tree.sproutworld"), "The engine has shut down."), "an open after shutdown is refused");
  fake->function_count = 0;
  CHECK(player_register(&fake->api), "and the player can start again");
  end();
}

int main(void) {
  test_program("bridge");
  every_function_is_registered_under_sprout();
  each_function_hands_lua_one_json_string_and_reads_its_argument();
  a_missing_argument_is_an_empty_one_and_never_a_crash();
  the_player_shutting_down_puts_a_visitor_away_and_saves_and_refuses_what_comes_after();
  return finish();
}
