/*
 * The pictures a turn showed, Source/gallery.lua's: the queue of what `media.show` asked for, each
 * image once in the order asked, which one is on screen, and the slat-clack motion the crank gives
 * them (the design doc's Images). A step holds the picture on screen an elastic moment, stretched
 * the way it will go, then whizzes it out while the next whizzes in behind it and lands with a
 * clack. A gallery holds names, never bitmaps: the screen (pictures.h) loads the one it draws.
 */
#ifndef PLAYER_UI_GALLERY_H
#define PLAYER_UI_GALLERY_H

#include <stdbool.h>
#include <stddef.h>

#include "pd_api.h"

/* Degrees of crank for one picture. */
#define GALLERY_DEGREES_PER_STEP 36.0f
/* Frames a picture is held, stretched, before it whizzes out. */
#define GALLERY_HOLD_FRAMES 6
/* How far the held picture is stretched the way it will go, in pixels. */
#define GALLERY_STRETCH 8
/* The share of the way left that a whizzing picture moves each frame. */
#define GALLERY_WHIZ 0.4f
/* The height a picture travels: the screen's. */
#define GALLERY_TRAVEL 240

/* A picture asked for: the image's path inside the world's assets, and its caption or NULL. */
typedef struct gallery_picture {
  char *image;
  char *caption;
} gallery_picture;

typedef enum gallery_phase { GALLERY_REST, GALLERY_HOLD, GALLERY_WHIZ_OUT } gallery_phase;

typedef struct gallery {
  PlaydateAPI *pd;
  gallery_picture *pictures;
  size_t count, capacity;
  size_t selected;  /* the picture on screen, or landing */
  long leaving;     /* the picture leaving, or -1 */
  float crank;      /* degrees turned toward the next step, not yet a step */
  gallery_phase phase;
  int held;         /* frames held so far */
  float y;          /* the leaving picture's offset */
  int direction;    /* 1 toward the next, -1 back, 0 at rest */
} gallery;

/* One picture as the screen draws it this frame: which, and its vertical offset, 0 at rest. */
typedef struct gallery_shown {
  long index; /* -1 for none */
  int y;
} gallery_shown;

typedef struct gallery_frame {
  gallery_shown current, leaving;
} gallery_frame;

/* An empty gallery over `pd`'s allocator. */
void gallery_init(gallery *g, PlaydateAPI *pd);
void gallery_free(gallery *g);

/* Adds the picture `image` with `caption` (or NULL) unless the gallery holds that image; false when there is no memory for it. */
bool gallery_add(gallery *g, const char *image, size_t image_length, const char *caption, size_t caption_length);

/* The picture on screen, or NULL for an empty gallery. */
const gallery_picture *gallery_current(const gallery *g);

/* Moves on by `steps` pictures, wrapping, the one on screen leaving the way the steps go. */
void gallery_nudge(gallery *g, long steps);

/* Turns the crank by `degrees`: a picture for each GALLERY_DEGREES_PER_STEP, the rest kept; the steps taken. */
long gallery_turn(gallery *g, float degrees);

/* One frame of the motion; true the frame the next picture lands, which clacks. */
bool gallery_update(gallery *g);

/* What to draw this frame: the picture landing or at rest, and the one leaving while one leaves. */
gallery_frame gallery_frame_now(const gallery *g);

#endif
