/*
 * Reads verbs, phrases and intents, and builds the phrases a visitor may type
 * (the spec's Verbs; Parsing). Phrases are tried in the order the spec gives:
 * the world's own verbs, then the standard library's, then every other
 * library's, each in declared order, a verb's written phrases before the
 * world's synonyms and those before an object's.
 */
#include <string.h>

#include "catalogue_build.h"

/* ---- verbs, phrases, intents, messages ---- */

static sprout_status read_phrase(loader *l, const sprout_node *node, sprout_phrase *out) {
  const sprout_node *parts = sprout_node_get(node, "parts");
  size_t i;
  out->text = cat_text(node, "text");
  if (out->text == NULL || !cat_is_array(parts)) return cat_shaped(l, "a phrase");
  out->part_count = parts->count;
  out->parts = (sprout_part *)cat_array(l, parts->count, sizeof(sprout_part));
  MEMORY(out->parts);
  for (i = 0; i < parts->count; i++) {
    const char *which = cat_text(parts->items[i], "part");
    const sprout_node *role = sprout_node_get(parts->items[i], "role");
    if (which == NULL) return cat_shaped(l, "a phrase's part");
    if (strcmp(which, "words") == 0) {
      out->parts[i].text = cat_text(parts->items[i], "text");
      if (out->parts[i].text == NULL) return cat_shaped(l, "a phrase's words");
    } else if (strcmp(which, "slot") == 0 && role != NULL && role->kind == SPROUT_NODE_NUMBER) {
      out->parts[i].is_slot = true;
      out->parts[i].role = (size_t)role->number;
    } else {
      return cat_shaped(l, "a phrase's part");
    }
  }
  return SPROUT_OK;
}

sprout_status cat_read_phrases(loader *l, const sprout_node *list, size_t *count,
                                  sprout_phrase **out) {
  size_t i;
  if (!cat_is_array(list)) return cat_shaped(l, "a list of phrases");
  *count = list->count;
  *out = (sprout_phrase *)cat_array(l, list->count, sizeof(sprout_phrase));
  MEMORY(*out);
  for (i = 0; i < list->count; i++) NEED(read_phrase(l, list->items[i], &(*out)[i]));
  return SPROUT_OK;
}

sprout_status cat_read_verb(loader *l, const sprout_node *node, sprout_verb **out) {
  sprout_verb *verb;
  const sprout_node *roles;
  size_t i;
  *out = NULL;
  if (node == NULL || node->kind != SPROUT_NODE_OBJECT || node->index == SPROUT_NOT_AN_ENTRY)
    return cat_shaped(l, "a verb");
  if (l->verb_cache[node->index] != NULL) {
    *out = l->verb_cache[node->index];
    return SPROUT_OK;
  }
  verb = (sprout_verb *)cat_array(l, 1, sizeof *verb);
  MEMORY(verb);
  l->verb_cache[node->index] = verb;
  verb->library = cat_text(node, "library");
  verb->name = cat_text(node, "name");
  if (verb->library == NULL || verb->name == NULL) return cat_shaped(l, "a verb");
  verb->node = node;
  roles = sprout_node_get(node, "roles");
  if (!cat_is_array(roles)) return cat_shaped(l, "a verb's roles");
  verb->role_count = roles->count;
  verb->roles = (sprout_role *)cat_array(l, roles->count, sizeof(sprout_role));
  MEMORY(verb->roles);
  for (i = 0; i < roles->count; i++) {
    const sprout_node *role = roles->items[i];
    const sprout_node *filler = sprout_node_get(role, "filler");
    const char *fills = cat_text(filler, "fills");
    sprout_role *out_role = &verb->roles[i];
    out_role->name = cat_text(role, "name");
    if (out_role->name == NULL) return cat_shaped(l, "a verb's role");
    out_role->many = cat_bool(role, "many");
    out_role->optional = cat_bool(role, "optional");
    out_role->carried = cat_bool(role, "carried");
    if (filler != NULL && filler->kind == SPROUT_NODE_NULL) out_role->filler = SPROUT_FILLER_NONE;
    else if (fills == NULL) return cat_shaped(l, "a role's filler");
    else if (strcmp(fills, "kind") == 0) {
      out_role->filler = SPROUT_FILLER_KIND;
      NEED(cat_read_kind(l, sprout_node_get(filler, "kind"), (sprout_kind_def **)&out_role->filler_kind));
    } else if (strcmp(fills, "open") == 0) out_role->filler = SPROUT_FILLER_OPEN;
    else if (strcmp(fills, "symbol") == 0) out_role->filler = SPROUT_FILLER_SYMBOL;
    else if (strcmp(fills, "integer") == 0) out_role->filler = SPROUT_FILLER_INTEGER;
    else if (strcmp(fills, "exit") == 0) out_role->filler = SPROUT_FILLER_EXIT;
    else return cat_fail(l, "This cartridge holds a role filler this runtime does not know: `", fills, "`.");
  }
  NEED(cat_read_phrases(l, sprout_node_get(node, "phrases"), &verb->phrase_count, &verb->phrases));
  *out = verb;
  return SPROUT_OK;
}

sprout_status cat_read_intent(loader *l, const sprout_node *node, sprout_intent *out) {
  const sprout_node *steps = sprout_node_get(node, "steps");
  size_t i, j;
  out->library = cat_text(node, "library");
  out->name = cat_text(node, "name");
  if (out->library == NULL || out->name == NULL || !cat_is_array(steps))
    return cat_shaped(l, "an intent");
  NEED(cat_strings(l, sprout_node_get(node, "slots"), "an intent's slots", &out->slot_count,
               &out->slots));
  NEED(cat_read_phrases(l, sprout_node_get(node, "phrases"), &out->phrase_count, &out->phrases));
  out->step_count = steps->count;
  out->steps = (sprout_intent_step *)cat_array(l, steps->count, sizeof(sprout_intent_step));
  MEMORY(out->steps);
  for (i = 0; i < steps->count; i++) {
    sprout_intent_step *step = &out->steps[i];
    const sprout_node *fillers = sprout_node_get(steps->items[i], "fillers");
    sprout_verb *verb = NULL;
    NEED(cat_read_verb(l, sprout_node_get(steps->items[i], "verb"), &verb));
    step->verb = verb;
    step->when = sprout_node_get(steps->items[i], "when");
    if (fillers == NULL || fillers->kind != SPROUT_NODE_MAP) return cat_shaped(l, "an intent's fillers");
    step->filler_count = fillers->count;
    step->filler_roles = (const char **)cat_array(l, fillers->count, sizeof(char *));
    step->filler_slots = (size_t *)cat_array(l, fillers->count, sizeof(size_t));
    MEMORY(step->filler_roles);
    MEMORY(step->filler_slots);
    for (j = 0; j < fillers->count; j++) {
      if (fillers->map_keys[j]->kind != SPROUT_NODE_STRING ||
          fillers->items[j]->kind != SPROUT_NODE_NUMBER)
        return cat_shaped(l, "an intent's fillers");
      step->filler_roles[j] = fillers->map_keys[j]->text;
      step->filler_slots[j] = (size_t)fillers->items[j]->number;
    }
  }
  return SPROUT_OK;
}

/* ---- typed phrases ---- */

/*
 * The words of a phrase's text: the cartridge writes them final (lower case, a comma a word of its own,
 * single spaces between), so they are cut at the spaces and compared as bytes.
 */
sprout_status cat_typed_words(loader *l, const char *text, size_t *count, const char ***words) {
  size_t length = strlen(text), n = 0, i = 0;
  char *buffer;
  const char **out;
  buffer = (char *)cat_array(l, length + 1, 1);
  MEMORY(buffer);
  out = (const char **)cat_array(l, length + 1, sizeof(char *));
  MEMORY(out);
  while (i < length) {
    size_t start;
    while (i < length && text[i] == ' ') i++;
    if (i >= length) break;
    start = i;
    while (i < length && text[i] != ' ') i++;
    memcpy(buffer, text + start, i - start);
    buffer[i - start] = '\0';
    out[n++] = buffer;
    buffer += i - start + 1;
  }
  *count = n;
  *words = out;
  return SPROUT_OK;
}

static sprout_status typed_parts(loader *l, const sprout_phrase *phrase, size_t *count,
                                 sprout_typed_part **out) {
  size_t i, n = 0;
  *out = (sprout_typed_part *)cat_array(l, phrase->part_count, sizeof(sprout_typed_part));
  MEMORY(*out);
  for (i = 0; i < phrase->part_count; i++) {
    if (phrase->parts[i].is_slot) {
      (*out)[n].is_slot = true;
      (*out)[n].role = phrase->parts[i].role;
      n++;
    } else {
      size_t words;
      const char **list;
      NEED(cat_typed_words(l, phrase->parts[i].text, &words, &list));
      if (words == 0) continue;
      (*out)[n].word_count = words;
      (*out)[n].words = list;
      n++;
    }
  }
  *count = n;
  return SPROUT_OK;
}

static size_t verb_rank(const sprout_verb *verb, const char *world) {
  if (strcmp(verb->library, world) == 0) return 0;
  return strcmp(verb->library, "sprout") == 0 ? 1 : 2;
}

sprout_status cat_build_typed_phrases(loader *l) {
  sprout_world *w = l->world;
  size_t *order, kept = 0, i, j, k, rank, total = 0, at = 0;
  const char *name = w->header.name;
  order = (size_t *)cat_array(l, w->verb_count, sizeof(size_t));
  MEMORY(order);
  for (rank = 0; rank < 3; rank++) {
    for (i = 0; i < w->verb_count; i++) {
      bool own = false;
      if (verb_rank(w->verbs[i], name) != rank) continue;
      if (strcmp(w->verbs[i]->library, name) != 0) {
        for (j = 0; j < w->verb_count && !own; j++)
          own = strcmp(w->verbs[j]->library, name) == 0 && strcmp(w->verbs[j]->name, w->verbs[i]->name) == 0;
      }
      if (!own) order[kept++] = i;
    }
  }
  for (i = 0; i < kept; i++) {
    total += w->verbs[order[i]]->phrase_count;
    for (j = 0; j < w->synonym_count; j++)
      if (w->synonyms[j].verb == w->verbs[order[i]]) total += w->synonyms[j].phrase_count;
  }
  w->phrases = (sprout_typed_phrase *)cat_array(l, total, sizeof(sprout_typed_phrase));
  MEMORY(w->phrases);
  for (i = 0; i < kept; i++) {
    const sprout_verb *verb = w->verbs[order[i]];
    int pass;
    for (j = 0; j < verb->phrase_count; j++) {
      sprout_typed_phrase *typed = &w->phrases[at++];
      typed->verb = verb;
      NEED(typed_parts(l, &verb->phrases[j], &typed->part_count, &typed->parts));
    }
    for (pass = 0; pass < 2; pass++) {
      for (j = 0; j < w->synonym_count; j++) {
        const sprout_synonym *synonym = &w->synonyms[j];
        if (synonym->verb != verb || (pass == 0) != (synonym->object == NULL)) continue;
        for (k = 0; k < synonym->phrase_count; k++) {
          sprout_typed_phrase *typed = &w->phrases[at++];
          typed->verb = verb;
          typed->only = synonym->object;
          NEED(typed_parts(l, &synonym->phrases[k], &typed->part_count, &typed->parts));
        }
      }
    }
  }
  w->phrase_count = at;
  total = 0;
  for (i = 0; i < w->intent_count; i++) total += w->intents[i].phrase_count;
  w->intent_phrases =
      (sprout_typed_intent_phrase *)cat_array(l, total, sizeof(sprout_typed_intent_phrase));
  MEMORY(w->intent_phrases);
  for (i = 0; i < w->intent_count; i++) {
    for (j = 0; j < w->intents[i].phrase_count; j++) {
      sprout_typed_intent_phrase *typed = &w->intent_phrases[w->intent_phrase_count++];
      typed->intent = &w->intents[i];
      NEED(typed_parts(l, &w->intents[i].phrases[j], &typed->part_count, &typed->parts));
    }
  }
  return SPROUT_OK;
}
