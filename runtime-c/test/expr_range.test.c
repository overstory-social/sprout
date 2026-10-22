/*
 * Tests for src/expr/range.c: what is live in the containment tree, whether
 * a target is in range of an asker by the path between them (every container
 * strictly between letting it through), what a container holds that `self`
 * can see, and the walk outward that a place's `lit` makes; what `self` sees
 * and sight pass over what is unseen (Range > Unseen).
 */
#include "eval_fixture.h"
#include "expr/expr.h"
#include "unseen_fixture.h"
#include "several_fixture.h"

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

static bool among(const sprout_str *ids, size_t count, const char *id) {
  size_t i;
  for (i = 0; i < count; i++)
    if (sprout_str_is(ids[i], id)) return true;
  return false;
}


static void sight_reaches_what_is_shut_in_with_it_and_no_further(void) {
  bench b;
  bench_turn t;
  const sprout_str *seen;
  size_t count;
  bench_open(&b);
  bench_turn_for(&b, &t, "get reads the property");
  /* The coin is shut in the vault with the box. */
  CHECK_INT(expr_seen_from(&t.frame, bench_id(COIN), &seen, &count), SPROUT_EVAL_OK);
  CHECK(among(seen, count, "eval_bench.hall.vault"));
  CHECK(among(seen, count, "eval_bench.hall.vault.box"));
  CHECK(!among(seen, count, HALL));
  CHECK(!among(seen, count, PROBE));
  bench_turn_close(&t);
  bench_close(&b);
}
static void what_is_unseen_is_reached_and_not_seen_but_by_itself_and_what_it_holds(void) {
  unseen_bench b;
  bool reached = false, seen = true;
  unseen_open(&b);
  CHECK_INT(expr_reaches(&b.frame, b.marta, unseen_str("unseen.hall.niche.coin"), NULL, &reached), SPROUT_EVAL_OK);
  CHECK(reached);
  CHECK_INT(expr_seen_by(&b.frame, unseen_str("unseen.hall.niche.coin"), &seen), SPROUT_EVAL_OK);
  CHECK(!seen);
  CHECK_INT(expr_seen_by(&b.frame, unseen_str("unseen.hall.thief"), &seen), SPROUT_EVAL_OK);
  CHECK(!seen);
  CHECK_INT(expr_seen_by(&b.frame, unseen_str("unseen.hall.bell"), &seen), SPROUT_EVAL_OK);
  CHECK(seen);
  b.frame.self = unseen_str("unseen.hall.niche");
  CHECK_INT(expr_seen_by(&b.frame, unseen_str("unseen.hall.niche"), &seen), SPROUT_EVAL_OK);
  CHECK(seen);
  CHECK_INT(expr_seen_by(&b.frame, unseen_str("unseen.hall.niche.coin"), &seen), SPROUT_EVAL_OK);
  CHECK(seen);
  b.frame.self = unseen_str("unseen.hall.niche.coin");
  CHECK_INT(expr_seen_by(&b.frame, unseen_str("unseen.hall.niche"), &seen), SPROUT_EVAL_OK);
  CHECK(seen);
  unseen_close(&b);
}

static void a_container_shows_nothing_unseen_save_in_the_acting_visitors_open_hands(void) {
  unseen_bench b;
  const sprout_str *seen;
  size_t count;
  unseen_open(&b);
  CHECK_INT(sprout_draft_place(&b.run.draft, unseen_str("unseen.hall.bell"), &b.marta), SPROUT_DRAFT_OK);
  unseen_set(&b, "unseen.hall.bell", true);
  b.frame.self = unseen_str("unseen.hall");
  CHECK_INT(expr_contents_seen(&b.frame, unseen_str("unseen.hall"), &seen, &count), SPROUT_EVAL_OK);
  CHECK(among(seen, count, "unseen.hall.leaves"));
  CHECK(!among(seen, count, "unseen.hall.thief") && !among(seen, count, "unseen.hall.grating"));
  b.frame.hands = b.marta;
  CHECK_INT(expr_contents_seen(&b.frame, b.marta, &seen, &count), SPROUT_EVAL_OK);
  CHECK(among(seen, count, "unseen.hall.bell"));
  /* An unseen visitor's hands are open to their own refusal's words too. */
  unseen_write(&b.run.draft, b.frame.turn, tw_person(&b.w, "v-marta"), true);
  CHECK_INT(expr_contents_seen(&b.frame, b.marta, &seen, &count), SPROUT_EVAL_OK);
  CHECK(among(seen, count, "unseen.hall.bell"));
  b.frame.hands = (sprout_str){NULL, 0};
  CHECK_INT(expr_contents_seen(&b.frame, b.marta, &seen, &count), SPROUT_EVAL_OK);
  CHECK_INT(count, 0);
  unseen_close(&b);
}

static void sight_does_not_see_what_is_unseen(void) {
  unseen_bench b;
  const sprout_str *seen;
  size_t count;
  unseen_open(&b);
  CHECK_INT(expr_seen_from(&b.frame, unseen_str("unseen.cellar"), &seen, &count), SPROUT_EVAL_OK);
  CHECK(among(seen, count, "unseen.cellar"));
  CHECK(!among(seen, count, "unseen.cellar.lamp"));
  unseen_set(&b, "unseen.cellar.lamp", false);
  CHECK_INT(expr_seen_from(&b.frame, unseen_str("unseen.cellar"), &seen, &count), SPROUT_EVAL_OK);
  CHECK(among(seen, count, "unseen.cellar.lamp"));
  unseen_close(&b);
}

static void a_thing_in_several_places_is_reached_through_any_of_them_both_ways(void) {
  several s;
  bool reached;
  several_open(&s);
  CHECK_INT(expr_reaches(&s.frame, exec_str(s.ash), exec_str(SEVERAL_DOOR), NULL, &reached), SPROUT_EVAL_OK);
  CHECK(reached);
  CHECK_INT(expr_reaches(&s.frame, exec_str(s.wren), exec_str(SEVERAL_DOOR), NULL, &reached), SPROUT_EVAL_OK);
  CHECK(reached);
  CHECK_INT(expr_reaches(&s.frame, exec_str(SEVERAL_DOOR), exec_str(s.ash), NULL, &reached), SPROUT_EVAL_OK);
  CHECK(reached);
  CHECK_INT(expr_reaches(&s.frame, exec_str(SEVERAL_DOOR), exec_str(SEVERAL_DREARY), NULL, &reached), SPROUT_EVAL_OK);
  CHECK(reached);
  /* Two things in several places reach each other through a place they share, and not across the world. */
  CHECK_INT(expr_reaches(&s.frame, exec_str(SEVERAL_EAST_WALL), exec_str("several_places.west_teller.north_wall"), NULL,
                         &reached),
            SPROUT_EVAL_OK);
  CHECK(reached);
  CHECK_INT(expr_reaches(&s.frame, exec_str(SEVERAL_DOOR), exec_str(SEVERAL_EAST_WALL), NULL, &reached), SPROUT_EVAL_OK);
  CHECK(!reached);
  CHECK_INT(expr_reaches(&s.frame, exec_str(s.ash), exec_str(s.wren), NULL, &reached), SPROUT_EVAL_OK);
  CHECK(!reached);
  several_close(&s);
}

int main(void) {
  RUN(a_thing_in_several_places_is_reached_through_any_of_them_both_ways);
  RUN(what_is_in_the_tree_is_live_and_what_is_not_is_not);
  RUN(a_target_is_in_range_when_every_container_between_lets_it_through);
  RUN(opening_the_container_brings_what_it_holds_into_range);
  RUN(every_node_the_walk_touches_costs_a_step);
  RUN(a_container_shows_what_self_can_see_in_its_order);
  RUN(sight_walks_outward_from_where_a_thing_stands);
  RUN(sight_reaches_what_is_shut_in_with_it_and_no_further);
  RUN(what_is_unseen_is_reached_and_not_seen_but_by_itself_and_what_it_holds);
  RUN(a_container_shows_nothing_unseen_save_in_the_acting_visitors_open_hands);
  RUN(sight_does_not_see_what_is_unseen);
  return REPORT();
}
