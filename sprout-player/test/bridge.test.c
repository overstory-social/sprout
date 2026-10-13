/* bridge.c: the functions registered with the Lua runtime, called as Lua calls them, and every reply they hand back. */
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
  save_paths_of_reply(opened, state_path, log_path, sizeof state_path);
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

/* ---- the transcript: every reply Lua reads, against test/fixtures/bridge.golden.txt ---- */

#define ASK_GUARD                                                                                         \
  "{\"verb\":\"sprout.ask\",\"text\":\"ask guard about weather\",\"fillers\":[{\"role\":\"target\",\"binds\":\"object\"," \
  "\"id\":\"chip_tree.hall.guard\"},{\"role\":\"topic\",\"binds\":\"value\",\"value\":\"weather\"}]}"
#define TURN_DIAL                                                                                          \
  "{\"verb\":\"chip_tree.turn\",\"fillers\":[{\"role\":\"knob\",\"binds\":\"object\",\"id\":\"chip_tree.hall.dial\"}," \
  "{\"role\":\"notch\",\"binds\":\"value\",\"value\":3}]}"
#define GO_NORTH                                                                                      \
  "{\"verb\":\"sprout.go\",\"fillers\":[{\"role\":\"way\",\"binds\":\"exit\",\"direction\":\"north\"," \
  "\"label\":\"to the yard\",\"to\":\"chip_tree.yard\"}]}"

static char transcript[1 << 20];
static size_t transcript_length;

/* Calls a registered function as Lua does and writes the call and its reply into the transcript. */
static char *said(const char *name, const char *argument) {
  char *reply = call(name, argument);
  int wrote = snprintf(transcript + transcript_length, sizeof transcript - transcript_length, "%s(%s) %s\n", name,
                       argument == NULL ? "" : argument, reply);
  if (wrote > 0) transcript_length += (size_t)wrote;
  return reply;
}

static char *said3(const char *name, const char *first, const char *second, const char *third) {
  char *reply = call3(name, first, second, third);
  int wrote = snprintf(transcript + transcript_length, sizeof transcript - transcript_length, "%s(...) %s\n", name, reply);
  if (wrote > 0) transcript_length += (size_t)wrote;
  return reply;
}

/* Opens a world through the calls, every step written. */
static void said_open(const char *path) {
  int steps = 0;
  if (!HAS(said("sprout.open", path), "\"ok\":true")) return;
  while (HAS(said("sprout.step", NULL), "\"done\":false") && ++steps < 10000) {
  }
}

/* Compares the transcript with the golden file, or writes it there when PLAYER_WRITE_GOLDEN is set. */
static void against_golden(const char *name) {
  char path[600];
  FILE *file;
  static char golden[1 << 20];
  size_t got = 0, line = 1, i;
  snprintf(path, sizeof path, "%s/%s", PLAYER_FIXTURES, name);
  if (getenv("PLAYER_WRITE_GOLDEN") != NULL) {
    file = fopen(path, "wb");
    CHECK(file != NULL, "writing %s", path);
    if (file != NULL) {
      fwrite(transcript, 1, transcript_length, file);
      fclose(file);
    }
    return;
  }
  file = fopen(path, "rb");
  CHECK(file != NULL, "the golden transcript %s", path);
  if (file == NULL) return;
  got = fread(golden, 1, sizeof golden - 1, file);
  fclose(file);
  golden[got] = '\0';
  for (i = 0; i < got && i < transcript_length && golden[i] == transcript[i]; i++)
    if (golden[i] == '\n') line++;
  CHECK(got == transcript_length && i == got, "line %zu of %s differs:\n  wanted %.400s\n  got    %.400s", line, name,
        golden + (i - (i > 0 && golden[i - 1] != '\n' ? 1 : 0)), transcript + i);
}

static void every_reply_lua_reads_is_the_one_the_golden_transcript_holds(void) {
  begin_bridge("golden");
  transcript_length = 0;
  /* Nothing open: each call says so in its own shape. */
  said("sprout.view", NULL);
  said("sprout.chips", "[]");
  said("sprout.step", NULL);
  said("sprout.load", NULL);
  said("sprout.save", NULL);
  said("sprout.admit", "Marta");
  said("sprout.turn", ASK_GUARD);
  said("sprout.tick", NULL);
  said("sprout.close", NULL);
  /* The shelf. */
  write_text("garbage.sproutworld", "this is not a cartridge");
  said("sprout.inspect", "chip-tree.sproutworld");
  said("sprout.inspect", "garbage.sproutworld");
  said("sprout.inspect", "absent.sproutworld");
  said("sprout.open", "absent.sproutworld");
  said("sprout.step", NULL);
  /* A first visit to chip-tree. */
  said_open("chip-tree.sproutworld");
  said("sprout.load", NULL);
  said("sprout.view", NULL);
  said("sprout.turn", ASK_GUARD);
  said("sprout.tick", NULL);
  said("sprout.admit", "guard");
  said("sprout.admit", "Marta");
  said("sprout.view", NULL);
  said("sprout.chips", "[]");
  said("sprout.chips", "[1]");
  said("sprout.chips", "[1,1]");
  said("sprout.chips", "[]");
  said("sprout.chips", "[2]");
  said("sprout.chips", "[3]");
  said("sprout.chips", "[3,1]");
  said("sprout.chips", "[3,1,1]");
  said("sprout.chips", "[999]");
  said("sprout.chips", "[1,999]");
  said("sprout.chips", "[0]");
  said("sprout.chips", "[1e30]");
  said("sprout.chips", "[1,\"x\"]");
  said("sprout.chips", "{}");
  said("sprout.chips", "nope");
  said("sprout.chips", NULL);
  /* Every verb reached, and its first choice: the root then says of each what its level said. */
  {
    char path[32];
    int v;
    for (v = 1; v <= 14; v++) {
      snprintf(path, sizeof path, "[%d]", v);
      said("sprout.chips", path);
      snprintf(path, sizeof path, "[%d,1]", v);
      said("sprout.chips", path);
      snprintf(path, sizeof path, "[%d,2]", v);
      said("sprout.chips", path);
    }
  }
  said("sprout.chips", "[]");
  said("sprout.turn", ASK_GUARD);
  said("sprout.turn", TURN_DIAL);
  said("sprout.turn", "{\"verb\":\"sprout.nonesuch\",\"fillers\":[]}");
  said("sprout.turn", "not json at all");
  said("sprout.turn", "{\"verb\":\"sprout.look\"}");
  said("sprout.turn", "{\"verb\":\"sprout.look\",\"fillers\":[{\"role\":\"a\",\"binds\":\"teleport\"}]}");
  said("sprout.turn", NULL);
  said("sprout.turn", "{\"verb\":\"sprout.take\",\"fillers\":[{\"role\":\"target\",\"binds\":\"object\",\"id\":\"chip_tree.hall.pebble\"}]}");
  said("sprout.view", NULL);
  said("sprout.turn", GO_NORTH);
  said("sprout.view", NULL);
  said("sprout.tick", NULL);
  said("sprout.save", NULL);
  /* A full disk: the save, the turn and the tick say it could not be written. */
  fake->fail_writes = 1;
  said("sprout.save", NULL);
  said("sprout.turn", "{\"verb\":\"sprout.wait\",\"fillers\":[]}");
  said("sprout.tick", NULL);
  fake->fail_writes = 0;
  said("sprout.close", NULL);
  said("sprout.close", NULL);
  /* The return. */
  said_open("chip-tree.sproutworld");
  said("sprout.load", NULL);
  said("sprout.admit", "Marta");
  said("sprout.view", NULL);
  /* The app killed while the visitor stood in the world, and then a save that cannot be read. */
  {
    char state_path[200], log_path[200], aside[260];
    char *opened = call("sprout.open", "chip-tree.sproutworld"), *state, *log;
    save_paths_of_reply(opened, state_path, log_path, sizeof state_path);
    call("sprout.close", NULL);
    said_open("chip-tree.sproutworld");
    said("sprout.load", NULL);
    said("sprout.admit", "Marta");
    said("sprout.save", NULL);
    state = file_text(state_path);
    log = file_text(log_path);
    said("sprout.close", NULL);
    write_text(state_path, state);
    write_text(log_path, log);
    free(state);
    free(log);
    said_open("chip-tree.sproutworld");
    said("sprout.load", NULL);
    write_text(state_path, "{\"this\":\"is not a stored world\"}");
    said("sprout.load", NULL);
    snprintf(aside, sizeof aside, "%s.damaged", state_path);
    CHECK(exists(aside), "the damaged save was set aside");
    said("sprout.admit", "Marta");
  }
  said("sprout.close", NULL);
  /* A picture, and time passing. */
  said_open("media-room.sproutworld");
  said("sprout.load", NULL);
  said("sprout.admit", "Marta");
  said("sprout.view", NULL);
  said("sprout.close", NULL);
  said_open("ticks.sproutworld");
  said("sprout.load", NULL);
  said("sprout.admit", "Marta");
  said("sprout.tick", NULL);
  fake->seconds += 40;
  said("sprout.tick", NULL);
  said("sprout.close", NULL);
  /* The download screen's two. */
  write_text("abc.txt", "abc");
  said("sprout.digest", "abc.txt");
  said("sprout.digest", "absent.txt");
  said3("sprout.verify", "r",
        "92a009a9f0d4cab8720e820b5f642540a2b27b5416503f8fb3762223ebdb69da085ac1e43e15996e458f3613d0f11d8c387b2eaeb4302aee"
        "b00d291612bb0c00",
        "3d4017c3e843895a92b70aa74d1b7ebc9c982ccf2ec4968cc0cd55f12af4660c");
  said3("sprout.verify", "s",
        "92a009a9f0d4cab8720e820b5f642540a2b27b5416503f8fb3762223ebdb69da085ac1e43e15996e458f3613d0f11d8c387b2eaeb4302aee"
        "b00d291612bb0c00",
        "3d4017c3e843895a92b70aa74d1b7ebc9c982ccf2ec4968cc0cd55f12af4660c");
  said3("sprout.verify", "r", "92a0", "3d40");
  /* After the system has told the app to stop. */
  said_open("chip-tree.sproutworld");
  said("sprout.load", NULL);
  said("sprout.admit", "Marta");
  player_shutdown();
  said("sprout.view", NULL);
  said("sprout.tick", NULL);
  said("sprout.chips", "[]");
  said3("sprout.verify", "r", "", "");
  fake->function_count = 0;
  CHECK(player_register(&fake->api), "registering again");
  against_golden("bridge.golden.txt");
  end();
}

int main(void) {
  test_program("bridge");
  every_function_is_registered_under_sprout();
  each_function_hands_lua_one_json_string_and_reads_its_argument();
  a_missing_argument_is_an_empty_one_and_never_a_crash();
  the_player_shutting_down_puts_a_visitor_away_and_saves_and_refuses_what_comes_after();
  every_reply_lua_reads_is_the_one_the_golden_transcript_holds();
  return finish();
}
