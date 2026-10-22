/*
 * The plays a participant's kind runs for its role in a reading (the spec's
 * Verbs > Roles compose, The two passes). `as target for any` and `as tool
 * for any` play every verb at once by the category of the role the
 * participant fills, the target being the verb's first role and a tool any
 * other, and `as actor for any` the actor's own part of every verb; each
 * runs before the participant's plays for the verb, and none runs for a
 * verb its `except` names.
 */
#include <string.h>

#include "reading.h"

/* A group against the parts asked for, in the order the catalogue keeps a kind's groups: verb, then role, then library. */
static int against(const sprout_play_group *group, const char *role, const char *library, const char *verb) {
  int order = strcmp(group->verb, verb);
  if (order == 0) order = strcmp(group->role, role);
  if (order == 0)
    order = group->library == NULL ? (library == NULL ? 0 : -1) : library == NULL ? 1 : strcmp(group->library, library);
  return order;
}

/* The group whose key is exactly `as <role> for <library>.<verb>`, or `as <role> for <verb>` where library is NULL. */
static const sprout_play_group *group_for(const sprout_kind_def *kind, const char *role, const char *library,
                                          const char *verb) {
  size_t lo = 0, hi = kind->play_group_count;
  while (lo < hi) {
    size_t mid = lo + (hi - lo) / 2;
    int order = against(kind->plays_by_verb[mid], role, library, verb);
    if (order == 0) return kind->plays_by_verb[mid];
    if (order < 0) lo = mid + 1;
    else hi = mid;
  }
  return NULL;
}

const sprout_play_group *sprout_own_plays(const sprout_verb *verb, const char *role, const sprout_kind_def *kind) {
  return group_for(kind, role, verb->library, verb->name);
}

void sprout_plays_for(const sprout_resolved *reading, const sprout_participant *who, const sprout_kind_def *kind,
                      sprout_plays *out) {
  const sprout_verb *verb = reading->verb;
  const sprout_play_group *own = group_for(kind, who->role == NULL ? "actor" : who->role->name, verb->library, verb->name);
  const char *part = who->role == NULL ? "actor" : who->role == &verb->roles[0] ? "target" : "tool";
  const sprout_play_group *any = group_for(kind, part, NULL, "any");
  out->count = 0;
  if (any != NULL) out->groups[out->count++] = any;
  if (own != NULL) out->groups[out->count++] = own;
}

bool sprout_play_runs(const sprout_play *play, const sprout_verb *verb) {
  size_t i;
  for (i = 0; i < play->except_count; i++)
    if (strcmp(play->except[i].name, verb->name) == 0 && strcmp(play->except[i].library, verb->library) == 0)
      return false;
  return true;
}
