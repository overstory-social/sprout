/*
 * The list operations (the spec's Properties > Lists): includes, count, add
 * and remove on an ordered list of one element type without duplicates. A
 * list is immutable; add and remove hand back a list, and the same list when
 * nothing changes. Its length is bounded by the host's list_elements.
 */
#ifndef SPROUT_LISTS_H
#define SPROUT_LISTS_H

#include "values.h"

typedef enum sprout_list_result {
  SPROUT_LIST_OK,
  SPROUT_LIST_FULL,       /* a new element would pass the host's bound: a fault */
  SPROUT_LIST_WRONG_TYPE, /* an element is not of the list's element type */
  SPROUT_LIST_NO_MEMORY
} sprout_list_result;

/* A list of `holds` with the elements given in order; later duplicates are dropped. */
sprout_list_result sprout_list_make(sprout_arena *arena, const sprout_type *holds,
                                    const sprout_value *elements, size_t count,
                                    sprout_limit allowed, const sprout_list **list);

size_t sprout_list_count(const sprout_list *list);
bool sprout_list_includes(const sprout_list *list, const sprout_value *element);

/* With the element in it at the end; already holding it, the same list. */
sprout_list_result sprout_list_add(sprout_arena *arena, const sprout_list *list,
                                   const sprout_value *element, sprout_limit allowed,
                                   const sprout_list **result);

/* Without the element; not holding it, the same list. */
sprout_list_result sprout_list_remove(sprout_arena *arena, const sprout_list *list,
                                      const sprout_value *element, const sprout_list **result);

#endif
