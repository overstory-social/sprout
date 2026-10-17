/*
 * Reading the expression nodes a cartridge holds (the spec's The compiler >
 * What compiling produces): an expression is an object whose `kind` names
 * what it is, and whose other fields are the nodes it is made of.
 */
#include "expr.h"

/* The kind an expression node's `kind` names, told apart by its first byte before any whole comparison. */
expr_kind expr_kind_of(const sprout_graph *graph, const sprout_node *node) {
  const char *kind = node == NULL ? NULL : sprout_node_text(graph, node, "kind");
  if (kind == NULL) return EXPR_OTHER;
  switch (kind[0]) {
    case 'b':
      if (strcmp(kind, "binary") == 0) return EXPR_BINARY;
      if (strcmp(kind, "binding") == 0) return EXPR_BINDING;
      if (strcmp(kind, "boolean") == 0) return EXPR_BOOLEAN;
      if (strcmp(kind, "bound") == 0) return EXPR_BOUND;
      break;
    case 'c':
      if (strcmp(kind, "call") == 0) return EXPR_CALL;
      break;
    case 'f':
      if (strcmp(kind, "free-call") == 0) return EXPR_FREE_CALL;
      break;
    case 'i':
      if (strcmp(kind, "integer") == 0) return EXPR_INTEGER;
      break;
    case 'k':
      if (strcmp(kind, "kind-expr") == 0) return EXPR_KIND;
      break;
    case 'm':
      if (strcmp(kind, "member") == 0) return EXPR_MEMBER;
      break;
    case 's':
      if (strcmp(kind, "string") == 0) return EXPR_STRING;
      if (strcmp(kind, "symbol-expr") == 0) return EXPR_SYMBOL;
      break;
    case 'u':
      if (strcmp(kind, "unary") == 0) return EXPR_UNARY;
      break;
    default:
      break;
  }
  return EXPR_OTHER;
}

bool expr_is_and(const sprout_graph *graph, const sprout_node *node) {
  return expr_kind_of(graph, node) == EXPR_BINARY && sprout_node_is(graph, sprout_node_get(graph, node, "operator"), "&&");
}

size_t expr_argument_count(const sprout_graph *graph, const sprout_node *call) {
  const sprout_node *arguments = sprout_node_get(graph, call, "arguments");
  return arguments == NULL ? 0 : arguments->count;
}

const sprout_node *expr_argument(const sprout_graph *graph, const sprout_node *call, size_t index) {
  return sprout_item(graph, sprout_node_get(graph, call, "arguments"), index);
}

sprout_str expr_str(const char *text) {
  sprout_str str;
  str.bytes = text;
  str.length = strlen(text);
  return str;
}

/* `a.b.c` for a chain of members on a binding; *out is NULL where the chain is not written on a name. */
sprout_eval_status expr_written_members(const sprout_frame *frame, const sprout_node *member, const char **out) {
  size_t length = 0, steps = 0, i;
  const sprout_node *node = member;
  char *text, *end;
  *out = NULL;
  for (; expr_kind_of(frame->graph, node) == EXPR_MEMBER; node = sprout_node_get(frame->graph, node, "receiver")) {
    length += strlen(sprout_node_name(frame->graph, node, "member")) + 1;
    steps++;
  }
  if (expr_kind_of(frame->graph, node) != EXPR_BINDING) return SPROUT_EVAL_OK;
  length += strlen(sprout_node_name(frame->graph, node, "name"));
  text = (char *)sprout_arena_take(frame->turn, length + 1);
  if (text == NULL) return SPROUT_EVAL_NO_MEMORY;
  /* Written from the end: the last member first, the binding's name last. */
  end = text + length;
  *end = '\0';
  for (node = member, i = 0; i < steps; i++, node = sprout_node_get(frame->graph, node, "receiver")) {
    const char *name = sprout_node_name(frame->graph, node, "member");
    size_t n = strlen(name);
    end -= n;
    memcpy(end, name, n);
    *--end = '.';
  }
  {
    const char *name = sprout_node_name(frame->graph, node, "name");
    end -= strlen(name);
    memcpy(end, name, strlen(name));
  }
  *out = text;
  return SPROUT_EVAL_OK;
}

/* The part of a library before a file's slash: `shop/rooms/cellar` reads the world's own names. */
static size_t looking_from(const char *library) {
  const char *slash = strchr(library, '/');
  return slash == NULL ? strlen(library) : (size_t)(slash - library);
}

const sprout_kind_def *expr_kind_named(const sprout_frame *frame, const sprout_node *written) {
  const char *name = sprout_node_name(frame->graph, written, "name");
  const sprout_node *library = sprout_node_get(frame->graph, written, "library");
  if (name == NULL) return NULL;
  if (library != NULL && library->kind != SPROUT_NODE_NULL) {
    const char *text = sprout_name(frame->graph, library);
    return text == NULL ? NULL : sprout_world_kind_named(frame->world, text, strlen(text), name);
  }
  {
    const sprout_kind_def *own = sprout_world_kind_named(frame->world, frame->library, looking_from(frame->library), name);
    return own != NULL ? own : sprout_world_kind_named(frame->world, "sprout", 6, name);
  }
}
