/* seen.c: the visitor's view for the UI: the place, the ways out and the chip tree. */
#include "session.h"
#include "support.h"

static void the_view_holds_the_place_the_ways_out_and_the_chip_tree(void) {
  player_session *s;
  char *view;
  const sprout_json *reply, *chips;
  begin("chip-tree");
  json_begin();
  s = session_new();
  player_open(s, "chip-tree.sproutworld");
  player_load(s);
  player_admit(s, "Marta");
  view = keep(player_view(s));
  reply = parse(view);
  CHECK(strcmp(string_at(reply, "place"), "chip_tree.hall") == 0, "%.100s", view);
  CHECK(HAS(view, "\"description\":[\"There is nothing special about a hall.\"]"), "the description");
  CHECK(HAS(view, "\"exits\":[{\"direction\":\"north\",\"label\":\"to the yard\",\"to\":\"chip_tree.yard\"}]"), "the exit");
  CHECK(HAS(view, "\"occupants\":[{\"id\":\"chip_tree.hall.guard\",\"name\":\"a guard\"}]"), "who else is here");
  CHECK(HAS(view, "\"carried\":[]") && HAS(view, "\"faulted\":false"), "nothing carried, no fault");
  chips = sprout_json_get(reply, "chips");
  CHECK(chips != NULL && chips->count >= 10 && strcmp(string_at(chips->items[0], "verb"), "chip_tree.juggle") == 0, "the tree");
  CHECK(!HAS(view, "\"readings\""), "the flat list of readings is not sent");
  CHECK(HAS(view, "\"role\":\"things\",\"binds\":\"set\",\"ids\":[\"chip_tree.hall\"]"), "a set role is offered a thing at a time");
  CHECK(HAS(view, "\"ranges\":[{\"min\":0,\"max\":9}]"), "the dial's range");
  CHECK(HAS(view, "\"refused\":[\"You are not holding a dial.\"]"), "a refusal in the leaf");
  json_end();
  end();
}

static void a_visitor_who_is_not_in_the_world_sees_words_and_nothing_to_do(void) {
  player_session *s;
  char *view;
  begin("away");
  s = session_new();
  view = keep(player_view(s));
  CHECK(HAS(view, "\"words\":\"You are not in a world.\"") && HAS(view, "\"chips\":[]"),
        "before opening: %s", view);
  player_open(s, "chip-tree.sproutworld");
  player_load(s);
  view = keep(player_view(s));
  CHECK(HAS(view, "You are not in a world.") && HAS(view, "\"place\":\"\""), "before arriving: %s", view);
  player_admit(s, "Marta");
  player_close(s);
  player_open(s, "chip-tree.sproutworld");
  player_load(s);
  view = keep(player_view(s));
  CHECK(HAS(view, "You are not in a world."), "after leaving: %s", view);
  end();
}

int main(void) {
  test_program("seen");
  the_view_holds_the_place_the_ways_out_and_the_chip_tree();
  a_visitor_who_is_not_in_the_world_sees_words_and_nothing_to_do();
  return finish();
}
