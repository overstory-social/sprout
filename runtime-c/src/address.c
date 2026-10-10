/*
 * What an instance is called (see address.h). The default name is the identifier humanised, or, for
 * a spawn, which has none, its kind's name in lower case.
 */
#include "address.h"

#include "expr/expr.h"

const sprout_stored_visitor *sprout_visitor_of(const sprout_draft *draft, sprout_str instance) {
  size_t i;
  for (i = 0; i < draft->visitor_count; i++)
    if (sprout_str_same(draft->visitors[i].instance, instance)) return &draft->visitors[i];
  for (i = 0; i < draft->base->visitor_count; i++) {
    const sprout_stored_visitor *current = sprout_draft_visitor(draft, draft->base->visitors[i].visit);
    if (current != NULL && sprout_str_same(current->instance, instance)) return current;
  }
  return NULL;
}

bool sprout_humanised(sprout_arena *arena, sprout_str text, sprout_str *words) {
  char *copy = sprout_arena_copy(arena, text.bytes, text.length);
  size_t i;
  if (copy == NULL) return false;
  for (i = 0; i < text.length; i++)
    if (copy[i] == '_') copy[i] = ' ';
  words->bytes = copy;
  words->length = text.length;
  return true;
}

static bool is_lower(char c) { return c >= 'a' && c <= 'z'; }
static bool is_upper(char c) { return c >= 'A' && c <= 'Z'; }

/* A kind's name as a name, in lower case: `MazeCell` is "maze cell". */
static bool humanised_kind(sprout_arena *arena, const char *kind, sprout_str *name) {
  size_t length = strlen(kind), i, n = 0;
  char *out = (char *)sprout_arena_take(arena, length * 2 + 1);
  if (out == NULL) return false;
  for (i = 0; i < length; i++) {
    char c = kind[i];
    if (i > 0 && is_upper(c) &&
        (is_lower(kind[i - 1]) || (kind[i - 1] >= '0' && kind[i - 1] <= '9') ||
         (is_upper(kind[i - 1]) && i + 1 < length && is_lower(kind[i + 1]))))
      out[n++] = ' ';
    out[n++] = is_upper(c) ? (char)(c - 'A' + 'a') : c;
  }
  name->bytes = out;
  name->length = n;
  return true;
}

/* The identifier a thing was declared by, or none for a spawn or a visitor. */
static bool identifier_of(const sprout_stored_instance *instance, sprout_str *identifier) {
  size_t i;
  switch (instance->made) {
    case SPROUT_MADE_WORLD:
      *identifier = instance->id;
      return true;
    case SPROUT_MADE_DECLARED:
      for (i = instance->id.length; i > 0; i--)
        if (instance->id.bytes[i - 1] == '.') break;
      identifier->bytes = instance->id.bytes + i;
      identifier->length = instance->id.length - i;
      return true;
    case SPROUT_MADE_GIVEN:
      if (instance->path_count == 0) return false;
      *identifier = instance->path[instance->path_count - 1];
      return true;
    case SPROUT_MADE_VISITOR:
    case SPROUT_MADE_SPAWNED:
      break;
  }
  return false;
}

const sprout_node *sprout_grammar_text(const sprout_kind_def *kind, const char *line) {
  const sprout_node *written = sprout_node_get(sprout_node_get(kind->node, "grammar"), line);
  const sprout_node *value = sprout_node_get(written, "value");
  return value != NULL && value->kind == SPROUT_NODE_STRING ? value : NULL;
}

sprout_eval_status sprout_name_of(const sprout_frame *frame, const sprout_stored_instance *instance, sprout_str *name) {
  const sprout_stored_visitor *visitor =
      instance->made == SPROUT_MADE_VISITOR ? sprout_visitor_of(frame->draft, instance->id) : NULL;
  const sprout_node *written;
  sprout_str identifier;
  if (visitor != NULL) {
    *name = visitor->nickname;
    return SPROUT_EVAL_OK;
  }
  written = sprout_grammar_text(instance->kind, "name");
  if (written != NULL) {
    *name = (sprout_str){written->text, written->length};
    return SPROUT_EVAL_OK;
  }
  if (identifier_of(instance, &identifier)) return sprout_humanised(frame->turn, identifier, name) ? SPROUT_EVAL_OK : SPROUT_EVAL_NO_MEMORY;
  return humanised_kind(frame->turn, instance->kind->name, name) ? SPROUT_EVAL_OK : SPROUT_EVAL_NO_MEMORY;
}
