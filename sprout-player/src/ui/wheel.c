/* The disc of words drawn; see wheel.h. */
#include "wheel.h"

#include <stdint.h>
#include <string.h>

#include "host/files.h"

static const char NO_MEMORY[] = "The player ran out of memory drawing the wheel.";

/* Half the pixels white, in a checker: drawn over a greyed word. */
static const LCDPattern GREY = {0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF,
                                0xAA, 0x55, 0xAA, 0x55, 0xAA, 0x55, 0xAA, 0x55};

void wheel_hold_font(player_app *app) {
  const char *error = NULL;
  if (app->disc_font_tried) return;
  app->disc_font_tried = true;
  app->disc_font = player_pen_hold(&app->pen, WHEEL_FONT, &error);
}

bool wheel_steer(player_app *app, wheel *w, size_t count, size_t *selected, const player_input *input) {
  long turned, stepped = 0;
  if (count == 0) return false;
  turned = disc_crank(&w->disc, input->crank);
  if (turned != 0) player_cue(app, PLAYER_CUE_TICK);
  if (disc_update(&w->disc, input->crank != 0)) player_cue(app, PLAYER_CUE_CLACK);
  if (input->pushed & kButtonDown) stepped++;
  if (input->pushed & kButtonUp) stepped--;
  if (input->pushed & (kButtonDown | kButtonUp)) player_cue(app, PLAYER_CUE_TICK);
  if (turned + stepped == 0) return false;
  *selected = disc_moved(count, *selected, turned + stepped);
  return true;
}

/* ---- labels ---- */

void wheel_free(player_app *app, wheel *w) {
  size_t i;
  for (i = 0; i < w->label_count; i++) {
    if (w->labels[i].flat != NULL) app->pd->graphics->freeBitmap(w->labels[i].flat);
    if (w->labels[i].turned != NULL) app->pd->graphics->freeBitmap(w->labels[i].turned);
  }
  player_free(app->pd, w->labels);
  w->labels = NULL;
  w->label_count = 0;
}

/* A label for each of `count` words, none drawn yet, where the words changed since the labels were made. False where there is no memory for them. */
static bool labels_stand(player_app *app, wheel *w, size_t count, unsigned long words_of) {
  if (w->labels != NULL && w->labels_of == words_of && w->label_count == count) return true;
  wheel_free(app, w);
  w->labels = (wheel_label *)player_alloc(app->pd, count * sizeof *w->labels);
  if (w->labels == NULL) return false;
  memset(w->labels, 0, count * sizeof *w->labels);
  w->label_count = count;
  w->labels_of = words_of;
  return true;
}

/* `word` drawn flat in `font`, black on white, and greyed in a checker where it is greyed; NULL where there is no memory for it. */
static LCDBitmap *flat_label(PlaydateAPI *pd, LCDFont *font, wheel_word word) {
  size_t length = strlen(word.text), count = player_utf8_count(word.text, length);
  int width = pd->graphics->getTextWidth(font, word.text, count, kUTF8Encoding, 0) + 6;
  int height = pd->graphics->getFontHeight(font) + 2;
  LCDBitmap *flat;
  if (width > PLAYER_SCREEN_WIDTH) width = PLAYER_SCREEN_WIDTH;
  flat = pd->graphics->newBitmap(width, height, kColorWhite);
  if (flat == NULL) return NULL;
  pd->graphics->pushContext(flat);
  pd->graphics->setFont(font);
  pd->graphics->drawText(word.text, count, kUTF8Encoding, 3, 1);
  if (word.greyed) pd->graphics->fillRect(0, 0, width, height, (LCDColor)(uintptr_t)&GREY);
  pd->graphics->popContext();
  return flat;
}

/*
 * Places `label`, of `word`, along the ray of `row` from the hub at (hx, cy): drawn flat the first
 * time, and turned again only where its angle or whether it is the front has changed.
 */
static void place_label(PlaydateAPI *pd, LCDFont *font, wheel_label *label, wheel_word word, const disc_row *row, int hx,
                        int cy) {
  int width, height, rowbytes, x, y;
  uint8_t *flat, *data, *mask;
  float along;
  disc_box box;
  if (label->flat == NULL) label->flat = flat_label(pd, font, word);
  if (label->flat == NULL) return;
  pd->graphics->getBitmapData(label->flat, &width, &height, &rowbytes, NULL, &flat);
  along = disc_bent(row->angle, (float)DISC_WORD_AT + (float)width / 2);
  box = disc_turned_box(width, height, along);
  if (label->turned == NULL || label->along != along || label->front != row->front) {
    int box_rowbytes;
    if (label->turned != NULL) pd->graphics->freeBitmap(label->turned);
    /* Made clear, so it has a mask for the pixels the turn leaves undrawn. */
    label->turned = pd->graphics->newBitmap(box.width, box.height, kColorClear);
    if (label->turned == NULL) return;
    pd->graphics->getBitmapData(label->turned, NULL, NULL, &box_rowbytes, &mask, &data);
    disc_turn(flat, width, height, rowbytes, along, row->front, box, data, mask, box_rowbytes);
    label->along = along;
    label->front = row->front;
  }
  disc_point(disc_bent(row->angle, (float)DISC_WORD_AT), (float)DISC_WORD_AT, &x, &y);
  label->angle = row->angle;
  label->x = hx + x + box.x;
  label->y = cy + y + box.y;
  label->shown = true;
  pd->graphics->drawBitmap(label->turned, label->x, label->y, kBitmapUnflipped);
}

/* ---- the disc ---- */

/* A sector's dividing line: the ray leaving the hub at `angle`, bent outward, in segments. */
static void draw_ray(PlaydateAPI *pd, int hx, int cy, float angle) {
  int i, x0, y0, x1, y1;
  float step = (float)(DISC_REACH - DISC_HUB_RADIUS) / DISC_RAY_SEGMENTS;
  disc_point(angle, (float)DISC_HUB_RADIUS, &x0, &y0);
  for (i = 1; i <= DISC_RAY_SEGMENTS; i++) {
    float r = (float)DISC_HUB_RADIUS + step * (float)i;
    disc_point(disc_bent(angle, r), r, &x1, &y1);
    pd->graphics->drawLine(hx + x0, cy + y0, hx + x1, cy + y1, 1, kColorBlack);
    x0 = x1;
    y0 = y1;
  }
}

void wheel_draw(player_app *app, wheel *w, size_t count, size_t selected, wheel_words words, const void *ctx,
                unsigned long words_of, int top, int bottom) {
  PlaydateAPI *pd = app->pd;
  int cy = (top + bottom) / 2, hx = DISC_HUB_X, k;
  size_t made, i;
  LCDFont *font = app->disc_font != NULL ? app->disc_font : app->pen.body;
  disc_row rows[DISC_MOST_ROWS];
  if (count == 0) return;
  if (!labels_stand(app, w, count, words_of)) {
    player_pen_say(&app->pen, NO_MEMORY, PLAYER_MARGIN, cy - app->pen.line_height / 2);
    return;
  }
  pd->graphics->setClipRect(0, top, PLAYER_SCREEN_WIDTH, bottom - top);
  pd->graphics->drawEllipse(hx - DISC_HUB_RADIUS, cy - DISC_HUB_RADIUS, 2 * DISC_HUB_RADIUS, 2 * DISC_HUB_RADIUS, 2, 0.0f,
                            0.0f, kColorBlack);
  pd->graphics->fillTriangle(hx + DISC_HUB_RADIUS - 2, cy - 6, hx + DISC_HUB_RADIUS - 2, cy + 6, hx + DISC_HUB_RADIUS + 8, cy,
                             kColorBlack);
  made = disc_rows(count, selected, disc_fraction(&w->disc), rows);
  for (i = 0; i < made; i++) {
    for (k = -1; k <= 1; k += 2) {
      float edge = rows[i].angle + (float)k * DISC_SECTOR_DEGREES / 2;
      if (edge > -90.0f && edge < 90.0f) draw_ray(pd, hx, cy, edge);
    }
  }
  for (i = 0; i < count; i++) w->labels[i].shown = false;
  for (i = made; i > 0; i--)
    place_label(pd, font, &w->labels[rows[i - 1].index], words(ctx, rows[i - 1].index), &rows[i - 1], hx, cy);
  for (i = 0; i < count; i++) {
    wheel_label *label = &w->labels[i];
    if (label->shown || label->turned == NULL) continue;
    pd->graphics->freeBitmap(label->turned);
    label->turned = NULL;
  }
  pd->graphics->clearClipRect();
}
