/*
 * A view as canonical JSON (see view_json.h).
 */
#include "view_json.h"

#include <string.h>

#include "view.h"

/* The arena a tree is built in, and whether every page asked for was given. */
typedef struct writer {
  sprout_arena *arena;
  bool ok;
} writer;

static sprout_json *made(writer *w, sprout_json_kind kind, size_t members) {
  sprout_json *node = sprout_json_make(w->arena, kind, members);
  if (node == NULL) w->ok = false;
  return node;
}

static sprout_json *text(writer *w, const char *bytes, size_t length) {
  sprout_json *node = sprout_json_text(w->arena, bytes, length);
  if (node == NULL) w->ok = false;
  return node;
}

static sprout_json *cstring(writer *w, const char *bytes) { return text(w, bytes, strlen(bytes)); }

static sprout_json *str(writer *w, sprout_str s) { return text(w, s.bytes, s.length); }

static sprout_json *number(writer *w, double value) {
  sprout_json *node = made(w, SPROUT_JSON_NUMBER, 0);
  if (node != NULL) node->number = value;
  return node;
}

static sprout_json *nothing(writer *w) { return made(w, SPROUT_JSON_NULL, 0); }

static sprout_json *paragraphs(writer *w, const sprout_str *items, size_t count) {
  sprout_json *list = made(w, SPROUT_JSON_ARRAY, count);
  size_t i;
  for (i = 0; i < count; i++) sprout_json_adopt(list, NULL, str(w, items[i]));
  return list;
}

static sprout_json *exit_node(writer *w, const sprout_seen_exit *exit) {
  sprout_json *object = made(w, SPROUT_JSON_OBJECT, 3);
  sprout_json_adopt(object, "direction", exit->direction == NULL ? nothing(w) : cstring(w, exit->direction));
  sprout_json_adopt(object, "label", cstring(w, exit->label));
  sprout_json_adopt(object, "to", str(w, exit->to));
  return object;
}

static sprout_json *thing_node(writer *w, const sprout_seen_thing *thing) {
  sprout_json *object = made(w, SPROUT_JSON_OBJECT, 2);
  sprout_json_adopt(object, "id", str(w, thing->id));
  sprout_json_adopt(object, "name", str(w, thing->name));
  return object;
}

static sprout_json *things(writer *w, const sprout_seen_thing *items, size_t count) {
  sprout_json *list = made(w, SPROUT_JSON_ARRAY, count);
  size_t i;
  for (i = 0; i < count; i++) sprout_json_adopt(list, NULL, thing_node(w, &items[i]));
  return list;
}

static sprout_json *filler_node(writer *w, const sprout_seen_filler *filler) {
  sprout_json *object = made(w, SPROUT_JSON_OBJECT, 4);
  size_t i;
  sprout_json_adopt(object, "role", cstring(w, filler->role));
  switch (filler->binds) {
    case SPROUT_SEEN_OBJECT:
      sprout_json_adopt(object, "binds", cstring(w, "object"));
      sprout_json_adopt(object, "id", str(w, filler->thing.id));
      sprout_json_adopt(object, "name", str(w, filler->thing.name));
      break;
    case SPROUT_SEEN_SET: {
      sprout_json *ids = made(w, SPROUT_JSON_ARRAY, filler->member_count);
      sprout_json *names = made(w, SPROUT_JSON_ARRAY, filler->member_count);
      for (i = 0; i < filler->member_count; i++) {
        sprout_json_adopt(ids, NULL, str(w, filler->members[i].id));
        sprout_json_adopt(names, NULL, str(w, filler->members[i].name));
      }
      sprout_json_adopt(object, "binds", cstring(w, "set"));
      sprout_json_adopt(object, "ids", ids);
      sprout_json_adopt(object, "names", names);
      break;
    }
    case SPROUT_SEEN_EXIT:
      sprout_json_adopt(object, "binds", cstring(w, "exit"));
      sprout_json_adopt(object, "direction",
                        filler->exit.direction == NULL ? nothing(w) : cstring(w, filler->exit.direction));
      sprout_json_adopt(object, "label", cstring(w, filler->exit.label));
      sprout_json_adopt(object, "to", str(w, filler->exit.to));
      break;
    case SPROUT_SEEN_UNBOUND:
      sprout_json_adopt(object, "binds", cstring(w, "unbound"));
      break;
  }
  return object;
}

static sprout_json *options_node(writer *w, const sprout_seen_options *options) {
  sprout_json *object = made(w, SPROUT_JSON_OBJECT, 3), *list;
  size_t i;
  sprout_json_adopt(object, "role", cstring(w, options->role));
  if (options->symbol) {
    list = made(w, SPROUT_JSON_ARRAY, options->option_count);
    for (i = 0; i < options->option_count; i++) {
      sprout_json *one = made(w, SPROUT_JSON_OBJECT, 2);
      sprout_json_adopt(one, "value", str(w, options->options[i].value));
      sprout_json_adopt(one, "words", str(w, options->options[i].words));
      sprout_json_adopt(list, NULL, one);
    }
    sprout_json_adopt(object, "takes", cstring(w, "symbol"));
    sprout_json_adopt(object, "options", list);
  } else {
    list = made(w, SPROUT_JSON_ARRAY, options->range_count);
    for (i = 0; i < options->range_count; i++) {
      sprout_json *one = made(w, SPROUT_JSON_OBJECT, 2);
      sprout_json_adopt(one, "min", number(w, options->ranges[i].min));
      sprout_json_adopt(one, "max", number(w, options->ranges[i].max));
      sprout_json_adopt(list, NULL, one);
    }
    sprout_json_adopt(object, "takes", cstring(w, "integer"));
    sprout_json_adopt(object, "ranges", list);
  }
  return object;
}

/* An extension's payload as the JSON the extension recorded; null where the runtime holds no code for it. */
static sprout_json *payload_node(writer *w, sprout_str payload) {
  sprout_json *root = NULL;
  sprout_json_error error;
  if (payload.length == 0) return nothing(w);
  if (sprout_json_read(w->arena, payload.bytes, payload.length, &root, &error) != SPROUT_OK) {
    w->ok = false;
    return nothing(w);
  }
  return root;
}

static sprout_json *effect_node(writer *w, const sprout_seen_effect *effect) {
  sprout_json *object = made(w, SPROUT_JSON_OBJECT, 4);
  sprout_json_adopt(object, "extension", cstring(w, effect->extension));
  sprout_json_adopt(object, "statement", cstring(w, effect->statement));
  sprout_json_adopt(object, "payload", payload_node(w, effect->payload));
  sprout_json_adopt(object, "transcript", str(w, effect->transcript));
  return object;
}

static sprout_json *reading_node(writer *w, const sprout_seen_reading *reading) {
  sprout_json *object = made(w, SPROUT_JSON_OBJECT, 5);
  sprout_json *fillers = made(w, SPROUT_JSON_ARRAY, reading->filler_count);
  sprout_json *options = made(w, SPROUT_JSON_ARRAY, reading->options_count);
  size_t i;
  sprout_json_adopt(object, "verb", cstring(w, reading->verb));
  sprout_json_adopt(object, "typed", str(w, reading->typed));
  sprout_json_adopt(object, "refused",
                    reading->refused ? paragraphs(w, reading->refusal, reading->refusal_count) : nothing(w));
  for (i = 0; i < reading->filler_count; i++) sprout_json_adopt(fillers, NULL, filler_node(w, &reading->fillers[i]));
  for (i = 0; i < reading->options_count; i++) sprout_json_adopt(options, NULL, options_node(w, &reading->options[i]));
  sprout_json_adopt(object, "fillers", fillers);
  sprout_json_adopt(object, "options", options);
  return object;
}

sprout_json *sprout_seen_filler_json(sprout_arena *arena, const sprout_seen_filler *filler) {
  writer w = {arena, true};
  sprout_json *node = filler_node(&w, filler);
  return w.ok ? node : NULL;
}

sprout_json *sprout_seen_refusal_json(sprout_arena *arena, const sprout_seen_reading *reading) {
  writer w = {arena, true};
  sprout_json *node = reading->refused ? paragraphs(&w, reading->refusal, reading->refusal_count) : nothing(&w);
  return w.ok ? node : NULL;
}

sprout_json *sprout_seen_options_json(sprout_arena *arena, const sprout_seen_reading *reading) {
  writer w = {arena, true};
  sprout_json *list = made(&w, SPROUT_JSON_ARRAY, reading->options_count);
  size_t i;
  for (i = 0; i < reading->options_count; i++) sprout_json_adopt(list, NULL, options_node(&w, &reading->options[i]));
  return w.ok ? list : NULL;
}

sprout_json *sprout_view_tree(sprout_arena *arena, const sprout_seen_view *view) {
  writer w = {arena, true};
  sprout_json *object = made(&w, SPROUT_JSON_OBJECT, 6);
  sprout_json *exits = made(&w, SPROUT_JSON_ARRAY, view->exit_count);
  sprout_json *effects = made(&w, SPROUT_JSON_ARRAY, view->effect_count);
  sprout_json *readings = made(&w, SPROUT_JSON_ARRAY, view->reading_count);
  size_t i;
  for (i = 0; i < view->effect_count; i++) sprout_json_adopt(effects, NULL, effect_node(&w, &view->effects[i]));
  for (i = 0; i < view->exit_count; i++) sprout_json_adopt(exits, NULL, exit_node(&w, &view->exits[i]));
  for (i = 0; i < view->reading_count; i++) sprout_json_adopt(readings, NULL, reading_node(&w, &view->readings[i]));
  sprout_json_adopt(object, "description", paragraphs(&w, view->description, view->description_count));
  sprout_json_adopt(object, "effects", effects);
  sprout_json_adopt(object, "exits", exits);
  sprout_json_adopt(object, "occupants", things(&w, view->occupants, view->occupant_count));
  sprout_json_adopt(object, "carried", things(&w, view->carried, view->carried_count));
  sprout_json_adopt(object, "readings", readings);
  return w.ok ? object : NULL;
}

sprout_status sprout_view_json(sprout_seen_view *view, const char **bytes, size_t *length) {
  sprout_arena *arena = sprout_view_arena(view);
  sprout_json *tree = sprout_view_tree(arena, view);
  if (tree == NULL) return SPROUT_NO_MEMORY;
  return sprout_json_write(arena, tree, bytes, length);
}
