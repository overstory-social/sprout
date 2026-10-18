/* The fake's bitmaps: those made with newBitmap, holding real pixels and drawn through their mask, at their size or scaled; see fake_playdate.h. */
#include "fake.h"

#include <stdio.h>
#include <stdlib.h>
#include <string.h>

int fake_made_index(const fake_playdate *fake, const LCDBitmap *bitmap) {
  int index = (int)((const fake_made *)bitmap - fake->made);
  if (index < 0 || index >= FAKE_MADE) return -1;
  return (const fake_made *)bitmap == &fake->made[index] && fake->made[index].live ? index : -1;
}

LCDSolidColor fake_made_pixel(const fake_playdate *fake, int made, int x, int y) {
  const fake_made *m = &fake->made[made];
  if (x < 0 || y < 0 || x >= m->width || y >= m->height) return kColorClear;
  if (m->mask != NULL && !((m->mask[y * m->rowbytes + x / 8] >> (7 - x % 8)) & 1)) return kColorClear;
  return (m->data[y * m->rowbytes + x / 8] >> (7 - x % 8)) & 1 ? kColorWhite : kColorBlack;
}

/* Whether `bitmap` points into the made bitmaps, live or not. */
static int is_made(LCDBitmap *bitmap) {
  const fake_made *m = (const fake_made *)bitmap;
  return m >= fake_current->made && m < fake_current->made + FAKE_MADE;
}

/* The live made bitmap `bitmap` is; anything else is a fault. */
static int made_of(LCDBitmap *bitmap) {
  int index = fake_made_index(fake_current, bitmap);
  if (index < 0) abort();
  return index;
}

/* A bitmap filled with `color`; a clear one has a mask, all of it undrawn. */
static LCDBitmap *fake_new_bitmap(int width, int height, LCDColor color) {
  int i;
  for (i = 0; i < FAKE_MADE; i++) {
    fake_made *made = &fake_current->made[i];
    size_t bytes;
    if (made->live) continue;
    if (width <= 0 || height <= 0 || color > kColorClear) abort();
    memset(made, 0, sizeof *made);
    made->width = width;
    made->height = height;
    made->rowbytes = (width + 31) / 32 * 4; /* padded, so a reader that assumes the width's bytes is caught */
    bytes = (size_t)made->rowbytes * (size_t)height;
    made->data = (uint8_t *)malloc(bytes);
    if (made->data == NULL) abort();
    memset(made->data, color == kColorBlack ? 0x00 : 0xFF, bytes);
    if (color == kColorClear) {
      made->mask = (uint8_t *)calloc(1, bytes);
      if (made->mask == NULL) abort();
    }
    made->live = 1;
    fake_current->made_live++;
    fake_current->made_total++;
    return (LCDBitmap *)made;
  }
  abort(); /* more bitmaps held at once than any screen should */
}

static void fake_push_context(LCDBitmap *target) {
  if (fake_current->context_count == FAKE_CONTEXTS) abort();
  fake_current->contexts[fake_current->context_count++] = target == NULL ? -1 : made_of(target);
}

static void fake_pop_context(void) {
  if (fake_current->context_count == 0) abort();
  fake_current->context_count--;
}

static void fake_free_bitmap(LCDBitmap *bitmap) {
  fake_made *made = &fake_current->made[made_of(bitmap)];
  int i;
  for (i = 0; i < fake_current->context_count; i++)
    if (fake_current->contexts[i] == made - fake_current->made) abort(); /* freed while drawn into */
  free(made->data);
  free(made->mask);
  made->data = made->mask = NULL;
  made->live = 0;
  fake_current->made_live--;
}

static void fake_bitmap_data(LCDBitmap *bitmap, int *width, int *height, int *rowbytes, uint8_t **mask, uint8_t **data) {
  fake_made *made = &fake_current->made[made_of(bitmap)];
  if (width != NULL) *width = made->width;
  if (height != NULL) *height = made->height;
  if (rowbytes != NULL) *rowbytes = made->rowbytes;
  if (mask != NULL) *mask = made->mask;
  if (data != NULL) *data = made->data;
}

/* A made bitmap copied onto the context through its mask at `scale`, each pixel of the copy its nearest, and its placement recorded. */
static void placed_at(LCDBitmap *bitmap, int x, int y, float scale) {
  int index = made_of(bitmap), i, j;
  const fake_made *made = &fake_current->made[index];
  int width = (int)((float)made->width * scale), height = (int)((float)made->height * scale);
  fake_placed *placed;
  if (fake_current->placed_count == FAKE_PLACED) abort();
  placed = &fake_current->placed[fake_current->placed_count++];
  placed->made = index;
  placed->x = x;
  placed->y = y;
  placed->scale = scale;
  placed->clipped = fake_current->clipped;
  placed->clip_x = fake_current->clip_x;
  placed->clip_y = fake_current->clip_y;
  placed->clip_width = fake_current->clip_width;
  placed->clip_height = fake_current->clip_height;
  for (j = 0; j < height; j++)
    for (i = 0; i < width; i++) {
      LCDSolidColor pixel = fake_made_pixel(fake_current, index, (int)((float)i / scale), (int)((float)j / scale));
      if (pixel != kColorClear) fake_set_pixel(x + i, y + j, pixel == kColorBlack);
    }
}

static void fake_draw_bitmap(LCDBitmap *bitmap, int x, int y, LCDBitmapFlip flip) {
  if (flip != kBitmapUnflipped) abort();
  placed_at(bitmap, x, y, 1.0f);
}

static void fake_draw_scaled_bitmap(LCDBitmap *bitmap, int x, int y, float xscale, float yscale) {
  if (xscale != yscale || xscale <= 0.0f) abort();
  placed_at(bitmap, x, y, xscale);
}

void fake_install_bitmaps(fake_playdate *fake) {
  fake->gfx.newBitmap = fake_new_bitmap;
  fake->gfx.pushContext = fake_push_context;
  fake->gfx.popContext = fake_pop_context;
  fake->gfx.freeBitmap = fake_free_bitmap;
  fake->gfx.getBitmapData = fake_bitmap_data;
  fake->gfx.drawBitmap = fake_draw_bitmap;
  fake->gfx.drawScaledBitmap = fake_draw_scaled_bitmap;
}
