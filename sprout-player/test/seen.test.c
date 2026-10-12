/* seen.c: the visitor's view for the UI: the place, the ways out, and the chip tree a level at a time. */
#include "chips.h"
#include "session.h"
#include "session_internal.h"
#include "support.h"

static void the_view_holds_the_place_and_the_ways_out_and_not_the_tree(void) {
  player_session *s;
  char *view;
  begin("chip-tree");
  json_begin();
  s = session_new();
  player_open_whole(s, "chip-tree.sproutworld");
  player_load(s);
  player_admit(s, "Marta");
  view = keep(player_view(s));
  CHECK(HAS(view, "\"place\":{\"id\":\"chip_tree.hall\",\"name\":\"a hall\"}"), "the place, by id and as the visitor reads it: %.100s", view);
  CHECK(HAS(view, "\"description\":[\"There is nothing special about a hall.\"]"), "the description");
  CHECK(HAS(view, "\"exits\":[{\"direction\":\"north\",\"label\":\"to the yard\",\"to\":\"chip_tree.yard\"}]"), "the exit");
  CHECK(HAS(view, "\"occupants\":[{\"id\":\"chip_tree.hall.guard\",\"name\":\"a guard\"}]"), "who else is here");
  CHECK(HAS(view, "\"carried\":[]") && HAS(view, "\"faulted\":false"), "nothing carried, no fault");
  CHECK(HAS(view, "\"effects\":[]"), "a world with no pictures records none");
  CHECK(!HAS(view, "\"chips\"") && !HAS(view, "\"readings\""), "neither the tree nor the flat list of readings is sent");
  CHECK(strlen(view) < 600, "the view is small: %zu bytes", strlen(view));
  json_end();
  end();
}

/* Whether nothing at or below a node of the whole tree's JSON can be done, as the builder once worked it out. */
static bool refused_all(const sprout_json *node) {
  const sprout_json *leaf = sprout_json_get(node, "leaf"), *choices = sprout_json_get(node, "choices");
  size_t i;
  if (leaf != NULL && leaf->kind != SPROUT_JSON_NULL && sprout_json_get(leaf, "refused")->kind == SPROUT_JSON_NULL) return false;
  for (i = 0; choices != NULL && i < choices->count; i++)
    if (!refused_all(sprout_json_get(choices->items[i], "next"))) return false;
  return true;
}

static void a_level_at_a_time_matches_the_whole_tree(void) {
  player_session *s;
  const sprout_json *root, *verbs, *whole, *level, *choices;
  sprout_json *tree_json;
  size_t v, c, greyed = 0, refused = 0;
  char path[64];
  sprout_arena scratch;
  begin("chip-levels");
  json_begin();
  s = session_new();
  sprout_arena_init(&scratch, &s->host.record);
  player_open_whole(s, "chip-tree.sproutworld");
  player_load(s);
  player_admit(s, "Marta");
  keep(player_view(s));
  /* The whole tree, as the view used to carry it, from the tree the session keeps. */
  tree_json = sprout_chip_tree_json(&scratch, &s->chips);
  CHECK(tree_json != NULL && tree_json->count >= 10, "the tree the session keeps");
  root = parse(keep(player_chips(s, "[]")));
  verbs = sprout_json_get(root, "choices");
  CHECK(verbs != NULL && verbs->count == tree_json->count, "one choice per verb at the root");
  CHECK(strcmp(string_at(verbs->items[0], "verb"), "chip_tree.juggle") == 0, "in the view's order: %s", string_at(verbs->items[0], "verb"));
  CHECK(sprout_json_get(root, "leaf")->kind == SPROUT_JSON_NULL, "no reading ends at the root");
  for (v = 0; v < verbs->count; v++) {
    whole = tree_json->items[v];
    CHECK(strcmp(string_at(verbs->items[v], "verb"), string_at(whole, "verb")) == 0, "verb %zu", v);
    CHECK(sprout_json_get(verbs->items[v], "greyed")->boolean == refused_all(sprout_json_get(whole, "next")), "greyed as the tree says, verb %zu", v);
    if (sprout_json_get(verbs->items[v], "greyed")->boolean) greyed++;
    snprintf(path, sizeof path, "[%zu]", v + 1);
    level = parse(keep(player_chips(s, path)));
    choices = sprout_json_get(level, "choices");
    CHECK(choices != NULL && choices->count == sprout_json_get(sprout_json_get(whole, "next"), "choices")->count, "the verb's fillers, %zu", v);
    for (c = 0; choices != NULL && c < choices->count; c++) {
      const sprout_json *choice = choices->items[c];
      const sprout_json *was = sprout_json_get(sprout_json_get(whole, "next"), "choices")->items[c];
      const char *bytes_a, *bytes_b;
      size_t na, nb;
      CHECK(sprout_json_write_value(&scratch, sprout_json_get(choice, "filler"), &bytes_a, &na) == SPROUT_OK &&
                sprout_json_write_value(&scratch, sprout_json_get(was, "filler"), &bytes_b, &nb) == SPROUT_OK &&
                na == nb && memcmp(bytes_a, bytes_b, na) == 0,
            "the same filler, verb %zu choice %zu", v, c);
      CHECK(sprout_json_get(choice, "greyed")->boolean == refused_all(sprout_json_get(was, "next")), "greyed as the tree says, verb %zu choice %zu", v, c);
      if (sprout_json_get(choice, "greyed")->boolean) {
        refused++;
        CHECK(sprout_json_get(choice, "reason")->kind == SPROUT_JSON_STRING, "a greyed choice says why");
      }
    }
  }
  CHECK(refused > 0, "some choice is refused in the hall");
  CHECK(greyed < verbs->count, "not every verb is greyed");
  sprout_arena_reset(&scratch);
  json_end();
  end();
}

static void a_leaf_carries_its_line_refusal_and_options_and_a_bad_path_is_refused_in_words(void) {
  player_session *s;
  const sprout_json *root, *verbs, *level, *leaf;
  size_t v, turn = 0;
  char path[64];
  begin("chip-leaf");
  json_begin();
  s = session_new();
  CHECK(HAS(keep(player_chips(s, "[]")), "\"ok\":false,\"reason\":\"No view has been polled.\""), "before any view");
  player_open_whole(s, "chip-tree.sproutworld");
  player_load(s);
  player_admit(s, "Marta");
  keep(player_view(s));
  root = parse(keep(player_chips(s, "[]")));
  verbs = sprout_json_get(root, "choices");
  for (v = 0; v < verbs->count; v++)
    if (strcmp(string_at(verbs->items[v], "verb"), "chip_tree.turn") == 0) turn = v + 1;
  CHECK(turn > 0, "turn is offered");
  snprintf(path, sizeof path, "[%zu]", turn);
  level = parse(keep(player_chips(s, path)));
  CHECK(HAS(keep(player_chips(s, path)), "\"role\":\"things\",\"binds\":\"set\",\"ids\":[\"chip_tree.hall\"]") ||
            HAS(keep(player_chips(s, "[1]")), "\"role\":\"things\",\"binds\":\"set\",\"ids\":[\"chip_tree.hall\"]"),
        "a set role is offered a thing at a time");
  {
    const sprout_json *choices = sprout_json_get(level, "choices");
    size_t c, dial = 0;
    for (c = 0; c < choices->count; c++)
      if (strcmp(string_at(sprout_json_get(choices->items[c], "filler"), "name"), "a dial") == 0) dial = c + 1;
    CHECK(dial > 0, "the dial is offered to turn");
    snprintf(path, sizeof path, "[%zu,%zu]", turn, dial);
    level = parse(keep(player_chips(s, path)));
    leaf = sprout_json_get(level, "leaf");
    CHECK(leaf != NULL && leaf->kind == SPROUT_JSON_OBJECT, "the reading ends here");
    CHECK(HAS(keep(player_chips(s, path)), "\"typed\":\"turn dial to …\""), "the typed line");
    CHECK(HAS(keep(player_chips(s, path)), "\"ranges\":[{\"min\":0,\"max\":9}]"), "the dial's range");
    CHECK(sprout_json_get(level, "choices")->count == 0, "nothing more to fill");
  }
  CHECK(HAS(keep(player_chips(s, "[999]")), "\"ok\":false,\"reason\":\"The path names no choice of the tree.\""), "a verb past the end");
  CHECK(HAS(keep(player_chips(s, "[1,999]")), "\"ok\":false"), "a choice past the end");
  CHECK(HAS(keep(player_chips(s, "[0]")), "\"ok\":false"), "a zero: the picks are 1-based");
  CHECK(HAS(keep(player_chips(s, "{}")), "\"ok\":false"), "not a path");
  CHECK(HAS(keep(player_chips(s, "nope")), "\"ok\":false"), "not JSON");
  CHECK(HAS(keep(player_chips(s, "[\"x\"]")), "\"ok\":false"), "not an index");
  /* A refusal in a leaf, the words the consent pass gives. */
  {
    size_t c;
    bool found = false;
    for (v = 1; v <= verbs->count && !found; v++) {
      snprintf(path, sizeof path, "[%zu]", v);
      level = parse(keep(player_chips(s, path)));
      for (c = 1; c <= sprout_json_get(level, "choices")->count && !found; c++) {
        snprintf(path, sizeof path, "[%zu,%zu]", v, c);
        found = HAS(keep(player_chips(s, path)), "\"refused\":[\"You are not holding a dial.\"]");
      }
    }
    CHECK(found, "a refusal in a leaf");
  }
  player_close(s);
  CHECK(HAS(keep(player_chips(s, "[]")), "\"ok\":false,\"reason\":\"No view has been polled.\""), "after closing the tree is gone");
  json_end();
  end();
}

static void a_picture_the_description_shows_is_sent_as_an_effect_with_its_payload(void) {
  player_session *s;
  char *view;
  begin("media-room");
  json_begin();
  s = session_new();
  player_open_whole(s, "media-room.sproutworld");
  player_load(s);
  player_admit(s, "Marta");
  view = keep(player_view(s));
  CHECK(HAS(view, "\"effects\":[{\"extension\":\"media\",\"statement\":\"show\",\"payload\":{\"image\":\"cellar.png\"},"
                  "\"transcript\":\"[cellar.png]\"}]"),
        "the effect: %.300s", view);
  CHECK(HAS(view, "\"description\":[\"A damp cellar.\"]"), "the description keeps its words");
  json_end();
  end();
}

static void a_visitor_who_is_not_in_the_world_sees_words_and_nothing_to_do(void) {
  player_session *s;
  char *view;
  begin("away");
  s = session_new();
  view = keep(player_view(s));
  CHECK(HAS(view, "\"words\":\"You are not in a world.\"") && !HAS(view, "\"chips\"") && HAS(view, "\"effects\":[]"),
        "before opening: %s", view);
  CHECK(HAS(keep(player_chips(s, "[]")), "\"ok\":false"), "and no level to ask for");
  player_open_whole(s, "chip-tree.sproutworld");
  player_load(s);
  view = keep(player_view(s));
  CHECK(HAS(view, "You are not in a world.") && HAS(view, "\"place\":{\"id\":\"\",\"name\":\"\"}"), "before arriving: %s", view);
  player_admit(s, "Marta");
  player_close(s);
  player_open_whole(s, "chip-tree.sproutworld");
  player_load(s);
  view = keep(player_view(s));
  CHECK(HAS(view, "You are not in a world."), "after leaving: %s", view);
  end();
}

int main(void) {
  test_program("seen");
  the_view_holds_the_place_and_the_ways_out_and_not_the_tree();
  a_level_at_a_time_matches_the_whole_tree();
  a_leaf_carries_its_line_refusal_and_options_and_a_bad_path_is_refused_in_words();
  a_picture_the_description_shows_is_sent_as_an_effect_with_its_payload();
  a_visitor_who_is_not_in_the_world_sees_words_and_nothing_to_do();
  return finish();
}
