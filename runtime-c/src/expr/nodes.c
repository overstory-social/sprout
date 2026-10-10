/*
 * Reading the expression nodes a cartridge holds (the spec's The compiler >
 * What compiling produces): an expression is an object whose `kind` names
 * what it is, and whose other fields are the nodes it is made of.
 */
#include "expr.h"

expr_kind expr_kind_of(const sprout_node *node) {
  static const struct {
    const char *name;
    expr_kind kind;
  } kinds[] = {{"boolean", EXPR_BOOLEAN}, {"integer", EXPR_INTEGER},     {"string", EXPR_STRING},
               {"binding", EXPR_BINDING}, {"symbol-expr", EXPR_SYMBOL},  {"kind-expr", EXPR_KIND},
               {"unary", EXPR_UNARY},     {"binary", EXPR_BINARY},       {"member", EXPR_MEMBER},
               {"call", EXPR_CALL},       {"free-call", EXPR_FREE_CALL}, {"bound", EXPR_BOUND}};
  const char *kind = node == NULL ? NULL : sprout_node_text(node, "kind");
  size_t i;
  if (kind == NULL) return EXPR_OTHER;
  for (i = 0; i < sizeof kinds / sizeof kinds[0]; i++)
    if (strcmp(kinds[i].name, kind) == 0) return kinds[i].kind;
  return EXPR_OTHER;
}

const char *expr_ident(const sprout_node *node, const char *field) {
  return sprout_node_text(sprout_node_get(node, field), "text");
}

bool expr_is_and(const sprout_node *node) {
  return expr_kind_of(node) == EXPR_BINARY && sprout_node_is(sprout_node_get(node, "operator"), "&&");
}

size_t expr_argument_count(const sprout_node *call) {
  const sprout_node *arguments = sprout_node_get(call, "arguments");
  return arguments == NULL ? 0 : arguments->count;
}

const sprout_node *expr_argument(const sprout_node *call, size_t index) {
  return sprout_node_get(call, "arguments")->items[index];
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
  for (; expr_kind_of(node) == EXPR_MEMBER; node = sprout_node_get(node, "receiver")) {
    length += strlen(expr_ident(node, "member")) + 1;
    steps++;
  }
  if (expr_kind_of(node) != EXPR_BINDING) return SPROUT_EVAL_OK;
  length += strlen(expr_ident(node, "name"));
  text = (char *)sprout_arena_take(frame->turn, length + 1);
  if (text == NULL) return SPROUT_EVAL_NO_MEMORY;
  /* Written from the end: the last member first, the binding's name last. */
  end = text + length;
  *end = '\0';
  for (node = member, i = 0; i < steps; i++, node = sprout_node_get(node, "receiver")) {
    const char *name = expr_ident(node, "member");
    size_t n = strlen(name);
    end -= n;
    memcpy(end, name, n);
    *--end = '.';
  }
  {
    const char *name = expr_ident(node, "name");
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

static const sprout_kind_def *find_kind(const sprout_world *world, const char *library, size_t library_length,
                                        const char *name) {
  size_t i;
  for (i = 0; i < world->kind_count; i++) {
    const sprout_kind_def *kind = world->kinds[i];
    if (strlen(kind->library) == library_length && memcmp(kind->library, library, library_length) == 0 &&
        strcmp(kind->name, name) == 0)
      return kind;
  }
  return NULL;
}

const sprout_kind_def *expr_kind_named(const sprout_frame *frame, const sprout_node *written) {
  const char *name = expr_ident(written, "name");
  const sprout_node *library = sprout_node_get(written, "library");
  if (name == NULL) return NULL;
  if (library != NULL && library->kind != SPROUT_NODE_NULL) {
    const char *text = sprout_node_text(library, "text");
    return text == NULL ? NULL : find_kind(frame->world, text, strlen(text), name);
  }
  {
    const sprout_kind_def *own = find_kind(frame->world, frame->library, looking_from(frame->library), name);
    return own != NULL ? own : find_kind(frame->world, "sprout", 6, name);
  }
}
