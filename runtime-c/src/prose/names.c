/*
 * What an object is called when a slot renders it (the spec's Prose > Slots; Names >
 * Addressing and display, Articles, Nicknames). An object renders as its article and its name,
 * as its grammar block and the defaults give them, and as "you" to the reader it is. A visitor is
 * their nickname as the turn leaves it, with no article. The default name is the identifier
 * humanised, or, for a spawn, which has none, its kind's name humanised in lower case; the
 * default article is `a`, or `an` before a vowel. An option renders humanised.
 */
#include "prose/prose.h"

const sprout_stored_visitor *prose_visitor_of(const sprout_draft *draft, sprout_str instance) {
  size_t i;
  for (i = 0; i < draft->visitor_count; i++)
    if (sprout_str_same(draft->visitors[i].instance, instance)) return &draft->visitors[i];
  for (i = 0; i < draft->base->visitor_count; i++) {
    const sprout_stored_visitor *current = sprout_draft_visitor(draft, draft->base->visitors[i].visit);
    if (current != NULL && sprout_str_same(current->instance, instance)) return current;
  }
  return NULL;
}

bool prose_humanised(sprout_arena *arena, sprout_str option, sprout_str *words) {
  char *copy = sprout_arena_copy(arena, option.bytes, option.length);
  size_t i;
  if (copy == NULL) return false;
  for (i = 0; i < option.length; i++)
    if (copy[i] == '_') copy[i] = ' ';
  words->bytes = copy;
  words->length = option.length;
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

/* The `value` of a grammar line the composed kind writes, or NULL. */
static const sprout_node *grammar_line(const sprout_kind_def *kind, const char *line) {
  const sprout_node *written = sprout_node_get(sprout_node_get(kind->node, "grammar"), line);
  const sprout_node *value = sprout_node_get(written, "value");
  return value != NULL && value->kind == SPROUT_NODE_STRING ? value : NULL;
}

static sprout_eval_status joined(const sprout_frame *frame, const char *article, size_t article_length, sprout_str name,
                                 sprout_str *words) {
  size_t gap = article_length > 0 ? article_length + 1 : 0;
  char *out = (char *)sprout_arena_take(frame->turn, gap + name.length + 1);
  if (out == NULL) return SPROUT_EVAL_NO_MEMORY;
  if (gap > 0) {
    memcpy(out, article, article_length);
    out[article_length] = ' ';
  }
  memcpy(out + gap, name.bytes, name.length);
  words->bytes = out;
  words->length = gap + name.length;
  return SPROUT_EVAL_OK;
}

sprout_eval_status prose_object_words(const sprout_frame *frame, sprout_str object, sprout_str reader,
                                      sprout_str *words) {
  const sprout_stored_instance *instance;
  const sprout_stored_visitor *visitor;
  const sprout_node *written;
  sprout_str name, identifier;
  const char *article;
  if (sprout_str_same(object, reader)) {
    *words = (sprout_str){"you", 3};
    return SPROUT_EVAL_OK;
  }
  EXPR_NEED(expr_instance_of(frame, object, &instance));
  visitor = instance->made == SPROUT_MADE_VISITOR ? prose_visitor_of(frame->draft, object) : NULL;
  if (visitor != NULL) {
    *words = visitor->nickname;
    return SPROUT_EVAL_OK;
  }
  written = grammar_line(instance->kind, "name");
  if (written != NULL) name = (sprout_str){written->text, written->length};
  else if (identifier_of(instance, &identifier)) {
    if (!prose_humanised(frame->turn, identifier, &name)) return SPROUT_EVAL_NO_MEMORY;
  } else if (!humanised_kind(frame->turn, instance->kind->name, &name)) return SPROUT_EVAL_NO_MEMORY;
  written = grammar_line(instance->kind, "article");
  if (written != NULL) article = written->text;
  else
    article = name.length > 0 && strchr("aeiouAEIOU", name.bytes[0]) != NULL ? "an" : "a";
  if (strcmp(article, "none") == 0) {
    *words = name;
    return SPROUT_EVAL_OK;
  }
  return joined(frame, article, strlen(article), name, words);
}
