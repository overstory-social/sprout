/*
 * What an instance is called and answers to while the world runs (the spec's Names > Addressing and display,
 * Articles, Nicknames; Verbs > Slots). Its composed grammar block says what it writes, and the rest is the
 * defaults: its name is address.c's (the written name, else the identifier or the kind's name humanised); it
 * answers to its full name, the last word of it, its identifier and every noun its closure writes, and its
 * adjectives are its name's words before the last and every adjective its closure writes. A visitor answers to
 * the whole of their nickname, with the nouns and adjectives their kind writes. The cartridge carries the nouns and
 * adjectives as written, so they are read as typed words here.
 */
#include <string.h>

#include "../address.h"
#include "../expr/expr.h"
#include "../typed.h"
#include "parse.h"

/* Room for the nouns and adjectives as they are gathered. */
typedef struct gathered {
  parse_words *nouns;
  size_t noun_count;
  sprout_str *adjectives;
  size_t adjective_count;
} gathered;

static bool same_words(parse_words a, parse_words b) {
  size_t i;
  if (a.count != b.count) return false;
  for (i = 0; i < a.count; i++)
    if (!sprout_str_same(a.words[i], b.words[i])) return false;
  return true;
}

/* Adds a noun unless it is empty or already held: the first is kept. */
static void noun(gathered *g, parse_words words) {
  size_t i;
  if (words.count == 0) return;
  for (i = 0; i < g->noun_count; i++)
    if (same_words(g->nouns[i], words)) return;
  g->nouns[g->noun_count++] = words;
}

static void adjective(gathered *g, sprout_str word) {
  size_t i;
  for (i = 0; i < g->adjective_count; i++)
    if (sprout_str_same(g->adjectives[i], word)) return;
  g->adjectives[g->adjective_count++] = word;
}

static sprout_eval_status words_of(const sprout_frame *frame, sprout_str text, parse_words *out) {
  sprout_str *words;
  size_t count;
  if (typed_words(frame->turn, text, &words, &count) != SPROUT_OK) return SPROUT_EVAL_NO_MEMORY;
  out->words = words;
  out->count = count;
  return SPROUT_EVAL_OK;
}

static sprout_str text_of(const sprout_graph *graph, const sprout_node *node) {
  sprout_str text;
  text.bytes = sprout_text(graph, node);
  text.length = sprout_text_length(graph, node);
  return text;
}

/* The strings of a list the composed grammar block writes, `nouns` or `adjectives`, or NULL. */
static const sprout_node *written_list(const sprout_graph *graph, const sprout_kind_def *kind, const char *line) {
  const sprout_node *list = sprout_node_get(graph, sprout_node_get(graph, kind->node, "grammar"), line);
  return list != NULL && list->kind == SPROUT_NODE_ARRAY ? list : NULL;
}

/* Room enough for every noun and adjective `instance` may answer to: the name's words, the identifier, and the written. */
static sprout_eval_status make_room(const sprout_frame *frame, const sprout_kind_def *kind, size_t name_words,
                                    gathered *g, const sprout_node **nouns, const sprout_node **adjectives,
                                    size_t *adjective_words) {
  const sprout_graph *graph = &frame->world->graph;
  size_t i, noun_room, adjective_room;
  *nouns = written_list(graph, kind, "nouns");
  *adjectives = written_list(graph, kind, "adjectives");
  *adjective_words = 0;
  /* A written adjective may be several words, each its own adjective. */
  for (i = 0; *adjectives != NULL && i < (*adjectives)->count; i++) {
    const sprout_node *one = sprout_item(graph, *adjectives, i);
    if (one->kind == SPROUT_NODE_STRING) *adjective_words += sprout_text_length(graph, one) + 1;
  }
  noun_room = 3 + (*nouns == NULL ? 0 : (*nouns)->count);
  adjective_room = name_words + *adjective_words + 1;
  g->nouns = (parse_words *)sprout_arena_take(frame->turn, noun_room * sizeof *g->nouns);
  g->adjectives = (sprout_str *)sprout_arena_take(frame->turn, adjective_room * sizeof *g->adjectives);
  g->noun_count = g->adjective_count = 0;
  return g->nouns == NULL || g->adjectives == NULL ? SPROUT_EVAL_NO_MEMORY : SPROUT_EVAL_OK;
}

/* Every noun and adjective the closure writes, after those already gathered. */
static sprout_eval_status add_written(const sprout_frame *frame, gathered *g, const sprout_node *nouns,
                                      const sprout_node *adjectives, bool adjectives_first) {
  const sprout_graph *graph = &frame->world->graph;
  parse_words words;
  size_t i, j;
  if (!adjectives_first)
    for (i = 0; nouns != NULL && i < nouns->count; i++) {
      const sprout_node *one = sprout_item(graph, nouns, i);
      if (one->kind != SPROUT_NODE_STRING) continue;
      EXPR_NEED(words_of(frame, text_of(graph, one), &words));
      noun(g, words);
    }
  for (i = 0; adjectives != NULL && i < adjectives->count; i++) {
    const sprout_node *one = sprout_item(graph, adjectives, i);
    if (one->kind != SPROUT_NODE_STRING) continue;
    EXPR_NEED(words_of(frame, text_of(graph, one), &words));
    for (j = 0; j < words.count; j++) adjective(g, words.words[j]);
  }
  return SPROUT_EVAL_OK;
}

/* The identifier a thing was declared by, humanised, or none for a spawn, which has none. */
static sprout_eval_status identifier_of(const sprout_frame *frame, const sprout_stored_instance *instance,
                                        bool *has, sprout_str *identifier) {
  size_t i;
  sprout_str raw;
  *has = true;
  switch (instance->made) {
    case SPROUT_MADE_WORLD:
      raw = instance->id;
      break;
    case SPROUT_MADE_DECLARED:
      for (i = instance->id.length; i > 0; i--)
        if (instance->id.bytes[i - 1] == '.') break;
      raw.bytes = instance->id.bytes + i;
      raw.length = instance->id.length - i;
      break;
    case SPROUT_MADE_GIVEN:
      if (instance->path_count == 0) {
        *has = false;
        return SPROUT_EVAL_OK;
      }
      raw = instance->path[instance->path_count - 1];
      break;
    default:
      *has = false;
      return SPROUT_EVAL_OK;
  }
  return sprout_humanised(frame->turn, raw, identifier) ? SPROUT_EVAL_OK : SPROUT_EVAL_NO_MEMORY;
}

sprout_eval_status parse_address_of(const sprout_frame *frame, const sprout_stored_instance *instance, parse_address *out) {
  const sprout_graph *graph = &frame->world->graph;
  const sprout_kind_def *kind = instance->kind;
  const sprout_node *nouns, *adjectives, *article, *pronoun = sprout_grammar_text(graph, kind, "pronoun");
  const sprout_stored_visitor *visitor =
      instance->made == SPROUT_MADE_VISITOR ? sprout_visitor_of(frame->draft, instance->id) : NULL;
  parse_words name, last;
  gathered g;
  size_t adjective_words, i;
  sprout_str identifier;
  bool has_identifier;
  memset(out, 0, sizeof *out);
  out->pronoun = pronoun == NULL ? PARSE_PRONOUN_NONE : parse_pronoun_named(sprout_text(graph, pronoun));
  EXPR_NEED(sprout_name_of(frame, instance, &out->name));
  EXPR_NEED(words_of(frame, out->name, &name));
  EXPR_NEED(make_room(frame, kind, name.count, &g, &nouns, &adjectives, &adjective_words));
  if (visitor != NULL) {
    out->article = "none";
    noun(&g, name);
    EXPR_NEED(add_written(frame, &g, nouns, NULL, false));
    EXPR_NEED(add_written(frame, &g, NULL, adjectives, true));
  } else {
    article = sprout_grammar_text(graph, kind, "article");
    out->article = article != NULL ? sprout_text(graph, article)
                   : out->name.length > 0 && strchr("aeiouAEIOU", out->name.bytes[0]) != NULL ? "an"
                                                                                               : "a";
    /* The full name, and its last word where that is another noun. */
    noun(&g, name);
    if (name.count > 1) {
      last.words = name.words + name.count - 1;
      last.count = 1;
      noun(&g, last);
    }
    EXPR_NEED(identifier_of(frame, instance, &has_identifier, &identifier));
    if (has_identifier) {
      parse_words words;
      EXPR_NEED(words_of(frame, identifier, &words));
      noun(&g, words);
    }
    EXPR_NEED(add_written(frame, &g, nouns, NULL, false));
    for (i = 0; i + 1 < name.count; i++) adjective(&g, name.words[i]);
    EXPR_NEED(add_written(frame, &g, NULL, adjectives, true));
  }
  out->nouns = g.nouns;
  out->noun_count = g.noun_count;
  out->adjectives = g.adjectives;
  out->adjective_count = g.adjective_count;
  return SPROUT_EVAL_OK;
}

sprout_eval_status parse_written_as(const sprout_frame *frame, const parse_address *address, sprout_str *out) {
  size_t article = strlen(address->article);
  sprout_str lower;
  char *text;
  if (typed_lower(frame->turn, address->name, &lower) != SPROUT_OK) return SPROUT_EVAL_NO_MEMORY;
  text = (char *)sprout_arena_take(frame->turn, article + 1 + lower.length + 1);
  if (text == NULL) return SPROUT_EVAL_NO_MEMORY;
  memcpy(text, address->article, article);
  text[article] = ' ';
  memcpy(text + article + 1, lower.bytes, lower.length);
  out->bytes = text;
  out->length = article + 1 + lower.length;
  return SPROUT_EVAL_OK;
}
