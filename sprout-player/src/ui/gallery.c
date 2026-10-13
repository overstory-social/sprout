/* The pictures a turn showed; see gallery.h. */
#include "gallery.h"

#include <math.h>
#include <string.h>

#include "host/files.h"

void gallery_init(gallery *g, PlaydateAPI *pd) {
  memset(g, 0, sizeof *g);
  g->pd = pd;
  g->leaving = -1;
}

void gallery_free(gallery *g) {
  size_t i;
  for (i = 0; i < g->count; i++) {
    player_free(g->pd, g->pictures[i].image);
    player_free(g->pd, g->pictures[i].caption);
  }
  player_free(g->pd, g->pictures);
  gallery_init(g, g->pd);
}

static char *copy_of(PlaydateAPI *pd, const char *text, size_t length) {
  char *copy = (char *)player_alloc(pd, length + 1);
  if (copy == NULL) return NULL;
  memcpy(copy, text, length);
  copy[length] = '\0';
  return copy;
}

bool gallery_add(gallery *g, const char *image, size_t image_length, const char *caption, size_t caption_length) {
  gallery_picture *picture;
  size_t i;
  for (i = 0; i < g->count; i++)
    if (strlen(g->pictures[i].image) == image_length && memcmp(g->pictures[i].image, image, image_length) == 0) return true;
  if (g->count == g->capacity) {
    size_t capacity = g->capacity == 0 ? 4 : g->capacity * 2;
    gallery_picture *grown = (gallery_picture *)player_alloc(g->pd, capacity * sizeof *grown);
    if (grown == NULL) return false;
    if (g->count > 0) memcpy(grown, g->pictures, g->count * sizeof *grown);
    player_free(g->pd, g->pictures);
    g->pictures = grown;
    g->capacity = capacity;
  }
  picture = &g->pictures[g->count];
  picture->image = copy_of(g->pd, image, image_length);
  picture->caption = caption != NULL && caption_length > 0 ? copy_of(g->pd, caption, caption_length) : NULL;
  if (picture->image == NULL || (caption != NULL && caption_length > 0 && picture->caption == NULL)) {
    player_free(g->pd, picture->image);
    player_free(g->pd, picture->caption);
    return false;
  }
  g->count++;
  return true;
}

const gallery_picture *gallery_current(const gallery *g) { return g->count > 0 ? &g->pictures[g->selected] : NULL; }

void gallery_nudge(gallery *g, long steps) {
  long n = (long)g->count;
  if (n < 2 || steps == 0) return;
  g->leaving = (long)g->selected;
  g->selected = (size_t)((((long)g->selected + steps) % n + n) % n);
  g->direction = steps > 0 ? 1 : -1;
  g->phase = GALLERY_HOLD;
  g->held = 0;
  g->y = 0;
}

long gallery_turn(gallery *g, float degrees) {
  long steps = 0;
  g->crank += degrees;
  while (g->crank >= GALLERY_DEGREES_PER_STEP) {
    g->crank -= GALLERY_DEGREES_PER_STEP;
    steps++;
  }
  while (g->crank <= -GALLERY_DEGREES_PER_STEP) {
    g->crank += GALLERY_DEGREES_PER_STEP;
    steps--;
  }
  if (steps != 0) gallery_nudge(g, steps);
  return steps;
}

bool gallery_update(gallery *g) {
  if (g->phase == GALLERY_HOLD) {
    g->held++;
    /* Stretched the way it will go, a little more each frame, like something pulled back. */
    g->y = (float)(-g->direction * (GALLERY_STRETCH * g->held / GALLERY_HOLD_FRAMES));
    if (g->held >= GALLERY_HOLD_FRAMES) g->phase = GALLERY_WHIZ_OUT;
    return false;
  }
  if (g->phase == GALLERY_WHIZ_OUT) {
    float goal = (float)(g->direction * GALLERY_TRAVEL);
    g->y += (goal - g->y) * GALLERY_WHIZ;
    if (fabsf(goal - g->y) < 2.0f) {
      g->phase = GALLERY_REST;
      g->leaving = -1;
      g->y = 0;
      g->direction = 0;
      return true;
    }
  }
  return false;
}

gallery_frame gallery_frame_now(const gallery *g) {
  gallery_frame frame;
  int y = (int)floorf(g->y + 0.5f);
  frame.current.index = g->count > 0 ? (long)g->selected : -1;
  frame.current.y = 0;
  frame.leaving.index = -1;
  frame.leaving.y = 0;
  if (frame.current.index < 0 || g->leaving < 0) return frame;
  /* The leaving picture goes out the way the steps went, up for the next; the new one follows it in. */
  frame.current.y = y + g->direction * GALLERY_TRAVEL;
  frame.leaving.index = g->leaving;
  frame.leaving.y = y;
  return frame;
}
