/*
 * Tests for src/parse/exits.c: the way out a slot's words name (the spec's Verbs > Exits, Links; Names >
 * Articles), over ways out built here as the cartridge carries them, a
 * label beside its typed words, and the labels of the corpus worlds `exit-labels`, `out-of-reach-exit` and
 * `movement-phrasing`.
 */
#include "parse_fixture.h"

typedef struct ways {
  sprout_arena arena;
  sprout_builder builder;
  sprout_way way[8];
  size_t count;
} ways;

/* A way out in `direction` (NULL for a link) whose label is `label`, its typed words `typed`. */
static void add(ways *w, const char *direction, const char *label, const char *typed) {
  static const char *const label_keys[] = {"text", "typed"};
  static const char *const line_keys[] = {"label"};
  static const char *const exit_keys[] = {"line"};
  const sprout_node *texts[2], *line, *exit;
  texts[0] = sprout_build_string(&w->builder, label, strlen(label));
  texts[1] = sprout_build_string(&w->builder, typed, strlen(typed));
  line = sprout_build_object(&w->builder, label_keys, texts, 2);
  line = sprout_build_object(&w->builder, line_keys, &line, 1);
  exit = sprout_build_object(&w->builder, exit_keys, &line, 1);
  memset(&w->way[w->count], 0, sizeof w->way[w->count]);
  w->way[w->count].direction = direction;
  w->way[w->count].label = label;
  w->way[w->count].exit = exit;
  w->count++;
}

static void begin(ways *w, test_heap *heap, sprout_host *host) {
  sprout_build_room room = SPROUT_BUILD_LINE_ROOM;
  *host = test_host(heap);
  host->page_bytes = 65536;
  sprout_arena_init(&w->arena, host);
  sprout_build_begin(&w->builder, &w->arena, room);
  w->count = 0;
}

static parse_words words(ways *w, const char *line) {
  parse_words out;
  sprout_str *found;
  size_t count;
  if (typed_words(&w->arena, bench_str(line), &found, &count) != SPROUT_OK) exit(2);
  out.words = found;
  out.count = count;
  return out;
}

/* The index of the way `line` names, or -1. */
static long named(ways *w, const char *line) {
  const sprout_way *way = parse_exit_named(sprout_build_graph(&w->builder), words(w, line), w->way, w->count);
  return way == NULL ? -1 : (long)(way - w->way);
}

static void maze(ways *w) {
  add(w, "north", "deeper into the dark", "deeper into the dark");
  add(w, "north", "toward a grey light", "toward a grey light");
  add(w, "down", "Down the Coal Stair", "down the coal stair");
  add(w, NULL, "the way you came", "the way you came");
}

static void it_is_the_first_that_applies_in_the_direction_named_written_out_or_abbreviated(void) {
  test_heap heap;
  sprout_host host;
  ways w;
  begin(&w, &heap, &host);
  maze(&w);
  CHECK_INT(named(&w, "north"), 0);
  CHECK_INT(named(&w, "n"), 0);
  CHECK_INT(named(&w, "d"), 2);
  sprout_arena_reset(&w.arena);
}

static void it_is_the_one_whose_label_was_typed_however_cased(void) {
  test_heap heap;
  sprout_host host;
  ways w;
  begin(&w, &heap, &host);
  maze(&w);
  CHECK_INT(named(&w, "toward a grey light"), 1);
  CHECK_INT(named(&w, "Down the coal STAIR"), 2);
  sprout_arena_reset(&w.arena);
}

static void an_article_my_this_or_that_at_a_labels_start_is_dropped_as_typed_and_as_written(void) {
  static const char *const tree[] = {"tree", "the tree", "a tree", "my tree", "this tree", "that tree"};
  static const char *const door[] = {"trap door", "the trap door", "that trap door"};
  test_heap heap;
  sprout_host host;
  ways w;
  size_t i;
  begin(&w, &heap, &host);
  add(&w, "up", "tree", "tree");
  add(&w, "down", "The Trap Door", "the trap door");
  for (i = 0; i < 6; i++) CHECK_INT(named(&w, tree[i]), 0);
  for (i = 0; i < 3; i++) CHECK_INT(named(&w, door[i]), 1);
  /* Only one, and only at the start: a word the label holds inside it is kept. */
  CHECK_INT(named(&w, "the the tree"), -1);
  CHECK_INT(named(&w, "trap the door"), -1);
  CHECK_INT(named(&w, "the"), -1);
  sprout_arena_reset(&w.arena);
}

static void a_label_of_one_word_is_kept_whole_though_it_is_an_article(void) {
  test_heap heap;
  sprout_host host;
  ways w;
  begin(&w, &heap, &host);
  CHECK_INT(parse_label_words(words(&w, "the")).count, 1);
  CHECK_INT(parse_label_words(words(&w, "the tree")).count, 1);
  CHECK_INT(parse_label_words(words(&w, "tree house")).count, 2);
  sprout_arena_reset(&w.arena);
}

static void a_link_is_taken_by_its_label_alone(void) {
  test_heap heap;
  sprout_host host;
  ways w;
  begin(&w, &heap, &host);
  maze(&w);
  CHECK_INT(named(&w, "the way you came"), 3);
  CHECK_INT(named(&w, "way"), -1);
  sprout_arena_reset(&w.arena);
}

static void it_is_none_where_nothing_applies_in_that_direction_or_answers_to_the_words(void) {
  static const char *const lines[] = {"south", "s", "up", "into the dark", "north north"};
  test_heap heap;
  sprout_host host;
  ways w;
  size_t i;
  begin(&w, &heap, &host);
  maze(&w);
  for (i = 0; i < 5; i++) CHECK_INT(named(&w, lines[i]), -1);
  w.count = 0;
  CHECK_INT(named(&w, "north"), -1);
  sprout_arena_reset(&w.arena);
}

static void a_direction_through_into_down_or_up_its_own_label_names_that_way(void) {
  static const char *const crawlway[] = {"south through the crawlway", "s through crawlway", "south into the crawlway",
                                         "south down the crawlway", "south up that crawlway"};
  test_heap heap;
  sprout_host host;
  ways w;
  size_t i;
  begin(&w, &heap, &host);
  add(&w, "south", "the crawlway", "the crawlway");
  add(&w, "north", "up the ladder", "up the ladder");
  add(&w, "east", "the crack", "the crack");
  add(&w, "east", "the crawlway", "the crawlway");
  for (i = 0; i < 5; i++) CHECK_INT(named(&w, crawlway[i]), 0);
  /* A label that begins with the way word is typed with it once. */
  CHECK_INT(named(&w, "north up the ladder"), 1);
  /* Of two ways in one direction, the one whose label was typed. */
  CHECK_INT(named(&w, "east through the crawlway"), 3);
  /* Another way's label, a label in no direction, or a word between that is no way word, names none. */
  CHECK_INT(named(&w, "south through the crack"), -1);
  CHECK_INT(named(&w, "west through the crack"), -1);
  CHECK_INT(named(&w, "south past the crawlway"), -1);
  CHECK_INT(named(&w, "south through"), -1);
  sprout_arena_reset(&w.arena);
}

static void a_direction_through_is_read_only_where_a_way_word_follows_a_direction(void) {
  test_heap heap;
  sprout_host host;
  ways w;
  parse_words label;
  begin(&w, &heap, &host);
  CHECK_STR(parse_direction_through(words(&w, "s through the crawlway"), &label), "south");
  CHECK_INT(label.count, 3);
  CHECK_STR(parse_direction_through(words(&w, "north up the ladder"), &label), "north");
  CHECK(parse_direction_through(words(&w, "through the crawlway"), &label) == NULL);
  CHECK(parse_direction_through(words(&w, "south through"), &label) == NULL);
  CHECK(parse_direction_through(words(&w, "south past the crawlway"), &label) == NULL);
  CHECK(parse_direction_through(words(&w, "crawl through the crawlway"), &label) == NULL);
  sprout_arena_reset(&w.arena);
}

static void the_worlds_labels_are_every_exits_and_links_as_typed_without_their_article(void) {
  bench b;
  bench_open(&b, "exit-labels", "Marta");
  CHECK(parse_way_label(b.w.world, bench_words(&b, "tree")));
  CHECK(parse_way_label(b.w.world, bench_words(&b, "trap door")));
  CHECK(parse_way_label(b.w.world, bench_words(&b, "the forest floor")));
  CHECK(!parse_way_label(b.w.world, bench_words(&b, "window")));
  bench_close(&b);
  /* A label one place writes is known in another, where it names a way out of reach. */
  bench_open(&b, "out-of-reach-exit", "Marta");
  CHECK(parse_way_label(b.w.world, bench_words(&b, "window")));
  CHECK(parse_way_label(b.w.world, bench_words(&b, "south")));
  CHECK(!parse_way_label(b.w.world, bench_words(&b, "door")));
  bench_close(&b);
}

static void a_label_after_a_way_word_is_the_worlds_with_or_without_that_word(void) {
  bench b;
  bench_open(&b, "movement-phrasing", "Marta");
  CHECK(parse_through_label(b.w.world, bench_words(&b, "through the crawlway")));
  CHECK(parse_through_label(b.w.world, bench_words(&b, "into hole")));
  CHECK(parse_through_label(b.w.world, bench_words(&b, "up the ladder")));
  CHECK(parse_through_label(b.w.world, bench_words(&b, "down the ladder")));
  CHECK(!parse_through_label(b.w.world, bench_words(&b, "through the bananas")));
  CHECK(!parse_through_label(b.w.world, bench_words(&b, "into the up ladder")));
  bench_close(&b);
}

int main(void) {
  RUN(it_is_the_first_that_applies_in_the_direction_named_written_out_or_abbreviated);
  RUN(it_is_the_one_whose_label_was_typed_however_cased);
  RUN(an_article_my_this_or_that_at_a_labels_start_is_dropped_as_typed_and_as_written);
  RUN(a_label_of_one_word_is_kept_whole_though_it_is_an_article);
  RUN(a_link_is_taken_by_its_label_alone);
  RUN(it_is_none_where_nothing_applies_in_that_direction_or_answers_to_the_words);
  RUN(a_direction_through_into_down_or_up_its_own_label_names_that_way);
  RUN(a_direction_through_is_read_only_where_a_way_word_follows_a_direction);
  RUN(the_worlds_labels_are_every_exits_and_links_as_typed_without_their_article);
  RUN(a_label_after_a_way_word_is_the_worlds_with_or_without_that_word);
  return REPORT();
}
