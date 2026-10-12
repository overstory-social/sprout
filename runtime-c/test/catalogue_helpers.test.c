/*
 * Tests for src/catalogue_helpers.c: the refusal sentence, the arena
 * allocation that reports no memory, and the small readers of strings and
 * flags out of graph nodes.
 */
#include "catalogue_build.h"
#include "check.h"

typedef struct bench {
  test_heap heap;
  sprout_host host;
  sprout_arena arena;
  sprout_builder builder;
  const sprout_graph *graph;
  loader l;
  char error[160];
} bench;

/* A bench whose nodes are built at run time, since the helpers read nodes and nothing else of a cartridge. */
static void open_bench(bench *b) {
  sprout_build_room room = SPROUT_BUILD_LINE_ROOM;
  memset(b, 0, sizeof *b);
  b->host = test_host(&b->heap);
  sprout_arena_init(&b->arena, &b->host);
  sprout_build_begin(&b->builder, &b->arena, room);
  b->graph = sprout_build_graph(&b->builder);
  b->l.arena = &b->arena;
  b->l.graph = b->graph;
  b->l.error = b->error;
  b->l.capacity = sizeof b->error;
}

static void a_refusal_is_the_pieces_joined_and_cut_to_fit(void) {
  bench b;
  open_bench(&b);
  CHECK_INT(cat_fail(&b.l, "one ", "two ", "three"), SPROUT_BAD_INPUT);
  CHECK_STR(b.error, "one two three");
  CHECK_INT(cat_fail(&b.l, "a", NULL, "c"), SPROUT_BAD_INPUT);
  CHECK_STR(b.error, "ac");
  CHECK_INT(cat_fail(&b.l, "0123456789012345678901234567890123456789012345678901234567890123456789012345678901234567890123456789", "0123456789012345678901234567890123456789012345678901234567890123456789012345678901234567890123456789", "xyz"),
            SPROUT_BAD_INPUT);
  CHECK_INT(strlen(b.error), 159);
  CHECK_INT(cat_shaped(&b.l, "kinds.all"), SPROUT_BAD_INPUT);
  CHECK_STR(b.error, "This cartridge is not shaped as a cartridge is at `kinds.all`: it is not what a cartridge holds there.");
  sprout_arena_reset(&b.arena);
}

static void allocation_is_zeroed_and_an_impossible_size_is_refused(void) {
  bench b;
  char *room;
  size_t i;
  open_bench(&b);
  room = (char *)cat_array(&b.l, 10, 4);
  CHECK(room != NULL);
  for (i = 0; room != NULL && i < 40; i++) CHECK(room[i] == 0);
  CHECK(cat_array(&b.l, (size_t)-1, 16) == NULL);
  CHECK(cat_array(&b.l, 0, 8) != NULL);
  sprout_arena_reset(&b.arena);
}

static void strings_flags_and_arrays_are_read_from_nodes(void) {
  bench b;
  const sprout_node *o, *words, *one_word, *mixed;
  size_t count = 0;
  const char **items = NULL;
  char *joined;
  open_bench(&b);
  {
    static const char *const keys[] = {"name", "yes", "no", "n", "list", "words", "bad"};
    const sprout_node *values[7], *x, *y, *z, *four;
    x = sprout_build_string(&b.builder, "x", 1);
    y = sprout_build_string(&b.builder, "y", 1);
    z = sprout_build_string(&b.builder, "z", 1);
    four = sprout_build_number(&b.builder, 4);
    {
      const sprout_node *xy[2], *zz[1], *x4[2];
      xy[0] = x, xy[1] = y;
      zz[0] = z;
      x4[0] = x, x4[1] = four;
      words = sprout_build_array(&b.builder, xy, 2);
      one_word = sprout_build_array(&b.builder, zz, 1);
      mixed = sprout_build_array(&b.builder, x4, 2);
    }
    values[0] = sprout_build_string(&b.builder, "oak", 3);
    values[1] = sprout_build_bool(&b.builder, true);
    values[2] = sprout_build_bool(&b.builder, false);
    values[3] = sprout_build_number(&b.builder, 3);
    values[4] = words;
    values[5] = one_word;
    values[6] = mixed;
    o = sprout_build_object(&b.builder, keys, values, 7);
    CHECK(o != NULL && !sprout_build_failed(&b.builder));
  }
  CHECK_STR(cat_text(b.graph, o, "name"), "oak");
  CHECK(cat_text(b.graph, o, "n") == NULL);
  CHECK(cat_text(b.graph, o, "absent") == NULL);
  CHECK(cat_bool(b.graph, o, "yes"));
  CHECK(!cat_bool(b.graph, o, "no"));
  CHECK(!cat_bool(b.graph, o, "n"));
  CHECK(!cat_bool(b.graph, o, "absent"));
  CHECK(cat_is_array(words) && cat_is_array(one_word));
  CHECK(!cat_is_array(o) && !cat_is_array(NULL));
  CHECK_INT(cat_strings(&b.l, words, "words", &count, &items), SPROUT_OK);
  CHECK_INT(count, 2);
  CHECK_STR(items[1], "y");
  CHECK_INT(cat_strings(&b.l, one_word, "words", &count, &items), SPROUT_OK);
  CHECK_INT(count, 1);
  CHECK_INT(cat_strings(&b.l, mixed, "words", &count, &items), SPROUT_BAD_INPUT);
  CHECK(strstr(b.error, "`words`") != NULL);
  CHECK_INT(cat_strings(&b.l, o, "words", &count, &items), SPROUT_BAD_INPUT);
  joined = cat_join3(&b.l, "ab", ".", "cd");
  CHECK(joined != NULL);
  if (joined != NULL) CHECK_STR(joined, "ab.cd");
  {
    const char *path[] = {"a", "b"};
    CHECK_STR(cat_id_of(&b.l, "w", 2, path), "w.a.b");
    CHECK_STR(cat_id_of(&b.l, "w", 0, path), "w");
  }
  sprout_arena_reset(&b.arena);
  CHECK_INT(b.heap.pages, 0);
}

int main(void) {
  RUN(a_refusal_is_the_pieces_joined_and_cut_to_fit);
  RUN(allocation_is_zeroed_and_an_impossible_size_is_refused);
  RUN(strings_flags_and_arrays_are_read_from_nodes);
  return REPORT();
}
