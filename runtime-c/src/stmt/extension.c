/*
 * An extension's statement (the spec's Extensions > The rule, Activation and
 * absence). It records an effect and never performs one: its arguments are
 * evaluated and kept with the extension and the statement, and, for an
 * extension this runtime holds code for (`media` at major 1), turned into the
 * payload and the transcript line a client that cannot use it reads. Each
 * recording is a step beyond the statement's own and one of the host's capped
 * effects. A statement of an extension the world does not pin, or pins and
 * this runtime holds no code for, records nothing (the spec's Activation and
 * absence).
 */
#include "stmt.h"

#include "../media.h"

static const sprout_extension_pin *pinned(const sprout_world *world, const char *name) {
  size_t i;
  for (i = 0; i < world->extension_count; i++)
    if (strcmp(world->extensions[i].name, name) == 0) return &world->extensions[i];
  return NULL;
}

sprout_eval_status stmt_extension_said(const sprout_frame *frame, const sprout_node *statement, sprout_speech *said,
                                       bool *recorded) {
  const char *extension = expr_ident(statement, "extension");
  const char *name = expr_ident(statement, "name");
  const sprout_node *arguments = sprout_node_get(statement, "arguments");
  const sprout_extension_pin *pin = pinned(frame->world, extension);
  sprout_value *values;
  size_t count = arguments == NULL ? 0 : arguments->count, i;
  *recorded = false;
  if (pin == NULL || !sprout_media_holds(extension, pin->major)) return SPROUT_EVAL_OK;
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
  memset(said, 0, sizeof *said);
  said->kind = SPROUT_SPEECH_RECORDED;
  said->extension = extension;
  said->statement = name;
  said->argument_count = count;
  said->arguments = values;
  EXPR_NEED(sprout_media_record(frame, name, count, values, &said->payload, &said->transcript));
  *recorded = true;
  return SPROUT_EVAL_OK;
}

sprout_eval_status stmt_extension(sprout_run *run, const sprout_frame *frame, const sprout_node *statement) {
  sprout_effect effect;
  bool recorded;
  EXPR_NEED(stmt_acting(run, frame, "an extension's statement"));
  memset(&effect, 0, sizeof effect);
  EXPR_NEED(stmt_extension_said(frame, statement, &effect.said, &recorded));
  if (!recorded) return SPROUT_EVAL_OK;
  effect.kind = SPROUT_EFFECT_EXTENSION;
  effect.by = frame->self;
  if (run->x->records_as_said) {
    EXPR_NEED(sprout_exec_hearers(run->x, frame, &effect.to, &effect.to_count));
  } else {
    EXPR_NEED(sprout_told_to(run->x, frame, frame->self, SPROUT_TELL_PLACE, &effect.to, &effect.to_count));
  }
  return sprout_exec_record(run->x, &effect);
}
