/*
 * ui/disc.c: where the disc's words sit, when it comes to rest, and how a label's pixels are
 * turned. The rules: the selected entry is at the front and comes first, its neighbours a sector
 * either side in the entries' order, the disc wrapping, each entry placed once where it is nearest
 * the front; the crank's fraction turns every sector by the same angle, through the detent curve,
 * which is 0 at 0, a half at a half, odd, rising, and behind the crank between; the disc settles only
 * once the crank has rested DISC_REST_FRAMES, easing back into the slot, and says so once, the frame
 * it comes to rest; and a label
 * turned about the middle of its left edge lands, pixel for pixel, where the turn carries it, at a
 * quarter turn and at an eighth as at none, inverted where it is the front.
 */
#include "support.h"
#include "ui/disc.h"

/* ---- where the words sit ---- */

static void the_front_comes_first_and_its_neighbours_lie_a_sector_either_side(void) {
  disc_row rows[DISC_MOST_ROWS];
  size_t made, i;
  made = disc_rows(1, 0, 0.0f, rows);
  CHECK(made == 1 && rows[0].index == 0 && rows[0].angle == 0.0f && rows[0].front, "one entry sits at the front");
  made = disc_rows(12, 0, 0.0f, rows);
  CHECK(made == DISC_MOST_ROWS, "as many sectors as are shown: %zu", made);
  CHECK(rows[0].index == 0 && rows[0].front && rows[0].angle == 0.0f, "the selected first, level at the front");
  CHECK(rows[1].index == 11 && rows[1].angle == -DISC_SECTOR_DEGREES && !rows[1].front, "the last entry a sector above, the disc wrapping");
  CHECK(rows[2].index == 1 && rows[2].angle == DISC_SECTOR_DEGREES && !rows[2].front, "the next a sector below");
  for (i = 1; i < made; i++) {
    long k = rows[i].angle > 0 ? (long)(rows[i].angle / DISC_SECTOR_DEGREES + 0.5f) : -(long)(-rows[i].angle / DISC_SECTOR_DEGREES + 0.5f);
    CHECK(rows[i].index == (size_t)((12 + k) % 12) && !rows[i].front, "the entry %ld along is %ld sectors round: %zu", k, k, rows[i].index);
  }
}

static void the_detent_holds_the_word_then_slots_the_next_in(void) {
  float f, last = disc_detent(-0.5f);
  CHECK(disc_detent(0.0f) == 0.0f, "at rest, no turn");
  CHECK(disc_detent(0.5f) == 0.5f && disc_detent(-0.5f) == -0.5f,
        "exactly half a sector at half a step, so a step meets the next word's half with nothing to jump");
  CHECK(disc_detent(0.25f) < 0.25f && disc_detent(0.25f) > 0.0f, "a quarter step on, the disc lags the crank: %f",
        (double)disc_detent(0.25f));
  for (f = -0.5f; f <= 0.5f; f += 1.0f / 64) {
    float at = disc_detent(f);
    CHECK(at == -disc_detent(-f), "the same either way at %f", (double)f);
    CHECK(at >= last, "rising with the crank at %f: %f after %f", (double)f, (double)at, (double)last);
    CHECK(f <= 0 || at <= f, "behind the crank going on at %f: %f", (double)f, (double)at);
    last = at;
  }
}

static void the_cranks_fraction_turns_every_sector_alike(void) {
  disc_row rest[DISC_MOST_ROWS], turned[DISC_MOST_ROWS];
  size_t made = disc_rows(12, 5, 0.0f, rest), i;
  CHECK(disc_rows(12, 5, 0.25f, turned) == made, "the same sectors a quarter of the way on");
  for (i = 0; i < made; i++)
    CHECK(turned[i].index == rest[i].index && turned[i].angle == rest[i].angle - disc_detent(0.25f) * DISC_SECTOR_DEGREES,
          "entry %zu turned back by the detent of a quarter step: %f from %f", rest[i].index, (double)turned[i].angle,
          (double)rest[i].angle);
  disc_rows(12, 5, -0.5f, turned);
  CHECK(turned[0].index == 5 && turned[0].front && turned[0].angle == 0.5f * DISC_SECTOR_DEGREES,
        "half a sector back, the selected one is still the front");
}

static void each_entry_is_placed_once_where_it_is_nearest(void) {
  disc_row rows[DISC_MOST_ROWS];
  size_t made = disc_rows(4, 0, 0.0f, rows), i, j;
  CHECK(made == 4, "four entries, four sectors: %zu", made);
  for (i = 0; i < made; i++)
    for (j = i + 1; j < made; j++) CHECK(rows[i].index != rows[j].index, "entry %zu placed once", rows[i].index);
  CHECK(rows[3].index == 2 && rows[3].angle == -2 * DISC_SECTOR_DEGREES, "the one two round either way is placed above: %f",
        (double)rows[3].angle);
  for (i = 0; i < made; i++) CHECK(rows[i].angle > -90.0f && rows[i].angle < 90.0f, "within a quarter turn of the front");
}

static void the_rays_leave_the_hub_and_bend_toward_the_rim(void) {
  int x, y;
  disc_point(0.0f, (float)DISC_WORD_AT, &x, &y);
  CHECK(x == DISC_WORD_AT && y == 0, "the front ray runs level: %d %d", x, y);
  disc_point(90.0f, 10.0f, &x, &y);
  CHECK(x == 0 && y == 10, "a quarter turn runs straight down: %d %d", x, y);
  disc_point(-30.0f, 100.0f, &x, &y);
  CHECK(x == 87 && y == -50, "thirty degrees up: %d %d", x, y);
  CHECK(disc_bent(24.0f, (float)DISC_HUB_RADIUS) == 24.0f, "at the hub a ray is not bent");
  CHECK(disc_bent(24.0f, (float)DISC_REACH) == 24.0f * (1 + DISC_BEND), "at its reach it is bent the most");
  CHECK(disc_bent(-24.0f, 200.0f) < -24.0f && disc_bent(24.0f, 200.0f) > 24.0f, "outward, above and below");
}

static void the_disc_settles_once_the_crank_rests(void) {
  sentence s;
  disc d = {0, false};
  int frames = 0, rested = 0, settling = 0;
  float drawn;
  memset(&s, 0, sizeof s);
  s.crank = 10.0f;
  CHECK(disc_at_rest(&d), "before the crank moves, the disc is at rest");
  CHECK(!disc_update(&d, &s, true), "turning, it does not settle");
  CHECK(!disc_at_rest(&d), "and is not at rest");
  for (frames = 1; frames < DISC_REST_FRAMES; frames++) {
    CHECK(!disc_update(&d, &s, false), "resting %d frames, not yet", frames);
    CHECK(s.crank == 10.0f, "and it has not moved");
    CHECK(!disc_at_rest(&d), "nor is it at rest while the crank has only just stopped");
  }
  /* The settle is the crank's own, so through the curve the drawn turn shrinks every frame to none. */
  drawn = disc_detent(sentence_fraction(&s));
  for (frames = 0; frames < 60 && !rested; frames++) {
    rested += disc_update(&d, &s, false);
    CHECK(disc_at_rest(&d) == (rested != 0), "at rest only once it has settled");
    CHECK(disc_detent(sentence_fraction(&s)) < drawn, "easing back into the slot: %f after %f",
          (double)disc_detent(sentence_fraction(&s)), (double)drawn);
    drawn = disc_detent(sentence_fraction(&s));
    settling++;
  }
  for (; frames < 60; frames++) rested += disc_update(&d, &s, false);
  CHECK(rested == 1 && s.crank == 0.0f && sentence_fraction(&s) == 0.0f, "it settles and says so once: %d", rested);
  CHECK(settling == 6, "ten degrees off, it comes to rest in six frames, crank by crank: %d", settling);
  CHECK(!disc_update(&d, &s, false), "and not again while it rests");
  CHECK(disc_at_rest(&d), "at rest from then on");
}

/* ---- turning a label ---- */

#define W 20
#define H 8
#define ROW 4 /* bytes a row, padded as the device pads them */

/* A label W by H, white, with the pixels in [x0, x1) by [y0, y1) black. */
static void label(uint8_t flat[H * ROW], int x0, int y0, int x1, int y1) {
  int x, y;
  memset(flat, 0xFF, H * ROW);
  for (y = y0; y < y1; y++)
    for (x = x0; x < x1; x++) flat[y * ROW + x / 8] &= (uint8_t)~(0x80u >> (x % 8));
}

/* The turned pixel at (u, v): 'k' black, 'w' white, '.' clear. */
static char at(const uint8_t *data, const uint8_t *mask, int rowbytes, int u, int v) {
  int bit = 7 - u % 8;
  if (mask != NULL && !((mask[v * rowbytes + u / 8] >> bit) & 1)) return '.';
  return (data[v * rowbytes + u / 8] >> bit) & 1 ? 'w' : 'k';
}

/* The pixel of `box` holding the point (x, y) from the pivot. */
static char at_point(const uint8_t *data, const uint8_t *mask, int rowbytes, disc_box box, float x, float y) {
  int u = (int)(x - (float)box.x + 100) - 100, v = (int)(y - (float)box.y + 100) - 100;
  if (u < 0 || v < 0 || u >= box.width || v >= box.height) return '.';
  return at(data, mask, rowbytes, u, v);
}

static int count_of(const uint8_t *data, const uint8_t *mask, int rowbytes, disc_box box, char kind) {
  int u, v, n = 0;
  for (v = 0; v < box.height; v++)
    for (u = 0; u < box.width; u++) n += at(data, mask, rowbytes, u, v) == kind;
  return n;
}

static void a_label_unturned_is_itself(void) {
  uint8_t flat[H * ROW], data[64 * 8], mask[64 * 8];
  disc_box box = disc_turned_box(W, H, 0.0f);
  int u, v, alike = 1;
  CHECK(box.x == 0 && box.y == -H / 2 && box.width == W && box.height == H, "the box is the label's, its pivot the middle of its left edge: %d %d %d %d",
        box.x, box.y, box.width, box.height);
  label(flat, 2, 1, 6, 3);
  disc_turn(flat, W, H, ROW, 0.0f, false, box, data, mask, 8);
  for (v = 0; v < H; v++)
    for (u = 0; u < W; u++) alike = alike && at(data, mask, 8, u, v) == (u >= 2 && u < 6 && v >= 1 && v < 3 ? 'k' : '.');
  CHECK(alike, "the glyph block black where it was, everything else clear");
  disc_turn(flat, W, H, ROW, 0.0f, true, box, data, mask, 8);
  alike = 1;
  for (v = 0; v < H; v++)
    for (u = 0; u < W; u++) alike = alike && at(data, mask, 8, u, v) == (u >= 2 && u < 6 && v >= 1 && v < 3 ? 'w' : 'k');
  CHECK(alike, "inverted: the label's rectangle black and its glyph white");
  disc_turn(flat, W, H, ROW, 0.0f, false, box, data, NULL, 8);
  CHECK(at(data, NULL, 8, 0, 0) == 'w' && at(data, NULL, 8, 2, 1) == 'k', "without a mask, what would be clear is white");
}

static void a_quarter_turn_stands_the_label_on_its_end(void) {
  uint8_t flat[H * ROW], data[64 * 8], mask[64 * 8];
  disc_box box = disc_turned_box(W, H, 90.0f);
  int u, v, alike = 1;
  CHECK(box.x == -H / 2 && box.y == 0 && box.width == H && box.height == W, "the box stands down from the pivot: %d %d %d %d", box.x,
        box.y, box.width, box.height);
  label(flat, 0, 0, W, H);
  disc_turn(flat, W, H, ROW, 90.0f, false, box, data, mask, 8);
  CHECK(count_of(data, mask, 8, box, 'k') == W * H, "a filled label fills its turned box: %d", count_of(data, mask, 8, box, 'k'));
  CHECK(at(data, mask, 8, 0, 0) == 'k' && at(data, mask, 8, H - 1, 0) == 'k' && at(data, mask, 8, 0, W - 1) == 'k' &&
            at(data, mask, 8, H - 1, W - 1) == 'k',
        "its corners are the box's");
  /* Turned clockwise, the label's top runs down the right of the box: a block at its top left lands at the box's top right. */
  label(flat, 2, 1, 6, 3);
  disc_turn(flat, W, H, ROW, 90.0f, false, box, data, mask, 8);
  for (v = 0; v < W; v++)
    for (u = 0; u < H; u++) alike = alike && at(data, mask, 8, u, v) == (u >= 5 && u < 7 && v >= 2 && v < 6 ? 'k' : '.');
  CHECK(alike, "the glyph block lands where a quarter turn carries it");
}

static void an_eighth_turn_carries_each_corner_round(void) {
  static const float corners[4][2] = {{0, -H / 2.0f}, {W, -H / 2.0f}, {0, H / 2.0f}, {W, H / 2.0f}};
  uint8_t flat[H * ROW], data[64 * 8], mask[64 * 8];
  const float r = 0.70710678f; /* the sine and cosine of an eighth turn */
  disc_box box = disc_turned_box(W, H, 45.0f);
  int i, black;
  CHECK(box.x == -3 && box.y == -3 && box.width == 20 && box.height == 20, "the box holds the turned corners: %d %d %d %d", box.x, box.y,
        box.width, box.height);
  label(flat, 0, 0, W, H);
  disc_turn(flat, W, H, ROW, 45.0f, false, box, data, mask, 8);
  for (i = 0; i < 4; i++) {
    /* A point a little inside the label's corner, and a little outside it, both turned an eighth. */
    float lx = corners[i][0], ly = corners[i][1], sx = lx == 0 ? 1.2f : -1.2f, sy = ly < 0 ? 1.2f : -1.2f;
    float in_x = lx + sx, in_y = ly + sy, out_x = lx - sx, out_y = ly - sy;
    CHECK(at_point(data, mask, 8, box, in_x * r - in_y * r, in_x * r + in_y * r) == 'k', "inside corner %d, the label is drawn", i);
    CHECK(at_point(data, mask, 8, box, out_x * r - out_y * r, out_x * r + out_y * r) == '.', "outside corner %d, nothing is", i);
  }
  CHECK(at_point(data, mask, 8, box, (float)W / 2 * r, (float)W / 2 * r) == 'k', "the label's middle lands an eighth turn down its ray");
  black = count_of(data, mask, 8, box, 'k');
  CHECK(black >= W * H - 16 && black <= W * H + 16, "and it keeps its area: %d of %d", black, W * H);
}

int main(void) {
  test_program("disc");
  the_front_comes_first_and_its_neighbours_lie_a_sector_either_side();
  the_detent_holds_the_word_then_slots_the_next_in();
  the_cranks_fraction_turns_every_sector_alike();
  each_entry_is_placed_once_where_it_is_nearest();
  the_rays_leave_the_hub_and_bend_toward_the_rim();
  the_disc_settles_once_the_crank_rests();
  a_label_unturned_is_itself();
  a_quarter_turn_stands_the_label_on_its_end();
  an_eighth_turn_carries_each_corner_round();
  return finish();
}
