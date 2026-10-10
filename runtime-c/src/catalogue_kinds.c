/*
 * Reads types, defaults, kinds and the contents a kind's body gives (the
 * spec's The runtime > State; Properties). A kind, or a type, that two parts
 * of the graph share is read once and found again by the index of its entry,
 * so identity is pointer identity.
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
  if (node->index != SPROUT_NOT_AN_ENTRY && l->type_cache[node->index] != NULL) {
    *out = l->type_cache[node->index];
    return SPROUT_OK;
  }
  tag = cat_text(node, "type");
  if (tag == NULL) return cat_shaped(l, "a type");
  type = (sprout_decl_type *)cat_array(l, 1, sizeof *type);
  MEMORY(type);
  if (node->index != SPROUT_NOT_AN_ENTRY) l->type_cache[node->index] = type;
  if (strcmp(tag, "boolean") == 0) {
    type->kind = SPROUT_DECL_BOOLEAN;
    type->key = "boolean";
  } else if (strcmp(tag, "string") == 0) {
    type->kind = SPROUT_DECL_STRING;
    type->key = "string";
  } else if (strcmp(tag, "integer") == 0) {
    const sprout_node *min = sprout_node_get(node, "min"), *max = sprout_node_get(node, "max");
    if (min == NULL || max == NULL || min->kind != SPROUT_NODE_NUMBER ||
        max->kind != SPROUT_NODE_NUMBER)
      return cat_shaped(l, "an integer type");
    type->kind = SPROUT_DECL_INTEGER;
    type->min = min->number;
    type->max = max->number;
    type->key = "integer";
  } else if (strcmp(tag, "symbol") == 0) {
    const sprout_node *of = sprout_node_get(node, "of");
    const char *library = cat_text(of, "library"), *name = cat_text(of, "name");
    if (library == NULL || name == NULL) return cat_shaped(l, "an enum type");
    type->kind = SPROUT_DECL_SYMBOL;
    type->key = type->enum_name = cat_join3(l, library, ".", name);
    MEMORY(type->key);
    NEED(cat_strings(l, sprout_node_get(of, "options"), "an enum's options", &type->option_count,
                 &type->options));
  } else if (strcmp(tag, "list") == 0) {
    const char *inner;
    NEED(cat_read_type(l, sprout_node_get(node, "element"), &type->element));
    if (type->element == NULL) return cat_shaped(l, "a list type");
    type->kind = SPROUT_DECL_LIST;
    inner = cat_join3(l, "[", type->element->key, "]");
    MEMORY(inner);
    type->key = inner;
  } else if (strcmp(tag, "extension") == 0) {
    const char *extension = cat_text(node, "extension"), *name = cat_text(node, "name");
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
  const char *kind = cat_text(node, "kind");
  const sprout_node *value;
  size_t i;
  if (kind == NULL) return cat_shaped(l, "a property's default");
  value = sprout_node_get(node, "value");
  if (strcmp(kind, "boolean") == 0 && value != NULL && value->kind == SPROUT_NODE_BOOL) {
    out->kind = SPROUT_LITERAL_BOOLEAN;
    out->boolean = value->boolean;
  } else if (strcmp(kind, "integer") == 0 && value != NULL && value->kind == SPROUT_NODE_NUMBER) {
    out->kind = SPROUT_LITERAL_NUMBER;
    out->number = value->number;
  } else if (strcmp(kind, "string") == 0 && value != NULL && value->kind == SPROUT_NODE_STRING) {
    out->kind = SPROUT_LITERAL_STRING;
    out->text = value->text;
  } else if (strcmp(kind, "option-literal") == 0) {
    out->kind = SPROUT_LITERAL_OPTION;
    out->text = cat_text(sprout_node_get(node, "name"), "text");
    if (out->text == NULL) return cat_shaped(l, "an option default");
  } else if (strcmp(kind, "list-literal") == 0) {
    const sprout_node *elements = sprout_node_get(node, "elements");
    if (!cat_is_array(elements)) return cat_shaped(l, "a list default");
    out->kind = SPROUT_LITERAL_LIST;
    out->count = elements->count;
    out->items = (sprout_literal *)cat_array(l, elements->count, sizeof(sprout_literal));
    MEMORY(out->items);
    for (i = 0; i < elements->count; i++) NEED(read_literal(l, elements->items[i], &out->items[i]));
  } else {
    return cat_fail(l, "This cartridge holds a default this runtime does not know: `", kind, "`.");
  }
  return SPROUT_OK;
}

/* ---- kinds ---- */

static sprout_status read_property(loader *l, const sprout_node *name_node,
                                   const sprout_node *node, sprout_property *out) {
  const sprout_node *remembered = sprout_node_get(node, "remembered");
  const sprout_node *declaration = sprout_node_get(node, "declaration");
  if (name_node->kind != SPROUT_NODE_STRING || remembered == NULL ||
      remembered->kind != SPROUT_NODE_BOOL)
    return cat_shaped(l, "a property");
  out->name = name_node->text;
  out->remembered = remembered->boolean;
  out->origin = cat_text(node, "origin");
  if (out->origin == NULL) return cat_shaped(l, "a property's origin");
  NEED(cat_read_type(l, sprout_node_get(node, "type"), &out->type));
  if (out->type == NULL) return cat_shaped(l, "a property's type");
  return read_literal(l, sprout_node_get(declaration, "default"), &out->default_value);
}

sprout_status cat_read_kind(loader *l, const sprout_node *node, sprout_kind_def **out) {
  sprout_kind_def *kind;
  const sprout_node *properties, *passages, *plays;
  size_t i, j;
  *out = NULL;
  if (node == NULL || node->kind == SPROUT_NODE_NULL) return SPROUT_OK;
  if (node->kind != SPROUT_NODE_OBJECT || node->index == SPROUT_NOT_AN_ENTRY)
    return cat_shaped(l, "a kind");
  if (l->kind_cache[node->index] != NULL) {
    *out = l->kind_cache[node->index];
    return SPROUT_OK;
  }
  kind = (sprout_kind_def *)cat_array(l, 1, sizeof *kind);
  MEMORY(kind);
  l->kind_cache[node->index] = kind;
  kind->library = cat_text(node, "library");
  kind->name = cat_text(node, "name");
  if (kind->library == NULL || kind->name == NULL) return cat_shaped(l, "a kind");
  kind->qualified = cat_join3(l, kind->library, ".", kind->name);
  MEMORY(kind->qualified);
  kind->node = node;
  NEED(cat_strings(l, sprout_node_get(node, "order"), "a kind's order", &kind->order_count,
               &kind->order));
  for (i = 0; i < kind->order_count; i++) {
    if (strcmp(kind->order[i], "sprout.World") == 0) kind->composes_world = true;
    if (strcmp(kind->order[i], "sprout.Visitor") == 0) kind->composes_visitor = true;
    if (strcmp(kind->order[i], "sprout.Actor") == 0) kind->composes_actor = true;
  }
  kind->contains = cat_bool(node, "contains");
  kind->contains_actors = cat_bool(node, "containsActors");

  properties = sprout_node_get(node, "properties");
  if (properties == NULL || properties->kind != SPROUT_NODE_MAP)
    return cat_shaped(l, "a kind's properties");
  kind->property_count = properties->count;
  kind->properties = (sprout_property *)cat_array(l, properties->count, sizeof(sprout_property));
  MEMORY(kind->properties);
  for (i = 0; i < properties->count; i++)
    NEED(read_property(l, properties->map_keys[i], properties->items[i], &kind->properties[i]));

  passages = sprout_node_get(node, "passages");
  if (passages == NULL || passages->kind != SPROUT_NODE_MAP)
    return cat_shaped(l, "a kind's passages");
  kind->passage_count = passages->count;
  kind->passages = (sprout_passage *)cat_array(l, passages->count, sizeof(sprout_passage));
  MEMORY(kind->passages);
  for (i = 0; i < passages->count; i++) {
    if (passages->map_keys[i]->kind != SPROUT_NODE_STRING) return cat_shaped(l, "a passage");
    kind->passages[i].name = passages->map_keys[i]->text;
    kind->passages[i].node = passages->items[i];
  }

  plays = sprout_node_get(node, "plays");
  if (plays == NULL || plays->kind != SPROUT_NODE_MAP) return cat_shaped(l, "a kind's plays");
  kind->play_group_count = plays->count;
  kind->plays = (sprout_play_group *)cat_array(l, plays->count, sizeof(sprout_play_group));
  MEMORY(kind->plays);
  for (i = 0; i < plays->count; i++) {
    const sprout_node *group = plays->items[i];
    if (plays->map_keys[i]->kind != SPROUT_NODE_STRING || !cat_is_array(group))
      return cat_shaped(l, "a kind's plays");
    kind->plays[i].key = plays->map_keys[i]->text;
    kind->plays[i].count = group->count;
    kind->plays[i].plays = (sprout_play *)cat_array(l, group->count, sizeof(sprout_play));
    MEMORY(kind->plays[i].plays);
    for (j = 0; j < group->count; j++) {
      sprout_play *play = &kind->plays[i].plays[j];
      play->origin = cat_text(group->items[j], "origin");
      play->library = cat_text(group->items[j], "library");
      play->verb = cat_text(group->items[j], "verb");
      play->role = cat_text(group->items[j], "role");
      play->any = cat_bool(group->items[j], "any");
      play->node = group->items[j];
      if (play->origin == NULL || play->library == NULL || play->verb == NULL || play->role == NULL)
        return cat_shaped(l, "a play");
    }
  }
  *out = kind;
  return SPROUT_OK;
}

sprout_status cat_read_content(loader *l, const sprout_node *node, sprout_content *out) {
  const sprout_node *held = sprout_node_get(node, "holds");
  size_t i;
  out->giver = cat_text(node, "giver");
  if (out->giver == NULL) return cat_shaped(l, "a kind's content");
  NEED(cat_strings(l, sprout_node_get(node, "path"), "a content's path", &out->path_count, &out->path));
  NEED(cat_read_kind(l, sprout_node_get(node, "kind"), (sprout_kind_def **)&out->kind));
  if (!cat_is_array(held)) return cat_shaped(l, "a content's holds");
  out->held_count = held->count;
  out->held = (sprout_content *)cat_array(l, held->count, sizeof(sprout_content));
  MEMORY(out->held);
  for (i = 0; i < held->count; i++) NEED(cat_read_content(l, held->items[i], &out->held[i]));
  return SPROUT_OK;
}
