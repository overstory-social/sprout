/*
 * `send` and `broadcast` (the spec's Events, messages and the bus >
 * Sending). A directed send is queued to its target where the target is live
 * and in the sender's range for that message, and to no one otherwise; a
 * broadcast walks the sender's range for the message, nearest first, and is
 * queued to everything the walk reaches but the sender itself and a container
 * outward that refuses, which the walk reaches only as a surface. Nothing is
 * delivered here: the walk is made and the value evaluated when the statement
 * runs, against the tree as it stands then.
 */
#include "stmt.h"

static const char *const ENGINE_MESSAGES[] = {"entered", "left", "moved", "arrived", "departed", "spawned", "tick", "woke"};

/* The library a name written without one is looked up from: a file's world, before its slash. */
static size_t looking_from(const char *library) {
  const char *slash = strchr(library, '/');
  return slash == NULL ? strlen(library) : (size_t)(slash - library);
}

static const sprout_message *message_in(const sprout_world *world, const char *library, size_t length, const char *name) {
  size_t i;
  for (i = 0; i < world->message_count; i++)
    if (strlen(world->messages[i].library) == length && strncmp(world->messages[i].library, library, length) == 0 &&
        strcmp(world->messages[i].name, name) == 0)
      return &world->messages[i];
  return NULL;
}

/* The message a send names, reached from the library that wrote the body; NULL where it is absent at load. */
static sprout_eval_status declared_message(const sprout_frame *frame, const sprout_node *statement,
                                           const sprout_message **out) {
  const char *name = expr_ident(statement, "message");
  size_t i;
  *out = NULL;
  for (i = 0; i < sizeof ENGINE_MESSAGES / sizeof *ENGINE_MESSAGES; i++)
    if (strcmp(ENGINE_MESSAGES[i], name) == 0) {
      expr_text text = expr_text_begin(frame);
      expr_put(&text, "`:");
      expr_put(&text, name);
      expr_put(&text, "` is the engine's own, and reached a send; the checker refuses it.");
      frame->fault->name = "Error";
      return SPROUT_EVAL_ENGINE;
    }
  *out = message_in(frame->world, frame->library, looking_from(frame->library), name);
  if (*out == NULL) *out = message_in(frame->world, "sprout", 6, name);
  return SPROUT_EVAL_OK;
}

const char *stmt_message_key(const sprout_exec *x, const sprout_message *declared) {
  size_t library = strlen(declared->library), name = strlen(declared->name);
  char *key = (char *)sprout_arena_take(x->turn, library + 1 + name + 1);
  if (key == NULL) return NULL;
  memcpy(key, declared->library, library);
  key[library] = '.';
  memcpy(key + library + 1, declared->name, name);
  return key;
}

/* What a send carries, where it carries anything. */
static sprout_eval_status carried(const sprout_frame *frame, const sprout_node *statement, sprout_send *send) {
  const sprout_node *value = sprout_node_get(statement, "value");
  sprout_evaluated evaluated;
  if (value == NULL || value->kind == SPROUT_NODE_NULL) return SPROUT_EVAL_OK;
  EXPR_NEED(sprout_eval(frame, value, &evaluated));
  EXPR_NEED(expr_as_value(frame, &evaluated, &send->value));
  send->has_value = true;
  return SPROUT_EVAL_OK;
}

sprout_eval_status stmt_send(sprout_run *run, const sprout_frame *frame, const sprout_node *statement) {
  sprout_str target;
  bool found, reached = false;
  const sprout_message *declared;
  const char *key;
  sprout_send send;
  EXPR_NEED(stmt_acting(run, frame, "`send`"));
  EXPR_NEED(stmt_target_at(frame, sprout_node_get(statement, "target"), &target, &found));
  EXPR_NEED(declared_message(frame, statement, &declared));
  if (declared == NULL) return SPROUT_EVAL_OK;
  memset(&send, 0, sizeof send);
  EXPR_NEED(carried(frame, statement, &send));
  if (!found || !expr_live(frame, target)) return SPROUT_EVAL_OK;
  key = stmt_message_key(run->x, declared);
  if (key == NULL) return SPROUT_EVAL_NO_MEMORY;
  EXPR_NEED(expr_reaches(frame, frame->self, target, key, &reached));
  if (!reached) return SPROUT_EVAL_OK;
  send.message = SPROUT_MSG_AUTHORED;
  send.recipient = target;
  send.has_from = true;
  send.from = frame->self;
  send.declared = declared;
  return sprout_exec_queue(run->x, &send);
}

sprout_eval_status stmt_broadcast(sprout_run *run, const sprout_frame *frame, const sprout_node *statement) {
  const sprout_message *declared;
  const char *key;
  sprout_send send;
  const sprout_reached *walked;
  size_t count, i;
  EXPR_NEED(stmt_acting(run, frame, "`broadcast`"));
  EXPR_NEED(declared_message(frame, statement, &declared));
  if (declared == NULL) return SPROUT_EVAL_OK;
  memset(&send, 0, sizeof send);
  EXPR_NEED(carried(frame, statement, &send));
  key = stmt_message_key(run->x, declared);
  if (key == NULL) return SPROUT_EVAL_NO_MEMORY;
  EXPR_NEED(sprout_range_of(frame, frame->self, key, &walked, &count));
  send.message = SPROUT_MSG_AUTHORED;
  send.has_from = true;
  send.from = frame->self;
  send.declared = declared;
  for (i = 0; i < count; i++) {
    if (walked[i].via != SPROUT_VIA_HELD && walked[i].via != SPROUT_VIA_PASSED) continue;
    send.recipient = walked[i].node;
    EXPR_NEED(sprout_exec_queue(run->x, &send));
  }
  return SPROUT_EVAL_OK;
}
