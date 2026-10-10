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
  sprout_arena *arena;
  char *error;
  size_t capacity;
  sprout_kind_def **kind_cache; /* by graph entry index */
  sprout_verb **verb_cache;
  sprout_decl_type **type_cache;
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
/* A refusal naming the place in the cartridge that is not shaped as a cartridge is. */
sprout_status cat_shaped(loader *l, const char *where);
/* Zeroed room for `count` things of `size`, or NULL when the host refuses a page. */
void *cat_array(loader *l, size_t count, size_t size);
bool cat_is_array(const sprout_node *node);
/* A string field of an object, or NULL. */
const char *cat_text(const sprout_node *object, const char *key);
/* A boolean field that is true; false when absent. */
bool cat_bool(const sprout_node *object, const char *key);
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

/* Fills `world` from the cartridge's JSON, whose graph is already read into world->graph. */
sprout_status sprout_catalogue_build(sprout_world *world, const sprout_json *root, char *error,
                                     size_t capacity);

#endif
