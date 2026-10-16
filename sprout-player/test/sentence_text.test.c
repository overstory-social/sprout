/*
 * ui/sentence_text.c: words grow from the fake's allocator and are found by offset once closed; a verb is named
 * without its library, a filler by its thing, things or way out, a role a reading may leave out by the words its
 * phrase puts before it or its name where the view carries none, and a number by its digits.
 */
#include "support.h"
#include "host/files.h"
#include "ui/sentence_text.h"

static sprout_seen_filler thing(const char *role, const char *words, const char *name) {
  sprout_seen_filler filler;
  memset(&filler, 0, sizeof filler);
  filler.role = role;
  filler.words = words;
  filler.binds = SPROUT_SEEN_OBJECT;
  filler.thing.id = (sprout_str){"w.x", 3};
  filler.thing.name = (sprout_str){name, strlen(name)};
  return filler;
}

static void words_grow_and_are_found_by_offset(void) {
  sentence_text t;
  size_t first, second, start;
  begin("offsets");
  memset(&t, 0, sizeof t);
  first = words_close(&fake->api, &t, 0, words_add_text(&fake->api, &t, "take"));
  start = t.length;
  second = words_close(&fake->api, &t, start, words_add(&fake->api, &t, "a sack!", 6));
  CHECK(first == 1 && strcmp(words_at(&t, first), "take") == 0, "the first string is at 1: %s", words_at(&t, first));
  CHECK(second == 6 && strcmp(words_at(&t, second), "a sack") == 0, "the next after its NUL: %s", words_at(&t, second));
  CHECK(words_at(&t, 0) == NULL, "0 is no string");
  CHECK(words_close(&fake->api, &t, t.length, false) == 0, "a string that could not be made is 0");
  player_free(&fake->api, t.bytes);
  end();
}

static void a_verb_a_filler_a_role_and_a_number_are_worded_for_the_disc(void) {
  sentence_text t;
  sprout_seen_filler source = thing("source", "from", "a table"), target = thing("target", "", "a sack"), way;
  begin("labels");
  memset(&t, 0, sizeof t);
  memset(&way, 0, sizeof way);
  way.role = "way";
  way.words = "";
  way.binds = SPROUT_SEEN_EXIT;
  way.exit.label = "to the yard";
  CHECK(words_verb(&fake->api, &t, "sprout.pick_up") && strcmp(t.bytes, "pick up") == 0, "a verb's name, its underscores as spaces: %s", t.bytes);
  t.length = 0;
  CHECK(words_filler(&fake->api, &t, &source) && strcmp(t.bytes, "a table") == 0, "a thing by its name: %s", t.bytes);
  t.length = 0;
  CHECK(words_filler(&fake->api, &t, &way) && strcmp(t.bytes, "to the yard") == 0, "a way out with no direction by its label: %s", t.bytes);
  t.length = 0;
  CHECK(words_role(&fake->api, &t, &source) && strcmp(t.bytes, "from") == 0, "a role by the words before its slot: %s", t.bytes);
  t.length = 0;
  CHECK(words_role(&fake->api, &t, &target) && strcmp(t.bytes, "target") == 0, "or by its name where the view carries none: %s", t.bytes);
  t.length = 0;
  CHECK(words_before(&fake->api, &t, &source) && words_filler(&fake->api, &t, &source) && strcmp(t.bytes, "from a table") == 0,
        "the words before a pick, and a space: %s", t.bytes);
  t.length = 0;
  CHECK(words_before(&fake->api, &t, &target) && words_filler(&fake->api, &t, &target) && strcmp(t.bytes, "a sack") == 0,
        "and nothing where the view carries none: %s", t.bytes);
  t.length = 0;
  CHECK(words_number(&fake->api, &t, -42) && strcmp(t.bytes, "-42") == 0, "a number with its sign: %s", t.bytes);
  player_free(&fake->api, t.bytes);
  end();
}

int main(void) {
  test_program("sentence_text");
  words_grow_and_are_found_by_offset();
  a_verb_a_filler_a_role_and_a_number_are_worded_for_the_disc();
  return finish();
}
