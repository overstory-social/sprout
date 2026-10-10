/*
 * `say`, `tell` and the words a `refuse` gives (the spec's Prose; Other people
 * > Who hears it; The runtime > Effects). Nothing is rendered: the words are
 * recorded as the passage `self`'s kind has under the name written, or the
 * words quoted, beside every name in scope, for the prose layer to render
 * once the turn's work is done.
 */
#include "stmt.h"

void stmt_speech_of(const sprout_frame *frame, const sprout_node *statement, sprout_speech *out) {
  const sprout_node *said = sprout_node_get(statement, "said");
  const sprout_stored_instance *self;
  memset(out, 0, sizeof *out);
  if (sprout_node_is(sprout_node_get(said, "kind"), "prose-literal")) {
    out->kind = SPROUT_SPEECH_TEXT;
    out->node = said;
    out->library = frame->library;
    return;
  }
  out->name = sprout_node_text(said, "text");
  self = expr_instance(frame, frame->self);
  if (self != NULL && sprout_passage_on(self->kind, out->name, out)) return;
  out->kind = SPROUT_SPEECH_ABSENT;
}

sprout_eval_status stmt_say(sprout_run *run, const sprout_frame *frame, const sprout_node *statement) {
  sprout_effect effect;
  EXPR_NEED(stmt_acting(run, frame, "`say`"));
  memset(&effect, 0, sizeof effect);
  effect.kind = SPROUT_EFFECT_SAID;
  EXPR_NEED(sprout_exec_hearers(run->x, frame, &effect.to, &effect.to_count));
  effect.by = frame->self;
  effect.has_speaker = run->x->has_speaker;
  effect.speaker = run->x->speaker;
  stmt_speech_of(frame, statement, &effect.said);
  EXPR_NEED(sprout_effect_names(frame, &effect.bindings, &effect.binding_count));
  return sprout_exec_record(run->x, &effect);
}

sprout_eval_status stmt_tell(sprout_run *run, const sprout_frame *frame, const sprout_node *statement) {
  const sprout_node *to = sprout_node_get(statement, "to");
  const sprout_node *direction = sprout_node_get(statement, "direction");
  sprout_effect effect;
  sprout_str one = {NULL, 0};
  sprout_tell_scope scope = SPROUT_TELL_PLACE;
  bool named = to != NULL && to->kind != SPROUT_NODE_NULL;
  EXPR_NEED(stmt_acting(run, frame, "`tell`"));
  if (named) EXPR_NEED(stmt_object_at(frame, to, &one));
  if (direction != NULL && direction->kind != SPROUT_NODE_NULL)
    scope = sprout_node_is(sprout_node_get(direction, "word"), "inside") ? SPROUT_TELL_INSIDE : SPROUT_TELL_OUTSIDE;
  memset(&effect, 0, sizeof effect);
  effect.kind = SPROUT_EFFECT_TOLD;
  effect.by = frame->self;
  stmt_speech_of(frame, statement, &effect.said);
  EXPR_NEED(sprout_effect_names(frame, &effect.bindings, &effect.binding_count));
  if (named) EXPR_NEED(sprout_told_to_one(run->x, frame, frame->self, one, &effect.to, &effect.to_count));
  else EXPR_NEED(sprout_told_to(run->x, frame, frame->self, scope, &effect.to, &effect.to_count));
  return sprout_exec_record(run->x, &effect);
}
