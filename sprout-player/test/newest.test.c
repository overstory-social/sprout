/*
 * newest.c: the newest build of each world. Versions rank as semver.org's precedence ranks them, a
 * number by value (0.10.0 above 0.9.0), a pre-release below its release, build metadata never
 * deciding, and a version that is not semver below any that is; the ranking is antisymmetric and
 * reads only the length it is given. Over lists of builds, generated and by hand, the first places
 * hold one build of each world (one title and author), the highest version and the first listed
 * among equals, each where its world was first listed; a build whose author or version is not known
 * is a world of its own; and every build stays in the list. A later version keeps an earlier one's save
 * by semver's caret read strictly, a pre-release only under itself, build metadata unread.
 */
#include "newest.h"
#include "support.h"

static int sign(int order) { return (order > 0) - (order < 0); }

static void versions_rank_as_semver_ranks_them(void) {
  static const struct {
    const char *a, *b;
    int order;
  } CASES[] = {
      {"0.9.0", "0.10.0", -1},
      {"1.0.0", "0.99.99", 1},
      {"1.2.9", "1.10.0", -1},
      {"1.2.3", "1.2.10", -1},
      {"9.0.0", "12345678901234567890.0.0", -1},
      {"1.0.0-alpha", "1.0.0", -1},
      {"1.0.0-alpha", "1.0.0-alpha.1", -1},
      {"1.0.0-alpha.1", "1.0.0-alpha.beta", -1},
      {"1.0.0-beta.2", "1.0.0-beta.11", -1},
      {"1.0.0-beta", "1.0.0-alpha.9", 1},
      {"1.0.0-rc.1", "1.0.0-RC.1", 1},
      {"0.1.0", "0.1.0", 0},
      {"1.0.0+build.1", "1.0.0+build.2", 0},
      {"1.0.0+b", "1.0.0", 0},
      {"not a version", "0.0.1", -1},
      {"01.0.0", "0.1.0", -1},
      {"1.0", "0.0.1", -1},
      {"1.0.0-", "0.0.1", -1},
      {"1.0.0-01", "0.0.1", -1},
      {"1..0", "1.0", 0},
  };
  size_t i;
  player_text cut;
  begin("versions");
  for (i = 0; i < sizeof CASES / sizeof CASES[0]; i++) {
    player_text a = player_text_of(CASES[i].a), b = player_text_of(CASES[i].b);
    int order = sign(player_version_order(a, b)), back = sign(player_version_order(b, a));
    CHECK(order == CASES[i].order, "%s against %s is %d, not %d", CASES[i].a, CASES[i].b, order, CASES[i].order);
    CHECK(back == -order, "%s against %s is %d, and back %d", CASES[i].a, CASES[i].b, order, back);
  }
  cut.at = "1.10.0-junk";
  cut.length = 6;
  CHECK(player_version_order(cut, player_text_of("1.10.0")) == 0, "only the length given is read");
  CHECK(player_version_order(player_text_of(NULL), player_text_of("oops")) == 0 &&
            player_version_order(player_text_of(NULL), player_text_of("0.0.1")) < 0,
        "an unknown version ranks as one that is not semver");
  end();
}

/* The spec's State › Across versions: semver's caret read strictly, a pre-release compatible only with itself. */
static void a_later_version_keeps_a_save_by_the_caret(void) {
  static const struct {
    const char *earlier, *later;
    bool keeps;
  } CASES[] = {
      {"0.1.0", "0.1.1", true},
      {"0.1.0", "0.1.0", true},
      {"0.1.0", "0.2.0", false},
      {"0.1.9", "0.1.10", true},
      {"0.0.3", "0.0.3", true},
      {"0.0.3", "0.0.4", false},
      {"1.0.0", "1.1.0", true},
      {"1.4.2", "1.10.0", true},
      {"1.0.0", "2.0.0", false},
      {"1.1.0", "1.0.0", false},
      {"0.1.1", "0.1.0", false},
      {"1.0.0-beta.1", "1.0.0-beta.1", true},
      {"1.0.0-beta.1", "1.0.0-beta.2", false},
      {"1.0.0-beta.1", "1.0.0", false},
      {"1.0.0", "1.0.1-rc.1", false},
      {"1.0.0+a", "1.0.1+b", true},
      {"1.0.0-rc.1+a", "1.0.0-rc.1+b", true},
      {"not a version", "1.0.0", false},
      {"1.0.0", "1.0", false},
      {"01.0.0", "1.0.0", false},
  };
  size_t i;
  begin("keeps");
  for (i = 0; i < sizeof CASES / sizeof CASES[0]; i++) {
    bool keeps = player_version_keeps_saves(player_text_of(CASES[i].earlier), player_text_of(CASES[i].later));
    CHECK(keeps == CASES[i].keeps, "a save of %s under %s: %d, not %d", CASES[i].earlier, CASES[i].later, keeps, CASES[i].keeps);
  }
  CHECK(!player_version_keeps_saves(player_text_of(NULL), player_text_of("1.0.0")) &&
            !player_version_keeps_saves(player_text_of("1.0.0"), player_text_of(NULL)),
        "an unknown version keeps nothing");
  end();
}

/* ---- lists of builds ---- */

#define MOST 24

typedef struct listed {
  const char *title, *author, *version;
  int id; /* where it was listed, which the ranking never reads */
} listed;

typedef struct builds {
  listed at[MOST];
  size_t count;
} builds;

static player_build build_at(void *ctx, size_t i) {
  const listed *one = &((builds *)ctx)->at[i];
  player_build build;
  build.title = player_text_of(one->title);
  build.author = player_text_of(one->author);
  build.version = player_text_of(one->version);
  return build;
}

static void swap_at(void *ctx, size_t i, size_t j) {
  builds *list = (builds *)ctx;
  listed held = list->at[i];
  list->at[i] = list->at[j];
  list->at[j] = held;
}

static size_t newest_of(builds *list) {
  player_builds view;
  view.ctx = list;
  view.count = list->count;
  view.at = build_at;
  view.swap = swap_at;
  return player_newest_builds(&view);
}

static bool same(const char *a, const char *b) { return a != NULL && b != NULL && strcmp(a, b) == 0; }

/* Whether two listed builds are of one world, as newest.h has it. */
static bool one_world(const listed *a, const listed *b) {
  return a->version != NULL && b->version != NULL && same(a->title, b->title) && same(a->author, b->author);
}

static void the_newest_build_of_each_world_comes_first(void) {
  builds list = {{{"Moss", "Bo", "0.9.0", 0},
                  {"Bell", "Eve", "0.1.0", 1},
                  {"Moss", "Bo", "0.10.0", 2},
                  {"Moss", "Ada", "0.1.0", 3},
                  {"Bell", "Eve", NULL, 4},
                  {"Moss", "Bo", "0.10.0", 5},
                  {"Bell", NULL, "9.0.0", 6}},
                 7};
  static const int KEPT[] = {2, 1, 3, 4, 6};
  size_t kept, i;
  begin("by-hand");
  kept = newest_of(&list);
  CHECK(kept == 5, "seven builds of five worlds: %zu", kept);
  for (i = 0; i < 5 && i < kept; i++) CHECK(list.at[i].id == KEPT[i], "place %zu holds build %d, not %d", i, list.at[i].id, KEPT[i]);
  list.count = 0;
  CHECK(newest_of(&list) == 0, "no builds are no worlds");
  end();
}

/* The next of a fixed sequence, so every run generates the same lists. */
static unsigned next(unsigned *seed) {
  *seed = *seed * 1103515245u + 12345u;
  return (*seed >> 16) & 0x7fffu;
}

static void over_generated_lists_each_world_keeps_its_newest_and_nothing_is_lost(void) {
  static const char *const TITLES[] = {"Moss", "Bell", "Tea"};
  static const char *const AUTHORS[] = {"Ada", "Bo", NULL};
  static const char *const VERSIONS[] = {"0.1.0", "0.10.0", "0.9.0", "1.0.0-rc.1", "1.0.0", "1.0.0+b", "oops", NULL};
  unsigned seed = 7;
  int round;
  begin("generated");
  for (round = 0; round < 500; round++) {
    builds list, before;
    bool seen[MOST];
    int firsts[MOST];
    size_t kept, i, j;
    list.count = next(&seed) % (MOST + 1);
    for (i = 0; i < list.count; i++) {
      list.at[i].title = TITLES[next(&seed) % 3];
      list.at[i].author = AUTHORS[next(&seed) % 3];
      list.at[i].version = VERSIONS[next(&seed) % 8];
      list.at[i].id = (int)i;
    }
    before = list;
    kept = newest_of(&list);
    memset(seen, 0, sizeof seen);
    for (i = 0; i < list.count; i++) seen[list.at[i].id] = true;
    for (i = 0; i < before.count; i++) CHECK(seen[i], "round %d: build %zu is still listed", round, i);
    for (i = 0; i < kept; i++) {
      const listed *winner = &list.at[i];
      int best = -1;
      firsts[i] = -1;
      for (j = 0; j < before.count; j++) {
        const listed *one = &before.at[j];
        if ((int)j != winner->id && !one_world(one, winner)) continue;
        if (firsts[i] < 0) firsts[i] = (int)j;
        if (best < 0 || player_version_order(player_text_of(one->version), player_text_of(before.at[best].version)) > 0)
          best = (int)j;
      }
      CHECK(winner->id == best, "round %d: place %zu holds build %d, not the newest, %d", round, i, winner->id, best);
      CHECK(i == 0 || firsts[i] > firsts[i - 1], "round %d: place %zu is in the order its world was first listed", round, i);
      for (j = 0; j < i; j++) CHECK(!one_world(&list.at[j], winner), "round %d: places %zu and %zu are one world", round, j, i);
    }
    for (i = kept; i < list.count; i++) {
      bool outranked = false;
      for (j = 0; j < kept; j++) outranked = outranked || one_world(&list.at[j], &list.at[i]);
      CHECK(outranked, "round %d: build %d past the worlds is outranked by one of them", round, list.at[i].id);
    }
  }
  end();
}

int main(void) {
  test_program("newest");
  versions_rank_as_semver_ranks_them();
  a_later_version_keeps_a_save_by_the_caret();
  the_newest_build_of_each_world_comes_first();
  over_generated_lists_each_world_keeps_its_newest_and_nothing_is_lost();
  return finish();
}
