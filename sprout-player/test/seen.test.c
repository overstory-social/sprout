/* seen.c: the visitor's view for the UI: the scene, the verbs, and a verb's readings asked for when it is reached. */
#include "chips.h"
#include "session.h"
#include "session_internal.h"
#include "state.h"
#include "support.h"

/* The 1-based pick of the verb named `verb` at the root, or 0. */
static size_t pick_of(player_session *s, const char *verb) {
  player_chip_level root = player_chips(s, NULL, 0);
  size_t v;
  for (v = 0; root.ok && v < root.choice_count; v++)
    if (strcmp(root.choices[v].verb, verb) == 0) return v + 1;
  return 0;
}

/* Whether a choice's filler names the thing called `name`. */
static bool names(const player_chip *chip, const char *name) {
  return chip->filler != NULL && sprout_str_is(chip->filler->thing.name, name);
}

static player_session *arrived(const char *world) {
  player_session *s = session_new();
  player_open_whole(s, world);
  player_load(s);
  player_admit(s, "Marta");
  return s;
}

static void the_view_holds_the_scene_and_neither_readings_nor_a_tree(void) {
  player_session *s;
  const sprout_seen_view *view;
  const char *words = NULL;
  begin("chip-tree");
  s = arrived("chip-tree.sproutworld");
  view = player_view(s, &words);
  CHECK(view != NULL && strcmp(words, "") == 0, "a view: %s", words);
  if (view == NULL) return;
  CHECK(sprout_str_is(view->place.id, "chip_tree.hall") && sprout_str_is(view->place.name, "a hall"), "the place, by id and as the visitor reads it");
  CHECK(view->description_count == 1 && sprout_str_is(view->description[0], "There is nothing special about a hall."), "the description");
  CHECK(view->exit_count == 1 && strcmp(view->exits[0].direction, "north") == 0 && strcmp(view->exits[0].label, "to the yard") == 0 &&
            sprout_str_is(view->exits[0].to, "chip_tree.yard"),
        "the exit");
  CHECK(view->occupant_count == 1 && sprout_str_is(view->occupants[0].id, "chip_tree.hall.guard") &&
            sprout_str_is(view->occupants[0].name, "a guard"),
        "who else is here");
  CHECK(view->carried_count == 0 && !view->faulted && view->effect_count == 0, "nothing carried, no fault, no pictures");
  CHECK(view->reading_count == 0, "no readings in the scene");
  CHECK(view == &s->seen && view->verb_count > 0 && s->chips.verb_count == view->verb_count, "the scene's verbs are the tree's root");
  end();
}

/* Whether nothing at or below a node of the whole tree can be done. */
static bool refused_all(const sprout_chip_node *node) {
  size_t i;
  if (node->leaf != NULL && !node->leaf->refused) return false;
  for (i = 0; i < node->choice_count; i++)
    if (!refused_all(node->choices[i].next)) return false;
  return true;
}

/* Whether two of the view's strings hold the same bytes; an empty one may have none. */
static bool same_str(sprout_str a, sprout_str b) {
  return a.length == b.length && (a.length == 0 || memcmp(a.bytes, b.bytes, a.length) == 0);
}

/* Whether two fillers offer the same thing, things or way out for the same role. */
static bool same_filler(const sprout_seen_filler *a, const sprout_seen_filler *b) {
  size_t i;
  if (strcmp(a->role, b->role) != 0 || a->binds != b->binds || a->member_count != b->member_count) return false;
  for (i = 0; i < a->member_count; i++)
    if (!same_str(a->members[i].id, b->members[i].id)) return false;
  if (a->binds == SPROUT_SEEN_EXIT) return strcmp(a->exit.label, b->exit.label) == 0 && same_str(a->exit.to, b->exit.to);
  return same_str(a->thing.id, b->thing.id);
}

static void a_verb_is_asked_for_when_reached_and_its_levels_match_the_whole_tree(void) {
  player_session *s;
  player_chip_level root, level;
  sprout_seen_view whole_view;
  sprout_chip_tree whole;
  size_t v, c, greyed = 0, refused = 0, asked;
  sprout_arena scratch;
  const char *words;
  begin("chip-levels");
  s = arrived("chip-tree.sproutworld");
  sprout_arena_init(&scratch, &s->host.record);
  player_view(s, &words);
  CHECK(sprout_view(s->world, s->state, &s->host.record, PLAYER_VISIT, &whole_view) == SPROUT_OK, "the whole poll");
  CHECK(sprout_chip_tree_of(&scratch, &whole_view, &whole) == SPROUT_OK && whole.verb_count >= 10, "the whole tree");
  root = player_chips(s, NULL, 0);
  CHECK(root.ok && root.choice_count >= whole.verb_count, "a choice for every verb with a reading at the root, and perhaps more");
  CHECK(strcmp(root.choices[0].verb, "chip_tree.juggle") == 0, "in the view's order: %s", root.choices[0].verb);
  CHECK(root.leaf == NULL && root.verb == NULL, "no reading ends at the root");
  for (v = 0; v < root.choice_count; v++)
    CHECK(root.choices[v].greyed == PLAYER_GREYED_UNKNOWN && root.choices[v].reason == NULL && root.choices[v].filler == NULL,
          "before a verb is reached it is neither greyed nor not, verb %zu", v);
  for (v = 0; v < s->chips.verb_count; v++) CHECK(!s->fetched[v], "no verb's readings were asked for by the root");
  for (v = 0; v < s->chips.verb_count; v++) {
    const sprout_chip_verb *in_whole = NULL;
    const char *name = s->chips.verbs[v].verb;
    size_t pick = v + 1, w;
    for (w = 0; w < whole.verb_count; w++)
      if (strcmp(name, whole.verbs[w].verb) == 0) in_whole = &whole.verbs[w];
    level = player_chips(s, &pick, 1);
    CHECK(level.ok && s->fetched[v], "reaching the verb asked for its readings, verb %zu", v);
    CHECK(level.verb != NULL && strcmp(level.verb->verb, name) == 0, "the level under a verb names it, verb %zu", v);
    if (in_whole == NULL) {
      /* A verb whose roles can be filled from what is here, but which no reading fits: reached, it is empty and greyed. */
      CHECK(level.choice_count == 0 && level.leaf == NULL, "nothing under %s", name);
      CHECK(level.verb->greyed == PLAYER_GREYED_YES && level.verb->reason != NULL && strncmp(level.verb->reason, "Nothing here fits ", 18) == 0,
            "greyed, and says why: %s", level.verb->reason);
      greyed++;
      continue;
    }
    CHECK(level.verb->greyed == (refused_all(in_whole->next) ? PLAYER_GREYED_YES : PLAYER_GREYED_NO),
          "the level under a verb says of the verb what the tree says, verb %zu", v);
    if (level.verb->greyed == PLAYER_GREYED_YES) greyed++;
    CHECK(level.choice_count == in_whole->next->choice_count, "the verb's fillers, %zu", v);
    for (c = 0; c < level.choice_count && c < in_whole->next->choice_count; c++) {
      const player_chip *choice = &level.choices[c];
      const sprout_chip_choice *was = &in_whole->next->choices[c];
      CHECK(choice->verb == NULL && same_filler(choice->filler, was->filler), "the same filler, verb %zu choice %zu", v, c);
      CHECK(choice->greyed == (refused_all(was->next) ? PLAYER_GREYED_YES : PLAYER_GREYED_NO), "greyed as the tree says, verb %zu choice %zu", v, c);
      if (choice->greyed == PLAYER_GREYED_YES) {
        refused++;
        CHECK(choice->reason != NULL && strlen(choice->reason) > 0, "a greyed choice says why");
      }
    }
    /* Reaching the verb again asks for nothing: the subtree is kept. */
    asked = s->chips.verbs[v].next->choice_count;
    player_chips(s, &pick, 1);
    CHECK(s->chips.verbs[v].next->choice_count == asked, "the subtree kept, verb %zu", v);
  }
  /* The root now says of every verb what the levels said. */
  root = player_chips(s, NULL, 0);
  for (v = 0; v < root.choice_count; v++) {
    size_t w;
    bool in_tree = false;
    for (w = 0; w < whole.verb_count; w++)
      if (strcmp(root.choices[v].verb, whole.verbs[w].verb) == 0) {
        in_tree = true;
        CHECK(root.choices[v].greyed == (refused_all(whole.verbs[w].next) ? PLAYER_GREYED_YES : PLAYER_GREYED_NO),
              "greyed at the root once reached, verb %zu", v);
      }
    if (!in_tree) CHECK(root.choices[v].greyed == PLAYER_GREYED_YES, "a verb with no reading is greyed once reached");
  }
  CHECK(refused > 0, "some choice is refused in the hall");
  CHECK(greyed > 0 && greyed < root.choice_count, "some verb is greyed and not every verb");
  sprout_view_free(&whole_view);
  sprout_arena_reset(&scratch);
  end();
}

/* A verb whose poll runs out of its budget is greyed with the fault's words, and asked for again when reached next. */
static void a_verb_whose_poll_runs_out_says_so_and_is_asked_again(void) {
  player_session *s;
  player_chip_level level;
  sprout_limit was;
  size_t first = 1;
  const char *words;
  begin("chip-fault");
  s = arrived("chip-tree.sproutworld");
  player_view(s, &words);
  was = s->host.record.budgets.poll_steps;
  s->host.record.budgets.poll_steps = (sprout_limit){true, 1};
  level = player_chips(s, &first, 1);
  CHECK(level.ok && level.verb != NULL && level.verb->greyed == PLAYER_GREYED_YES, "greyed while its poll ran out");
  CHECK(level.verb->reason != NULL && strlen(level.verb->reason) > 0, "with the fault's words");
  CHECK(level.choice_count == 0, "and nothing under it");
  CHECK(!s->fetched[0], "not kept as fetched");
  level = player_chips(s, NULL, 0);
  CHECK(level.choices[0].greyed == PLAYER_GREYED_YES, "the root says so too");
  s->host.record.budgets.poll_steps = was;
  level = player_chips(s, &first, 1);
  CHECK(s->fetched[0], "reached again with the budget back, it is asked for and kept");
  CHECK(level.choice_count > 0, "and has its fillers");
  CHECK(level.verb->greyed == PLAYER_GREYED_NO, "and is not greyed");
  end();
}

static void a_leaf_carries_its_line_refusal_and_options_and_a_bad_path_is_refused_in_words(void) {
  player_session *s;
  player_chip_level level;
  size_t path[3] = {0, 0, 0}, c, v, turn, count;
  bool found = false;
  const char *words;
  begin("chip-leaf");
  s = session_new();
  level = player_chips(s, NULL, 0);
  CHECK(!level.ok && strcmp(level.reason, "No view has been polled.") == 0, "before any view");
  player_open_whole(s, "chip-tree.sproutworld");
  player_load(s);
  player_admit(s, "Marta");
  player_view(s, &words);
  turn = pick_of(s, "chip_tree.turn");
  CHECK(turn > 0, "turn is offered");
  path[0] = turn;
  level = player_chips(s, path, 1);
  for (c = 0; c < level.choice_count; c++)
    if (names(&level.choices[c], "a dial")) path[1] = c + 1;
  CHECK(path[1] > 0, "the dial is offered to turn");
  level = player_chips(s, path, 2);
  CHECK(level.ok && level.leaf != NULL && level.choice_count == 0, "the reading ends here, with nothing more to fill");
  CHECK(level.leaf->typed.length > 0 && strncmp(level.leaf->typed.bytes, "turn dial to \xe2\x80\xa6", level.leaf->typed.length) == 0,
        "the typed line");
  CHECK(level.leaf->options_count == 1 && level.leaf->options[0].range_count == 1 && level.leaf->options[0].ranges[0].min == 0 &&
            level.leaf->options[0].ranges[0].max == 9,
        "the dial's range");
  CHECK(level.verb == NULL, "a level below a verb says nothing of the verb");
  path[0] = 999;
  CHECK(!player_chips(s, path, 1).ok && strcmp(player_chips(s, path, 1).reason, "The path names no choice of the tree.") == 0, "a verb past the end");
  path[0] = 1;
  path[1] = 999;
  CHECK(!player_chips(s, path, 2).ok, "a choice past the end");
  path[0] = 0;
  CHECK(!player_chips(s, path, 1).ok, "a zero: the picks are 1-based");
  path[0] = turn;
  path[1] = 1;
  path[2] = 1;
  CHECK(!player_chips(s, path, 3).ok, "a pick past a leaf");
  /* A refusal in a leaf, the words the consent pass gives. */
  count = player_chips(s, NULL, 0).choice_count;
  for (v = 1; v <= count && !found; v++) {
    size_t choices;
    path[0] = v;
    choices = player_chips(s, path, 1).choice_count;
    for (c = 1; c <= choices && !found; c++) {
      const sprout_seen_reading *leaf;
      path[1] = c;
      leaf = player_chips(s, path, 2).leaf;
      found = leaf != NULL && leaf->refused && leaf->refusal_count == 1 && sprout_str_is(leaf->refusal[0], "You are not holding a dial.");
    }
  }
  CHECK(found, "a refusal in a leaf");
  player_close(s);
  level = player_chips(s, NULL, 0);
  CHECK(!level.ok && strcmp(level.reason, "No view has been polled.") == 0, "after closing the tree is gone");
  end();
}

static void a_picture_the_description_shows_is_kept_as_an_effect_with_its_payload(void) {
  player_session *s;
  const sprout_seen_view *view;
  const char *words;
  begin("media-room");
  s = arrived("media-room.sproutworld");
  view = player_view(s, &words);
  CHECK(view != NULL && view->effect_count == 1 && strcmp(view->effects[0].extension, "media") == 0 &&
            strcmp(view->effects[0].statement, "show") == 0 && sprout_str_is(view->effects[0].payload, "{\"image\":\"cellar.png\"}") &&
            sprout_str_is(view->effects[0].transcript, "[cellar.png]"),
        "the effect");
  CHECK(view != NULL && view->description_count == 1 && sprout_str_is(view->description[0], "A damp cellar."), "the description keeps its words");
  end();
}

/*
 * The view and its tree stand until a turn commits or changes the state, and a view asked while
 * they stand is the kept one, nothing polled: what the sentence builder opens from.
 */
static void the_view_is_kept_until_a_turn_changes_the_state(void) {
  player_session *s;
  const sprout_seen_view *view;
  const sprout_chip_node *subtree;
  const char *words = NULL;
  size_t pick;
  begin("kept");
  s = arrived("chip-tree.sproutworld");
  view = player_view(s, &words);
  pick = pick_of(s, "chip_tree.turn");
  CHECK(view != NULL && pick != 0, "the view, offering turn");
  if (view == NULL || pick == 0) return;
  player_chips(s, &pick, 1);
  CHECK(s->fetched[pick - 1], "turn's readings were asked for");
  subtree = s->chips.verbs[pick - 1].next;
  CHECK(player_view(s, &words) == view && strcmp(words, "") == 0 && s->fetched[pick - 1] && s->chips.verbs[pick - 1].next == subtree,
        "the view asked for again is the kept one, turn's readings still known under it");
  CHECK(!player_misread(s, "A reading the player could not make.").changed, "a misreading runs no turn, so the state did not change");
  CHECK(player_view(s, &words) == view && s->fetched[pick - 1] && s->chips.verbs[pick - 1].next == subtree, "and the view stands");
  CHECK(turn_of(s, "sprout.wait", NULL, 0, NULL).changed, "a turn that commits changes the state");
  CHECK(player_view(s, &words) == view && strcmp(words, "") == 0, "the next view is polled afresh");
  CHECK(!s->fetched[pick - 1], "with a tree of its own: turn's readings are asked for again when reached");
  end();
}

static void a_visitor_who_is_not_in_the_world_sees_words_and_nothing_to_do(void) {
  player_session *s;
  const char *words = NULL;
  begin("away");
  s = session_new();
  CHECK(player_view(s, &words) == NULL && strcmp(words, "You are not in a world.") == 0, "before opening");
  CHECK(!player_chips(s, NULL, 0).ok, "and no level to ask for");
  player_open_whole(s, "chip-tree.sproutworld");
  player_load(s);
  CHECK(player_view(s, &words) == NULL && strcmp(words, "You are not in a world.") == 0, "before arriving");
  player_admit(s, "Marta");
  player_close(s);
  player_open_whole(s, "chip-tree.sproutworld");
  player_load(s);
  CHECK(player_view(s, &words) == NULL && strcmp(words, "You are not in a world.") == 0, "after leaving");
  end();
}

int main(void) {
  test_program("seen");
  the_view_holds_the_scene_and_neither_readings_nor_a_tree();
  a_verb_is_asked_for_when_reached_and_its_levels_match_the_whole_tree();
  a_verb_whose_poll_runs_out_says_so_and_is_asked_again();
  a_leaf_carries_its_line_refusal_and_options_and_a_bad_path_is_refused_in_words();
  a_picture_the_description_shows_is_kept_as_an_effect_with_its_payload();
  the_view_is_kept_until_a_turn_changes_the_state();
  a_visitor_who_is_not_in_the_world_sees_words_and_nothing_to_do();
  return finish();
}
