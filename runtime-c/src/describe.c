/*
 * A description, derived (see describe.h). A describe holds exactly what the checker lets it hold:
 * `let`, `if`, `each`, `text` and an extension's statement. Each statement is a step. An extension's
 * statement gives no line of its own, and the C runtime holds no extension to record its effect.
 */
#include "describe.h"

#include <string.h>

#include "exits.h"
#include "stmt/stmt.h"

typedef struct described {
  sprout_str thing;
  sprout_spoken *lines;
  size_t count, capacity;
} described;

/* `frame`'s bindings with `name` bound to `bound` on top. */
static sprout_eval_status bound_with(sprout_frame *frame, const char *name, sprout_evaluated bound) {
  const sprout_binding *added = sprout_bind(frame, name, bound);
  if (added == NULL) return SPROUT_EVAL_NO_MEMORY;
  frame->bindings = added;
  return SPROUT_EVAL_OK;
}

static sprout_eval_status run_block(described *d, const sprout_frame *outer, const sprout_node *block);

/* An `if` and each `else if` after it; each link tested past the first is a step. */
static sprout_eval_status run_if(described *d, const sprout_frame *scope, const sprout_node *statement) {
  const sprout_node *link = statement;
  for (;;) {
    bool taken;
    const sprout_node *otherwise;
    EXPR_NEED(sprout_eval_condition(scope, sprout_node_get(link, "condition"), &taken));
    if (taken) return run_block(d, scope, sprout_node_get(link, "then"));
    otherwise = sprout_node_get(link, "otherwise");
    if (otherwise == NULL || otherwise->kind == SPROUT_NODE_NULL) return SPROUT_EVAL_OK;
    if (sprout_node_is(sprout_node_get(otherwise, "kind"), "block")) return run_block(d, scope, otherwise);
    EXPR_NEED(expr_spend(scope));
    link = otherwise;
  }
}

static sprout_eval_status run_each(described *d, const sprout_frame *scope, const sprout_node *statement) {
  const sprout_str *ids;
  size_t count, i;
  EXPR_NEED(stmt_each_walked(scope, statement, &ids, &count));
  for (i = 0; i < count; i++) {
    sprout_frame inner = *scope;
    EXPR_NEED(expr_spend(scope));
    EXPR_NEED(bound_with(&inner, expr_ident(statement, "variable"), sprout_evaluated_object(ids[i])));
    EXPR_NEED(run_block(d, &inner, sprout_node_get(statement, "body")));
  }
  return SPROUT_EVAL_OK;
}

static sprout_eval_status give_text(described *d, const sprout_frame *scope, const sprout_node *statement) {
  sprout_spoken *slot =
      (sprout_spoken *)sprout_exec_grow(scope->turn, (void **)&d->lines, &d->count, &d->capacity, sizeof *slot);
  if (slot == NULL) return SPROUT_EVAL_NO_MEMORY;
  slot->by = d->thing;
  slot->bindings = scope->bindings;
  stmt_speech_of(scope, statement, &slot->said);
  return SPROUT_EVAL_OK;
}

/* One statement, one step; a `let` adds to the scope, which is its block's. */
static sprout_eval_status run_statement(described *d, sprout_frame *scope, const sprout_node *statement) {
  const char *kind = sprout_node_text(statement, "kind");
  EXPR_NEED(expr_spend(scope));
  if (kind == NULL) return expr_unchecked(scope, "a statement with no kind");
  if (strcmp(kind, "let") == 0) {
    const sprout_node *value = sprout_node_get(statement, "value");
    sprout_evaluated bound;
    if (sprout_node_is(sprout_node_get(value, "kind"), "spawn")) return expr_unchecked(scope, "`spawn` in a `describe`");
    EXPR_NEED(sprout_eval(scope, value, &bound));
    return bound_with(scope, expr_ident(statement, "name"), bound);
  }
  if (strcmp(kind, "if") == 0) return run_if(d, scope, statement);
  if (strcmp(kind, "each") == 0) return run_each(d, scope, statement);
  if (strcmp(kind, "text") == 0) return give_text(d, scope, statement);
  if (strcmp(kind, "extension-statement") == 0) return SPROUT_EVAL_OK;
  return expr_engine(scope, "a statement reached a `describe`, which only reads and gives words; the checker refuses it.");
}

/* A block's statements in order, in a scope of its own: a `let` lives to its `}`. */
static sprout_eval_status run_block(described *d, const sprout_frame *outer, const sprout_node *block) {
  sprout_frame scope = *outer;
  const sprout_node *statements = sprout_node_get(block, "statements");
  size_t i;
  for (i = 0; statements != NULL && i < statements->count; i++)
    EXPR_NEED(run_statement(d, &scope, statements->items[i]));
  return SPROUT_EVAL_OK;
}

/* The line the engine says `name` with, to `actor` in `here`, and the names it renders with. */
static sprout_eval_status engine_line(const sprout_frame *frame, const char *name, sprout_str about, sprout_str here,
                                      sprout_str thing, bool names_thing, sprout_spoken *out) {
  sprout_frame bare = *frame;
  memset(out, 0, sizeof *out);
  sprout_engine_said(frame, name, &about, &here, &out->by, &out->said);
  bare.bindings = NULL;
  if (names_thing) {
    EXPR_NEED(bound_with(&bare, "thing", sprout_evaluated_object(thing)));
  } else {
    EXPR_NEED(bound_with(&bare, "actor", sprout_evaluated_object(about)));
    EXPR_NEED(bound_with(&bare, "here", sprout_evaluated_object(here)));
  }
  out->bindings = bare.bindings;
  return SPROUT_EVAL_OK;
}

sprout_eval_status sprout_describe(const sprout_frame *frame, sprout_str thing, sprout_str actor, const char *seen,
                                   sprout_description *out) {
  const sprout_stored_instance *instance = expr_instance(frame, thing), *standing = expr_instance(frame, actor);
  const sprout_node *describe;
  sprout_str here;
  sprout_frame inside = *frame;
  described d;
  sprout_value seen_value;
  bool lit;
  memset(out, 0, sizeof *out);
  if (instance == NULL) return expr_engine(frame, "a thing is described, and is not an instance.");
  if (standing == NULL || !standing->has_container) return expr_engine(frame, "an away visitor looks at nothing.");
  here = standing->container;
  out->of = thing;
  out->to = actor;
  EXPR_NEED(engine_line(frame, "unremarkable", actor, here, thing, true, &out->unremarkable));

  /* The place someone stands in, unlit, is described by the world's `dark` (the spec's Range > Sight). */
  if (sprout_str_same(thing, here)) {
    EXPR_NEED(sprout_is_lit(frame, here, &lit));
    if (!lit) {
      sprout_spoken *line = (sprout_spoken *)sprout_arena_take(frame->turn, sizeof *line);
      if (line == NULL) return SPROUT_EVAL_NO_MEMORY;
      EXPR_NEED(engine_line(frame, "dark", actor, here, thing, false, line));
      out->line_count = 1;
      out->lines = line;
      return SPROUT_EVAL_OK;
    }
  }
  describe = sprout_node_get(instance->kind->node, "describe");
  if (describe == NULL || describe->kind == SPROUT_NODE_NULL) return SPROUT_EVAL_OK;
  EXPR_NEED(sprout_origin_library(frame, sprout_node_text(describe, "origin"), &inside.library));
  inside.self = thing;
  inside.bindings = NULL;
  if (!sprout_string(frame->turn, seen, strlen(seen), &seen_value)) return SPROUT_EVAL_NO_MEMORY;
  EXPR_NEED(bound_with(&inside, "actor", sprout_evaluated_object(actor)));
  EXPR_NEED(bound_with(&inside, "here", sprout_evaluated_object(here)));
  EXPR_NEED(bound_with(&inside, "seen", sprout_evaluated_value(seen_value)));
  memset(&d, 0, sizeof d);
  d.thing = thing;
  EXPR_NEED(run_block(&d, &inside, sprout_node_get(sprout_node_get(describe, "declaration"), "body")));
  out->line_count = d.count;
  out->lines = d.lines;
  return SPROUT_EVAL_OK;
}
