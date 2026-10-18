/*
 * The pictures a world shows (the design doc's Images). `media.show` records
 * an effect whose payload is `{"image": ..., "caption": ...}`; the image is a 1-bit picture the
 * cartridge carries in its assets section (assets.h), packed as its width and height and then its
 * rows. A picture is a name until it is drawn: these functions find it in the cartridge's directory
 * and build its bitmap from the file, inflating only that picture, and the screen that draws it
 * (pictures.h) frees it.
 */
#ifndef PLAYER_UI_IMAGES_H
#define PLAYER_UI_IMAGES_H

#include <stdbool.h>
#include <stddef.h>

#include "gallery.h"
#include "pd_api.h"
#include "sprout.h"
#include "told.h"

/* The most bytes of assets directory read to find a picture: a directory larger is not a cartridge this reads. */
#define IMAGES_DIRECTORY_MOST 65536u

/* The box a picture is drawn in: the screen's width, and its height less the caption's line. */
#define IMAGES_MAX_WIDTH 400
#define IMAGES_MAX_HEIGHT 240

/*
 * Adds to `g` the picture an effect asks for, where it is `media.show` with an image and the
 * cartridge at `cartridge` (a path, "" for none) carries it; true where nothing was to be added,
 * false only where there was no memory.
 */
bool images_take(gallery *g, const char *cartridge, const char *extension, const char *statement, const char *payload,
                 size_t payload_length);

/* The same for every line a call told, in order. */
bool images_take_told(gallery *g, const char *cartridge, const told_list *lines);

/* The same for every effect a view's description recorded, in order. */
bool images_take_view(gallery *g, const char *cartridge, const sprout_seen_view *view);

/* Whether the cartridge carries the image `image`, by its directory alone. */
bool images_has(PlaydateAPI *pd, const char *cartridge, const char *image);

/* The image `image` the cartridge carries, built as a bitmap; NULL where it is not there or cannot be read. */
LCDBitmap *images_load(PlaydateAPI *pd, const char *cartridge, const char *image);

/* A picture `width` by `height` as drawn above a caption line `line_height` tall: no larger than the box, never enlarged. */
typedef struct images_fit {
  float scale;
  int width, height;
} images_fit;

images_fit images_fit_box(int width, int height, int line_height);

#endif
