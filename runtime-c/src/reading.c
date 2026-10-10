/*
 * A reading, run (the spec's Verbs > The two passes, Acting; Limits >
 * Runtime budgets). The consent pass, then, where nobody refused, the effect
 * pass, once each set role is checked against the host's cap on what one
 * binds. An `act` builds its reading from what its roles evaluated to, every
 * thing it names live and in the actor's range, runs it one deeper against
 * the cascade depth, and says a refusal to whoever would hear the actor; what
 * the reading says, tells and sends joins the body that performed it.
 */
#include <string.h>

#include "expr/expr.h"
#include "reading/reading.h"

const sprout_verb *sprout_verb_named(const sprout_world *world, const char *library, const char *name) {
  const char *slash = strchr(library, '/');
  size_t own = slash == NULL ? strlen(library) : (size_t)(slash - library), i;
  for (i = 0; i < world->verb_count; i++) {
    const sprout_verb *verb = world->verbs[i];
    if (strlen(verb->library) == own && memcmp(verb->library, library, own) == 0 && strcmp(verb->name, name) == 0)
      return verb;
  }
  for (i = 0; i < world->verb_count; i++)
    if (strcmp(world->verbs[i]->library, "sprout") == 0 && strcmp(world->verbs[i]->name, name) == 0)
      return world->verbs[i];
  return NULL;
}

sprout_bound_kind sprout_role_takes(const sprout_role *role) {
  if (role->filler == SPROUT_FILLER_EXIT) return SPROUT_BOUND_EXIT;
  if (role->filler == SPROUT_FILLER_SYMBOL || role->filler == SPROUT_FILLER_INTEGER) return SPROUT_BOUND_VALUE;
  return role->many ? SPROUT_BOUND_SET : SPROUT_BOUND_OBJECT;
}

sprout_eval_status sprout_perform(sprout_exec *x, const sprout_frame *frame, const sprout_resolved *reading,
                                  sprout_reading_end *end, sprout_permit_refusal *refusal) {
  bool refused;
  size_t i, owed_from = x->owed_count;
  for (i = 0; i < reading->verb->role_count; i++) {
    const sprout_role *role = &reading->verb->roles[i];
    const sprout_filled *held = &reading->roles[i];
    if (!held->filled) continue;
    if (held->bound.kind != sprout_role_takes(role)) {
      expr_text text = expr_text_begin(frame);
      expr_put(&text, "a reading of `");
      expr_put(&text, reading->verb->name);
      expr_put(&text, "` fills `");
      expr_put(&text, role->name);
      expr_put(&text, "` with what it does not take.");
      frame->fault->name = "Error";
      return SPROUT_EVAL_ENGINE;
    }
    if (held->bound.kind == SPROUT_BOUND_SET && !sprout_meter_set_role(x->meter, held->bound.set_count))
      return expr_budget_fault(frame);
  }
  EXPR_NEED(sprout_consent_pass(x, frame, reading, &refused, refusal));
  if (refused) {
    *end = SPROUT_READING_REFUSED;
    return SPROUT_EVAL_OK;
  }
  EXPR_NEED(sprout_effect_pass(x, frame, reading));
  /* A typed command's descriptions are read once everything its participants said is said. */
  if (x->acting == 0)
    for (i = owed_from; i < x->owed_count; i++) x->owed[i].after = x->effect_count;
  *end = sprout_draft_instance(x->draft, reading->actor) == NULL ? SPROUT_READING_GONE : SPROUT_READING_ACTED;
  return SPROUT_EVAL_OK;
}

/* ---- an `act` ---- */

/*
 * An `act` that could not be performed, as a `move` of something out of range
 * is: faulted, because the turn cannot do what it was asked. An NPC is
 * governed by every rule that governs a person, and a person names only what
 * is in range; so every thing an `act` names must be live and in the actor's
 * range, the walk charged to steps like any other.
 */
static sprout_eval_status in_range(const sprout_frame *frame, sprout_str actor, const sprout_verb *verb, sprout_str id) {
  bool near = false;
  if (expr_live(frame, id)) EXPR_NEED(expr_reaches(frame, actor, id, NULL, &near));
  if (!near) {
    expr_text text = expr_text_begin(frame);
    expr_put(&text, "`");
    expr_put_str(&text, id);
    expr_put(&text, "` is out of range of `");
    expr_put_str(&text, actor);
    expr_put(&text, "`, so `");
    expr_put(&text, verb->name);
    expr_put(&text, "` could not be performed with it.");
    return expr_fail(frame, "ActFault");
  }
  return SPROUT_EVAL_OK;
}

/* What fills one role, as the role takes it: one thing standing for a set of one in a role marked `many`. */
static sprout_eval_status filled_by(const sprout_frame *frame, sprout_str actor, const sprout_verb *verb,
                                    const sprout_role *role, const sprout_evaluated *evaluated, sprout_filled *out) {
  size_t i;
  memset(out, 0, sizeof *out);
  out->filled = true;
  switch (evaluated->binds) {
    case SPROUT_BINDS_VALUE:
      out->bound.kind = SPROUT_BOUND_VALUE;
      if (evaluated->value.kind == SPROUT_STRING) {
        out->bound.value_is_string = true;
        out->bound.value_string.bytes = evaluated->value.as.string.bytes;
        out->bound.value_string.length = evaluated->value.as.string.length;
      } else if (evaluated->value.kind == SPROUT_NUMBER) {
        out->bound.value_number = evaluated->value.as.number;
      } else {
        return expr_engine(frame, "an `act` filled a role with a value no role takes.");
      }
      return SPROUT_EVAL_OK;
    case SPROUT_BINDS_OBJECT:
      EXPR_NEED(in_range(frame, actor, verb, evaluated->id));
      if (!role->many) {
        out->bound.kind = SPROUT_BOUND_OBJECT;
        out->bound.object = evaluated->id;
        return SPROUT_EVAL_OK;
      }
      out->bound.kind = SPROUT_BOUND_SET;
      out->bound.set = (sprout_str *)sprout_arena_take(frame->turn, sizeof *out->bound.set);
      if (out->bound.set == NULL) return SPROUT_EVAL_NO_MEMORY;
      out->bound.set[0] = evaluated->id;
      out->bound.set_count = 1;
      return SPROUT_EVAL_OK;
    case SPROUT_BINDS_SET:
      if (!role->many) {
        expr_text text = expr_text_begin(frame);
        expr_put(&text, "a set filled `");
        expr_put(&text, role->name);
        expr_put(&text, "`, which is not marked `many`.");
        frame->fault->name = "Error";
        return SPROUT_EVAL_ENGINE;
      }
      out->bound.kind = SPROUT_BOUND_SET;
      out->bound.set = (sprout_str *)sprout_arena_take(frame->turn, (evaluated->count + 1) * sizeof *out->bound.set);
      if (out->bound.set == NULL) return SPROUT_EVAL_NO_MEMORY;
      for (i = 0; i < evaluated->count; i++) {
        EXPR_NEED(in_range(frame, actor, verb, evaluated->items[i]));
        out->bound.set[i] = evaluated->items[i];
      }
      out->bound.set_count = evaluated->count;
      return SPROUT_EVAL_OK;
    case SPROUT_BINDS_READINGS:
      break;
  }
  return expr_engine(frame, "`act` filled a role with `readings`, which a passage cannot name.");
}

/* The participants' ids, for deciding who hears the actor. */
static sprout_eval_status ids_of(sprout_exec *x, const sprout_resolved *reading, const sprout_str **ids, size_t *count) {
  const sprout_participant *participants;
  sprout_str *found;
  size_t n, i;
  EXPR_NEED(sprout_participants(x, reading, &participants, &n));
  found = (sprout_str *)sprout_arena_take(x->turn, (n + 1) * sizeof *found);
  if (found == NULL) return SPROUT_EVAL_NO_MEMORY;
  for (i = 0; i < n; i++) found[i] = participants[i].id;
  *ids = found;
  *count = n;
  return SPROUT_EVAL_OK;
}

sprout_eval_status sprout_run_reading(sprout_exec *x, const sprout_frame *frame, sprout_str actor, const char *written,
                                      size_t role_count, const sprout_pending_role *named, sprout_reading_end *end) {
  const sprout_verb *verb;
  sprout_filled *roles;
  sprout_resolved reading;
  sprout_permit_refusal refusal;
  sprout_eval_status status;
  size_t i, j;
  /* An `act` runs one deeper than the reading or the event it stands in. */
  x->meter->cascade_depth = x->depth - 1 + x->acting;
  if (!sprout_meter_enter_cascade(x->meter)) return expr_budget_fault(frame);
  verb = sprout_verb_named(x->world, frame->library, written);
  if (verb == NULL)
    return expr_engine(frame, "`act` reached the runtime, and no verb of that name is in reach; the checker refuses it.");
  roles = (sprout_filled *)sprout_arena_take(x->turn, (verb->role_count + 1) * sizeof *roles);
  if (roles == NULL) return SPROUT_EVAL_NO_MEMORY;
  for (i = 0; i < role_count; i++) {
    for (j = 0; j < verb->role_count && strcmp(verb->roles[j].name, named[i].role) != 0; j++) {}
    if (j == verb->role_count) {
      expr_text text = expr_text_begin(frame);
      expr_put(&text, "`act ");
      expr_put(&text, verb->name);
      expr_put(&text, "` names `");
      expr_put(&text, named[i].role);
      expr_put(&text, "`, which it does not declare.");
      frame->fault->name = "Error";
      return SPROUT_EVAL_ENGINE;
    }
    EXPR_NEED(filled_by(frame, actor, verb, &verb->roles[j], &named[i].filler, &roles[j]));
  }
  reading.verb = verb;
  reading.actor = actor;
  reading.roles = roles;
  x->acting++;
  status = sprout_perform(x, frame, &reading, end, &refusal);
  x->acting--;
  if (status != SPROUT_EVAL_OK) return status;
  if (*end == SPROUT_READING_REFUSED) {
    /* A refusal is said to whoever would hear the actor, as that reading's own `do`s would be. */
    sprout_hearing saved;
    const sprout_str *ids;
    size_t count;
    EXPR_NEED(ids_of(x, &reading, &ids, &count));
    EXPR_NEED(sprout_hear_reading(x, frame, actor, ids, count, &saved));
    status = sprout_record_refusal(x, frame, &refusal.refusal);
    sprout_hearing_restore(x, &saved);
  }
  return status;
}
