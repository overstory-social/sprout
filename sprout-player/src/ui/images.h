/*
 * The pictures a world shows, Source/images.lua's (the design doc's Images). `media.show` records
 * an effect whose payload is `{"image": ..., "caption": ...}`; the image is a 1-bit picture that
 * `sprout pack` put beside the cartridge, at `<cartridge>.assets/<image>`, which the pdx holds
 * compiled under its name without `.png`. A picture is a name until it is drawn: these functions
 * find it and load it, and the screen that draws it (pictures.h) frees it.
 */
#ifndef PLAYER_UI_IMAGES_H
#define PLAYER_UI_IMAGES_H

#include <stdbool.h>
#include <stddef.h>

#include "gallery.h"
#include "pd_api.h"
#include "sprout.h"
#include "told.h"

#define IMAGES_FOLDER_BYTES 256
#define IMAGES_PATH_BYTES 512

/* The box a picture is drawn in: the screen's width, and its height less the caption's line. */
#define IMAGES_MAX_WIDTH 400
#define IMAGES_MAX_HEIGHT 240

/* The folder of the cartridge's assets, `<cartridge>.assets/`, into `folder`; false where it does not fit. */
bool images_folder(const char *cartridge, char *folder, size_t size);

/*
 * Adds to `g` the picture an effect asks for, where it is `media.show` with an image and the
 * folder holds it; true where nothing was to be added, false only where there was no memory.
 */
bool images_take(gallery *g, const char *folder, const char *extension, const char *statement, const char *payload,
                 size_t payload_length);

/* The same for every line a call told, in order. */
bool images_take_told(gallery *g, const char *folder, const told_list *lines);

/* The same for every effect a view's description recorded, in order. */
bool images_take_view(gallery *g, const char *folder, const sprout_seen_view *view);

/* Whether the folder holds the image `image`, without loading it. */
bool images_has(PlaydateAPI *pd, const char *folder, const char *image);

/* The image `image` in the folder, loaded; NULL where it is not there or cannot be read. */
LCDBitmap *images_load(PlaydateAPI *pd, const char *folder, const char *image);

/* A picture `width` by `height` as drawn above a caption line `line_height` tall: no larger than the box, never enlarged. */
typedef struct images_fit {
  float scale;
  int width, height;
} images_fit;

images_fit images_fit_box(int width, int height, int line_height);

#endif
