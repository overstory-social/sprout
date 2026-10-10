/*
 * What one reader may still be told this turn (the spec's Limits > Runtime budgets: output per
 * recipient; Other people > What this costs). Output is counted per recipient, and a turn never
 * faults because of who else was there: the actor's own past the host's figure faults the turn,
 * as any budget spent does, and anyone else's cuts them short, so they read what was said to
 * them up to the first whole line that did not fit and nothing after it, and the host is told
 * who was cut.
 */
#include "prose/prose.h"

sprout_eval_status prose_budget_fault(sprout_eval_fault *fault, const sprout_meter *meter) {
  size_t i;
  for (i = 0; i + 1 < sizeof fault->text && meter->fault.text[i] != '\0'; i++) fault->text[i] = meter->fault.text[i];
  fault->text[i] = '\0';
  fault->name = "BudgetExhausted";
  return SPROUT_EVAL_FAULT;
}

static prose_recipient *recipient_of(prose_output *output, sprout_str reader) {
  prose_recipient *slot;
  size_t i;
  for (i = 0; i < output->recipient_count; i++)
    if (sprout_str_same(output->recipients[i].reader, reader)) return &output->recipients[i];
  slot = (prose_recipient *)sprout_exec_grow(output->turn, (void **)&output->recipients, &output->recipient_count,
                                             &output->recipient_capacity, sizeof *slot);
  if (slot == NULL) return NULL;
  memset(slot, 0, sizeof *slot);
  slot->reader = reader;
  return slot;
}

sprout_eval_status prose_charge(prose_output *output, sprout_str reader, uint64_t characters, bool *told) {
  prose_recipient *recipient = recipient_of(output, reader);
  bool is_actor = output->has_actor && sprout_str_same(output->actor, reader);
  sprout_output_result result;
  *told = false;
  if (recipient == NULL) return SPROUT_EVAL_NO_MEMORY;
  if (recipient->cut) return SPROUT_EVAL_OK;
  result = sprout_meter_output(output->meter, &recipient->held, characters, is_actor);
  if (result == SPROUT_OUTPUT_FAULT) return prose_budget_fault(output->fault, output->meter);
  if (result == SPROUT_OUTPUT_CUT) {
    sprout_str *slot = (sprout_str *)sprout_exec_grow(output->turn, (void **)&output->cut, &output->cut_count,
                                                      &output->cut_capacity, sizeof *slot);
    recipient->cut = true;
    if (slot == NULL) return SPROUT_EVAL_NO_MEMORY;
    *slot = reader;
    return SPROUT_EVAL_OK;
  }
  *told = true;
  return SPROUT_EVAL_OK;
}
