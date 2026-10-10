/*
 * The visitor's view for the UI (the spec's The runtime > The view): the place, by id and as the
 * visitor reads it, its description as paragraphs, what its extension statements recorded (an image
 * to draw), the ways out, who else is there, what is carried, and the chip tree the sentence builder
 * walks. The flat list of readings the view also holds is not sent: the tree
 * holds every one of them, grouped by verb and by what fills each role.
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
  root = jb_object(&builder, 9);
  jb_set(&builder, root, "place", nowhere(&builder));
  jb_set(&builder, root, "description", jb_array(&builder, 0));
  jb_set(&builder, root, "effects", jb_array(&builder, 0));
  jb_set(&builder, root, "exits", jb_array(&builder, 0));
  jb_set(&builder, root, "occupants", jb_array(&builder, 0));
  jb_set(&builder, root, "carried", jb_array(&builder, 0));
  jb_set(&builder, root, "chips", jb_array(&builder, 0));
  jb_set(&builder, root, "faulted", jb_bool(&builder, false));
  jb_set(&builder, root, "words", jb_string(&builder, words));
  return session_reply_end(session, &arena, &builder, root);
}

/* Moves a member of the view's own tree under the reply's object. */
static void take(jb *builder, sprout_json *into, const sprout_json *from, const char *key) {
  jb_set(builder, into, key, (sprout_json *)sprout_json_get(from, key));
}

const char *player_view(player_session *session) {
  sprout_seen_view view;
  sprout_chip_tree tree;
  sprout_arena *arena;
  jb builder;
  sprout_json *root, *whole, *chips;
  const sprout_stored_visitor *visitor = session_visitor(session);
  sprout_status status;
  const char *reply;
  if (session->state == NULL || visitor == NULL || !session_visitor_present(session, visitor))
    return nothing_to_see(session, "You are not in a world.");
  status = sprout_view(session->world, session->state, &session->host.record, PLAYER_VISIT, &view);
  if (status != SPROUT_OK) {
    return nothing_to_see(session, status == SPROUT_BAD_INPUT ? view.fault.text : sprout_status_text(status));
  }
  arena = sprout_view_arena(&view);
  jb_begin(&builder, arena);
  whole = sprout_view_tree(arena, &view);
  if (sprout_chip_tree_of(arena, &view, &tree) != SPROUT_OK) builder.ok = false;
  chips = builder.ok ? sprout_chip_tree_json(arena, &tree) : NULL;
  root = jb_object(&builder, 9);
  if (whole == NULL || chips == NULL) builder.ok = false;
  if (builder.ok) {
    jb_set(&builder, root, "place", place_of(&builder, &view));
    take(&builder, root, whole, "description");
    take(&builder, root, whole, "effects");
    take(&builder, root, whole, "exits");
    take(&builder, root, whole, "occupants");
    take(&builder, root, whole, "carried");
    jb_set(&builder, root, "chips", chips);
    jb_set(&builder, root, "faulted", jb_bool(&builder, view.faulted));
  }
  if (builder.ok && jb_finish(&builder, session->pd, root, &session->reply)) reply = session->reply;
  else reply = nothing_to_see(session, "The player ran out of memory looking around.");
  sprout_view_free(&view);
  return reply;
}
