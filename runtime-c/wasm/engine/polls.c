/*
 * The view in its parts (the spec's The runtime > The view), polled over the live state, each answered in the
 * language's shape with the poll's fault laid against the visitor's place, or null: the whole view
 * `{"view", "fault"}`; the scene `{"scene", "fault"}`, the view but its readings with the verbs whose readings may be
 * asked for, each with the phrases a visitor types it by; and one verb's readings `{"readings", "fault"}`.
 */
#include <string.h>

#include "engine.h"
#include "logged.h"
#include "view_json.h"
#include "world.h"

/* The poll's fault in the language's shape, laid against the visitor's place, or null where it did not fault. */
static sprout_json *fault_of(wasm_engine *e, const sprout_seen_view *view) {
  sprout_fault_about about;
  if (!view->faulted) return engine_null(e);
  memset(&about, 0, sizeof about);
  about.has_object = view->fault_object.bytes != NULL;
  about.object = view->fault_object;
  return sprout_logged_fault(&e->scratch, view->fault_name, (sprout_str){view->fault.text, strlen(view->fault.text)},
                             &about, false);
}

/* `{"<what>": part, "fault": fault}` as the answer. */
static int answer_polled(wasm_engine *e, const char *what, sprout_json *part, sprout_json *fault) {
  sprout_json *root = sprout_json_make(&e->scratch, SPROUT_JSON_OBJECT, 2);
  if (root == NULL || part == NULL || fault == NULL) return SPROUT_NO_MEMORY;
  sprout_json_adopt(root, what, part);
  sprout_json_adopt(root, "fault", fault);
  return engine_answer_json(e, root);
}

/* The visit in the input, after the checks every poll makes; NULL with the refusal answered in `*status`. */
static const char *visit_of(wasm_engine *e, size_t visit_length, int *status) {
  const char *visit;
  if (!engine_ready(e)) {
    *status = engine_refuse(e, "Load a cartridge and open a state first.");
    return NULL;
  }
  visit = engine_input_string(e, 0, visit_length);
  if (visit == NULL) *status = engine_refuse(e, "Hand the visit in through sw_input first.");
  return visit;
}

/* A poll that could not run: its words where the host asked wrongly, or the status's. */
static int not_polled(wasm_engine *e, sprout_status status, const sprout_seen_view *view) {
  return engine_answer_text(e, status, status == SPROUT_BAD_INPUT ? view->fault.text : sprout_status_text(status));
}

/* A visitor's whole view, the input holding the visit. */
EXPORT("sw_view") int sw_view(size_t visit_length) {
  wasm_engine *e = &the_engine;
  sprout_seen_view view;
  const char *visit;
  sprout_status status;
  int said;
  engine_begin(e, 0);
  if ((visit = visit_of(e, visit_length, &said)) == NULL) return said;
  status = sprout_view(e->world, e->state, &e->host, visit, &view);
  if (status != SPROUT_OK) return not_polled(e, status, &view);
  said = answer_polled(e, "view", sprout_view_tree(&e->scratch, &view), fault_of(e, &view));
  sprout_view_free(&view);
  return said;
}

/* Whether `phrase` types the verb with the qualified name `name` for anyone, and not for one object alone. */
static bool phrase_of(const sprout_typed_phrase *phrase, const char *name) {
  size_t library = strlen(phrase->verb->library);
  return phrase->only == NULL && strncmp(name, phrase->verb->library, library) == 0 && name[library] == '.' &&
         strcmp(name + library + 1, phrase->verb->name) == 0;
}

/* `phrase` as a scene lists it: its words, each slot written `…`. NULL when a page is refused. */
static sprout_json *phrase_text(wasm_engine *e, const sprout_typed_phrase *phrase) {
  size_t bytes = 1, i, j, at = 0;
  char *text;
  for (i = 0; i < phrase->part_count; i++) {
    const sprout_typed_part *part = &phrase->parts[i];
    if (part->is_slot) bytes += 4;
    for (j = 0; !part->is_slot && j < part->word_count; j++) bytes += strlen(part->words[j]) + 1;
  }
  text = (char *)sprout_arena_take(&e->scratch, bytes);
  if (text == NULL) return NULL;
  for (i = 0; i < phrase->part_count; i++) {
    const sprout_typed_part *part = &phrase->parts[i];
    if (part->is_slot) {
      if (at > 0) text[at++] = ' ';
      memcpy(text + at, "\xE2\x80\xA6", 3);
      at += 3;
    }
    for (j = 0; !part->is_slot && j < part->word_count; j++) {
      size_t n = strlen(part->words[j]);
      if (at > 0) text[at++] = ' ';
      memcpy(text + at, part->words[j], n);
      at += n;
    }
  }
  return engine_text(e, text, at);
}

/* The verb `name` as a scene lists it: `{"verb", "phrases"}`, each phrase once, in the order the parser tries them. */
static sprout_json *verb_of(wasm_engine *e, const char *name) {
  const sprout_world *world = e->world;
  sprout_json *one = sprout_json_make(&e->scratch, SPROUT_JSON_OBJECT, 2);
  sprout_json *phrases = sprout_json_make(&e->scratch, SPROUT_JSON_ARRAY, world->phrase_count);
  size_t i, j;
  if (one == NULL || phrases == NULL) return NULL;
  for (i = 0; i < world->phrase_count; i++) {
    sprout_json *text;
    bool seen = false;
    if (!phrase_of(&world->phrases[i], name)) continue;
    if ((text = phrase_text(e, &world->phrases[i])) == NULL) return NULL;
    for (j = 0; j < phrases->count && !seen; j++)
      seen = phrases->items[j]->length == text->length && memcmp(phrases->items[j]->bytes, text->bytes, text->length) == 0;
    if (!seen) sprout_json_adopt(phrases, NULL, text);
  }
  sprout_json_adopt(one, "verb", engine_text(e, name, strlen(name)));
  sprout_json_adopt(one, "phrases", phrases);
  return one->count == 2 ? one : NULL;
}

/* A visitor's scene, the input holding the visit. */
EXPORT("sw_scene") int sw_scene(size_t visit_length) {
  wasm_engine *e = &the_engine;
  sprout_seen_view view;
  sprout_json *tree, *verbs;
  const char *visit;
  sprout_status status;
  size_t i;
  int said;
  engine_begin(e, 0);
  if ((visit = visit_of(e, visit_length, &said)) == NULL) return said;
  status = sprout_scene(e->world, e->state, &e->host, visit, &view);
  if (status != SPROUT_OK) return not_polled(e, status, &view);
  tree = sprout_view_tree(&e->scratch, &view);
  verbs = sprout_json_make(&e->scratch, SPROUT_JSON_ARRAY, view.verb_count);
  said = SPROUT_NO_MEMORY;
  /* A scene is the view but its readings, which the tree puts last, and the verbs in their place. */
  if (tree != NULL && verbs != NULL && tree->count > 0 && strcmp(tree->items[tree->count - 1]->key, "readings") == 0) {
    tree->count--;
    for (i = 0; i < view.verb_count; i++) sprout_json_adopt(verbs, NULL, verb_of(e, view.verbs[i]));
    sprout_json_adopt(tree, "verbs", verbs);
    if (verbs->count == view.verb_count) said = answer_polled(e, "scene", tree, fault_of(e, &view));
  }
  sprout_view_free(&view);
  return said;
}

/* One verb's readings for a visitor, the input holding the visit and then the verb. */
EXPORT("sw_readings") int sw_readings(size_t visit_length, size_t verb_length) {
  wasm_engine *e = &the_engine;
  sprout_seen_view view;
  sprout_json *tree;
  sprout_status status;
  const char *visit, *verb;
  int said;
  engine_begin(e, 0);
  if ((visit = visit_of(e, visit_length, &said)) == NULL) return said;
  verb = engine_input_string(e, visit_length, verb_length);
  if (verb == NULL) return engine_refuse(e, "Hand the visit and verb in through sw_input first.");
  status = sprout_readings_for(e->world, e->state, &e->host, visit, verb, &e->scratch, &view);
  if (status != SPROUT_OK) return not_polled(e, status, &view);
  tree = sprout_view_tree(&e->scratch, &view);
  if (tree == NULL) return SPROUT_NO_MEMORY;
  return answer_polled(e, "readings", (sprout_json *)sprout_json_get(tree, "readings"), fault_of(e, &view));
}
