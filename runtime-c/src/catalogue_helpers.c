/*
 * The shared machinery of the catalogue readers: the arena allocation that
 * reports no memory, the refusal sentence, and the small readers of strings
 * and flags out of graph nodes.
 */
#include <string.h>

#include "catalogue_build.h"

sprout_status cat_fail(loader *l, const char *a, const char *b, const char *c) {
  size_t used = 0, i;
  const char *parts[3];
  parts[0] = a;
  parts[1] = b;
  parts[2] = c;
  for (i = 0; i < 3 && l->capacity > 0; i++) {
    size_t n = parts[i] == NULL ? 0 : strlen(parts[i]);
    if (used + n >= l->capacity) n = l->capacity - 1 - used;
    if (n > 0) memcpy(l->error + used, parts[i], n);
    used += n;
  }
  if (l->capacity > 0) l->error[used] = '\0';
  return SPROUT_BAD_INPUT;
}

void *cat_array(loader *l, size_t count, size_t size) {
  if (size != 0 && count > (size_t)-1 / size) return NULL;
  return sprout_arena_take(l->arena, count * size);
}

/* The shape the cartridge should have had at `where`. */
sprout_status cat_shaped(loader *l, const char *where) {
  return cat_fail(l, "This cartridge is not shaped as a cartridge is at `", where,
              "`: it is not what a cartridge holds there.");
}

bool cat_is_array(const sprout_node *node) {
  return node != NULL && (node->kind == SPROUT_NODE_ARRAY || node->kind == SPROUT_NODE_SET);
}

const char *cat_text(const sprout_node *object, const char *key) {
  return sprout_node_text(object, key);
}

sprout_status cat_strings(loader *l, const sprout_node *list, const char *where, size_t *count,
                             const char ***items) {
  size_t i;
  if (!cat_is_array(list)) return cat_shaped(l, where);
  *count = list->count;
  *items = (const char **)cat_array(l, list->count, sizeof(char *));
  MEMORY(*items);
  for (i = 0; i < list->count; i++) {
    if (list->items[i]->kind != SPROUT_NODE_STRING) return cat_shaped(l, where);
    (*items)[i] = list->items[i]->text;
  }
  return SPROUT_OK;
}

char *cat_join3(loader *l, const char *a, const char *b, const char *c) {
  size_t na = strlen(a), nb = strlen(b), nc = strlen(c);
  char *out = (char *)cat_array(l, na + nb + nc + 1, 1);
  if (out == NULL) return NULL;
  memcpy(out, a, na);
  memcpy(out + na, b, nb);
  memcpy(out + na + nb, c, nc);
  return out;
}

bool cat_bool(const sprout_node *object, const char *key) {
  const sprout_node *field = sprout_node_get(object, key);
  return field != NULL && field->kind == SPROUT_NODE_BOOL && field->boolean;
}

