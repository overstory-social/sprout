/*
 * The reading pass an `act` runs on the spot (the spec's Verbs > The two
 * passes, Acting). The pass itself is C07's: until it lands, running a
 * reading ends with the status `not_built` and words that say so, which the
 * `act` statement reports as an engine error rather than going on as though
 * the reading had run.
 */
#include "exec.h"

sprout_eval_status sprout_run_reading(sprout_exec *x, const sprout_frame *frame, sprout_str actor, const char *verb,
                                      size_t role_count, const sprout_pending_role *roles, sprout_reading_end *end,
                                      const char **not_built) {
  (void)x;
  (void)frame;
  (void)actor;
  (void)verb;
  (void)role_count;
  (void)roles;
  *end = SPROUT_READING_NOT_BUILT;
  *not_built = "An `act` runs a reading through the consent and effect passes, and the reading pass is not built yet.";
  return SPROUT_EVAL_OK;
}
