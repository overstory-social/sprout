/*
 * The words a noun may be made of anywhere in the world (the spec's Parsing > When nothing matches): every word some
 * thing in the world is named by, whatever its reach, or was or could be, destroyed or not yet spawned; every kind's
 * name; and the parser's own words a noun may hold. A noun that names nothing in reach is `not_here` only where each
 * of its words is one of these, and otherwise the line is `unknown`. What the bundle writes costs nothing, since it
 * is read once for the bundle; each instance in the world's tree is a step, the world first.
 */
#include <string.h>

#include "../address.h"
#include "../expr/expr.h"
#include "../typed.h"
#include "parse.h"

/* Gathering words into a vocabulary, in `arena`. */
typedef struct gathering {
  sprout_arena *arena;
  sprout_str *words;
  size_t count, capacity;
} gathering;

static sprout_eval_status add_word(gathering *g, sprout_str word) {
  sprout_str *slot = (sprout_str *)sprout_exec_grow(g->arena, (void **)&g->words, &g->count, &g->capacity, sizeof *slot);
  if (slot == NULL) return SPROUT_EVAL_NO_MEMORY;
  *slot = word;
  return SPROUT_EVAL_OK;
}

/* Each typed word of `text`. */
static sprout_eval_status add_text(gathering *g, sprout_str text) {
  sprout_str *words;
  size_t count, i;
  if (typed_words(g->arena, text, &words, &count) != SPROUT_OK) return SPROUT_EVAL_NO_MEMORY;
  for (i = 0; i < count; i++) EXPR_NEED(add_word(g, words[i]));
  return SPROUT_EVAL_OK;
}

/* An identifier, `_` read as a space. */
static sprout_eval_status add_identifier(gathering *g, const char *identifier) {
  sprout_str words;
  if (!sprout_humanised(g->arena, (sprout_str){identifier, strlen(identifier)}, &words)) return SPROUT_EVAL_NO_MEMORY;
  return add_text(g, words);
}

/* Each word of the names of the kinds in `order`, by qualified name, which `except` reads. */
static sprout_eval_status add_kinds(gathering *g, const char *const *order, size_t count) {
  size_t i;
  for (i = 0; i < count; i++) {
    const char *dot = strrchr(order[i], '.');
    sprout_str name;
    if (!sprout_humanised_kind(g->arena, dot == NULL ? order[i] : dot + 1, &name)) return SPROUT_EVAL_NO_MEMORY;
    EXPR_NEED(add_text(g, name));
  }
  return SPROUT_EVAL_OK;
}

/* The grammar `kind` writes: its name, nouns and adjectives, with the names of the kinds it is made of. */
static sprout_eval_status add_grammar(gathering *g, const sprout_graph *graph, const sprout_kind_def *kind) {
  static const char *const lists[] = {"nouns", "adjectives"};
  const sprout_node *grammar, *name;
  size_t l, i;
  if (kind == NULL) return SPROUT_EVAL_OK;
  name = sprout_grammar_text(graph, kind, "name");
  if (name != NULL) EXPR_NEED(add_text(g, (sprout_str){sprout_text(graph, name), sprout_text_length(graph, name)}));
  grammar = sprout_node_get(graph, kind->node, "grammar");
  for (l = 0; l < 2; l++) {
    const sprout_node *list = sprout_node_get(graph, grammar, lists[l]);
    if (list == NULL || list->kind != SPROUT_NODE_ARRAY) continue;
    for (i = 0; i < list->count; i++) {
      const sprout_node *one = sprout_item(graph, list, i);
      if (one->kind == SPROUT_NODE_STRING)
        EXPR_NEED(add_text(g, (sprout_str){sprout_text(graph, one), sprout_text_length(graph, one)}));
    }
  }
  return add_kinds(g, kind->order, kind->order_count);
}

/* What a kind's body gives, and what that holds, each by its identifier and its kind's grammar. */
static sprout_eval_status add_given(gathering *g, const sprout_graph *graph, const sprout_content *given, size_t count) {
  size_t i;
  for (i = 0; i < count; i++) {
    if (given[i].path_count > 0) EXPR_NEED(add_identifier(g, given[i].path[given[i].path_count - 1]));
    EXPR_NEED(add_grammar(g, graph, given[i].kind));
    EXPR_NEED(add_given(g, graph, given[i].held, given[i].held_count));
  }
  return SPROUT_EVAL_OK;
}

/* The words the bundle writes for what it could ever hold: every declared object, every kind, every object a kind gives. */
static sprout_eval_status add_written(gathering *g, const sprout_world *world) {
  const sprout_graph *graph = &world->graph;
  size_t i;
  for (i = 0; i < world->declared_count; i++) {
    const sprout_declared *declared = &world->declared[i];
    if (declared->path_count > 0) EXPR_NEED(add_identifier(g, declared->path[declared->path_count - 1]));
    EXPR_NEED(add_grammar(g, graph, declared->kind));
  }
  for (i = 0; i < world->kind_count; i++) {
    sprout_str name;
    if (!sprout_humanised_kind(g->arena, world->kinds[i]->name, &name)) return SPROUT_EVAL_NO_MEMORY;
    EXPR_NEED(add_text(g, name));
    EXPR_NEED(add_grammar(g, graph, world->kinds[i]));
  }
  for (i = 0; i < world->content_list_count; i++)
    EXPR_NEED(add_given(g, graph, world->contents[i].items, world->contents[i].count));
  return SPROUT_EVAL_OK;
}

/* Each instance the world's tree holds, a step each: a live thing's nouns, adjectives and kinds' names. */
static sprout_eval_status add_live(gathering *g, const sprout_frame *frame) {
  sprout_str world = frame->draft->base->world, *waiting = NULL;
  size_t count = 0, capacity = 0, i, j;
  sprout_str *first = (sprout_str *)sprout_exec_grow(g->arena, (void **)&waiting, &count, &capacity, sizeof *waiting);
  if (first == NULL) return SPROUT_EVAL_NO_MEMORY;
  *first = world;
  while (count > 0) {
    sprout_str id = waiting[--count];
    const sprout_stored_instance *instance;
    const sprout_str *children;
    size_t child_count;
    sprout_draft_result result;
    EXPR_NEED(expr_spend(frame));
    instance = expr_instance(frame, id);
    if (instance == NULL) continue;
    if (!sprout_str_same(id, world)) {
      parse_address address;
      EXPR_NEED(parse_address_of(frame, instance, &address));
      for (i = 0; i < address.noun_count; i++)
        for (j = 0; j < address.nouns[i].count; j++) EXPR_NEED(add_word(g, address.nouns[i].words[j]));
      for (i = 0; i < address.adjective_count; i++) EXPR_NEED(add_word(g, address.adjectives[i]));
      EXPR_NEED(add_kinds(g, instance->kind->order, instance->kind->order_count));
    }
    result = sprout_draft_children(frame->draft, id, &children, &child_count);
    if (result == SPROUT_DRAFT_NO_MEMORY) return SPROUT_EVAL_NO_MEMORY;
    if (result != SPROUT_DRAFT_OK) return expr_engine(frame, "the world's tree would not list what an instance holds.");
    for (i = 0; i < child_count; i++) {
      sprout_str *slot = (sprout_str *)sprout_exec_grow(g->arena, (void **)&waiting, &count, &capacity, sizeof *slot);
      if (slot == NULL) return SPROUT_EVAL_NO_MEMORY;
      *slot = children[i];
    }
  }
  return SPROUT_EVAL_OK;
}

sprout_eval_status parse_world_words(const sprout_frame *frame, sprout_arena *keep, parse_vocabulary *out) {
  sprout_frame at = *frame;
  gathering g;
  memset(&g, 0, sizeof g);
  memset(out, 0, sizeof *out);
  g.arena = keep;
  /* What an address is built of stays in `keep` too, where the words outlive the phrase being tried. */
  at.turn = keep;
  EXPR_NEED(add_written(&g, frame->world));
  EXPR_NEED(add_live(&g, &at));
  out->words = g.words;
  out->count = g.count;
  return SPROUT_EVAL_OK;
}

bool parse_in_vocabulary(parse_words words, const parse_vocabulary *vocabulary) {
  size_t i, j;
  for (i = 0; i < words.count; i++) {
    bool known = parse_is_noun_word(words.words[i]);
    for (j = 0; j < vocabulary->count && !known; j++) known = sprout_str_same(words.words[i], vocabulary->words[j]);
    if (!known) return false;
  }
  return true;
}
