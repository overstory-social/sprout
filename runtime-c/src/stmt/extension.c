/*
 * An extension's statement (the spec's Extensions > The rule, Activation and
 * absence). It records an effect and never performs one: its arguments are
 * evaluated and kept with the extension and the statement, for the
 * extension's code to turn into a payload once the turn is over. Each
 * recording is a step beyond the statement's own and one of the host's capped
 * effects. A statement of an extension the world does not pin records
 * nothing.
 */
#include "stmt.h"

static bool pinned(const sprout_world *world, const char *name) {
  size_t i;
  for (i = 0; i < world->extension_count; i++)
    if (strcmp(world->extensions[i].name, name) == 0) return true;
  return false;
}

sprout_eval_status stmt_extension(sprout_run *run, const sprout_frame *frame, const sprout_node *statement) {
  const char *extension = expr_ident(statement, "extension");
  const sprout_node *arguments = sprout_node_get(statement, "arguments");
  sprout_effect effect;
  sprout_value *values;
  size_t count = arguments == NULL ? 0 : arguments->count, i;
  EXPR_NEED(stmt_acting(run, frame, "an extension's statement"));
  if (!pinned(frame->world, extension)) return SPROUT_EVAL_OK;
  values = (sprout_value *)sprout_arena_take(frame->turn, (count + 1) * sizeof *values);
  if (values == NULL) return SPROUT_EVAL_NO_MEMORY;
  for (i = 0; i < count; i++) {
    sprout_evaluated evaluated;
    EXPR_NEED(sprout_eval(frame, arguments->items[i], &evaluated));
    if (evaluated.binds != SPROUT_BINDS_VALUE) return expr_unchecked(frame, "an object handed to an extension");
    values[i] = evaluated.value;
  }
  EXPR_NEED(expr_spend(frame));
  if (!sprout_meter_effect(frame->meter)) return expr_budget_fault(frame);
  memset(&effect, 0, sizeof effect);
  effect.kind = SPROUT_EFFECT_EXTENSION;
  effect.by = frame->self;
  effect.said.kind = SPROUT_SPEECH_RECORDED;
  effect.said.extension = extension;
  effect.said.statement = expr_ident(statement, "name");
  effect.said.argument_count = count;
  effect.said.arguments = values;
  if (run->x->records_as_said) {
    effect.to = run->x->heard_by;
    effect.to_count = run->x->heard_count;
  } else {
    EXPR_NEED(sprout_told_to(run->x, frame, frame->self, SPROUT_TELL_PLACE, &effect.to, &effect.to_count));
  }
  return sprout_exec_record(run->x, &effect);
}
