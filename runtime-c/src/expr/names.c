/*
 * What a name written in a body reaches (the spec's Identifiers and scope;
 * Object identity): the world, a declared object by its path, a copy the
 * running instance's own body declares, or what is nearest the running
 * instance by what each container holds now. A name read at run time reaches
 * only what is in range of `self`, and narrowing a name with `is(K)` binds it
 * to what it reached, so that a move inside the branch cannot change it.
 */
#include "expr.h"

const sprout_binding *expr_binding(const sprout_frame *frame, const char *name) {
  const sprout_binding *bound;
  for (bound = frame->bindings; bound != NULL; bound = bound->next)
    if (strcmp(bound->name, name) == 0) return bound;
  return NULL;
}

const sprout_binding *sprout_bind(const sprout_frame *frame, const char *name, sprout_evaluated bound) {
  sprout_binding *made = (sprout_binding *)sprout_arena_take(frame->turn, sizeof *made);
  if (made == NULL) return NULL;
  made->name = name;
  made->bound = bound;
  made->next = frame->bindings;
  return made;
}

static sprout_str world_of(const sprout_frame *frame) { return frame->draft->base->world; }

/* `prefix.a.b` from a prefix id and an array node of names. */
static sprout_eval_status joined(const sprout_frame *frame, sprout_str prefix, const sprout_node *parts,
                                 sprout_str *out) {
  size_t length = prefix.length, i;
  char *text, *at;
  for (i = 0; parts != NULL && i < parts->count; i++) length += 1 + strlen(parts->items[i]->text);
  text = (char *)sprout_arena_take(frame->turn, length + 1);
  if (text == NULL) return SPROUT_EVAL_NO_MEMORY;
  memcpy(text, prefix.bytes, prefix.length);
  at = text + prefix.length;
  for (i = 0; parts != NULL && i < parts->count; i++) {
    size_t n = strlen(parts->items[i]->text);
    *at++ = '.';
    memcpy(at, parts->items[i]->text, n);
    at += n;
  }
  out->bytes = text;
  out->length = length;
  return SPROUT_EVAL_OK;
}

/* Whether an id is the world's or declared under it, rather than minted. */
static bool declared_form(const sprout_frame *frame, sprout_str id) {
  sprout_str world = world_of(frame);
  if (sprout_str_same(id, world)) return true;
  return id.length > world.length && memcmp(id.bytes, world.bytes, world.length) == 0 &&
         id.bytes[world.length] == '.';
}

/* The declared object an id names, faulting where it was destroyed; *found is false where nothing is decoded under it. */
static sprout_eval_status named_object(const sprout_frame *frame, sprout_str id, sprout_str *out, bool *found) {
  expr_text text;
  *found = false;
  if (!declared_form(frame, id)) {
    text = expr_text_begin(frame);
    expr_put(&text, "`");
    expr_put_str(&text, id);
    expr_put(&text, "` is minted, and a name reaches only what is declared.");
    frame->fault->name = "Error";
    return SPROUT_EVAL_ENGINE;
  }
  if (sprout_draft_tombstoned(frame->draft, id)) {
    text = expr_text_begin(frame);
    expr_put(&text, "`");
    expr_put_str(&text, id);
    expr_put(&text, "` was destroyed, and a declared object destroyed is gone for good.");
    return expr_fail(frame, "DestroyedReference");
  }
  if (expr_instance(frame, id) != NULL) {
    *out = id;
    *found = true;
  }
  return SPROUT_EVAL_OK;
}

/* Whether a step of a name is answered by a decoded instance. */
static bool answers_to(const sprout_frame *frame, const sprout_stored_instance *instance, const sprout_node *step,
                       bool identifiers) {
  const char *name = sprout_node_text(step, "name");
  size_t length = name == NULL ? 0 : strlen(name);
  switch (instance->made) {
    case SPROUT_MADE_WORLD:
    case SPROUT_MADE_VISITOR:
      return false;
    case SPROUT_MADE_DECLARED: {
      sprout_str id = instance->id;
      size_t at = id.length;
      if (!declared_form(frame, id) || sprout_str_same(id, world_of(frame))) return false;
      while (at > 0 && id.bytes[at - 1] != '.') at--;
      return id.length - at == length && memcmp(id.bytes + at, name, length) == 0;
    }
    case SPROUT_MADE_GIVEN:
      return instance->path_count > 0 && instance->path[instance->path_count - 1].length == length &&
             memcmp(instance->path[instance->path_count - 1].bytes, name, length) == 0;
    case SPROUT_MADE_SPAWNED: {
      const sprout_node *made_of = sprout_node_get(step, "madeOf");
      size_t i, j;
      if (identifiers) return false;
      for (i = 0; made_of != NULL && i < made_of->count; i++) {
        const sprout_node *kinds = made_of->items[i];
        bool all = kinds->count > 0;
        for (j = 0; j < kinds->count && all; j++) all = expr_composes(instance->kind, kinds->items[j]->text);
        if (all) return true;
      }
      return false;
    }
  }
  return false;
}

/* The first thing `holder` holds now, in its contents order, that answers to `step`. */
static sprout_eval_status held_as(const sprout_frame *frame, sprout_str holder, const sprout_node *step,
                                  bool identifiers, sprout_str *out, bool *found) {
  const sprout_str *held;
  size_t count, i;
  *found = false;
  if (sprout_draft_children(frame->draft, holder, &held, &count) != SPROUT_DRAFT_OK) return SPROUT_EVAL_NO_MEMORY;
  for (i = 0; i < count; i++) {
    const sprout_stored_instance *instance = expr_instance(frame, held[i]);
    if (instance != NULL && answers_to(frame, instance, step, identifiers)) {
      *out = held[i];
      *found = true;
      return SPROUT_EVAL_OK;
    }
  }
  return SPROUT_EVAL_OK;
}

/* What `steps` reach from `self`, judged by contents: the first among what `self` holds, else what each container outward holds. */
static sprout_eval_status nearest(const sprout_frame *frame, const sprout_node *steps, bool identifiers,
                                  sprout_str *out, bool *found) {
  sprout_str holder = frame->self, at;
  size_t i;
  *found = false;
  if (steps == NULL || steps->count == 0) return SPROUT_EVAL_OK;
  for (;;) {
    bool here;
    const sprout_stored_instance *instance;
    EXPR_NEED(held_as(frame, holder, steps->items[0], identifiers, &at, &here));
    if (here) {
      for (i = 1; i < steps->count; i++) {
        EXPR_NEED(held_as(frame, at, steps->items[i], identifiers, &at, &here));
        if (!here) return SPROUT_EVAL_OK;
      }
      *out = at;
      *found = true;
      return SPROUT_EVAL_OK;
    }
    instance = expr_instance(frame, holder);
    if (instance == NULL || !instance->has_container) return SPROUT_EVAL_OK;
    holder = instance->container;
  }
}

/* Appends what `id` holds to the queue. */
static sprout_eval_status enqueue(const sprout_frame *frame, sprout_str id, sprout_str **queue, size_t *count,
                                  size_t *capacity) {
  const sprout_str *held;
  size_t n, i;
  if (sprout_draft_children(frame->draft, id, &held, &n) != SPROUT_DRAFT_OK) return SPROUT_EVAL_NO_MEMORY;
  for (i = 0; i < n; i++) {
    if (*count == *capacity) {
      size_t wanted = *capacity == 0 ? 8 : *capacity * 2;
      sprout_str *bigger = (sprout_str *)sprout_arena_take(frame->turn, wanted * sizeof *bigger);
      if (bigger == NULL) return SPROUT_EVAL_NO_MEMORY;
      if (*count > 0) memcpy(bigger, *queue, *count * sizeof *bigger);
      *queue = bigger;
      *capacity = wanted;
    }
    (*queue)[(*count)++] = held[i];
  }
  return SPROUT_EVAL_OK;
}

/* The first instance inside `holder`, breadth-first, made as `giver`'s copy at `path`. */
static sprout_eval_status given_inside(const sprout_frame *frame, sprout_str holder, const char *giver,
                                       const sprout_node *path, sprout_str *out, bool *found) {
  sprout_str *queue = NULL;
  size_t count = 0, capacity = 0, head, j;
  *found = false;
  EXPR_NEED(enqueue(frame, holder, &queue, &count, &capacity));
  for (head = 0; head < count; head++) {
    const sprout_stored_instance *instance = expr_instance(frame, queue[head]);
    if (instance != NULL && instance->made == SPROUT_MADE_GIVEN && sprout_str_is(instance->made_kind, giver) &&
        instance->path_count == path->count) {
      bool same = true;
      for (j = 0; j < path->count && same; j++) same = sprout_str_is(instance->path[j], path->items[j]->text);
      if (same) {
        *out = queue[head];
        *found = true;
        return SPROUT_EVAL_OK;
      }
    }
    EXPR_NEED(enqueue(frame, queue[head], &queue, &count, &capacity));
  }
  return SPROUT_EVAL_OK;
}

/* The instance `named` reaches from `self`'s body; *found is false where nothing is decoded there now. */
static sprout_eval_status object_named(const sprout_frame *frame, const sprout_node *named, bool identifiers,
                                       sprout_str *out, bool *found) {
  const char *how = sprout_node_text(named, "names");
  *found = false;
  if (how == NULL) return expr_unchecked(frame, "a name the table does not resolve");
  if (strcmp(how, "world") == 0) {
    *out = world_of(frame);
    *found = true;
    return SPROUT_EVAL_OK;
  }
  if (strcmp(how, "declared") == 0) {
    sprout_str id;
    EXPR_NEED(joined(frame, world_of(frame), sprout_node_get(named, "path"), &id));
    return named_object(frame, id, out, found);
  }
  if (strcmp(how, "own") == 0) {
    if (declared_form(frame, frame->self)) {
      sprout_str id;
      EXPR_NEED(joined(frame, frame->self, sprout_node_get(named, "parts"), &id));
      return named_object(frame, id, out, found);
    } else {
      const sprout_node *steps = sprout_node_get(named, "steps");
      sprout_str here = frame->self;
      size_t i;
      for (i = 0; steps != NULL && i < steps->count; i++) {
        bool at;
        EXPR_NEED(given_inside(frame, here, sprout_node_text(steps->items[i], "giver"),
                               sprout_node_get(steps->items[i], "path"), &here, &at));
        if (!at) return SPROUT_EVAL_OK;
      }
      *out = here;
      *found = true;
      return SPROUT_EVAL_OK;
    }
  }
  if (strcmp(how, "placed") == 0) return nearest(frame, sprout_node_get(named, "steps"), identifiers, out, found);
  return expr_unchecked(frame, "a name the table resolves in a way this runtime does not know");
}

sprout_eval_status expr_named_object(const sprout_frame *frame, const sprout_node *named, sprout_str *out,
                                     bool *found) {
  return object_named(frame, named, false, out, found);
}

sprout_eval_status expr_named_identifier(const sprout_frame *frame, const sprout_node *named, sprout_str *out,
                                         bool *found) {
  return object_named(frame, named, true, out, found);
}

sprout_eval_status expr_name_out_of_range(const sprout_frame *frame, const char *written, bool found,
                                          sprout_str target) {
  expr_text text = expr_text_begin(frame);
  if (!found) {
    expr_put(&text, "`");
    expr_put(&text, written);
    expr_put(&text, "` reaches nothing here now, so `");
    expr_put_str(&text, frame->self);
    expr_put(&text, "` could not read through it.");
  } else {
    expr_put(&text, "`");
    expr_put_str(&text, target);
    expr_put(&text, "` is out of range of `");
    expr_put_str(&text, frame->self);
    expr_put(&text, "`, so it could not be read through `");
    expr_put(&text, written);
    expr_put(&text, "`.");
  }
  return expr_fail(frame, "NameOutOfRange");
}

sprout_eval_status expr_reached_by_name(const sprout_frame *frame, const sprout_node *named, const char *written,
                                        sprout_str *out) {
  sprout_str target = {NULL, 0};
  bool found, in_range = false;
  EXPR_NEED(object_named(frame, named, false, &target, &found));
  if (found && expr_live(frame, target)) EXPR_NEED(expr_reaches(frame, frame->self, target, NULL, &in_range));
  if (!found || !in_range) return expr_name_out_of_range(frame, written, found, target);
  *out = target;
  return SPROUT_EVAL_OK;
}

sprout_eval_status expr_narrowed(const sprout_frame *frame, const sprout_node *operand, sprout_frame *out) {
  const sprout_node *receiver, *key = NULL, *named;
  const char *written = NULL;
  const sprout_binding *bound;
  sprout_str reached;
  *out = *frame;
  if (expr_kind_of(operand) != EXPR_CALL || strcmp(expr_ident(operand, "method"), "is") != 0) return SPROUT_EVAL_OK;
  if (expr_argument_count(operand) != 1) return SPROUT_EVAL_OK;
  receiver = sprout_node_get(operand, "receiver");
  /* A name, or a dotted path, which is bound by its text as written. */
  if (expr_kind_of(receiver) == EXPR_BINDING) {
    written = expr_ident(receiver, "name");
    key = sprout_node_get(receiver, "name");
  } else if (expr_kind_of(receiver) == EXPR_MEMBER) {
    EXPR_NEED(expr_written_members(frame, receiver, &written));
    key = receiver;
  }
  if (written == NULL || key == NULL) return SPROUT_EVAL_OK;
  if (strcmp(written, "self") == 0 || expr_binding(frame, written) != NULL) return SPROUT_EVAL_OK;
  named = sprout_world_bound(frame->world, key);
  if (named == NULL || !sprout_node_is(sprout_node_get(named, "names"), "placed")) return SPROUT_EVAL_OK;
  EXPR_NEED(expr_reached_by_name(frame, named, written, &reached));
  bound = sprout_bind(frame, written, sprout_evaluated_object(reached));
  if (bound == NULL) return SPROUT_EVAL_NO_MEMORY;
  out->bindings = bound;
  return SPROUT_EVAL_OK;
}
