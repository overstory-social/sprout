/*
 * The `media` extension in C (see media.h). `media.show` records `{"image": <name>}` and, where a
 * caption is given and is not empty, `"caption": <text>`; its transcript line is the caption or
 * `[<name>]`.
 */
#include "media.h"

#include <string.h>

#include "json.h"

bool sprout_media_holds(const char *name, long major) { return strcmp(name, "media") == 0 && major == SPROUT_MEDIA_MAJOR; }

sprout_eval_status sprout_media_record(const sprout_frame *frame, const char *statement, size_t argument_count,
                                       const sprout_value *arguments, sprout_str *payload, sprout_str *transcript) {
  sprout_json *object;
  const char *bytes;
  size_t length;
  bool captioned;
  if (strcmp(statement, "show") != 0) return expr_unchecked(frame, "a statement `media` does not declare");
  if (argument_count < 1 || argument_count > 2 || arguments[0].kind != SPROUT_STRING ||
      (argument_count == 2 && arguments[1].kind != SPROUT_STRING))
    return expr_unchecked(frame, "arguments `media.show` does not take");
  captioned = argument_count == 2 && arguments[1].as.string.length > 0;
  object = sprout_json_make(frame->turn, SPROUT_JSON_OBJECT, captioned ? 2 : 1);
  if (object == NULL) return SPROUT_EVAL_NO_MEMORY;
  sprout_json_adopt(object, "image",
                    sprout_json_text(frame->turn, arguments[0].as.string.bytes, arguments[0].as.string.length));
  if (captioned)
    sprout_json_adopt(object, "caption",
                      sprout_json_text(frame->turn, arguments[1].as.string.bytes, arguments[1].as.string.length));
  if (object->count != (captioned ? 2u : 1u)) return SPROUT_EVAL_NO_MEMORY;
  if (sprout_json_write(frame->turn, object, &bytes, &length) != SPROUT_OK) return SPROUT_EVAL_NO_MEMORY;
  payload->bytes = bytes;
  payload->length = length;
  if (captioned) {
    transcript->bytes = arguments[1].as.string.bytes;
    transcript->length = arguments[1].as.string.length;
  } else {
    const sprout_value *image = &arguments[0];
    char *line = (char *)sprout_arena_take(frame->turn, image->as.string.length + 3);
    if (line == NULL) return SPROUT_EVAL_NO_MEMORY;
    line[0] = '[';
    memcpy(line + 1, image->as.string.bytes, image->as.string.length);
    line[image->as.string.length + 1] = ']';
    line[image->as.string.length + 2] = '\0';
    transcript->bytes = line;
    transcript->length = image->as.string.length + 2;
  }
  return SPROUT_EVAL_OK;
}
