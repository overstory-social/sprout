/* The pictures a world shows; see images.h. */
#include "images.h"

#include <math.h>
#include <string.h>

#include "arena.h"
#include "host/files.h"
#include "host/pd_host.h"
#include "json.h"
#include "text.h"

static const char ASSETS[] = ".assets/";
static const char PNG[] = ".png";
static const char PDI[] = ".pdi";

bool images_folder(const char *cartridge, char *folder, size_t size) {
  text_buffer out;
  if (strlen(cartridge) + strlen(ASSETS) >= size) return false;
  text_begin(&out, folder, size);
  text_add(&out, cartridge);
  text_add(&out, ASSETS);
  return true;
}

/* The two names an image may be under in the folder: without `.png` (as the pdx compiles it), then as asked. */
static size_t names_of(const char *folder, const char *image, char names[2][IMAGES_PATH_BYTES]) {
  size_t length = strlen(image), stem = length, n = 0;
  if (length > strlen(PNG) && strcmp(image + length - strlen(PNG), PNG) == 0) stem = length - strlen(PNG);
  if (strlen(folder) + length + strlen(PDI) >= IMAGES_PATH_BYTES) return 0;
  if (stem < length) {
    memcpy(names[n], folder, strlen(folder));
    memcpy(names[n] + strlen(folder), image, stem);
    names[n][strlen(folder) + stem] = '\0';
    n++;
  }
  memcpy(names[n], folder, strlen(folder));
  memcpy(names[n] + strlen(folder), image, length + 1);
  return n + 1;
}

/* Whether the image is at `name`, compiled or not. */
static bool held_at(PlaydateAPI *pd, const char *name) {
  char compiled[IMAGES_PATH_BYTES];
  text_buffer out;
  if (player_file_exists(pd, name)) return true;
  text_begin(&out, compiled, sizeof compiled);
  text_add(&out, name);
  text_add(&out, PDI);
  return player_file_exists(pd, compiled);
}

bool images_has(PlaydateAPI *pd, const char *folder, const char *image) {
  char names[2][IMAGES_PATH_BYTES];
  size_t count = names_of(folder, image, names), i;
  for (i = 0; i < count; i++)
    if (held_at(pd, names[i])) return true;
  return false;
}

LCDBitmap *images_load(PlaydateAPI *pd, const char *folder, const char *image) {
  char names[2][IMAGES_PATH_BYTES];
  size_t count = names_of(folder, image, names), i;
  for (i = 0; i < count; i++) {
    LCDBitmap *bitmap;
    if (!held_at(pd, names[i])) continue;
    bitmap = player_load_bitmap(pd, names[i]);
    if (bitmap != NULL) return bitmap;
  }
  return NULL;
}

bool images_take(gallery *g, const char *folder, const char *extension, const char *statement, const char *payload,
                 size_t payload_length) {
  player_host host;
  sprout_arena arena;
  sprout_json *root = NULL;
  sprout_json_error error;
  const sprout_json *image, *caption;
  bool kept = true;
  if (folder[0] == '\0' || extension == NULL || statement == NULL || strcmp(extension, "media") != 0 || strcmp(statement, "show") != 0 ||
      payload == NULL || payload_length == 0)
    return true;
  player_host_init(&host, g->pd);
  if (sprout_arena_init(&arena, &host.record) != SPROUT_OK) return false;
  switch (sprout_json_read(&arena, payload, payload_length, &root, &error)) {
  case SPROUT_OK:
    break;
  case SPROUT_NO_MEMORY:
    kept = false;
    /* fall through */
  default:
    root = NULL;
    break;
  }
  image = root != NULL && root->kind == SPROUT_JSON_OBJECT ? sprout_json_get(root, "image") : NULL;
  caption = root != NULL && root->kind == SPROUT_JSON_OBJECT ? sprout_json_get(root, "caption") : NULL;
  if (caption != NULL && caption->kind != SPROUT_JSON_STRING) caption = NULL;
  if (image != NULL && image->kind == SPROUT_JSON_STRING && image->length > 0 && strlen(image->bytes) == image->length &&
      images_has(g->pd, folder, image->bytes))
    kept = gallery_add(g, image->bytes, image->length, caption != NULL ? caption->bytes : NULL,
                       caption != NULL ? caption->length : 0);
  sprout_arena_reset(&arena);
  return kept;
}

bool images_take_told(gallery *g, const char *folder, const told_list *lines) {
  bool kept = true;
  size_t i;
  for (i = 0; i < lines->count; i++) {
    const told *line = &lines->items[i];
    kept = images_take(g, folder, line->extension, line->statement, line->payload, line->payload_length) && kept;
  }
  return kept;
}

bool images_take_view(gallery *g, const char *folder, const sprout_seen_view *view) {
  bool kept = true;
  size_t i;
  for (i = 0; i < view->effect_count; i++) {
    const sprout_seen_effect *effect = &view->effects[i];
    kept = images_take(g, folder, effect->extension, effect->statement, effect->payload.bytes, effect->payload.length) &&
           kept;
  }
  return kept;
}

images_fit images_fit_box(int width, int height, int line_height) {
  images_fit fit;
  float room = (float)(IMAGES_MAX_HEIGHT - line_height - 4);
  fit.scale = 1.0f;
  if (width <= 0 || height <= 0) {
    fit.width = fit.height = 0;
    return fit;
  }
  if ((float)IMAGES_MAX_WIDTH / (float)width < fit.scale) fit.scale = (float)IMAGES_MAX_WIDTH / (float)width;
  if (room / (float)height < fit.scale) fit.scale = room / (float)height;
  fit.width = (int)floorf((float)width * fit.scale);
  fit.height = (int)floorf((float)height * fit.scale);
  return fit;
}
