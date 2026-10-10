/*
 * A view as canonical JSON, for the tests and for a host that wants it as text (the spec's The runtime >
 * The view). The form is the one the view specs write: the description as paragraphs, the extension
 * effects it recorded, the ways out as `{direction, label, to}`, the occupants and what is carried as
 * `{id, name}`, and each reading as its verb, typed line, refusal, the filler of each role and the
 * options of each value role. What an extension's statements recorded in the description are `effects`, each with
 * its payload as JSON and its transcript line.
 */
#ifndef SPROUT_VIEW_JSON_H
#define SPROUT_VIEW_JSON_H

#include "json.h"
#include "sprout.h"

/* The view as a tree in `arena`; NULL when the host refuses a page. */
sprout_json *sprout_view_tree(sprout_arena *arena, const sprout_seen_view *view);

/* One filler of a reading, as the view writes it; NULL when the host refuses a page. */
sprout_json *sprout_seen_filler_json(sprout_arena *arena, const sprout_seen_filler *filler);

/* A reading's refusal, as the paragraphs the visitor reads, or null where every participant consents. */
sprout_json *sprout_seen_refusal_json(sprout_arena *arena, const sprout_seen_reading *reading);

/* A reading's value options, one entry for each value role. */
sprout_json *sprout_seen_options_json(sprout_arena *arena, const sprout_seen_reading *reading);

/* The view's canonical text, NUL-terminated, in the view's own arena: valid until sprout_view_free. */
sprout_status sprout_view_json(sprout_seen_view *view, const char **bytes, size_t *length);

#endif
