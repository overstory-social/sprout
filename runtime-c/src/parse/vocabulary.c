/*
 * The words a noun may be made of anywhere in the world (the spec's Parsing > When nothing matches). Reading them
 * visits every instance the world's tree holds, the world first, each a step, as the TypeScript parser charges it, so
 * a line one phrase reads costs the same though another phrase's noun names nothing in reach. What the words are,
 * which answers such a line `not_here` or `unknown`, is #644's.
 */
#include "../expr/expr.h"
#include "parse.h"

sprout_eval_status parse_world_visits(const sprout_frame *frame) {
  sprout_str *waiting = NULL;
  size_t count = 0, capacity = 0, i;
  sprout_str *first = (sprout_str *)sprout_exec_grow(frame->turn, (void **)&waiting, &count, &capacity, sizeof *waiting);
  if (first == NULL) return SPROUT_EVAL_NO_MEMORY;
  *first = frame->draft->base->world;
  while (count > 0) {
    sprout_str id = waiting[--count];
    const sprout_str *children;
    size_t child_count;
    sprout_draft_result result;
    EXPR_NEED(expr_spend(frame));
    if (expr_instance(frame, id) == NULL) continue;
    result = sprout_draft_children(frame->draft, id, &children, &child_count);
    if (result == SPROUT_DRAFT_NO_MEMORY) return SPROUT_EVAL_NO_MEMORY;
    if (result != SPROUT_DRAFT_OK) return expr_engine(frame, "the world's tree would not list what an instance holds.");
    for (i = 0; i < child_count; i++) {
      sprout_str *slot = (sprout_str *)sprout_exec_grow(frame->turn, (void **)&waiting, &count, &capacity, sizeof *slot);
      if (slot == NULL) return SPROUT_EVAL_NO_MEMORY;
      *slot = children[i];
    }
  }
  return SPROUT_EVAL_OK;
}
