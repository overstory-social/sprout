/*
 * `connect` (the spec's Verbs > Links, for space that does not exist yet). A
 * link is `self`'s, kept under its name, so connecting one writes only
 * `self`; it names its destination by id, and nothing but the engine's
 * traversal reads it back. Connecting a link already set replaces where it
 * leads. A link `self` does not have, or a destination that is not in the
 * world or holds no actors, faults.
 */
#include "stmt.h"

/* Whether the kind declares a link by this name. */
static bool has_link(const sprout_kind_def *kind, const char *name) {
  const sprout_node *exits = sprout_node_get(kind->node, "exits");
  size_t i;
  for (i = 0; exits != NULL && i < exits->count; i++)
    if (sprout_node_is(sprout_node_get(exits->items[i], "kind"), "link") &&
        sprout_node_is(sprout_node_get(exits->items[i], "name"), name))
      return true;
  return false;
}

sprout_eval_status stmt_connect(sprout_run *run, const sprout_frame *frame, const sprout_node *statement) {
  const char *name = expr_ident(statement, "link");
  const sprout_stored_instance *self, *place;
  sprout_str to;
  sprout_stored_instance next;
  sprout_stored_link *links;
  size_t i;
  expr_text text;
  EXPR_NEED(stmt_acting(run, frame, "`connect`"));
  EXPR_NEED(stmt_object_at(frame, sprout_node_get(statement, "destination"), &to));
  EXPR_NEED(expr_instance_of(frame, frame->self, &self));
  if (!has_link(self->kind, name)) {
    text = expr_text_begin(frame);
    expr_put(&text, "`");
    expr_put_str(&text, frame->self);
    expr_put(&text, "` has no link ");
    expr_put(&text, name);
    expr_put(&text, ", so `connect ");
    expr_put(&text, name);
    expr_put(&text, "` has nothing to connect.");
    return expr_fail(frame, "ConnectFault");
  }
  place = expr_instance(frame, to);
  if (place == NULL || !expr_live(frame, to)) {
    text = expr_text_begin(frame);
    expr_put(&text, "`");
    expr_put_str(&text, to);
    expr_put(&text, "` is not in the world, so `");
    expr_put_str(&text, frame->self);
    expr_put(&text, "`'s link ");
    expr_put(&text, name);
    expr_put(&text, " could not lead there.");
    return expr_fail(frame, "ConnectFault");
  }
  if (!place->kind->contains_actors) {
    text = expr_text_begin(frame);
    expr_put(&text, "`");
    expr_put_str(&text, to);
    expr_put(&text, "` holds no actors, so `");
    expr_put_str(&text, frame->self);
    expr_put(&text, "`'s link ");
    expr_put(&text, name);
    expr_put(&text, " could not lead there.");
    return expr_fail(frame, "ConnectFault");
  }
  if (sprout_stored_instance_copy(frame->turn, self, &next) != SPROUT_OK) return SPROUT_EVAL_NO_MEMORY;
  links = (sprout_stored_link *)sprout_arena_take(frame->turn, (next.link_count + 1) * sizeof *links);
  if (links == NULL) return SPROUT_EVAL_NO_MEMORY;
  if (next.link_count > 0) memcpy(links, next.links, next.link_count * sizeof *links);
  for (i = 0; i < next.link_count; i++)
    if (sprout_str_is(links[i].name, name)) break;
  if (i == next.link_count) next.link_count++;
  links[i].name = (sprout_str){name, strlen(name)};
  links[i].to = to;
  next.links = links;
  if (sprout_stored_instance_order(frame->turn, &next) != SPROUT_OK) return SPROUT_EVAL_NO_MEMORY;
  return sprout_draft_write(frame->draft, &next) == SPROUT_DRAFT_OK ? SPROUT_EVAL_OK : SPROUT_EVAL_NO_MEMORY;
}
