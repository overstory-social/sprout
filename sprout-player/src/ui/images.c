/* The pictures a world shows; see images.h. */
#include "images.h"

#include <math.h>
#include <string.h>

#include "arena.h"
#include "assets.h"
#include "host/files.h"
#include "host/pd_host.h"
#include "inflate.h"
#include "json.h"
#include "load.h"
#include "text.h"

/* Reads exactly `bytes` of `file` into `buffer`; false where the file ends first or a read fails. */
static bool read_exactly(PlaydateAPI *pd, SDFile *file, void *buffer, size_t bytes) {
  size_t held = 0;
  while (held < bytes) {
    int got = player_file_read(pd, file, (unsigned char *)buffer + held, bytes - held);
    if (got <= 0) return false;
    held += (size_t)got;
  }
  return true;
}

/*
 * Where in the open cartridge `file` the picture `image` lies and how many bytes it is compressed,
 * by its header and its assets directory; false where it carries no such picture or cannot be read.
 */
static bool locate(PlaydateAPI *pd, SDFile *file, const char *image, size_t *at, size_t *bytes) {
  unsigned char header[SPROUT_CARTRIDGE_HEADER_BYTES], prefix[SPROUT_ASSETS_PREFIX_BYTES];
  sprout_cartridge_layout layout;
  sprout_refusal refusal;
  size_t count, directory_bytes;
  unsigned char *directory;
  bool found;
  if (!read_exactly(pd, file, header, sizeof header) ||
      sprout_cartridge_check_header(header, sizeof header, &layout, &refusal) != SPROUT_OK ||
      layout.assets_bytes < sizeof prefix || !player_file_seek(pd, file, layout.assets_at) ||
      !read_exactly(pd, file, prefix, sizeof prefix) ||
      !sprout_assets_prefix(prefix, layout.assets_bytes, &count, &directory_bytes) ||
      directory_bytes > IMAGES_DIRECTORY_MOST)
    return false;
  directory = (unsigned char *)player_alloc(pd, directory_bytes > 0 ? directory_bytes : 1);
  if (directory == NULL) return false;
  found = read_exactly(pd, file, directory, directory_bytes) &&
          sprout_assets_find(directory, directory_bytes, count, layout.assets_bytes, image, strlen(image), at, bytes);
  player_free(pd, directory);
  *at += layout.assets_at;
  return found;
}

bool images_has(PlaydateAPI *pd, const char *cartridge, const char *image) {
  size_t at = 0, bytes = 0;
  SDFile *file = player_file_open(pd, cartridge);
  bool found;
  if (file == NULL) return false;
  found = locate(pd, file, image, &at, &bytes);
  player_file_close(pd, file);
  return found;
}

/* The next `bytes` the picture inflates to, into `out`; false where it ends first or is damaged. */
static bool inflated(sprout_inflater *inflater, unsigned char *out, size_t bytes) {
  size_t held = 0;
  const char *why = NULL;
  while (held < bytes) {
    size_t got = 0;
    if (sprout_inflate_next(inflater, out + held, bytes - held, &got, &why) != SPROUT_OK || got == 0) return false;
    held += got;
  }
  return true;
}

/* The bitmap a packed picture's `packed` bytes inflate to: its width and height, then its rows; NULL where they do not. */
static LCDBitmap *unpacked(PlaydateAPI *pd, const unsigned char *packed, size_t bytes) {
  sprout_inflater *inflater = (sprout_inflater *)player_alloc(pd, sizeof *inflater);
  unsigned char size[4], spare;
  const char *why = NULL;
  LCDBitmap *bitmap = NULL;
  int width, height, rowbytes = 0, y;
  uint8_t *data = NULL;
  size_t stride, got = 0;
  bool whole;
  if (inflater == NULL) return NULL;
  if (sprout_inflate_begin(inflater, packed, bytes, &why) != SPROUT_OK || !inflated(inflater, size, sizeof size)) {
    player_free(pd, inflater);
    return NULL;
  }
  width = size[0] | (size[1] << 8);
  height = size[2] | (size[3] << 8);
  stride = ((size_t)width + 7) / 8;
  if (width > 0 && height > 0) bitmap = pd->graphics->newBitmap(width, height, kColorWhite);
  if (bitmap != NULL) pd->graphics->getBitmapData(bitmap, NULL, NULL, &rowbytes, NULL, &data);
  whole = bitmap != NULL && data != NULL && (size_t)rowbytes >= stride;
  for (y = 0; whole && y < height; y++) whole = inflated(inflater, data + (size_t)y * (size_t)rowbytes, stride);
  /* The picture ends where its rows do, and its trailer is checked. */
  whole = whole && sprout_inflate_next(inflater, &spare, 1, &got, &why) == SPROUT_OK && got == 0 &&
          sprout_inflate_done(inflater);
  player_free(pd, inflater);
  if (!whole && bitmap != NULL) {
    pd->graphics->freeBitmap(bitmap);
    bitmap = NULL;
  }
  return bitmap;
}

LCDBitmap *images_load(PlaydateAPI *pd, const char *cartridge, const char *image) {
  size_t at = 0, bytes = 0;
  unsigned char *packed = NULL;
  LCDBitmap *bitmap = NULL;
  SDFile *file = player_file_open(pd, cartridge);
  bool read;
  if (file == NULL) return NULL;
  read = locate(pd, file, image, &at, &bytes) && bytes > 0 &&
         (packed = (unsigned char *)player_alloc(pd, bytes)) != NULL && player_file_seek(pd, file, at) &&
         read_exactly(pd, file, packed, bytes);
  player_file_close(pd, file);
  if (read) bitmap = unpacked(pd, packed, bytes);
  player_free(pd, packed);
  return bitmap;
}

bool images_take(gallery *g, const char *cartridge, const char *extension, const char *statement, const char *payload,
                 size_t payload_length) {
  player_host host;
  sprout_arena arena;
  sprout_json *root = NULL;
  sprout_json_error error;
  const sprout_json *image, *caption;
  bool kept = true;
  if (cartridge[0] == '\0' || extension == NULL || statement == NULL || strcmp(extension, "media") != 0 || strcmp(statement, "show") != 0 ||
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
      images_has(g->pd, cartridge, image->bytes))
    kept = gallery_add(g, image->bytes, image->length, caption != NULL ? caption->bytes : NULL,
                       caption != NULL ? caption->length : 0);
  sprout_arena_reset(&arena);
  return kept;
}

bool images_take_told(gallery *g, const char *cartridge, const told_list *lines) {
  bool kept = true;
  size_t i;
  for (i = 0; i < lines->count; i++) {
    const told *line = &lines->items[i];
    kept = images_take(g, cartridge, line->extension, line->statement, line->payload, line->payload_length) && kept;
  }
  return kept;
}

bool images_take_view(gallery *g, const char *cartridge, const sprout_seen_view *view) {
  bool kept = true;
  size_t i;
  for (i = 0; i < view->effect_count; i++) {
    const sprout_seen_effect *effect = &view->effects[i];
    kept = images_take(g, cartridge, effect->extension, effect->statement, effect->payload.bytes, effect->payload.length) &&
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
