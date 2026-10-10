/*
 * A loaded world (the spec's The compiler > What compiling produces): the
 * catalogue of `catalogue.h` plus the graph of bodies and prose, held in the
 * world's own load arena and released whole by sprout_world_free. Reading a
 * cartridge fills it; nothing in it changes afterwards.
 */
#ifndef SPROUT_WORLD_H
#define SPROUT_WORLD_H

#include "catalogue.h"

struct sprout_world {
  sprout_host host; /* the host record as it was at load */
  sprout_arena arena;
  long format, level;
  sprout_cartridge_header header;
  sprout_graph graph;

  size_t kind_count;
  sprout_kind_def **kinds;        /* every kind the bundle declares, in declared order */
  sprout_kind_def *world_kind;    /* NULL where the world has none */
  sprout_kind_def *visitor_kind;  /* NULL where visitors have none */
  size_t content_list_count;
  sprout_content_list *contents;

  size_t declared_count;
  sprout_declared *declared; /* in rank order */
  const char *arrival;       /* the id visitors arrive at, or NULL */

  size_t verb_count;
  sprout_verb **verbs;
  size_t synonym_count;
  sprout_synonym *synonyms;
  size_t phrase_count;
  sprout_typed_phrase *phrases; /* in the order the command parser tries them */
  size_t intent_count;
  sprout_intent *intents;
  size_t intent_phrase_count;
  sprout_typed_intent_phrase *intent_phrases;
  size_t message_count;
  sprout_message *messages;

  size_t word_count;
  const char **words;

  /* Indexed by a graph entry's `index`: the node a name written there names, and whether a slot renders an option. */
  const sprout_node **bound;
  bool *option_slot;

  sprout_caps caps;
  size_t extension_count;
  sprout_extension_pin *extensions;
};

/* The declared object with this id, or NULL. */
const sprout_declared *sprout_world_declared(const sprout_world *world, const char *id);

/* The kind with this qualified name, or NULL. */
const sprout_kind_def *sprout_world_kind(const sprout_world *world, const char *qualified);

/* The property a kind declares by this name, or NULL. */
const sprout_property *sprout_kind_property(const sprout_kind_def *kind, const char *name);

/* What the body of `kind` writes at this path, or NULL: a content a spawn of the kind gives its instance. */
const sprout_content *sprout_world_content_at(const sprout_world *world, const char *kind,
                                              const char *const *path, size_t path_count);

/* The node a body's name, written at `written`, names; NULL when none is bound. */
const sprout_node *sprout_world_bound(const sprout_world *world, const sprout_node *written);

#endif
