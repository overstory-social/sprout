/*
 * Reads types, defaults, kinds and the contents a kind's body gives (the
 * spec's The runtime > State; Properties). A kind, a type, or a kind's
 * properties, passages or plays that two parts of the graph share is read
 * once and found again by the index of its entry, so identity is pointer
 * identity.
 */
#include <string.h>

#include "catalogue_build.h"

/* ---- types and literals ---- */

sprout_status cat_read_type(loader *l, const sprout_node *node, const sprout_decl_type **out) {
  sprout_decl_type *type;
  const char *tag;
  *out = NULL;
  if (node == NULL || node->kind == SPROUT_NODE_NULL) return SPROUT_OK;
  if (node->kind != SPROUT_NODE_OBJECT) return cat_shaped(l, "a type");
  *out = (const sprout_decl_type *)cat_read_as(l, node);
  if (*out != NULL) return SPROUT_OK;
  tag = cat_text(l->graph, node, "type");
  if (tag == NULL) return cat_shaped(l, "a type");
  type = (sprout_decl_type *)cat_array(l, 1, sizeof *type);
  MEMORY(type);
  NEED(cat_keep(l, node, type));
  if (strcmp(tag, "boolean") == 0) {
    type->kind = SPROUT_DECL_BOOLEAN;
    type->key = "boolean";
  } else if (strcmp(tag, "string") == 0) {
    type->kind = SPROUT_DECL_STRING;
    type->key = "string";
  } else if (strcmp(tag, "integer") == 0) {
    const sprout_node *min = sprout_node_get(l->graph, node, "min"), *max = sprout_node_get(l->graph, node, "max");
    if (min == NULL || max == NULL || min->kind != SPROUT_NODE_NUMBER ||
        max->kind != SPROUT_NODE_NUMBER)
      return cat_shaped(l, "an integer type");
    type->kind = SPROUT_DECL_INTEGER;
    type->min = sprout_node_number(l->graph, min);
    type->max = sprout_node_number(l->graph, max);
    type->key = "integer";
  } else if (strcmp(tag, "symbol") == 0) {
    const sprout_node *of = sprout_node_get(l->graph, node, "of");
    const char *library = cat_text(l->graph, of, "library"), *name = cat_text(l->graph, of, "name");
    if (library == NULL || name == NULL) return cat_shaped(l, "an enum type");
    type->kind = SPROUT_DECL_SYMBOL;
    type->key = type->enum_name = cat_join3(l, library, ".", name);
    MEMORY(type->key);
    NEED(cat_strings(l, sprout_node_get(l->graph, of, "options"), "an enum's options", &type->option_count,
                 &type->options));
  } else if (strcmp(tag, "list") == 0) {
    const char *inner;
    NEED(cat_read_type(l, sprout_node_get(l->graph, node, "element"), &type->element));
    if (type->element == NULL) return cat_shaped(l, "a list type");
    type->kind = SPROUT_DECL_LIST;
    inner = cat_join3(l, "[", type->element->key, "]");
    MEMORY(inner);
    type->key = inner;
  } else if (strcmp(tag, "extension") == 0) {
    const char *extension = cat_text(l->graph, node, "extension"), *name = cat_text(l->graph, node, "name");
    if (extension == NULL || name == NULL) return cat_shaped(l, "an extension type");
    type->kind = SPROUT_DECL_EXTENSION;
    type->key = cat_join3(l, extension, ".", name);
    MEMORY(type->key);
  } else {
    return cat_fail(l, "This cartridge holds a type this runtime does not know: `", tag, "`.");
  }
  *out = type;
  return SPROUT_OK;
}

static sprout_status read_literal(loader *l, const sprout_node *node, sprout_literal *out) {
  const char *kind = cat_text(l->graph, node, "kind");
  const sprout_node *value;
  size_t i;
  if (kind == NULL) return cat_shaped(l, "a property's default");
  value = sprout_node_get(l->graph, node, "value");
  if (strcmp(kind, "boolean") == 0 && value != NULL && value->kind == SPROUT_NODE_BOOL) {
    out->kind = SPROUT_LITERAL_BOOLEAN;
    out->boolean = sprout_truth(value);
  } else if (strcmp(kind, "integer") == 0 && value != NULL && value->kind == SPROUT_NODE_NUMBER) {
    out->kind = SPROUT_LITERAL_NUMBER;
    out->number = sprout_node_number(l->graph, value);
  } else if (strcmp(kind, "string") == 0 && value != NULL && value->kind == SPROUT_NODE_STRING) {
    out->kind = SPROUT_LITERAL_STRING;
    out->text = sprout_text(l->graph, value);
  } else if (strcmp(kind, "option-literal") == 0) {
    out->kind = SPROUT_LITERAL_OPTION;
    out->text = cat_text(l->graph, sprout_node_get(l->graph, node, "name"), "text");
    if (out->text == NULL) return cat_shaped(l, "an option default");
  } else if (strcmp(kind, "list-literal") == 0) {
    const sprout_node *elements = sprout_node_get(l->graph, node, "elements");
    if (!cat_is_array(elements)) return cat_shaped(l, "a list default");
    out->kind = SPROUT_LITERAL_LIST;
    out->count = elements->count;
    out->items = (sprout_literal *)cat_array(l, elements->count, sizeof(sprout_literal));
    MEMORY(out->items);
    for (i = 0; i < elements->count; i++) NEED(read_literal(l, sprout_item(l->graph, elements, i), &out->items[i]));
  } else {
    return cat_fail(l, "This cartridge holds a default this runtime does not know: `", kind, "`.");
  }
  return SPROUT_OK;
}

/* ---- kinds ---- */

/* The property a map lists under `name_node`; one record for each property entry and name, however many maps list it. */
static sprout_status read_property(loader *l, const sprout_node *name_node,
                                   const sprout_node *node, const sprout_property **read) {
  const sprout_node *remembered = sprout_node_get(l->graph, node, "remembered");
  const sprout_node *declaration = sprout_node_get(l->graph, node, "declaration");
  const sprout_property *kept;
  sprout_property *out;
  if (name_node->kind != SPROUT_NODE_STRING || remembered == NULL ||
      remembered->kind != SPROUT_NODE_BOOL)
    return cat_shaped(l, "a property");
  kept = (const sprout_property *)cat_read_as(l, node);
  if (kept != NULL && strcmp(kept->name, sprout_text(l->graph, name_node)) == 0) {
    *read = kept;
    return SPROUT_OK;
  }
  out = (sprout_property *)cat_array(l, 1, sizeof *out);
  MEMORY(out);
  if (kept == NULL) NEED(cat_keep(l, node, out));
  *read = out;
  out->name = sprout_text(l->graph, name_node);
  out->remembered = sprout_truth(remembered);
  out->origin = cat_text(l->graph, node, "origin");
  if (out->origin == NULL) return cat_shaped(l, "a property's origin");
  NEED(cat_read_type(l, sprout_node_get(l->graph, node, "type"), &out->type));
  if (out->type == NULL) return cat_shaped(l, "a property's type");
  return read_literal(l, sprout_node_get(l->graph, declaration, "default"), &out->default_value);
}

/* What a non-empty entry was already read as, or NULL; an empty one is never read, so never kept. */
static void *already(loader *l, const sprout_node *node) {
  return node->count == 0 ? NULL : cat_read_as(l, node);
}

static sprout_status keep(loader *l, const sprout_node *node, void *read) {
  return node->count == 0 ? SPROUT_OK : cat_keep(l, node, read);
}

/* A kind's properties, in declared order; a map two kinds share is read once. */
static sprout_status read_properties(loader *l, const sprout_node *map, const sprout_property ***out) {
  const sprout_property **properties = (const sprout_property **)already(l, map);
  size_t i;
  if (properties == NULL) {
    properties = (const sprout_property **)cat_array(l, map->count, sizeof(sprout_property *));
    MEMORY(properties);
    for (i = 0; i < map->count; i++)
      NEED(read_property(l, sprout_map_key(l->graph, map, i), sprout_item(l->graph, map, i), &properties[i]));
    NEED(keep(l, map, properties));
  }
  *out = properties;
  return SPROUT_OK;
}

static sprout_status read_passages(loader *l, const sprout_node *map, sprout_passage **out) {
  sprout_passage *passages = (sprout_passage *)already(l, map);
  size_t i;
  if (passages == NULL) {
    passages = (sprout_passage *)cat_array(l, map->count, sizeof(sprout_passage));
    MEMORY(passages);
    for (i = 0; i < map->count; i++) {
      if (sprout_map_key(l->graph, map, i)->kind != SPROUT_NODE_STRING) return cat_shaped(l, "a passage");
      passages[i].name = sprout_text(l->graph, sprout_map_key(l->graph, map, i));
      passages[i].node = sprout_item(l->graph, map, i);
    }
    NEED(keep(l, map, passages));
  }
  *out = passages;
  return SPROUT_OK;
}

/* One key's plays, in the order they run: one record for each group entry and key, however many kinds hold it. */
static sprout_status read_group(loader *l, const sprout_node *key, const sprout_node *group,
                                const sprout_play_group **out) {
  const sprout_play_group *kept = (const sprout_play_group *)already(l, group);
  sprout_play_group *made;
  sprout_play *plays;
  size_t j;
  if (kept != NULL && strcmp(kept->key, sprout_text(l->graph, key)) == 0) {
    *out = kept;
    return SPROUT_OK;
  }
  made = (sprout_play_group *)cat_array(l, 1, sizeof *made);
  MEMORY(made);
  made->key = sprout_text(l->graph, key);
  made->count = group->count;
  *out = made;
  if (kept != NULL) {
    made->plays = kept->plays;
    return SPROUT_OK;
  }
  plays = (sprout_play *)cat_array(l, group->count, sizeof(sprout_play));
  MEMORY(plays);
  made->plays = plays;
  for (j = 0; j < group->count; j++) {
    const sprout_node *one = sprout_item(l->graph, group, j);
    sprout_play *play = &plays[j];
    play->origin = cat_text(l->graph, one, "origin");
    play->library = cat_text(l->graph, one, "library");
    play->verb = cat_text(l->graph, one, "verb");
    play->role = cat_text(l->graph, one, "role");
    play->any = cat_bool(l->graph, one, "any");
    play->node = one;
    if (play->origin == NULL || play->library == NULL || play->verb == NULL || play->role == NULL)
      return cat_shaped(l, "a play");
  }
  return keep(l, group, made);
}

static sprout_status read_play_groups(loader *l, const sprout_node *map, const sprout_play_group ***out) {
  const sprout_play_group **groups = (const sprout_play_group **)already(l, map);
  size_t i;
  if (groups == NULL) {
    groups = (const sprout_play_group **)cat_array(l, map->count, sizeof(sprout_play_group *));
    MEMORY(groups);
    for (i = 0; i < map->count; i++) {
      const sprout_node *group = sprout_item(l->graph, map, i);
      if (sprout_map_key(l->graph, map, i)->kind != SPROUT_NODE_STRING || !cat_is_array(group))
        return cat_shaped(l, "a kind's plays");
      NEED(read_group(l, sprout_map_key(l->graph, map, i), group, &groups[i]));
    }
    NEED(keep(l, map, groups));
  }
  *out = groups;
  return SPROUT_OK;
}

sprout_status cat_read_kind(loader *l, const sprout_node *node, sprout_kind_def **out) {
  sprout_kind_def *kind;
  const sprout_node *properties, *passages, *plays;
  size_t i;
  *out = NULL;
  if (node == NULL || node->kind == SPROUT_NODE_NULL) return SPROUT_OK;
  if (node->kind != SPROUT_NODE_OBJECT || sprout_graph_index(l->graph, node) == SPROUT_NOT_AN_ENTRY)
    return cat_shaped(l, "a kind");
  *out = (sprout_kind_def *)cat_read_as(l, node);
  if (*out != NULL) return SPROUT_OK;
  kind = (sprout_kind_def *)cat_array(l, 1, sizeof *kind);
  MEMORY(kind);
  NEED(cat_keep(l, node, kind));
  kind->library = cat_text(l->graph, node, "library");
  kind->name = cat_text(l->graph, node, "name");
  if (kind->library == NULL || kind->name == NULL) return cat_shaped(l, "a kind");
  kind->qualified = cat_join3(l, kind->library, ".", kind->name);
  MEMORY(kind->qualified);
  kind->node = node;
  NEED(cat_strings(l, sprout_node_get(l->graph, node, "order"), "a kind's order", &kind->order_count,
               &kind->order));
  for (i = 0; i < kind->order_count; i++) {
    if (strcmp(kind->order[i], "sprout.World") == 0) kind->composes_world = true;
    if (strcmp(kind->order[i], "sprout.Visitor") == 0) kind->composes_visitor = true;
    if (strcmp(kind->order[i], "sprout.Actor") == 0) kind->composes_actor = true;
  }
  kind->contains = cat_bool(l->graph, node, "contains");
  kind->contains_actors = cat_bool(l->graph, node, "containsActors");
  kind->roams = cat_bool(l->graph, node, "roams");

  properties = sprout_node_get(l->graph, node, "properties");
  if (properties == NULL || properties->kind != SPROUT_NODE_MAP)
    return cat_shaped(l, "a kind's properties");
  kind->property_count = properties->count;
  NEED(read_properties(l, properties, &kind->properties));

  passages = sprout_node_get(l->graph, node, "passages");
  if (passages == NULL || passages->kind != SPROUT_NODE_MAP)
    return cat_shaped(l, "a kind's passages");
  kind->passage_count = passages->count;
  NEED(read_passages(l, passages, &kind->passages));

  plays = sprout_node_get(l->graph, node, "plays");
  if (plays == NULL || plays->kind != SPROUT_NODE_MAP) return cat_shaped(l, "a kind's plays");
  kind->play_group_count = plays->count;
  NEED(read_play_groups(l, plays, &kind->plays));
  *out = kind;
  return SPROUT_OK;
}

sprout_status cat_read_content(loader *l, const sprout_node *node, sprout_content *out) {
  const sprout_node *held = sprout_node_get(l->graph, node, "holds");
  size_t i;
  out->giver = cat_text(l->graph, node, "giver");
  if (out->giver == NULL) return cat_shaped(l, "a kind's content");
  NEED(cat_strings(l, sprout_node_get(l->graph, node, "path"), "a content's path", &out->path_count, &out->path));
  NEED(cat_read_kind(l, sprout_node_get(l->graph, node, "kind"), (sprout_kind_def **)&out->kind));
  if (!cat_is_array(held)) return cat_shaped(l, "a content's holds");
  out->held_count = held->count;
  out->held = (sprout_content *)cat_array(l, held->count, sizeof(sprout_content));
  MEMORY(out->held);
  for (i = 0; i < held->count; i++) NEED(cat_read_content(l, sprout_item(l->graph, held, i), &out->held[i]));
  return SPROUT_OK;
}
