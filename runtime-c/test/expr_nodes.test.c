/*
 * Tests for src/expr/nodes.c: each expression node of the bench cartridge is
 * told for what it is, a call's arguments are counted, a member chain written
 * on a name reads as the author wrote it, and a kind is found from the
 * library that wrote the body.
 */
#include "eval_fixture.h"
#include "expr/expr.h"

static void each_kind_of_expression_is_told_for_what_it_is(void) {
  static const struct {
    const char *name;
    expr_kind kind;
  } roots[] = {{"a boolean literal", EXPR_BOOLEAN},
               {"an integer literal", EXPR_INTEGER},
               {"a string literal", EXPR_STRING},
               {"negates a property", EXPR_UNARY},
               {"adds and subtracts", EXPR_BINARY},
               {"a list counts its elements", EXPR_MEMBER},
               {"get reads the property", EXPR_CALL},
               {"chance draws true from the seed", EXPR_FREE_CALL},
               {"bound asks of a name given", EXPR_BOUND}};
  bench b;
  size_t i;
  bench_open(&b);
  for (i = 0; i < sizeof roots / sizeof roots[0]; i++) CHECK_INT(expr_kind_of(bench_expr(&b, roots[i].name)), roots[i].kind);
  /* `self.get(:fill)`: a binding on the left, a symbol and no kind in the argument. */
  CHECK_INT(expr_kind_of(sprout_node_get(bench_expr(&b, "get reads the property"), "receiver")), EXPR_BINDING);
  CHECK_INT(expr_kind_of(expr_argument(bench_expr(&b, "get reads the property"), 0)), EXPR_SYMBOL);
  CHECK_INT(expr_kind_of(expr_argument(bench_expr(&b, "is asks whether an instance composes a kind"), 0)), EXPR_KIND);
  CHECK_INT(expr_kind_of(NULL), EXPR_OTHER);
  CHECK_INT(expr_kind_of(sprout_node_get(bench_expr(&b, "get reads the property"), "method")), EXPR_OTHER);
  bench_close(&b);
  CHECK_INT(b.heap.pages, 0);
}

static void an_and_is_told_from_the_other_binaries(void) {
  bench b;
  bench_open(&b);
  CHECK(expr_is_and(bench_expr(&b, "&& narrows the name on its right")));
  CHECK(!expr_is_and(bench_expr(&b, "compares below")));
  CHECK(!expr_is_and(bench_expr(&b, "get reads the property")));
  bench_close(&b);
}

static void a_calls_arguments_are_counted_and_read_in_order(void) {
  bench b;
  const sprout_node *sees;
  bench_open(&b);
  sees = bench_expr(&b, "sees finds a lit light");
  CHECK_INT(expr_argument_count(sees), 2);
  CHECK_STR(expr_ident(expr_argument(sees, 0), "name"), "LightSource");
  CHECK_STR(expr_ident(expr_argument(sees, 1), "name"), "lit");
  CHECK_INT(expr_argument_count(bench_expr(&b, "get reads the property")), 1);
  CHECK_INT(expr_argument_count(bench_expr(&b, "a boolean literal")), 0);
  bench_close(&b);
}

static void a_member_chain_on_a_name_is_written_as_the_author_wrote_it(void) {
  bench b;
  bench_turn t;
  const sprout_node *and_node, *is_call, *path;
  const char *written = "unset";
  bench_open(&b);
  bench_turn_for(&b, &t, "&& narrows a dotted path");
  and_node = bench_expr(&b, "&& narrows a dotted path");
  is_call = sprout_node_get(and_node, "left");
  path = sprout_node_get(is_call, "receiver");
  CHECK_INT(expr_kind_of(path), EXPR_MEMBER);
  CHECK_INT(expr_written_members(&t.frame, path, &written), SPROUT_EVAL_OK);
  CHECK_STR(written, "shelf.cup");
  /* A member read on something that is not a name is not a path. */
  CHECK_INT(expr_written_members(&t.frame, bench_expr(&b, "a list counts its elements"), &written), SPROUT_EVAL_OK);
  CHECK(written == NULL);
  bench_turn_close(&t);
  bench_close(&b);
}

static void a_kind_is_found_from_the_library_that_wrote_the_body(void) {
  bench b;
  bench_turn t;
  const sprout_node *kind_expr;
  const sprout_kind_def *found;
  bench_open(&b);
  bench_turn_for(&b, &t, "is asks whether an instance composes a kind");
  kind_expr = expr_argument(bench_expr(&b, "is asks whether an instance composes a kind"), 0);
  found = expr_kind_named(&t.frame, kind_expr);
  CHECK(found != NULL && strcmp(found->qualified, "eval_bench.Jar") == 0);
  /* A name written from the world's file reads the world's own names, as `shop/rooms/cellar` reads `shop`'s. */
  t.frame.library = "eval_bench/rooms/cellar";
  found = expr_kind_named(&t.frame, kind_expr);
  CHECK(found != NULL && strcmp(found->qualified, "eval_bench.Jar") == 0);
  /* From a library that declares no such kind, and the standard library does not either, there is none. */
  t.frame.library = "elsewhere";
  CHECK(expr_kind_named(&t.frame, kind_expr) == NULL);
  /* A kind written with its library, `sprout.LightSource`, is found whatever library wrote the body. */
  kind_expr = expr_argument(bench_expr(&b, "sees finds a lit light"), 0);
  CHECK(expr_kind_named(&t.frame, kind_expr) != NULL);
  bench_turn_close(&t);
  bench_close(&b);
}

static void a_string_is_a_pointer_and_its_length(void) {
  sprout_str str = expr_str("shop#4");
  CHECK_BYTES(str.bytes, str.length, "shop#4");
}

int main(void) {
  RUN(each_kind_of_expression_is_told_for_what_it_is);
  RUN(an_and_is_told_from_the_other_binaries);
  RUN(a_calls_arguments_are_counted_and_read_in_order);
  RUN(a_member_chain_on_a_name_is_written_as_the_author_wrote_it);
  RUN(a_kind_is_found_from_the_library_that_wrote_the_body);
  RUN(a_string_is_a_pointer_and_its_length);
  return REPORT();
}
