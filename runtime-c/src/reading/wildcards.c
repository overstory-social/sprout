/*
 * The plays a participant's kind runs for its role in a reading (the spec's
 * Verbs > Roles compose, The two passes). `as target for any` and `as tool
 * for any` play every verb at once by the category of the role the
 * participant fills, the target being the verb's first role and a tool any
 * other, and run before the participant's plays for the verb. The actor's
 * own part has no wildcard.
 */
#include <string.h>

#include "reading.h"

/* Whether `key` is exactly `as <role> for <library>.<verb>`, or `as <role> for <verb>` where library is NULL. */
static bool key_is(const char *key, const char *role, const char *library, const char *verb) {
  size_t n;
  if (strncmp(key, "as ", 3) != 0) return false;
  key += 3;
  n = strlen(role);
  if (strncmp(key, role, n) != 0) return false;
  key += n;
  if (strncmp(key, " for ", 5) != 0) return false;
  key += 5;
  if (library != NULL) {
    n = strlen(library);
    if (strncmp(key, library, n) != 0 || key[n] != '.') return false;
    key += n + 1;
  }
  return strcmp(key, verb) == 0;
}

static const sprout_play_group *group_for(const sprout_kind_def *kind, const char *role, const char *library,
                                          const char *verb) {
  size_t i;
  for (i = 0; i < kind->play_group_count; i++)
    if (key_is(kind->plays[i].key, role, library, verb)) return &kind->plays[i];
  return NULL;
}

void sprout_plays_for(const sprout_resolved *reading, const sprout_participant *who, const sprout_kind_def *kind,
                      sprout_plays *out) {
  const sprout_verb *verb = reading->verb;
  const sprout_play_group *own = group_for(kind, who->role == NULL ? "actor" : who->role->name, verb->library, verb->name);
  out->count = 0;
  if (who->role != NULL) {
    const sprout_play_group *any = group_for(kind, who->role == &verb->roles[0] ? "target" : "tool", NULL, "any");
    if (any != NULL) out->groups[out->count++] = any;
  }
  if (own != NULL) out->groups[out->count++] = own;
}
