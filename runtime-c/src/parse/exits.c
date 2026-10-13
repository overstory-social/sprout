/*
 * The words that fill an exit role (the spec's Verbs > Exits, Links; Names > Articles): a direction, written out or
 * abbreviated, or the label of an exit or a link typed, so what a screen reader speaks can be spoken back. A link
 * has no direction, and is taken by its label alone. An article, `my`, `this` or `that` at a label's start is
 * dropped, as typed and as written. Only the ways out that apply where the actor stands are asked (exits.h); an
 * exit that refuses is among them, named as any exit is. A label some way out in the world is written with, typed
 * where none that applies carries it, names a way out of reach. Labels are read by the words the cartridge carries
 * beside them, `label.typed`, as the tokeniser reads a typed line.
 */
#include <string.h>

#include "parse.h"

parse_words parse_label_words(parse_words words) {
  if (words.count > 1 && parse_is_determiner(words.words[0])) {
    words.words++;
    words.count--;
  }
  return words;
}

/* Whether `words`, less a leading article, are the typed label `typed`, its words joined by single spaces. */
static bool is_label(parse_words words, const char *typed) {
  size_t length = strlen(typed), at = 0, i, count = 0;
  sprout_str split[2];
  parse_words written;
  /* The label's own first word is dropped only where it is a determiner and more words follow. */
  const char *space = strchr(typed, ' ');
  if (space != NULL) {
    split[0].bytes = typed;
    split[0].length = (size_t)(space - typed);
    split[1].bytes = space + 1;
    split[1].length = length - split[0].length - 1;
    written.words = split;
    written.count = 2;
    if (parse_label_words(written).count == 1) at = split[0].length + 1;
  }
  words = parse_label_words(words);
  for (i = 0; i < words.count; i++) {
    if (at > length) return false;
    if (i > 0) {
      if (typed[at] != ' ') return false;
      at++;
    }
    if (length - at < words.words[i].length || memcmp(typed + at, words.words[i].bytes, words.words[i].length) != 0)
      return false;
    at += words.words[i].length;
    count++;
  }
  return count > 0 && at == length;
}

static const char *typed_label(const sprout_graph *graph, const sprout_node *exit) {
  return sprout_node_text(graph, sprout_node_get(graph, sprout_node_get(graph, exit, "line"), "label"), "typed");
}

const sprout_way *parse_exit_named(const sprout_graph *graph, parse_words words, const sprout_way *ways, size_t count) {
  const char *direction = words.count == 1 ? parse_direction_of(words.words[0]) : NULL;
  size_t i;
  if (direction != NULL)
    for (i = 0; i < count; i++)
      if (ways[i].direction != NULL && strcmp(ways[i].direction, direction) == 0) return &ways[i];
  for (i = 0; i < count; i++) {
    const char *typed = typed_label(graph, ways[i].exit);
    if (typed != NULL && is_label(words, typed)) return &ways[i];
  }
  return NULL;
}

/* Whether a kind's own exits and links hold one labelled `words`. */
static bool kind_labels(const sprout_graph *graph, const sprout_kind_def *kind, parse_words words) {
  const sprout_node *exits = kind == NULL ? NULL : sprout_node_get(graph, kind->node, "exits");
  size_t i;
  for (i = 0; exits != NULL && exits->kind == SPROUT_NODE_ARRAY && i < exits->count; i++) {
    const char *typed = typed_label(graph, sprout_item(graph, exits, i));
    if (typed != NULL && is_label(words, typed)) return true;
  }
  return false;
}

bool parse_way_label(const sprout_world *world, parse_words words) {
  size_t i;
  for (i = 0; i < world->kind_count; i++)
    if (kind_labels(&world->graph, world->kinds[i], words)) return true;
  for (i = 0; i < world->declared_count; i++)
    if (kind_labels(&world->graph, world->declared[i].kind, words)) return true;
  return false;
}
