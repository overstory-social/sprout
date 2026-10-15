/* The sentence's disc of words; see disc.h. */
#include "disc.h"

/* The sine and cosine of `degrees` within a quarter turn either side of 0, by their series, since the device's libm is not relied on. */
static float sine(float degrees) {
  float x = degrees * 3.14159265f / 180.0f, x2 = x * x;
  return x * (1 - x2 / 6 * (1 - x2 / 20 * (1 - x2 / 42 * (1 - x2 / 72))));
}

static float cosine(float degrees) {
  float x = degrees * 3.14159265f / 180.0f, x2 = x * x;
  return 1 - x2 / 2 * (1 - x2 / 12 * (1 - x2 / 30 * (1 - x2 / 56 * (1 - x2 / 90))));
}

static float magnitude(float v) { return v < 0 ? -v : v; }

/* The nearest whole number, halves up. */
static int nearest(float v) {
  float up = v + 0.5f;
  int whole = (int)up;
  return (float)whole > up ? whole - 1 : whole;
}

void disc_point(float angle, float radius, int *x, int *y) {
  *x = nearest(radius * cosine(angle));
  *y = nearest(radius * sine(angle));
}

float disc_bent(float angle, float radius) {
  float out = (radius - (float)DISC_HUB_RADIUS) / (float)(DISC_REACH - DISC_HUB_RADIUS);
  if (out < 0) out = 0;
  return angle * (1 + DISC_BEND * out);
}

size_t disc_rows(size_t count, size_t selected, float fraction, disc_row rows[DISC_MOST_ROWS]) {
  /* The sectors nearest the front first, so each word is placed once, where it is nearest. */
  static const int ORDER[DISC_MOST_ROWS] = {0, -1, 1, -2, 2, -3, 3};
  long side = count == 0 ? 0 : (long)count - 1 < DISC_SIDE ? (long)count - 1 : DISC_SIDE;
  size_t made = 0, i;
  if (count == 0) return 0;
  for (i = 0; i < DISC_MOST_ROWS; i++) {
    long k = ORDER[i], at = ((long)selected + k) % (long)count;
    size_t index = (size_t)(at < 0 ? at + (long)count : at), slot;
    float angle = ((float)k - fraction) * DISC_SECTOR_DEGREES;
    int seen = 0;
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
