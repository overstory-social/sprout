/*
 * Tests for src/expr/names.c: what a name written in a body reaches (the
 * world, a declared object by its path, what is nearest by what each
 * container holds), that a name is read only if it is in range, that a
 * declared object destroyed is gone for good, and that narrowing a name
 * binds it to what it reached.
 */
#include "eval_fixture.h"
#include "expr/expr.h"

/* The name table's entry for the name or path the node written holds. */
static const sprout_node *named_by(bench *b, const sprout_node *written) {
  const sprout_node *named = sprout_world_bound(b->world, written);
  CHECK(named != NULL);
  return named;
}

static void the_world_is_reached_by_its_name(void) {
  bench b;
  bench_turn t;
  sprout_str reached;
  const sprout_node *name;
  bench_open(&b);
  bench_turn_for(&b, &t, "the world by its name");
  name = sprout_node_get(sprout_node_get(bench_expr(&b, "the world by its name"), "left"), "name");
  CHECK_INT(expr_reached_by_name(&t.frame, named_by(&b, name), "eval_bench", &reached), SPROUT_EVAL_OK);
  CHECK_BYTES(reached.bytes, reached.length, "eval_bench");
  bench_turn_close(&t);
  bench_close(&b);
}

static void a_declared_object_is_reached_by_its_path(void) {
  bench b;
  bench_turn t;
  sprout_str reached;
  bench_open(&b);
  bench_turn_for(&b, &t, "compares two objects by identity");
  CHECK_INT(expr_reached_by_name(&t.frame, named_by(&b, sprout_node_get(bench_expr(&b, "compares two objects by identity"), "left")),
                                 "eval_bench.hall.shelf.jar", &reached),
            SPROUT_EVAL_OK);
  CHECK_BYTES(reached.bytes, reached.length, "eval_bench.hall.shelf.jar");
  bench_turn_close(&t);
  bench_close(&b);
}

static void the_nearest_thing_called_that_is_reached_by_what_each_container_holds(void) {
  bench b;
  bench_turn t;
  sprout_str reached;
  const sprout_node *root, *name, *path;
  bench_open(&b);
  bench_turn_for(&b, &t, "a name placed nearest");
  root = bench_expr(&b, "a name placed nearest");
  name = sprout_node_get(sprout_node_get(sprout_node_get(root, "left"), "receiver"), "name");
  CHECK_INT(expr_reached_by_name(&t.frame, named_by(&b, name), "shelf", &reached), SPROUT_EVAL_OK);
  CHECK_BYTES(reached.bytes, reached.length, "eval_bench.hall.shelf");
  /* And each step after it is among what the one before holds. */
  root = bench_expr(&b, "&& narrows a dotted path");
  path = sprout_node_get(sprout_node_get(root, "left"), "receiver");
  CHECK_INT(expr_reached_by_name(&t.frame, named_by(&b, path), "shelf.cup", &reached), SPROUT_EVAL_OK);
  CHECK_BYTES(reached.bytes, reached.length, "eval_bench.hall.shelf.cup");
  bench_turn_close(&t);
  bench_close(&b);
}

static void a_name_behind_a_closed_container_is_out_of_range(void) {
  bench b;
  bench_turn t;
  sprout_str reached;
  const sprout_node *path;
  bench_open(&b);
  bench_turn_for(&b, &t, "a name behind a closed container");
  path = sprout_node_get(bench_expr(&b, "a name behind a closed container"), "receiver");
  CHECK_INT(expr_reached_by_name(&t.frame, named_by(&b, path), "vault.coin", &reached), SPROUT_EVAL_FAULT);
  CHECK_STR(t.fault.name, "NameOutOfRange");
  CHECK_STR(t.fault.text,
            "`eval_bench.hall.vault.coin` is out of range of `eval_bench.hall.probe`, so it could not be read through "
            "`vault.coin`.");
  bench_turn_close(&t);
  bench_close(&b);
}

static void a_name_that_reaches_nothing_says_so(void) {
  bench b;
  bench_turn t;
  sprout_str reached;
  const sprout_node *name;
  bench_open(&b);
  bench_turn_for(&b, &t, "a name placed nearest");
  name = sprout_node_get(sprout_node_get(sprout_node_get(bench_expr(&b, "a name placed nearest"), "left"), "receiver"), "name");
  /* The shelf is gone from where it stood, and nothing else is called that. */
  t.frame.self = bench_id("eval_bench.nook");
  CHECK_INT(expr_reached_by_name(&t.frame, named_by(&b, name), "shelf", &reached), SPROUT_EVAL_FAULT);
  CHECK_STR(t.fault.name, "NameOutOfRange");
  CHECK_STR(t.fault.text, "`shelf` reaches nothing here now, so `eval_bench.nook` could not read through it.");
  bench_turn_close(&t);
  bench_close(&b);
}

static void a_declared_object_destroyed_is_gone_for_good(void) {
  bench b;
  bench_turn t;
  sprout_str reached;
  const sprout_str *removed;
  size_t count;
  bench_open(&b);
  bench_turn_for(&b, &t, "compares two objects by identity");
  CHECK_INT(sprout_draft_remove(&t.draft, bench_id("eval_bench.hall.shelf.jar"), &removed, &count), SPROUT_DRAFT_OK);
  CHECK_INT(expr_reached_by_name(&t.frame, named_by(&b, sprout_node_get(bench_expr(&b, "compares two objects by identity"), "left")),
                                 "eval_bench.hall.shelf.jar", &reached),
            SPROUT_EVAL_FAULT);
  CHECK_STR(t.fault.name, "DestroyedReference");
  CHECK_STR(t.fault.text, "`eval_bench.hall.shelf.jar` was destroyed, and a declared object destroyed is gone for good.");
  bench_turn_close(&t);
  bench_close(&b);
}

static void narrowing_a_name_binds_it_to_what_it_reached(void) {
  bench b;
  bench_turn t;
  sprout_frame inner;
  const sprout_node *is_call;
  const sprout_binding *bound;
  bench_open(&b);
  bench_turn_for(&b, &t, "a name placed nearest");
  is_call = sprout_node_get(bench_expr(&b, "a name placed nearest"), "left");
  CHECK(expr_binding(&t.frame, "shelf") == NULL);
  CHECK_INT(expr_narrowed(&t.frame, is_call, &inner), SPROUT_EVAL_OK);
  bound = expr_binding(&inner, "shelf");
  CHECK(bound != NULL);
  if (bound != NULL) {
    CHECK_INT(bound->bound.binds, SPROUT_BINDS_OBJECT);
    CHECK_BYTES(bound->bound.id.bytes, bound->bound.id.length, "eval_bench.hall.shelf");
  }
  /* The frame it was given is as it was. */
  CHECK(t.frame.bindings == NULL);
  /* A name already bound is not bound again. */
  t.frame.bindings = sprout_bind(&t.frame, "shelf", sprout_evaluated_object(bench_id("eval_bench.nook")));
  CHECK_INT(expr_narrowed(&t.frame, is_call, &inner), SPROUT_EVAL_OK);
  CHECK(inner.bindings == t.frame.bindings);
  /* Only an `is` narrows. */
  t.frame.bindings = NULL;
  CHECK_INT(expr_narrowed(&t.frame, bench_expr(&b, "get reads the property"), &inner), SPROUT_EVAL_OK);
  CHECK(inner.bindings == NULL);
  bench_turn_close(&t);
  bench_close(&b);
}

static void the_newest_binding_of_a_name_is_the_one_found(void) {
  bench b;
  bench_turn t;
  const sprout_binding *bound;
  bench_open(&b);
  bench_turn_for(&b, &t, "get reads the property");
  t.frame.bindings = sprout_bind(&t.frame, "tool", sprout_evaluated_object(bench_id("a")));
  t.frame.bindings = sprout_bind(&t.frame, "tool", sprout_evaluated_object(bench_id("b")));
  bound = expr_binding(&t.frame, "tool");
  CHECK(bound != NULL && sprout_str_is(bound->bound.id, "b"));
  CHECK(expr_binding(&t.frame, "topic") == NULL);
  bench_turn_close(&t);
  bench_close(&b);
}

int main(void) {
  RUN(the_world_is_reached_by_its_name);
  RUN(a_declared_object_is_reached_by_its_path);
  RUN(the_nearest_thing_called_that_is_reached_by_what_each_container_holds);
  RUN(a_name_behind_a_closed_container_is_out_of_range);
  RUN(a_name_that_reaches_nothing_says_so);
  RUN(a_declared_object_destroyed_is_gone_for_good);
  RUN(narrowing_a_name_binds_it_to_what_it_reached);
  RUN(the_newest_binding_of_a_name_is_the_one_found);
  return REPORT();
}
