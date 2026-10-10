/*
 * Running a body's block (the spec's Verbs > The two passes, Moving something,
 * Acting, Links; Properties; The world model > Spawning, Destroying; Time >
 * Wakes; Limits > Runtime budgets). One runner in two modes: a guard decides,
 * reading and ending in `allow`, in `refuse` or at its end, and a handler or a
 * `do` acts. Every statement executed is one step and every expression node
 * one more. A statement the checker keeps out of the mode a body runs in
 * reaching it is the engine's defect, reported as an engine error.
 */
#include <string.h>

#include "stmt/stmt.h"

void sprout_exec_begin(sprout_exec *x, const sprout_world *world, sprout_draft *draft, sprout_arena *turn,
                       sprout_meter *meter, sprout_draws *draws, sprout_eval_fault *fault, uint64_t instant) {
  memset(x, 0, sizeof *x);
  x->world = world;
  x->draft = draft;
  x->turn = turn;
  x->meter = meter;
  x->draws = draws;
  x->fault = fault;
  x->instant = instant;
  x->depth = 1;
  x->reading = sprout_run_reading;
}

sprout_frame sprout_exec_frame(const sprout_exec *x, sprout_str self, const char *library,
                               const sprout_binding *bindings) {
  sprout_frame frame;
  memset(&frame, 0, sizeof frame);
  frame.world = x->world;
  frame.draft = x->draft;
  frame.turn = x->turn;
  frame.meter = x->meter;
  frame.draws = x->draws;
  frame.self = self;
  frame.library = library;
  frame.bindings = bindings;
  frame.fault = x->fault;
  return frame;
}

void *sprout_exec_grow(sprout_arena *arena, void **items, size_t *count, size_t *capacity, size_t size) {
  if (*count == *capacity) {
    size_t wanted = *capacity == 0 ? 8 : *capacity * 2;
    char *bigger = (char *)sprout_arena_take(arena, wanted * size);
    if (bigger == NULL) return NULL;
    if (*count > 0) memcpy(bigger, *items, *count * size);
    *items = bigger;
    *capacity = wanted;
  }
  return (char *)*items + (*count)++ * size;
}

sprout_eval_status stmt_acting(const sprout_run *run, const sprout_frame *frame, const char *what) {
  expr_text text;
  if (run->mode == SPROUT_BODY_ACT) return SPROUT_EVAL_OK;
  text = expr_text_begin(frame);
  expr_put(&text, what);
  expr_put(&text, " reached a body that decides, which only reads; the checker refuses it.");
  frame->fault->name = "Error";
  return SPROUT_EVAL_ENGINE;
}

sprout_eval_status stmt_deciding(const sprout_run *run, const sprout_frame *frame, const char *what) {
  expr_text text;
  if (run->mode == SPROUT_BODY_DECIDE) return SPROUT_EVAL_OK;
  text = expr_text_begin(frame);
  expr_put(&text, what);
  expr_put(&text, " reached a `do`, which acts once the deciding is done; the checker refuses it.");
  frame->fault->name = "Error";
  return SPROUT_EVAL_ENGINE;
}

/* `wake in <n> <unit>`, as the seconds it asks to wait. */
static sprout_eval_status wake_statement(sprout_run *run, const sprout_frame *frame, const sprout_node *node) {
  const sprout_node *count = sprout_node_get(sprout_node_get(node, "count"), "value");
  const char *unit = sprout_node_text(node, "unit");
  double seconds;
  EXPR_NEED(stmt_acting(run, frame, "`wake`"));
  if (count == NULL || unit == NULL) return expr_unchecked(frame, "a `wake` with no count");
  seconds = count->number * (strcmp(unit, "hours") == 0 ? 3600 : strcmp(unit, "minutes") == 0 ? 60 : 1);
  return sprout_wake_ask(run->x, frame, (uint64_t)seconds);
}

/* A `let`: the value, or the new instance of a `spawn`, bound for the rest of the block. */
static sprout_eval_status let_statement(sprout_run *run, sprout_frame *scope, const sprout_node *node) {
  const sprout_node *value = sprout_node_get(node, "value");
  const char *name = expr_ident(node, "name");
  sprout_evaluated bound;
  const sprout_binding *added;
  if (sprout_node_is(sprout_node_get(value, "kind"), "spawn")) {
    sprout_str id;
    EXPR_NEED(stmt_acting(run, scope, "`let ... = spawn`"));
    EXPR_NEED(stmt_spawn(run, scope, value, &id));
    bound = sprout_evaluated_object(id);
  } else {
    EXPR_NEED(sprout_eval(scope, value, &bound));
  }
  added = sprout_bind(scope, name, bound);
  if (added == NULL) return SPROUT_EVAL_NO_MEMORY;
  scope->bindings = added;
  return SPROUT_EVAL_OK;
}

/*
 * An `if` and each `else if` after it, as the chain it is; each link tested
 * is a step. A condition that narrows a name binds it, for the branch it
 * guards, to what it reaches now.
 */
static sprout_eval_status if_statement(sprout_run *run, const sprout_frame *scope, const sprout_node *node,
                                       sprout_ended *ended) {
  const sprout_node *link = node;
  for (;;) {
    bool taken;
    sprout_frame inner;
    const sprout_node *otherwise;
    EXPR_NEED(sprout_eval_branch(scope, sprout_node_get(link, "condition"), &taken, &inner));
    if (taken) return stmt_block(run, &inner, sprout_node_get(link, "then"), ended);
    otherwise = sprout_node_get(link, "otherwise");
    if (otherwise == NULL || otherwise->kind == SPROUT_NODE_NULL) return SPROUT_EVAL_OK;
    if (sprout_node_is(sprout_node_get(otherwise, "kind"), "block")) return stmt_block(run, scope, otherwise, ended);
    EXPR_NEED(expr_spend(scope));
    link = otherwise;
  }
}

/* One statement, one step; a `let` adds to the scope, which is its block's. */
static sprout_eval_status statement(sprout_run *run, sprout_frame *scope, const sprout_node *node,
                                    sprout_ended *ended) {
  const char *kind = sprout_node_text(node, "kind");
  sprout_str id;
  EXPR_NEED(expr_spend(scope));
  if (kind == NULL) return expr_unchecked(scope, "a statement with no kind");
  if (strcmp(kind, "let") == 0) return let_statement(run, scope, node);
  if (strcmp(kind, "if") == 0) return if_statement(run, scope, node, ended);
  if (strcmp(kind, "each") == 0) return stmt_each(run, scope, node, ended);
  if (strcmp(kind, "allow") == 0) {
    EXPR_NEED(stmt_deciding(run, scope, "`allow`"));
    ended->how = SPROUT_END_ALLOW;
    return SPROUT_EVAL_OK;
  }
  if (strcmp(kind, "refuse") == 0) {
    EXPR_NEED(stmt_deciding(run, scope, "`refuse`"));
    ended->how = SPROUT_END_REFUSE;
    stmt_speech_of(scope, node, &ended->refused);
    return SPROUT_EVAL_OK;
  }
  if (strcmp(kind, "spawn") == 0) {
    EXPR_NEED(stmt_acting(run, scope, "`spawn`"));
    return stmt_spawn(run, scope, node, &id);
  }
  if (strcmp(kind, "destroy") == 0) return stmt_destroy(run, scope, node);
  if (strcmp(kind, "move") == 0) return stmt_move(run, scope, node);
  if (strcmp(kind, "connect") == 0) return stmt_connect(run, scope, node);
  if (strcmp(kind, "act") == 0) return stmt_act(run, scope, node);
  if (strcmp(kind, "send") == 0) return stmt_send(run, scope, node);
  if (strcmp(kind, "broadcast") == 0) return stmt_broadcast(run, scope, node);
  if (strcmp(kind, "wake") == 0) return wake_statement(run, scope, node);
  if (strcmp(kind, "cancel-wakes") == 0) {
    EXPR_NEED(stmt_acting(run, scope, "`cancel wakes`"));
    return sprout_wake_cancel(run->x, scope);
  }
  if (strcmp(kind, "say") == 0) return stmt_say(run, scope, node);
  if (strcmp(kind, "tell") == 0) return stmt_tell(run, scope, node);
  if (strcmp(kind, "text") == 0)
    return expr_engine(scope,
                       "`text` reached a body, and only a `describe` gives words so; the checker refuses it.");
  if (strcmp(kind, "expression-statement") == 0) return stmt_write(run, scope, node);
  if (strcmp(kind, "extension-statement") == 0) return stmt_extension(run, scope, node);
  return expr_unchecked(scope, "a statement this runtime does not know");
}

sprout_eval_status stmt_block(sprout_run *run, const sprout_frame *outer, const sprout_node *block,
                              sprout_ended *ended) {
  sprout_frame scope = *outer;
  const sprout_node *statements = sprout_node_get(block, "statements");
  size_t i;
  for (i = 0; statements != NULL && i < statements->count; i++) {
    EXPR_NEED(statement(run, &scope, statements->items[i], ended));
    if (ended->how != SPROUT_END_BODY || run->stopped != SPROUT_RUNNING) return SPROUT_EVAL_OK;
  }
  return SPROUT_EVAL_OK;
}

/* What a body asked for as it ended: `self` destroyed, or marked to be once the queue is empty. */
static sprout_eval_status ending(sprout_exec *x, const sprout_run *run, const sprout_frame *frame) {
  if (run->destroying && run->stopped != SPROUT_STOPPED_GONE) return stmt_remove(x, frame, frame->self);
  if (run->finally && run->stopped != SPROUT_STOPPED_GONE) {
    sprout_str *slot = (sprout_str *)sprout_exec_grow(x->turn, (void **)&x->marked, &x->marked_count,
                                                      &x->marked_capacity, sizeof *x->marked);
    if (slot == NULL) return SPROUT_EVAL_NO_MEMORY;
    *slot = frame->self;
  }
  return SPROUT_EVAL_OK;
}

sprout_eval_status sprout_exec_body(sprout_exec *x, const sprout_node *block, const sprout_frame *frame,
                                    sprout_body_mode mode, sprout_ended *ended) {
  sprout_run run;
  sprout_eval_status status;
  size_t owed_from = x->owed_count, i;
  memset(&run, 0, sizeof run);
  memset(ended, 0, sizeof *ended);
  run.x = x;
  run.mode = mode;
  status = stmt_block(&run, frame, block, ended);
  if (status == SPROUT_EVAL_OK) status = ending(x, &run, frame);
  /* A description a move owes is read once the lines the body said are said. */
  for (i = owed_from; i < x->owed_count; i++)
    if (x->owed[i].after == SIZE_MAX) x->owed[i].after = x->effect_count;
  return status;
}
