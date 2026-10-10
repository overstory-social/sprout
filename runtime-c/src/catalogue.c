/*
 * Builds the typed catalogue from a cartridge (the spec's The compiler > What
 * compiling produces; The runtime > State): the header, the caps, the
 * declared tree with each object's rank, and every section handed to the
 * readers of `catalogue_kinds.c` and `catalogue_grammar.c`. A cartridge that
 * is not shaped as one is refused in a sentence that names where.
 */
#include <string.h>

#include "catalogue_build.h"

/* ---- the declared tree ---- */

const char *cat_id_of(loader *l, const char *world, size_t count, const char *const *path) {
  size_t length = strlen(world), i;
  char *out, *at;
  for (i = 0; i < count; i++) length += 1 + strlen(path[i]);
  out = (char *)cat_array(l, length + 1, 1);
  if (out == NULL) return NULL;
  at = out;
  memcpy(at, world, strlen(world));
  at += strlen(world);
  for (i = 0; i < count; i++) {
    *at++ = '.';
    memcpy(at, path[i], strlen(path[i]));
    at += strlen(path[i]);
  }
  return out;
}

static sprout_status build_tree(loader *l, const sprout_node *holds) {
  sprout_world *w = l->world;
  const sprout_node **queue;
  size_t capacity = 16, tail = 0, head, i;
  if (holds == NULL || holds->kind != SPROUT_NODE_MAP) return cat_shaped(l, "tree.holds");
  queue = (const sprout_node **)cat_array(l, capacity, sizeof(sprout_node *));
  MEMORY(queue);
  /* Placements are a tree, so the queue never holds more than the whole of it; grow by doubling. */
  for (i = 0; i < holds->count; i++) {
    if (tail == capacity) {
      const sprout_node **bigger = (const sprout_node **)cat_array(l, capacity * 2, sizeof(sprout_node *));
      MEMORY(bigger);
      memcpy(bigger, queue, capacity * sizeof(sprout_node *));
      queue = bigger;
      capacity *= 2;
    }
    queue[tail++] = holds->items[i];
  }
  for (head = 0; head < tail; head++) {
    const sprout_node *held = sprout_node_get(queue[head], "holds");
    if (held == NULL || held->kind != SPROUT_NODE_MAP) return cat_shaped(l, "a placement's holds");
    for (i = 0; i < held->count; i++) {
      if (tail == capacity) {
        const sprout_node **bigger =
            (const sprout_node **)cat_array(l, capacity * 2, sizeof(sprout_node *));
        MEMORY(bigger);
        memcpy(bigger, queue, capacity * sizeof(sprout_node *));
        queue = bigger;
        capacity *= 2;
      }
      queue[tail++] = held->items[i];
    }
  }
  w->declared_count = tail;
  w->declared = (sprout_declared *)cat_array(l, tail, sizeof(sprout_declared));
  MEMORY(w->declared);
  for (head = 0; head < tail; head++) {
    sprout_declared *entry = &w->declared[head];
    size_t container_count;
    const char **container;
    sprout_kind_def *kind;
    NEED(cat_strings(l, sprout_node_get(queue[head], "path"), "a placement's path", &entry->path_count,
                 &entry->path));
    NEED(cat_strings(l, sprout_node_get(queue[head], "container"), "a placement's container",
                 &container_count, &container));
    NEED(cat_read_kind(l, sprout_node_get(queue[head], "kind"), &kind));
    entry->kind = kind;
    entry->rank = head;
    entry->id = cat_id_of(l, w->header.name, entry->path_count, entry->path);
    entry->container = cat_id_of(l, w->header.name, container_count, container);
    MEMORY(entry->id);
    MEMORY(entry->container);
  }
  return SPROUT_OK;
}

/* ---- the sections ---- */

static sprout_status read_caps(loader *l, const sprout_json *caps) {
  sprout_caps *c = &l->world->caps;
  static const char *const names[10] = {"optionsPerEnum",  "rolesPerVerb",  "phrasesPerVerb",
                                        "stepsPerIntent",  "phraseCharacters", "nounsPerObject",
                                        "nounCharacters",  "exitsPerPlace", "listElements",
                                        "literalCharacters"};
  double *fields[10];
  static const char *const optional[5] = {"places", "objects", "kinds", "files", "sourceBytes"};
  double *optional_fields[5];
  bool *optional_set[5];
  size_t i;
  fields[0] = &c->options_per_enum;
  fields[1] = &c->roles_per_verb;
  fields[2] = &c->phrases_per_verb;
  fields[3] = &c->steps_per_intent;
  fields[4] = &c->phrase_characters;
  fields[5] = &c->nouns_per_object;
  fields[6] = &c->noun_characters;
  fields[7] = &c->exits_per_place;
  fields[8] = &c->list_elements;
  fields[9] = &c->literal_characters;
  optional_fields[0] = &c->places;
  optional_fields[1] = &c->objects;
  optional_fields[2] = &c->kinds;
  optional_fields[3] = &c->files;
  optional_fields[4] = &c->source_bytes;
  optional_set[0] = &c->places_set;
  optional_set[1] = &c->objects_set;
  optional_set[2] = &c->kinds_set;
  optional_set[3] = &c->files_set;
  optional_set[4] = &c->source_bytes_set;
  if (caps == NULL || caps->kind != SPROUT_JSON_OBJECT) return cat_shaped(l, "caps");
  for (i = 0; i < 10; i++) {
    const sprout_json *field = sprout_json_get(caps, names[i]);
    if (field == NULL || field->kind != SPROUT_JSON_NUMBER)
      return cat_fail(l, "This cartridge is not shaped as a cartridge is at `caps.", names[i], "`: it should be a number.");
    *fields[i] = field->number;
  }
  for (i = 0; i < 5; i++) {
    const sprout_json *field = sprout_json_get(caps, optional[i]);
    if (field == NULL || (field->kind != SPROUT_JSON_NUMBER && field->kind != SPROUT_JSON_NULL))
      return cat_fail(l, "This cartridge is not shaped as a cartridge is at `caps.", optional[i], "`: it should be a number or null.");
    if (field->kind == SPROUT_JSON_NUMBER) {
      *optional_set[i] = true;
      *optional_fields[i] = field->number;
    }
  }
  return SPROUT_OK;
}

static const char *json_text(const sprout_json *object, const char *key) {
  const sprout_json *field = sprout_json_get(object, key);
  return field != NULL && field->kind == SPROUT_JSON_STRING ? field->bytes : NULL;
}

static sprout_status read_header(loader *l, const sprout_json *header) {
  sprout_cartridge_header *h = &l->world->header;
  const sprout_json *level = sprout_json_get(header, "level");
  const sprout_json *files = sprout_json_get(header, "files");
  const sprout_json *libraries = sprout_json_get(header, "libraries");
  size_t i;
  if (header == NULL || header->kind != SPROUT_JSON_OBJECT) return cat_shaped(l, "header");
  h->name = json_text(header, "name");
  h->namespace_name = json_text(header, "namespace");
  h->version = json_text(header, "version");
  h->author = json_text(header, "author");
  h->license = json_text(header, "license");
  h->hash = json_text(header, "hash");
  if (h->name == NULL || h->namespace_name == NULL || h->version == NULL || h->author == NULL ||
      h->license == NULL || h->hash == NULL || level == NULL || level->kind != SPROUT_JSON_NUMBER ||
      files == NULL || files->kind != SPROUT_JSON_ARRAY || libraries == NULL ||
      libraries->kind != SPROUT_JSON_ARRAY)
    return cat_shaped(l, "header");
  h->level = (long)level->number;
  h->file_count = files->count;
  h->files = (const char **)cat_array(l, files->count, sizeof(char *));
  MEMORY(h->files);
  for (i = 0; i < files->count; i++) {
    if (files->items[i]->kind != SPROUT_JSON_STRING) return cat_shaped(l, "header.files");
    h->files[i] = files->items[i]->bytes;
  }
  h->library_count = libraries->count;
  h->libraries = (sprout_library *)cat_array(l, libraries->count, sizeof(sprout_library));
  MEMORY(h->libraries);
  for (i = 0; i < libraries->count; i++) {
    h->libraries[i].name = json_text(libraries->items[i], "name");
    h->libraries[i].version = json_text(libraries->items[i], "version");
    h->libraries[i].sha = json_text(libraries->items[i], "sha");
    if (h->libraries[i].name == NULL || h->libraries[i].version == NULL ||
        h->libraries[i].sha == NULL)
      return cat_shaped(l, "header.libraries");
  }
  return SPROUT_OK;
}

static const sprout_json *section(const sprout_json *root, const char *name) {
  return sprout_json_get(root, name);
}

sprout_status sprout_catalogue_build(sprout_world *world, const sprout_json *root, char *error,
                                     size_t capacity) {
  loader load, *l = &load;
  const sprout_json *kinds_section, *tree_section, *grammar_section, *bodies_section, *ext;
  const sprout_node *all, *names, *scoped, *intents, *messages, *verbs, *contents;
  size_t i, j;
  memset(&load, 0, sizeof load);
  load.world = world;
  load.arena = &world->arena;
  load.error = error;
  load.capacity = capacity;
  load.kind_cache = (sprout_kind_def **)cat_array(l, world->graph.count, sizeof(sprout_kind_def *));
  load.verb_cache = (sprout_verb **)cat_array(l, world->graph.count, sizeof(sprout_verb *));
  load.type_cache = (sprout_decl_type **)cat_array(l, world->graph.count, sizeof(sprout_decl_type *));
  MEMORY(load.kind_cache);
  MEMORY(load.verb_cache);
  MEMORY(load.type_cache);

  NEED(read_header(l, section(root, "header")));
  NEED(read_caps(l, section(root, "caps")));

  kinds_section = section(root, "kinds");
  tree_section = section(root, "tree");
  grammar_section = section(root, "grammar");
  bodies_section = section(root, "bodies");
  if (kinds_section == NULL || tree_section == NULL || grammar_section == NULL ||
      bodies_section == NULL)
    return cat_shaped(l, "the sections");

  all = sprout_graph_cell(&world->graph, sprout_json_get(kinds_section, "all"));
  if (!cat_is_array(all)) return cat_shaped(l, "kinds.all");
  world->kind_count = all->count;
  world->kinds = (sprout_kind_def **)cat_array(l, all->count, sizeof(sprout_kind_def *));
  MEMORY(world->kinds);
  for (i = 0; i < all->count; i++) {
    NEED(cat_read_kind(l, all->items[i], &world->kinds[i]));
    world->kinds[i]->spawnable =
        !world->kinds[i]->composes_world && !world->kinds[i]->composes_visitor;
  }
  NEED(cat_read_kind(l, sprout_graph_cell(&world->graph, sprout_json_get(kinds_section, "world")),
                 &world->world_kind));
  NEED(cat_read_kind(l, sprout_graph_cell(&world->graph, sprout_json_get(kinds_section, "visitor")),
                 &world->visitor_kind));

  contents = sprout_graph_cell(&world->graph, sprout_json_get(kinds_section, "contents"));
  if (contents == NULL || contents->kind != SPROUT_NODE_MAP) return cat_shaped(l, "kinds.contents");
  world->content_list_count = contents->count;
  world->contents = (sprout_content_list *)cat_array(l, contents->count, sizeof(sprout_content_list));
  MEMORY(world->contents);
  for (i = 0; i < contents->count; i++) {
    const sprout_node *list = contents->items[i];
    if (contents->map_keys[i]->kind != SPROUT_NODE_STRING || !cat_is_array(list))
      return cat_shaped(l, "kinds.contents");
    world->contents[i].kind = contents->map_keys[i]->text;
    world->contents[i].count = list->count;
    world->contents[i].items = (sprout_content *)cat_array(l, list->count, sizeof(sprout_content));
    MEMORY(world->contents[i].items);
    for (j = 0; j < list->count; j++) NEED(cat_read_content(l, list->items[j], &world->contents[i].items[j]));
  }

  {
    const sprout_json *world_name = sprout_json_get(tree_section, "world");
    const sprout_json *arrival = sprout_json_get(tree_section, "arrival");
    if (world_name == NULL || world_name->kind != SPROUT_JSON_STRING ||
        strcmp(world_name->bytes, world->header.name) != 0)
      return cat_shaped(l, "tree.world");
    NEED(build_tree(l, sprout_graph_cell(&world->graph, sprout_json_get(tree_section, "holds"))));
    if (arrival != NULL && arrival->kind == SPROUT_JSON_ARRAY) {
      const char **path = (const char **)cat_array(l, arrival->count, sizeof(char *));
      MEMORY(path);
      for (i = 0; i < arrival->count; i++) {
        if (arrival->items[i]->kind != SPROUT_JSON_STRING) return cat_shaped(l, "tree.arrival");
        path[i] = arrival->items[i]->bytes;
      }
      world->arrival = cat_id_of(l, world->header.name, arrival->count, path);
      MEMORY(world->arrival);
    } else if (arrival == NULL || arrival->kind != SPROUT_JSON_NULL) {
      return cat_shaped(l, "tree.arrival");
    }
  }

  verbs = sprout_graph_cell(&world->graph, section(root, "verbs"));
  if (!cat_is_array(verbs)) return cat_shaped(l, "verbs");
  world->verb_count = verbs->count;
  world->verbs = (sprout_verb **)cat_array(l, verbs->count, sizeof(sprout_verb *));
  MEMORY(world->verbs);
  for (i = 0; i < verbs->count; i++) NEED(cat_read_verb(l, verbs->items[i], &world->verbs[i]));

  scoped = sprout_graph_cell(&world->graph, sprout_json_get(grammar_section, "scoped"));
  if (!cat_is_array(scoped)) return cat_shaped(l, "grammar.scoped");
  world->synonym_count = scoped->count;
  world->synonyms = (sprout_synonym *)cat_array(l, scoped->count, sizeof(sprout_synonym));
  MEMORY(world->synonyms);
  for (i = 0; i < scoped->count; i++) {
    sprout_verb *verb = NULL;
    const sprout_node *object = sprout_node_get(scoped->items[i], "object");
    NEED(cat_read_verb(l, sprout_node_get(scoped->items[i], "verb"), &verb));
    world->synonyms[i].verb = verb;
    NEED(cat_read_phrases(l, sprout_node_get(scoped->items[i], "phrases"),
                      &world->synonyms[i].phrase_count, &world->synonyms[i].phrases));
    if (cat_is_array(object)) {
      size_t count;
      const char **path;
      NEED(cat_strings(l, object, "a synonym's object", &count, &path));
      world->synonyms[i].object = cat_id_of(l, world->header.name, count, path);
      MEMORY(world->synonyms[i].object);
    }
  }

  intents = sprout_graph_cell(&world->graph, sprout_json_get(grammar_section, "intents"));
  if (!cat_is_array(intents)) return cat_shaped(l, "grammar.intents");
  world->intent_count = intents->count;
  world->intents = (sprout_intent *)cat_array(l, intents->count, sizeof(sprout_intent));
  MEMORY(world->intents);
  for (i = 0; i < intents->count; i++) NEED(cat_read_intent(l, intents->items[i], &world->intents[i]));

  {
    const sprout_json *words = sprout_json_get(grammar_section, "words");
    if (words == NULL || words->kind != SPROUT_JSON_ARRAY) return cat_shaped(l, "grammar.words");
    world->word_count = words->count;
    world->words = (const char **)cat_array(l, words->count, sizeof(char *));
    MEMORY(world->words);
    for (i = 0; i < words->count; i++) {
      if (words->items[i]->kind != SPROUT_JSON_STRING) return cat_shaped(l, "grammar.words");
      world->words[i] = words->items[i]->bytes;
    }
  }

  messages = sprout_graph_cell(&world->graph, section(root, "messages"));
  if (!cat_is_array(messages)) return cat_shaped(l, "messages");
  world->message_count = messages->count;
  world->messages = (sprout_message *)cat_array(l, messages->count, sizeof(sprout_message));
  MEMORY(world->messages);
  for (i = 0; i < messages->count; i++) {
    world->messages[i].library = cat_text(messages->items[i], "library");
    world->messages[i].name = cat_text(messages->items[i], "name");
    if (world->messages[i].library == NULL || world->messages[i].name == NULL)
      return cat_shaped(l, "a message");
    NEED(cat_read_type(l, sprout_node_get(messages->items[i], "carries"), &world->messages[i].carries));
  }

  /* The name table binds each name a body writes to what it names, by the index of the entry written. */
  world->bound = (const sprout_node **)cat_array(l, world->graph.count, sizeof(sprout_node *));
  world->option_slot = (bool *)cat_array(l, world->graph.count, sizeof(bool));
  MEMORY(world->bound);
  MEMORY(world->option_slot);
  names = sprout_graph_cell(&world->graph, sprout_json_get(bodies_section, "names"));
  if (names == NULL || names->kind != SPROUT_NODE_MAP) return cat_shaped(l, "bodies.names");
  for (i = 0; i < names->count; i++)
    if (names->map_keys[i]->index != SPROUT_NOT_AN_ENTRY) world->bound[names->map_keys[i]->index] = names->items[i];
  {
    const sprout_node *slots_set =
        sprout_graph_cell(&world->graph, sprout_json_get(bodies_section, "optionSlots"));
    if (slots_set == NULL || slots_set->kind != SPROUT_NODE_SET)
      return cat_shaped(l, "bodies.optionSlots");
    for (i = 0; i < slots_set->count; i++)
      if (slots_set->items[i]->index != SPROUT_NOT_AN_ENTRY) world->option_slot[slots_set->items[i]->index] = true;
  }

  ext = section(root, "extensions");
  if (ext == NULL || ext->kind != SPROUT_JSON_ARRAY) return cat_shaped(l, "extensions");
  world->extension_count = ext->count;
  world->extensions = (sprout_extension_pin *)cat_array(l, ext->count, sizeof(sprout_extension_pin));
  MEMORY(world->extensions);
  for (i = 0; i < ext->count; i++) {
    const sprout_json *major = sprout_json_get(ext->items[i], "major");
    world->extensions[i].name = json_text(ext->items[i], "name");
    if (world->extensions[i].name == NULL || major == NULL || major->kind != SPROUT_JSON_NUMBER)
      return cat_shaped(l, "extensions");
    world->extensions[i].major = (long)major->number;
  }

  return cat_build_typed_phrases(l);
}

/* ---- lookups ---- */

const sprout_declared *sprout_world_declared(const sprout_world *world, const char *id) {
  size_t i;
  for (i = 0; i < world->declared_count; i++)
    if (strcmp(world->declared[i].id, id) == 0) return &world->declared[i];
  return NULL;
}

const sprout_kind_def *sprout_world_kind(const sprout_world *world, const char *qualified) {
  size_t i;
  for (i = 0; i < world->kind_count; i++)
    if (strcmp(world->kinds[i]->qualified, qualified) == 0) return world->kinds[i];
  if (world->world_kind != NULL && strcmp(world->world_kind->qualified, qualified) == 0)
    return world->world_kind;
  if (world->visitor_kind != NULL && strcmp(world->visitor_kind->qualified, qualified) == 0)
    return world->visitor_kind;
  return NULL;
}

const sprout_property *sprout_kind_property(const sprout_kind_def *kind, const char *name) {
  size_t i;
  for (i = 0; i < kind->property_count; i++)
    if (strcmp(kind->properties[i].name, name) == 0) return &kind->properties[i];
  return NULL;
}

static const sprout_content *content_in(const sprout_content *items, size_t count,
                                        const char *const *path, size_t path_count) {
  size_t i;
  for (i = 0; i < count; i++) {
    size_t depth = items[i].path_count;
    if (depth == 0 || depth > path_count || strcmp(items[i].path[depth - 1], path[depth - 1]) != 0)
      continue;
    if (depth == path_count) return &items[i];
    {
      const sprout_content *inner = content_in(items[i].held, items[i].held_count, path, path_count);
      if (inner != NULL) return inner;
    }
  }
  return NULL;
}

const sprout_content *sprout_world_content_at(const sprout_world *world, const char *kind,
                                              const char *const *path, size_t path_count) {
  size_t i;
  for (i = 0; i < world->content_list_count; i++)
    if (strcmp(world->contents[i].kind, kind) == 0)
      return content_in(world->contents[i].items, world->contents[i].count, path, path_count);
  return NULL;
}

const sprout_node *sprout_world_bound(const sprout_world *world, const sprout_node *written) {
  if (written == NULL || written->index == SPROUT_NOT_AN_ENTRY) return NULL;
  return world->bound[written->index];
}
