/*
 * The tree a chip client walks (the spec's The runtime > The view: a reading is offered as verb,
 * fillers, the options of each value role, given per role in the order the verb declares them). The
 * readings of a view are grouped by verb, then by the filler of each filled role in declared order, and
 * end in the reading's typed line, its value options and the consent pass's refusal. Groups keep the
 * order the view offers them in; a tree points into the view it was made from.
 */
#ifndef SPROUT_CHIPS_H
#define SPROUT_CHIPS_H

#include "json.h"
#include "sprout.h"

typedef struct sprout_chip_node sprout_chip_node;

/* One filler a role can take, and what follows it. */
typedef struct sprout_chip_choice {
  const sprout_seen_filler *filler;
  sprout_chip_node *next;
} sprout_chip_choice;

/* What follows a verb or a filler: the fillers the next role can take, and the reading that ends here, if one does. */
struct sprout_chip_node {
  size_t choice_count;
  sprout_chip_choice *choices;
  const sprout_seen_reading *leaf;
};

/* One verb, by its qualified name, and what follows it. */
typedef struct sprout_chip_verb {
  const char *verb;
  sprout_chip_node *next;
} sprout_chip_verb;

typedef struct sprout_chip_tree {
  size_t verb_count;
  sprout_chip_verb *verbs;
} sprout_chip_tree;

/* `view`'s readings as the tree a chip client walks, built in `arena`. */
sprout_status sprout_chip_tree_of(sprout_arena *arena, const sprout_seen_view *view, sprout_chip_tree *out);

/* The tree as a JSON tree in `arena`: NULL when the host refuses a page. */
sprout_json *sprout_chip_tree_json(sprout_arena *arena, const sprout_chip_tree *tree);

#endif
