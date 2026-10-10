/*
 * The tree a chip client walks (see chips.h).
 */
#include "chips.h"

#include <string.h>

#include "view_json.h"

static bool same_str(sprout_str a, sprout_str b) { return a.length == b.length && memcmp(a.bytes, b.bytes, a.length) == 0; }

static bool same_thing(const sprout_seen_thing *a, const sprout_seen_thing *b) {
  return same_str(a->id, b->id) && same_str(a->name, b->name);
}

static bool same_text(const char *a, const char *b) { return a == NULL || b == NULL ? a == b : strcmp(a, b) == 0; }

/* Whether two fillers are written alike, field for field. */
static bool same_filler(const sprout_seen_filler *a, const sprout_seen_filler *b) {
  size_t i;
  if (strcmp(a->role, b->role) != 0 || a->binds != b->binds) return false;
  switch (a->binds) {
    case SPROUT_SEEN_OBJECT:
      return same_thing(&a->thing, &b->thing);
    case SPROUT_SEEN_SET:
      if (a->member_count != b->member_count) return false;
      for (i = 0; i < a->member_count; i++)
        if (!same_thing(&a->members[i], &b->members[i])) return false;
      return true;
    case SPROUT_SEEN_EXIT:
      return same_text(a->exit.direction, b->exit.direction) && strcmp(a->exit.label, b->exit.label) == 0 &&
             same_str(a->exit.to, b->exit.to);
    case SPROUT_SEEN_UNBOUND:
      break;
  }
  return true;
}

static sprout_chip_node *node_in(sprout_arena *arena) {
  return (sprout_chip_node *)sprout_arena_take(arena, sizeof(sprout_chip_node));
}

/* The next choice under `node` holding `filler`, made if it is new. */
static sprout_chip_node *choice_of(sprout_arena *arena, sprout_chip_node *node, const sprout_seen_filler *filler) {
  sprout_chip_choice *grown;
  size_t i;
  for (i = 0; i < node->choice_count; i++)
    if (same_filler(node->choices[i].filler, filler)) return node->choices[i].next;
  grown = (sprout_chip_choice *)sprout_arena_take(arena, (node->choice_count + 1) * sizeof *grown);
  if (grown == NULL) return NULL;
  if (node->choice_count > 0) memcpy(grown, node->choices, node->choice_count * sizeof *grown);
  grown[node->choice_count].filler = filler;
  grown[node->choice_count].next = node_in(arena);
  if (grown[node->choice_count].next == NULL) return NULL;
  node->choices = grown;
  return grown[node->choice_count++].next;
}

static sprout_chip_node *verb_of(sprout_arena *arena, sprout_chip_tree *tree, const char *name) {
  sprout_chip_verb *grown;
  size_t i;
  for (i = 0; i < tree->verb_count; i++)
    if (strcmp(tree->verbs[i].verb, name) == 0) return tree->verbs[i].next;
  grown = (sprout_chip_verb *)sprout_arena_take(arena, (tree->verb_count + 1) * sizeof *grown);
  if (grown == NULL) return NULL;
  if (tree->verb_count > 0) memcpy(grown, tree->verbs, tree->verb_count * sizeof *grown);
  grown[tree->verb_count].verb = name;
  grown[tree->verb_count].next = node_in(arena);
  if (grown[tree->verb_count].next == NULL) return NULL;
  tree->verbs = grown;
  return grown[tree->verb_count++].next;
}

sprout_status sprout_chip_tree_of(sprout_arena *arena, const sprout_seen_view *view, sprout_chip_tree *out) {
  size_t i, r;
  memset(out, 0, sizeof *out);
  for (i = 0; i < view->reading_count; i++) {
    const sprout_seen_reading *reading = &view->readings[i];
    sprout_chip_node *node = verb_of(arena, out, reading->verb);
    for (r = 0; node != NULL && r < reading->filler_count; r++)
      if (reading->fillers[r].binds != SPROUT_SEEN_UNBOUND) node = choice_of(arena, node, &reading->fillers[r]);
    if (node == NULL) return SPROUT_NO_MEMORY;
    if (node->leaf == NULL) node->leaf = reading;
  }
  return SPROUT_OK;
}

static sprout_json *leaf_json(sprout_arena *arena, const sprout_seen_reading *reading) {
  sprout_json *leaf = sprout_json_make(arena, SPROUT_JSON_OBJECT, 3);
  sprout_json *typed = sprout_json_text(arena, reading->typed.bytes, reading->typed.length);
  sprout_json *refused = sprout_seen_refusal_json(arena, reading);
  sprout_json *options = sprout_seen_options_json(arena, reading);
  if (leaf == NULL || typed == NULL || refused == NULL || options == NULL) return NULL;
  sprout_json_adopt(leaf, "typed", typed);
  sprout_json_adopt(leaf, "refused", refused);
  sprout_json_adopt(leaf, "options", options);
  return leaf;
}

static sprout_json *node_json(sprout_arena *arena, const sprout_chip_node *node) {
  sprout_json *object = sprout_json_make(arena, SPROUT_JSON_OBJECT, 2);
  sprout_json *choices = sprout_json_make(arena, SPROUT_JSON_ARRAY, node->choice_count);
  size_t i;
  if (object == NULL || choices == NULL) return NULL;
  for (i = 0; i < node->choice_count; i++) {
    sprout_json *choice = sprout_json_make(arena, SPROUT_JSON_OBJECT, 2);
    sprout_json *filler = sprout_seen_filler_json(arena, node->choices[i].filler);
    sprout_json *next = node_json(arena, node->choices[i].next);
    if (choice == NULL || filler == NULL || next == NULL) return NULL;
    sprout_json_adopt(choice, "filler", filler);
    sprout_json_adopt(choice, "next", next);
    sprout_json_adopt(choices, NULL, choice);
  }
  sprout_json_adopt(object, "choices", choices);
  sprout_json_adopt(object, "leaf",
                    node->leaf == NULL ? sprout_json_make(arena, SPROUT_JSON_NULL, 0) : leaf_json(arena, node->leaf));
  return object->count == 2 ? object : NULL;
}

sprout_json *sprout_chip_tree_json(sprout_arena *arena, const sprout_chip_tree *tree) {
  sprout_json *list = sprout_json_make(arena, SPROUT_JSON_ARRAY, tree->verb_count);
  size_t i;
  if (list == NULL) return NULL;
  for (i = 0; i < tree->verb_count; i++) {
    sprout_json *verb = sprout_json_make(arena, SPROUT_JSON_OBJECT, 2);
    sprout_json *next = node_json(arena, tree->verbs[i].next);
    sprout_json *name = sprout_json_text(arena, tree->verbs[i].verb, strlen(tree->verbs[i].verb));
    if (verb == NULL || next == NULL || name == NULL) return NULL;
    sprout_json_adopt(verb, "verb", name);
    sprout_json_adopt(verb, "next", next);
    sprout_json_adopt(list, NULL, verb);
  }
  return list;
}
