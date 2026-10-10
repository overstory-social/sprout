/*
 * The options a reading's value roles offer (the spec's Verbs > Value roles, A role-player narrows
 * its own options; The runtime > The view). A value role binds only what some participant's `from`
 * hears, so the options are exactly those: for a `symbol` role, the options each participant's list
 * property holds now, and for an `integer` role, each range a participant's integer property or
 * literal range gives. They are the values the consent pass accepts, so a chip a client offers is
 * one a typed line would bind.
 */
#ifndef SPROUT_OPTIONS_H
#define SPROUT_OPTIONS_H

#include "reading/reading.h"

/* A whole-number range, both ends included. */
typedef struct sprout_option_range {
  double min, max;
} sprout_option_range;

/* What one value role of a reading can be filled with now. */
typedef struct sprout_role_options {
  const char *role;
  bool symbol; /* a symbol role; otherwise an integer role */
  size_t option_count;
  const sprout_str *options; /* each option some participant hears, first heard first */
  size_t range_count;
  const sprout_option_range *ranges; /* each range some participant hears, first heard first */
} sprout_role_options;

/*
 * The options of each value role of `reading`, in the order the verb declares its roles: every value
 * any participant's `from` hears, a step for each `from` asked. A role nobody narrows has none.
 */
sprout_eval_status sprout_value_options(sprout_exec *x, const sprout_frame *frame, const sprout_resolved *reading,
                                        const sprout_role_options **out, size_t *count);

#endif
