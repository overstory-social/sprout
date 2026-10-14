/*
 * The engine's `acted` (the spec's Prose > Engine lines; The command line): what one visitor typed, as another
 * playing from the same console reads it. It is no turn's effect and nobody in the world reads it, so it is
 * rendered as a poll renders: over the committed state, under the poll's own budget, drawing nothing and writing
 * nothing, with the reader as its one reader and the line found as every engine line is, on the actor, where they
 * stand and the world.
 */
#include <string.h>

#include "draft.h"
#include "exec.h"
#include "prose/prose.h"
#include "world.h"

/* The paragraphs, copied into `keep`; false when a page is refused. */
static bool kept(sprout_arena *keep, const prose_paragraphs *paragraphs, sprout_acted_line *out) {
  sprout_str *items = (sprout_str *)sprout_arena_take(keep, (paragraphs->count + 1) * sizeof *items);
  size_t i;
  if (items == NULL) return false;
  for (i = 0; i < paragraphs->count; i++) {
    items[i].bytes = sprout_arena_copy(keep, paragraphs->items[i].bytes, paragraphs->items[i].length);
    items[i].length = paragraphs->items[i].length;
    if (items[i].bytes == NULL) return false;
  }
  out->paragraphs = items;
  out->paragraph_count = paragraphs->count;
  return true;
}

sprout_status sprout_acted(sprout_world *world, sprout_state *state, const sprout_host *host, const char *reader,
                           const char *actor, const char *typed, size_t typed_length, sprout_arena *keep,
                           sprout_acted_line *out) {
  sprout_arena turn;
  sprout_draft draft;
  sprout_meter meter;
  sprout_eval_fault fault;
  sprout_exec x;
  sprout_frame frame;
  prose_reading reading;
  prose_paragraphs paragraphs;
  const sprout_stored_visitor *reading_visitor, *acting;
  const sprout_stored_instance *standing;
  sprout_str by, place = {NULL, 0};
  sprout_speech said;
  sprout_value words;
  sprout_binding bindings[2];
  sprout_eval_status eval;
  sprout_status status = SPROUT_OK;
  if (out == NULL) return SPROUT_BAD_HOST;
  memset(out, 0, sizeof *out);
  if (keep == NULL) return SPROUT_BAD_HOST;
  if (world == NULL || state == NULL || host == NULL || reader == NULL || actor == NULL || typed == NULL)
    return SPROUT_BAD_INPUT;
  if ((status = sprout_arena_init(&turn, host)) != SPROUT_OK) return status;
  if (sprout_draft_open(&draft, &turn, world, state) != SPROUT_DRAFT_OK) {
    sprout_arena_reset(&turn);
    return SPROUT_NO_MEMORY;
  }
  reading_visitor = sprout_draft_visitor(&draft, (sprout_str){reader, strlen(reader)});
  acting = sprout_draft_visitor(&draft, (sprout_str){actor, strlen(actor)});
  if (reading_visitor == NULL || acting == NULL) {
    sprout_arena_reset(&turn);
    return SPROUT_BAD_INPUT;
  }
  memset(&fault, 0, sizeof fault);
  sprout_meter_begin(&meter, host, SPROUT_TURN_POLL);
  sprout_exec_begin(&x, world, &draft, &turn, &meter, NULL, &fault, 0);
  frame = sprout_exec_frame(&x, reading_visitor->instance, NULL, NULL);
  standing = sprout_draft_instance(&draft, acting->instance);
  if (standing != NULL && standing->has_container) place = standing->container;
  sprout_engine_said(&frame, "acted", &acting->instance, place.bytes == NULL ? NULL : &place, &by, &said);
  if (!sprout_string(&turn, typed, typed_length, &words)) {
    sprout_arena_reset(&turn);
    return SPROUT_NO_MEMORY;
  }
  bindings[1].name = "actor";
  bindings[1].bound = sprout_evaluated_object(acting->instance);
  bindings[1].next = NULL;
  bindings[0].name = "reading";
  bindings[0].bound = sprout_evaluated_value(words);
  bindings[0].next = &bindings[1];
  memset(&reading, 0, sizeof reading);
  reading.world = world;
  reading.graph = &world->graph;
  reading.draft = &draft;
  reading.turn = &turn;
  reading.meter = &meter;
  reading.fault = &fault;
  reading.reader = reading_visitor->instance;
  eval = prose_render_speech(&reading, by, &said, bindings, false, &paragraphs);
  if (eval == SPROUT_EVAL_NO_MEMORY) status = SPROUT_NO_MEMORY;
  else if (eval != SPROUT_EVAL_OK) out->faulted = true;
  else if (!kept(keep, &paragraphs, out)) status = SPROUT_NO_MEMORY;
  sprout_arena_reset(&turn);
  if (status != SPROUT_OK) memset(out, 0, sizeof *out);
  return status;
}
