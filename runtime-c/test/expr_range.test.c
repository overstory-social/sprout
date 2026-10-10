/*
 * Tests for src/expr/range.c: what is live in the containment tree, whether
 * a target is in range of an asker by the path between them (every container
 * strictly between letting it through), what a container holds that `self`
 * can see, and the walk outward that a place's `lit` makes.
 */
#include "eval_fixture.h"
#include "expr/expr.h"

#define HALL "eval_bench.hall"
#define PROBE "eval_bench.hall.probe"
#define COIN "eval_bench.hall.vault.coin"

static void what_is_in_the_tree_is_live_and_what_is_not_is_not(void) {
  bench b;
  bench_turn t;
  bench_open(&b);
  bench_turn_for(&b, &t, "get reads the property");
  CHECK(expr_live(&t.frame, bench_id(PROBE)));
  CHECK(expr_live(&t.frame, bench_id("eval_bench")));
  CHECK(expr_live(&t.frame, bench_id(COIN)));
  CHECK(!expr_live(&t.frame, bench_id("eval_bench.hall.nowhere")));
  bench_turn_close(&t);
  bench_close(&b);
}

static void a_target_is_in_range_when_every_container_between_lets_it_through(void) {
  bench b;
  bench_turn t;
  bool in_range;
  bench_open(&b);
  bench_turn_for(&b, &t, "get reads the property");
  CHECK_INT(expr_reaches(&t.frame, bench_id(PROBE), bench_id("eval_bench.hall.shelf.jar"), NULL, &in_range), SPROUT_EVAL_OK);
  CHECK(in_range);
  CHECK_INT(expr_reaches(&t.frame, bench_id(PROBE), bench_id(PROBE), NULL, &in_range), SPROUT_EVAL_OK);
  CHECK(in_range);
  /* The vault is closed: it is in range itself, and what it holds is not. */
  CHECK_INT(expr_reaches(&t.frame, bench_id(PROBE), bench_id("eval_bench.hall.vault"), NULL, &in_range), SPROUT_EVAL_OK);
  CHECK(in_range);
  CHECK_INT(expr_reaches(&t.frame, bench_id(PROBE), bench_id(COIN), NULL, &in_range), SPROUT_EVAL_OK);
  CHECK(!in_range);
  /* Nothing in the tree is in range of what is not in it. */
  CHECK_INT(expr_reaches(&t.frame, bench_id(PROBE), bench_id("eval_bench.hall.nowhere"), NULL, &in_range), SPROUT_EVAL_OK);
  CHECK(!in_range);
  bench_turn_close(&t);
  bench_close(&b);
}

static void opening_the_container_brings_what_it_holds_into_range(void) {
  bench b;
  bench_turn t;
  bool in_range;
  bench_open(&b);
  bench_turn_for(&b, &t, "a name reached through a container that passes");
  CHECK_INT(expr_seen_by(&t.frame, bench_id(COIN), &in_range), SPROUT_EVAL_OK);
  CHECK(in_range);
  bench_turn_close(&t);
  bench_close(&b);
}

static void every_node_the_walk_touches_costs_a_step(void) {
  bench b;
  bench_turn t;
  bool in_range;
  bench_open(&b);
  bench_turn_for(&b, &t, "get reads the property");
  /* Up from the probe: the probe, the hall, the world; and down to the jar: the jar and the shelf. */
  CHECK_INT(expr_reaches(&t.frame, bench_id(PROBE), bench_id("eval_bench.hall.shelf.jar"), NULL, &in_range), SPROUT_EVAL_OK);
  CHECK_INT(t.meter.steps, 5);
  bench_turn_close(&t);
  bench_close(&b);
}

static void a_container_shows_what_self_can_see_in_its_order(void) {
  bench b;
  bench_turn t;
  const sprout_str *seen;
  size_t count;
  bench_open(&b);
  bench_turn_for(&b, &t, "count is what a container holds in range");
  CHECK_INT(expr_contents_seen(&t.frame, bench_id("eval_bench.hall.shelf"), &seen, &count), SPROUT_EVAL_OK);
  CHECK_INT(count, 2);
  CHECK_BYTES(seen[0].bytes, seen[0].length, "eval_bench.hall.shelf.jar");
  CHECK_BYTES(seen[1].bytes, seen[1].length, "eval_bench.hall.shelf.cup");
  CHECK_INT(expr_contents_seen(&t.frame, bench_id("eval_bench.hall.vault"), &seen, &count), SPROUT_EVAL_OK);
  CHECK_INT(count, 0);
  bench_turn_close(&t);
  bench_close(&b);
}

static void sight_walks_outward_from_where_a_thing_stands(void) {
  bench b;
  bench_turn t;
  const sprout_str *seen;
  size_t count, i;
  bool lamp = false;
  bench_open(&b);
  bench_turn_for(&b, &t, "sees finds a lit light");
  CHECK_INT(expr_seen_from(&t.frame, bench_id("eval_bench.dim"), &seen, &count), SPROUT_EVAL_OK);
  CHECK(count >= 2);
  CHECK_BYTES(seen[0].bytes, seen[0].length, "eval_bench.dim");
  for (i = 0; i < count; i++) lamp = lamp || sprout_str_is(seen[i], "eval_bench.dim.lamp");
  CHECK(lamp);
  bench_turn_close(&t);
  bench_close(&b);
}

int main(void) {
  RUN(what_is_in_the_tree_is_live_and_what_is_not_is_not);
  RUN(a_target_is_in_range_when_every_container_between_lets_it_through);
  RUN(opening_the_container_brings_what_it_holds_into_range);
  RUN(every_node_the_walk_touches_costs_a_step);
  RUN(a_container_shows_what_self_can_see_in_its_order);
  RUN(sight_walks_outward_from_where_a_thing_stands);
  return REPORT();
}
