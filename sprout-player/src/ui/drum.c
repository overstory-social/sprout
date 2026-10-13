/* The sentence's drum; see drum.h. */
#include "drum.h"

bool drum_update(drum *d, sentence *s, bool turned) {
  if (turned) {
    d->still = 0;
    d->turned = true;
    return false;
  }
  if (d->still < DRUM_REST_FRAMES) d->still++;
  if (d->still < DRUM_REST_FRAMES) return false;
  sentence_settle(s, DRUM_SETTLE);
  if (!d->turned || sentence_fraction(s) != 0) return false;
  d->turned = false;
  return true;
}

/* The sine of `degrees` within a quarter turn either side of 0, by its series, since the device's libm is not relied on. */
static float sine(float degrees) {
  float x = degrees * 3.14159265f / 180.0f, x2 = x * x;
  return x * (1 - x2 / 6 * (1 - x2 / 20 * (1 - x2 / 42 * (1 - x2 / 72))));
}

static float magnitude(float v) { return v < 0 ? -v : v; }

/* The nearest whole number, halves up. */
static int nearest(float v) {
  float up = v + 0.5f;
  int whole = (int)up;
  return (float)whole > up ? whole - 1 : whole;
}

/* The tier of a slat beside the front one, by how far it has turned from the front. */
static drum_tier tier_of(float angle) {
  float away = magnitude(angle);
  if (away < DRUM_SLAT_DEGREES * 1.5f) return DRUM_NEAR;
  return DRUM_FAR;
}

/* Whether row `a` is drawn before row `b`: the front last, further from the front first, then the one above. */
static bool before(const drum_row *a, const drum_row *b) {
  float da = magnitude(a->angle), db = magnitude(b->angle);
  if ((a->tier == DRUM_FRONT) != (b->tier == DRUM_FRONT)) return b->tier == DRUM_FRONT;
  if (da != db) return da > db;
  return a->angle < b->angle;
}

size_t drum_rows(size_t count, size_t selected, float fraction, drum_row rows[DRUM_MOST_ROWS]) {
  /* The slats nearest the front first, so each word is placed once, where it is nearest. */
  static const int ORDER[DRUM_MOST_ROWS] = {0, -1, 1, -2, 2};
  long side = count == 0 ? 0 : (long)count - 1 < DRUM_SIDE ? (long)count - 1 : DRUM_SIDE;
  size_t made = 0, i, j;
  if (count == 0) return 0;
  for (i = 0; i < DRUM_MOST_ROWS; i++) {
    long k = ORDER[i], at = ((long)selected + k) % (long)count;
    size_t index = (size_t)(at < 0 ? at + (long)count : at), slot;
    float angle = ((float)k - fraction) * DRUM_SLAT_DEGREES;
    bool seen = false;
    if (k > side || -k > side || magnitude(angle) >= 90.0f) continue;
    for (slot = 0; slot < made; slot++) seen = seen || rows[slot].index == index;
    if (seen) continue;
    rows[made].index = index;
    rows[made].angle = angle;
    rows[made].y = nearest((float)DRUM_RADIUS * sine(angle));
    rows[made].tier = k == 0 ? DRUM_FRONT : tier_of(angle);
    made++;
  }
  for (i = 1; i < made; i++)
    for (j = i; j > 0 && before(&rows[j], &rows[j - 1]); j--) {
      drum_row moved = rows[j];
      rows[j] = rows[j - 1];
      rows[j - 1] = moved;
    }
  return made;
}
