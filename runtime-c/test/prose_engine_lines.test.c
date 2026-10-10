/*
 * Tests for src/prose/engine_lines.c: every line the engine speaks for itself reads as a
 * one-line passage in the standard library's words, and renders through the same path as any
 * passage; a name that is no engine line is not one.
 */
#include "prose_fixture.h"

static void every_engine_line_renders_as_the_oracle_did(void) {
  prose_bench b;
  prose_bench_open(&b);
  CHECK(prose_replay_area(&b, "engine") >= 27);
  prose_bench_close(&b);
  CHECK_INT(b.heap.pages, 0);
}

static const char *const LINES[] = {
    "unknown",       "not_here",  "no_way",      "cannot",    "not_carrying", "meant",   "pronoun_correction",
    "nothing_happens", "unremarkable", "unseen", "dark",      "fault",        "missing", "displaced",
    "inside_itself", "crowded",   "waited",      "help",      "acted",        "gone_away", "npc_says",
    "arrives",       "leaves",    "inventory",   "not_a_place"};

static void every_line_the_spec_names_reads_into_nodes(void) {
  test_heap heap;
  sprout_host host = test_host(&heap);
  sprout_arena turn;
  sprout_eval_fault fault;
  size_t i;
  sprout_arena_init(&turn, &host);
  for (i = 0; i < sizeof LINES / sizeof LINES[0]; i++) {
    const sprout_node *prose = NULL;
    bool known = false;
    CHECK_INT(prose_engine_prose(&turn, &fault, LINES[i], &prose, &known), SPROUT_EVAL_OK);
    CHECK(known);
    CHECK(prose != NULL && sprout_node_is(sprout_node_get(prose, "kind"), "prose"));
    CHECK(prose != NULL && sprout_node_get(prose, "pieces")->count > 0);
    CHECK(prose_stock_words(LINES[i]) != NULL);
  }
  sprout_arena_reset(&turn);
  CHECK_INT(heap.pages, 0);
}

static void a_name_that_is_no_engine_line_is_not_one(void) {
  test_heap heap;
  sprout_host host = test_host(&heap);
  sprout_arena turn;
  sprout_eval_fault fault;
  const sprout_node *prose = NULL;
  bool known = true;
  sprout_arena_init(&turn, &host);
  CHECK_INT(prose_engine_prose(&turn, &fault, "describe", &prose, &known), SPROUT_EVAL_OK);
  CHECK(!known);
  CHECK(prose_stock_words("describe") == NULL);
  sprout_arena_reset(&turn);
}

static void the_words_are_the_standard_librarys(void) {
  CHECK_STR(prose_stock_words("waited"), "Time passes.");
  CHECK_STR(prose_stock_words("cannot"), "You can't {reading}.");
  CHECK_STR(prose_stock_words("arrives"), "{item} arrives{if bound from} from {from}{/if}.");
  CHECK_STR(prose_stock_words("not_a_place"), "{item} cannot stand in {to}.");
}

static void a_line_reads_into_the_pieces_the_parser_would_make_of_it(void) {
  test_heap heap;
  sprout_host host = test_host(&heap);
  sprout_arena turn;
  sprout_eval_fault fault;
  const sprout_node *prose = NULL, *pieces, *branch;
  bool known;
  sprout_arena_init(&turn, &host);
  CHECK_INT(prose_engine_prose(&turn, &fault, "leaves", &prose, &known), SPROUT_EVAL_OK);
  pieces = sprout_node_get(prose, "pieces");
  /* {item} leaves{if bound to} for {to}{/if}. */
  CHECK_INT(pieces->count, 4);
  CHECK(sprout_node_is(sprout_node_get(pieces->items[0], "kind"), "prose-slot"));
  CHECK(sprout_node_is(sprout_node_get(pieces->items[1], "kind"), "prose-words"));
  branch = pieces->items[2];
  CHECK(sprout_node_is(sprout_node_get(branch, "kind"), "prose-if"));
  CHECK(sprout_node_is(sprout_node_get(sprout_node_get(branch, "condition"), "kind"), "bound"));
  CHECK(sprout_node_get(branch, "otherwise")->kind == SPROUT_NODE_NULL);
  CHECK_INT(sprout_node_get(sprout_node_get(branch, "then"), "pieces")->count, 2);
  sprout_arena_reset(&turn);
}

int main(void) {
  RUN(every_engine_line_renders_as_the_oracle_did);
  RUN(every_line_the_spec_names_reads_into_nodes);
  RUN(a_name_that_is_no_engine_line_is_not_one);
  RUN(the_words_are_the_standard_librarys);
  RUN(a_line_reads_into_the_pieces_the_parser_would_make_of_it);
  return REPORT();
}
