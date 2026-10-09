/*
 * Lists, as the spec's Properties > Lists has them: insertion order, no
 * duplicates, and a bound that is the host's. Adding a new element to a full
 * list is reported, not dropped, so the engine can fault the turn.
 */
#include "lists.h"

#include <string.h>

static bool fits_type(const sprout_type *holds, const sprout_value *element) {
  if (holds->kind != element->kind) return false;
  if (holds->kind != SPROUT_LIST) return true;
  return sprout_type_same(holds->element, element->as.list->holds);
}

static bool full(sprout_limit allowed, size_t count) {
  return allowed.set && (uint64_t)count >= allowed.value;
}

static sprout_list *make(sprout_arena *arena, const sprout_type *holds, size_t room) {
  sprout_list *list = (sprout_list *)sprout_arena_take(arena, sizeof *list);
  if (list == NULL) return NULL;
  list->holds = holds;
  list->count = 0;
  list->items = room == 0 ? NULL : (sprout_value *)sprout_arena_take(arena, room * sizeof(sprout_value));
  if (room != 0 && list->items == NULL) return NULL;
  return list;
}

size_t sprout_list_count(const sprout_list *list) { return list->count; }

bool sprout_list_includes(const sprout_list *list, const sprout_value *element) {
  for (size_t i = 0; i < list->count; i++)
    if (sprout_value_same(&list->items[i], element)) return true;
  return false;
}

sprout_list_result sprout_list_make(sprout_arena *arena, const sprout_type *holds,
                                    const sprout_value *elements, size_t count,
                                    sprout_limit allowed, const sprout_list **result) {
  sprout_list *list = make(arena, holds, count);
  if (list == NULL) return SPROUT_LIST_NO_MEMORY;
  for (size_t i = 0; i < count; i++) {
    if (!fits_type(holds, &elements[i])) return SPROUT_LIST_WRONG_TYPE;
    if (sprout_list_includes(list, &elements[i])) continue;
    if (full(allowed, list->count)) return SPROUT_LIST_FULL;
    list->items[list->count++] = elements[i];
  }
  *result = list;
  return SPROUT_LIST_OK;
}

sprout_list_result sprout_list_add(sprout_arena *arena, const sprout_list *list,
                                   const sprout_value *element, sprout_limit allowed,
                                   const sprout_list **result) {
  sprout_list *grown;
  if (!fits_type(list->holds, element)) return SPROUT_LIST_WRONG_TYPE;
  if (sprout_list_includes(list, element)) {
    *result = list;
    return SPROUT_LIST_OK;
  }
  if (full(allowed, list->count)) return SPROUT_LIST_FULL;
  grown = make(arena, list->holds, list->count + 1);
  if (grown == NULL) return SPROUT_LIST_NO_MEMORY;
  if (list->count > 0) memcpy(grown->items, list->items, list->count * sizeof(sprout_value));
  grown->items[list->count] = *element;
  grown->count = list->count + 1;
  *result = grown;
  return SPROUT_LIST_OK;
}

sprout_list_result sprout_list_remove(sprout_arena *arena, const sprout_list *list,
                                      const sprout_value *element, const sprout_list **result) {
  sprout_list *shrunk;
  size_t kept = 0;
  if (!sprout_list_includes(list, element)) {
    *result = list;
    return SPROUT_LIST_OK;
  }
  shrunk = make(arena, list->holds, list->count - 1);
  if (shrunk == NULL) return SPROUT_LIST_NO_MEMORY;
  for (size_t i = 0; i < list->count; i++)
    if (!sprout_value_same(&list->items[i], element)) shrunk->items[kept++] = list->items[i];
  shrunk->count = kept;
  *result = shrunk;
  return SPROUT_LIST_OK;
}
