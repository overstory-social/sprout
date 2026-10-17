/*
 * The readers that turn a cartridge's graph into the catalogue of
 * `catalogue.h`. Internal to the loader: a host sees sprout_load.
 */
#ifndef SPROUT_CATALOGUE_BUILD_H
#define SPROUT_CATALOGUE_BUILD_H

#include "world.h"

/* The state of one load: the world being filled and the sentence a refusal is written to. */
typedef struct loader {
  sprout_world *world;
  const sprout_graph *graph; /* the world's, which every node read here belongs to */
  sprout_arena *arena;
  sprout_arena *scratch; /* what the load alone reads, released after it */
  char *error;
  size_t capacity;
  /*
   * What each graph entry the build reads was read as, by its index: a kind, a verb, a type, a
   * property, a group of plays, or the array a kind's properties, passages or plays became. An entry is
   * only ever one of these, and the compiler shares what kinds inherit, so each is read once. It lives
   * in `scratch`.
   */
  sprout_entry_map read;
} loader;

#define NEED(expr)                        \
  do {                                    \
    sprout_status need_ = (expr);         \
    if (need_ != SPROUT_OK) return need_; \
  } while (0)

#define MEMORY(pointer)                             \
  do {                                              \
    if ((pointer) == NULL) return SPROUT_NO_MEMORY; \
  } while (0)

/* Writes the sentence a, b, c to the load's error and returns SPROUT_BAD_INPUT. */
sprout_status cat_fail(loader *l, const char *a, const char *b, const char *c);
/* What the entry `node` was read as, or NULL when it was not, or `node` is not an entry. */
void *cat_read_as(const loader *l, const sprout_node *node);
/* Records what the entry `node` was read as; a node that is not an entry is not recorded. */
sprout_status cat_keep(loader *l, const sprout_node *node, void *read);
/* A refusal naming the place in the cartridge that is not shaped as a cartridge is. */
sprout_status cat_shaped(loader *l, const char *where);
/* Zeroed room for `count` things of `size`, or NULL when the host refuses a page. */
void *cat_array(loader *l, size_t count, size_t size);
/* Sorts `count` pointers by `compare`, stably; NULL only when the host refuses the room the sort needs. */
void *cat_sort(loader *l, const void **items, size_t count, int (*compare)(const void *, const void *));
bool cat_is_array(const sprout_node *node);
/* A string field of an object, or NULL. */
const char *cat_text(const sprout_graph *graph, const sprout_node *object, const char *key);
/* A boolean field that is true; false when absent. */
bool cat_bool(const sprout_graph *graph, const sprout_node *object, const char *key);
/* An array or set of strings. */
sprout_status cat_strings(loader *l, const sprout_node *list, const char *where, size_t *count,
                          const char ***items);
char *cat_join3(loader *l, const char *a, const char *b, const char *c);
/* The id of the declared object at `path` under the world. */
const char *cat_id_of(loader *l, const char *world, size_t count, const char *const *path);

sprout_status cat_read_type(loader *l, const sprout_node *node, const sprout_decl_type **out);
sprout_status cat_read_kind(loader *l, const sprout_node *node, sprout_kind_def **out);
sprout_status cat_read_content(loader *l, const sprout_node *node, sprout_content *out);
sprout_status cat_read_phrases(loader *l, const sprout_node *list, size_t *count,
                               sprout_phrase **out);
sprout_status cat_read_verb(loader *l, const sprout_node *node, sprout_verb **out);
sprout_status cat_read_intent(loader *l, const sprout_node *node, sprout_intent *out);
sprout_status cat_build_typed_phrases(loader *l);
/* A phrase's text, which the cartridge writes as the tokeniser reads a typed line, cut at its single spaces. */
sprout_status cat_typed_words(loader *l, const char *text, size_t *count, const char ***words);

/* Fills only `world->header` and `world->caps` from the cartridge's JSON, for a peek. */
sprout_status sprout_catalogue_peek(sprout_world *world, const sprout_json *root, char *error, size_t capacity);

/*
 * Fills `world` from the cartridge's JSON, whose graph is already read into world->graph. What the
 * load alone needs (what each entry was read as) is taken from `scratch`, which the caller resets afterwards.
 */
sprout_status sprout_catalogue_build(sprout_world *world, const sprout_json *root, sprout_arena *scratch,
                                     char *error, size_t capacity);

#endif
