/* The sentence's disc of words; see disc.h. */
#include "disc.h"

bool disc_update(disc *d, sentence *s, bool turned) {
  if (turned) {
    d->still = 0;
    d->turned = true;
    return false;
  }
  if (d->still < DISC_REST_FRAMES) d->still++;
  if (d->still < DISC_REST_FRAMES) return false;
  sentence_settle(s, DISC_SETTLE);
  if (!d->turned || sentence_fraction(s) != 0) return false;
  d->turned = false;
  return true;
}

/*
 * The sine and cosine of `degrees` by their series, since the device's libm is not relied on; close
 * enough to a pixel well past a quarter turn either side of 0, which is as far as a ray bends.
 */
static float sine(float degrees) {
  float x = degrees * 3.14159265f / 180.0f, x2 = x * x;
  return x * (1 - x2 / 6 * (1 - x2 / 20 * (1 - x2 / 42 * (1 - x2 / 72 * (1 - x2 / 110)))));
}

static float cosine(float degrees) {
  float x = degrees * 3.14159265f / 180.0f, x2 = x * x;
  return 1 - x2 / 2 * (1 - x2 / 12 * (1 - x2 / 30 * (1 - x2 / 56 * (1 - x2 / 90 * (1 - x2 / 132)))));
}

static float magnitude(float v) { return v < 0 ? -v : v; }

/* The whole number at or below `v`, and at or above it. */
static int floor_of(float v) {
  int whole = (int)v;
  return (float)whole > v ? whole - 1 : whole;
}

static int ceiling_of(float v) {
  int whole = (int)v;
  return (float)whole < v ? whole + 1 : whole;
}

/* The nearest whole number, halves up. */
static int nearest(float v) { return floor_of(v + 0.5f); }

void disc_point(float angle, float radius, int *x, int *y) {
  *x = nearest(radius * cosine(angle));
  *y = nearest(radius * sine(angle));
}

float disc_bent(float angle, float radius) {
  float out = (radius - (float)DISC_HUB_RADIUS) / (float)(DISC_REACH - DISC_HUB_RADIUS);
  if (out < 0) out = 0;
  return angle * (1 + DISC_BEND * out);
}

float disc_detent(float fraction) {
  float out = magnitude(fraction) * 2, power = 1;
  int i;
  for (i = 0; i < DISC_DETENT; i++) power *= out;
  return fraction < 0 ? -power / 2 : power / 2;
}

size_t disc_rows(size_t count, size_t selected, float fraction, disc_row rows[DISC_MOST_ROWS]) {
  /* The sectors nearest the front first, so each word is placed once, where it is nearest. */
  static const int ORDER[DISC_MOST_ROWS] = {0, -1, 1, -2, 2, -3, 3};
  long side = count == 0 ? 0 : (long)count - 1 < DISC_SIDE ? (long)count - 1 : DISC_SIDE;
  size_t made = 0, i;
  float turn = disc_detent(fraction);
  if (count == 0) return 0;
  for (i = 0; i < DISC_MOST_ROWS; i++) {
    long k = ORDER[i], at = ((long)selected + k) % (long)count;
    size_t index = (size_t)(at < 0 ? at + (long)count : at), slot;
    float angle = ((float)k - turn) * DISC_SECTOR_DEGREES;
    bool seen = false;
    if (k > side || -k > side || magnitude(angle) >= 90.0f) continue;
    for (slot = 0; slot < made; slot++) seen = seen || rows[slot].index == index;
    if (seen) continue;
    rows[made].index = index;
    rows[made].angle = angle;
    rows[made].front = k == 0;
    made++;
  }
  return made;
}

/* A rounding error's worth of pixel, so a corner the series puts a hair past a whole pixel does not widen the box. */
#define HAIR 0.001f

disc_box disc_turned_box(int width, int height, float angle) {
  float c = cosine(angle), s = sine(angle), half = (float)height / 2;
  float corners[4][2] = {{0, -half}, {(float)width, -half}, {0, half}, {(float)width, half}};
  float lo_x = 0, hi_x = 0, lo_y = 0, hi_y = 0;
  disc_box box;
  int i;
  for (i = 0; i < 4; i++) {
    float x = corners[i][0] * c - corners[i][1] * s, y = corners[i][0] * s + corners[i][1] * c;
    if (i == 0 || x < lo_x) lo_x = x;
    if (i == 0 || x > hi_x) hi_x = x;
    if (i == 0 || y < lo_y) lo_y = y;
    if (i == 0 || y > hi_y) hi_y = y;
  }
  box.x = floor_of(lo_x + HAIR);
  box.y = floor_of(lo_y + HAIR);
  box.width = ceiling_of(hi_x - HAIR) - box.x;
  box.height = ceiling_of(hi_y - HAIR) - box.y;
  return box;
}

static void put_bit(uint8_t *bytes, int rowbytes, int x, int y, bool set) {
  uint8_t *byte = &bytes[y * rowbytes + x / 8], bit = (uint8_t)(0x80u >> (x % 8));
  if (set)
    *byte |= bit;
  else
    *byte &= (uint8_t)~bit;
}

void disc_turn(const uint8_t *flat, int width, int height, int rowbytes, float angle, bool inverted, disc_box box,
               uint8_t *data, uint8_t *mask, int box_rowbytes) {
  float c = cosine(angle), s = sine(angle), half = (float)height / 2;
  int u, v;
  for (v = 0; v < box.height; v++) {
    /* The middle of the row's first pixel, from the pivot, turned back onto the label; a pixel along the row is a step of (c, -s) there. */
    float px = (float)box.x + 0.5f, py = (float)(box.y + v) + 0.5f;
    float sx = px * c + py * s, sy = -px * s + py * c + half;
    for (u = 0; u < box.width; u++, sx += c, sy -= s) {
      int fx = floor_of(sx), fy = floor_of(sy);
      bool inside = fx >= 0 && fy >= 0 && fx < width && fy < height;
      bool black = inside && !((flat[fy * rowbytes + fx / 8] >> (7 - fx % 8)) & 1u);
      bool drawn = inside && (inverted || black);
      put_bit(data, box_rowbytes, u, v, drawn ? black == inverted : true);
      if (mask != NULL) put_bit(mask, box_rowbytes, u, v, drawn);
    }
  }
}
