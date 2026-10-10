/*
 * Making and unmaking instances from a body (the spec's The world model >
 * Spawning, Destroying; Limits > Runtime budgets). A `spawn` makes an
 * instance of a declared kind in a container in range, with everything its
 * kinds give it (`sprout_spawn`), and tells the world: `:entered` to the
 * container and `:spawned` to the new instance, queued for the bus. A
 * `destroy self` takes effect where the body that ran it ends and removes the
 * object with everything it held; a person is never destroyed.
 */
#include "stmt.h"

/* The kind a `spawn` names, as the library that wrote the body names it; a kind absent at load is named for the fault. */
static sprout_eval_status kind_written(const sprout_frame *frame, const sprout_node *written, const char **qualified) {
  const sprout_kind_def *kind = expr_kind_named(frame, written);
  const sprout_node *library = sprout_node_get(written, "library");
  const char *library_text = library == NULL || library->kind == SPROUT_NODE_NULL ? frame->library
                                                                                  : sprout_node_text(library, "text");
  const char *name = expr_ident(written, "name");
  char *joined;
  size_t library_length;
  if (kind != NULL) {
    *qualified = kind->qualified;
    return SPROUT_EVAL_OK;
  }
  library_length = strlen(library_text);
  joined = (char *)sprout_arena_take(frame->turn, library_length + 1 + strlen(name) + 1);
  if (joined == NULL) return SPROUT_EVAL_NO_MEMORY;
  memcpy(joined, library_text, library_length);
  joined[library_length] = '.';
  memcpy(joined + library_length + 1, name, strlen(name));
  *qualified = joined;
  return SPROUT_EVAL_OK;
}

sprout_eval_status stmt_spawn(sprout_run *run, const sprout_frame *frame, const sprout_node *statement, sprout_str *id) {
  const char *kind;
  sprout_str container;
  sprout_spawned made;
  sprout_send send;
  EXPR_NEED(kind_written(frame, sprout_node_get(statement, "spawned"), &kind));
  EXPR_NEED(stmt_object_at(frame, sprout_node_get(statement, "container"), &container));
  EXPR_NEED(sprout_spawn(frame, kind, container, &made));
  memset(&send, 0, sizeof send);
  send.message = SPROUT_MSG_ENTERED;
  send.recipient = container;
  send.item = made.id;
  send.has_from = true;
  send.from = frame->self;
  EXPR_NEED(sprout_exec_queue(run->x, &send));
  memset(&send, 0, sizeof send);
  send.message = SPROUT_MSG_SPAWNED;
  send.recipient = made.id;
  send.has_from = true;
  send.from = frame->self;
  EXPR_NEED(sprout_exec_queue(run->x, &send));
  *id = made.id;
  return SPROUT_EVAL_OK;
}

sprout_eval_status stmt_destroy(sprout_run *run, const sprout_frame *frame, const sprout_node *statement) {
  const sprout_node *after = sprout_node_get(statement, "finally");
  EXPR_NEED(stmt_acting(run, frame, "`destroy`"));
  if (after != NULL && after->boolean) run->finally = true;
  else run->destroying = true;
  return SPROUT_EVAL_OK;
}

sprout_eval_status stmt_remove(sprout_exec *x, const sprout_frame *frame, sprout_str id) {
  const sprout_stored_instance *instance = expr_instance(frame, id);
  const sprout_str *removed;
  sprout_str *subtree;
  size_t count, i;
  expr_text text;
  if (sprout_str_same(id, x->draft->base->world)) {
    text = expr_text_begin(frame);
    expr_put(&text, "the world cannot be destroyed.");
    return expr_fail(frame, "LifecycleFault");
  }
  if (instance == NULL) {
    text = expr_text_begin(frame);
    expr_put(&text, "`");
    expr_put_str(&text, id);
    expr_put(&text, "` is not an instance in this world.");
    frame->fault->name = "Error";
    return SPROUT_EVAL_ENGINE;
  }
  if (instance->made == SPROUT_MADE_VISITOR) {
    text = expr_text_begin(frame);
    expr_put(&text, "`");
    expr_put_str(&text, id);
    expr_put(&text, "` is a visitor, and a person is never destroyed.");
    return expr_fail(frame, "LifecycleFault");
  }
  if (sprout_draft_subtree(x->draft, id, &subtree, &count) != SPROUT_DRAFT_OK) return SPROUT_EVAL_NO_MEMORY;
  for (i = 0; i < count; i++) {
    const sprout_stored_instance *one = sprout_draft_record(x->draft, subtree[i]);
    if (one == NULL || one->made != SPROUT_MADE_VISITOR) continue;
    text = expr_text_begin(frame);
    expr_put(&text, "`");
    expr_put_str(&text, id);
    expr_put(&text, "` has the visitor `");
    expr_put_str(&text, subtree[i]);
    expr_put(&text, "` inside it, and a person is never destroyed.");
    return expr_fail(frame, "LifecycleFault");
  }
  if (sprout_draft_remove(x->draft, id, &removed, &count) != SPROUT_DRAFT_OK) return SPROUT_EVAL_NO_MEMORY;
  for (i = 0; i < count; i++) {
    sprout_str *slot = (sprout_str *)sprout_exec_grow(x->turn, (void **)&x->destroyed, &x->destroyed_count,
                                                      &x->destroyed_capacity, sizeof *x->destroyed);
    if (slot == NULL) return SPROUT_EVAL_NO_MEMORY;
    *slot = removed[i];
  }
  return SPROUT_EVAL_OK;
}
