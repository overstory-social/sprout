/*
 * The visitor's view for the UI (the spec's The runtime > The view): the place, by id and as the
 * visitor reads it, its description as paragraphs, what its extension statements recorded (an image
 * to draw), the ways out, who else is there, what is carried. The readings the view also holds are
 * not sent: they are kept here, arranged as the chip tree the sentence builder walks, and handed to
 * Lua one level at a time (`sprout.chips`), each choice with whether anything under it can be done
 * and why not, so the whole tree is never on the Lua side. The view and its tree live until the next
 * view, the next load, the close or the end.
 */
#include <string.h>

#include "chips.h"
#include "session_internal.h"
#include "view.h"
#include "view_json.h"

/* The place of a visitor who is not standing anywhere: an empty id and name. */
static sprout_json *nowhere(jb *builder) {
  sprout_json *place = jb_object(builder, 2);
  jb_set(builder, place, "id", jb_string(builder, ""));
  jb_set(builder, place, "name", jb_string(builder, ""));
  return place;
}

/* The visitor's place as the view names it: `{ id, name }`, as an occupant is given. */
static sprout_json *place_of(jb *builder, const sprout_seen_view *view) {
  sprout_json *place = jb_object(builder, 2);
  jb_set(builder, place, "id", jb_str(builder, view->place.id));
  jb_set(builder, place, "name", jb_str(builder, view->place.name));
  return place;
}

/* A view that is only words: the visitor is not in the world, or the poll could not be made. */
static const char *nothing_to_see(player_session *session, const char *words) {
  sprout_arena arena;
  jb builder;
  sprout_json *root;
  if (!session_reply_begin(session, &arena, &builder)) return session_reply_end(session, &arena, &builder, NULL);
  root = jb_object(&builder, 8);
  jb_set(&builder, root, "place", nowhere(&builder));
  jb_set(&builder, root, "description", jb_array(&builder, 0));
  jb_set(&builder, root, "effects", jb_array(&builder, 0));
  jb_set(&builder, root, "exits", jb_array(&builder, 0));
  jb_set(&builder, root, "occupants", jb_array(&builder, 0));
  jb_set(&builder, root, "carried", jb_array(&builder, 0));
  jb_set(&builder, root, "faulted", jb_bool(&builder, false));
  jb_set(&builder, root, "words", jb_string(&builder, words));
  return session_reply_end(session, &arena, &builder, root);
}

/* Moves a member of the view's own tree under the reply's object. */
static void take(jb *builder, sprout_json *into, const sprout_json *from, const char *key) {
  jb_set(builder, into, key, (sprout_json *)sprout_json_get(from, key));
}

void session_drop_view(player_session *session) {
  if (!session->seen_live) return;
  sprout_view_free(&session->seen);
  memset(&session->seen, 0, sizeof session->seen);
  memset(&session->chips, 0, sizeof session->chips);
  session->seen_live = false;
}

const char *player_view(player_session *session) {
  sprout_seen_view *view = &session->seen;
  sprout_arena *arena;
  jb builder;
  sprout_json *root, *whole;
  const sprout_stored_visitor *visitor = session_visitor(session);
  sprout_status status;
  const char *reply;
  session_drop_view(session);
  if (session->state == NULL || visitor == NULL || !session_visitor_present(session, visitor))
    return nothing_to_see(session, "You are not in a world.");
  status = sprout_view(session->world, session->state, &session->host.record, PLAYER_VISIT, view);
  if (status != SPROUT_OK) {
    return nothing_to_see(session, status == SPROUT_BAD_INPUT ? view->fault.text : sprout_status_text(status));
  }
  session->seen_live = true;
  arena = sprout_view_arena(view);
  jb_begin(&builder, arena);
  whole = sprout_view_tree(arena, view);
  if (sprout_chip_tree_of(arena, view, &session->chips) != SPROUT_OK) builder.ok = false;
  root = jb_object(&builder, 8);
  if (whole == NULL) builder.ok = false;
  if (builder.ok) {
    jb_set(&builder, root, "place", place_of(&builder, view));
    take(&builder, root, whole, "description");
    take(&builder, root, whole, "effects");
    take(&builder, root, whole, "exits");
    take(&builder, root, whole, "occupants");
    take(&builder, root, whole, "carried");
    jb_set(&builder, root, "faulted", jb_bool(&builder, view->faulted));
  }
  if (builder.ok && jb_finish(&builder, session->pd, root, &session->reply)) return session->reply;
  reply = nothing_to_see(session, "The player ran out of memory looking around.");
  session_drop_view(session);
  return reply;
}

/* ---- the chips, a level at a time ---- */

/* Whether nothing at or below `node` can be done: its reading and every choice are refused. */
static bool refused_all(const sprout_chip_node *node) {
  size_t i;
  if (node->leaf != NULL && !node->leaf->refused) return false;
  for (i = 0; i < node->choice_count; i++)
    if (!refused_all(node->choices[i].next)) return false;
  return true;
}

/* Why nothing at or below `node` can be done: the first refused reading under it, or NULL. */
static const sprout_seen_reading *reason_under(const sprout_chip_node *node) {
  if (node->leaf != NULL && node->leaf->refused) return node->leaf;
  if (node->leaf == NULL && node->choice_count > 0) return reason_under(node->choices[0].next);
  return NULL;
}

/* A refusal's paragraphs as one line, or null. */
static sprout_json *reason_json(jb *builder, sprout_arena *arena, const sprout_seen_reading *refused) {
  size_t total = 0, i, at = 0;
  char *joined;
  if (refused == NULL) return jb_null(builder);
  for (i = 0; i < refused->refusal_count; i++) total += refused->refusal[i].length + 1;
  joined = (char *)sprout_arena_take(arena, total + 1);
  if (joined == NULL) {
    builder->ok = false;
    return NULL;
  }
  for (i = 0; i < refused->refusal_count; i++) {
    if (i > 0) joined[at++] = ' ';
    memcpy(joined + at, refused->refusal[i].bytes, refused->refusal[i].length);
    at += refused->refusal[i].length;
  }
  joined[at] = '\0';
  return jb_text(builder, joined, at);
}

/* The node `path` names (the verb's, then each choice's), or NULL when the path names nothing; `*root` where it is empty. */
static const sprout_chip_node *node_at(const player_session *session, const sprout_json *path, bool *root) {
  const sprout_chip_node *node = NULL;
  size_t i;
  *root = path->count == 0;
  for (i = 0; i < path->count; i++) {
    const sprout_json *step = path->items[i];
    double at;
    if (step->kind != SPROUT_JSON_NUMBER) return NULL;
    at = step->number;
    if (at < 1 || at != (double)(size_t)at) return NULL;
    if (i == 0) {
      if ((size_t)at > session->chips.verb_count) return NULL;
      node = session->chips.verbs[(size_t)at - 1].next;
    } else {
      if ((size_t)at > node->choice_count) return NULL;
      node = node->choices[(size_t)at - 1].next;
    }
  }
  return node;
}

static const char *no_level(player_session *session, sprout_arena *arena, jb *builder, const char *reason) {
  sprout_json *root = jb_object(builder, 2);
  jb_set(builder, root, "ok", jb_bool(builder, false));
  jb_set(builder, root, "reason", jb_string(builder, reason));
  return session_reply_end(session, arena, builder, root);
}

const char *player_chips(player_session *session, const char *path_text) {
  sprout_arena arena;
  jb builder;
  sprout_json *path, *root, *choices;
  sprout_json_error error;
  const sprout_chip_node *node = NULL;
  bool at_root = false;
  size_t i;
  if (!session_reply_begin(session, &arena, &builder)) return session_reply_end(session, &arena, &builder, NULL);
  if (!session->seen_live) return no_level(session, &arena, &builder, "No view has been polled.");
  if (path_text == NULL) path_text = "[]";
  if (sprout_json_read(&arena, path_text, strlen(path_text), &path, &error) != SPROUT_OK ||
      path->kind != SPROUT_JSON_ARRAY || ((node = node_at(session, path, &at_root)) == NULL && !at_root))
    return no_level(session, &arena, &builder, "The path names no choice of the tree.");
  root = jb_object(&builder, 2);
  if (at_root) {
    choices = jb_array(&builder, session->chips.verb_count);
    for (i = 0; i < session->chips.verb_count; i++) {
      const sprout_chip_verb *verb = &session->chips.verbs[i];
      sprout_json *choice = jb_object(&builder, 3);
      jb_set(&builder, choice, "verb", jb_string(&builder, verb->verb));
      jb_set(&builder, choice, "greyed", jb_bool(&builder, refused_all(verb->next)));
      jb_set(&builder, choice, "reason", reason_json(&builder, &arena, reason_under(verb->next)));
      jb_set(&builder, choices, NULL, choice);
    }
    jb_set(&builder, root, "choices", choices);
    jb_set(&builder, root, "leaf", jb_null(&builder));
  } else {
    choices = jb_array(&builder, node->choice_count);
    for (i = 0; i < node->choice_count; i++) {
      const sprout_chip_choice *one = &node->choices[i];
      sprout_json *choice = jb_object(&builder, 3), *filler = sprout_seen_filler_json(&arena, one->filler);
      if (filler == NULL) builder.ok = false;
      jb_set(&builder, choice, "filler", filler);
      jb_set(&builder, choice, "greyed", jb_bool(&builder, refused_all(one->next)));
      jb_set(&builder, choice, "reason", reason_json(&builder, &arena, reason_under(one->next)));
      jb_set(&builder, choices, NULL, choice);
    }
    jb_set(&builder, root, "choices", choices);
    if (node->leaf == NULL) {
      jb_set(&builder, root, "leaf", jb_null(&builder));
    } else {
      sprout_json *leaf = sprout_chip_leaf_json(&arena, node->leaf);
      if (leaf == NULL) builder.ok = false;
      jb_set(&builder, root, "leaf", leaf);
    }
  }
  return session_reply_end(session, &arena, &builder, root);
}
