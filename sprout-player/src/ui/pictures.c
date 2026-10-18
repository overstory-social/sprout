/* The pictures screen; see pictures.h. */
#include "pictures.h"

#include <string.h>

#include "host/files.h"
#include "images.h"
#include "text.h"

static const char NO_MEMORY[] = "The player ran out of memory showing a picture.";

void player_pictures_show(player_app *app, player_reader *reader, gallery *g) {
  player_pictures *p;
  if (g->count == 0) {
    gallery_free(g);
    player_app_show(app, &player_reader_screen, reader);
    return;
  }
  p = (player_pictures *)player_alloc(app->pd, sizeof *p);
  if (p == NULL) {
    gallery_free(g);
    transcript_push(&reader->lines, "notice", NO_MEMORY, strlen(NO_MEMORY));
    player_app_show(app, &player_reader_screen, reader);
    return;
  }
  memset(p, 0, sizeof *p);
  p->gallery = *g;
  gallery_init(g, app->pd);
  p->slots[0].index = p->slots[1].index = -1;
  p->reader = reader;
  reader->lent = true;
  player_app_show(app, &player_pictures_screen, p);
}

static void release(player_app *app, pictures_slot *slot) {
  if (slot->bitmap != NULL) app->pd->graphics->freeBitmap(slot->bitmap);
  slot->bitmap = NULL;
  slot->index = -1;
}

/* The bitmap of the picture at `index`, loaded into a slot where it is not held; NULL where it cannot be read. */
static LCDBitmap *held(player_app *app, player_pictures *p, long index, long keep) {
  pictures_slot *slot;
  int i;
  for (i = 0; i < 2; i++)
    if (p->slots[i].index == index) return p->slots[i].bitmap;
  /* The slot not holding `keep`, the other picture this frame draws. */
  slot = p->slots[0].index == keep && keep >= 0 ? &p->slots[1] : &p->slots[0];
  release(app, slot);
  slot->index = index;
  slot->bitmap = images_load(app->pd, app->cartridge, p->gallery.pictures[index].image);
  return slot->bitmap;
}

static void close_pictures(player_app *app, player_pictures *p) {
  p->reader->lent = false;
  player_app_show(app, &player_reader_screen, p->reader);
  p->reader = NULL;
}

static void update(player_app *app, void *ctx, const player_input *input) {
  player_pictures *p = (player_pictures *)ctx;
  if (gallery_turn(&p->gallery, input->crank) != 0) player_cue(app, PLAYER_CUE_TICK);
  if (input->pushed & (kButtonRight | kButtonDown)) {
    gallery_nudge(&p->gallery, 1);
    player_cue(app, PLAYER_CUE_TICK);
  }
  if (input->pushed & (kButtonLeft | kButtonUp)) {
    gallery_nudge(&p->gallery, -1);
    player_cue(app, PLAYER_CUE_TICK);
  }
  if (gallery_update(&p->gallery)) player_cue(app, PLAYER_CUE_CLACK);
  if (input->pushed & (kButtonA | kButtonB)) close_pictures(app, p);
}

/* Draws the picture at `shown.index` centred across the screen, its top shifted by `shown.y`. */
static void draw_one(player_app *app, player_pictures *p, gallery_shown shown, long keep) {
  int frame_height = app->pen.frame_height, width, height, rowbytes;
  LCDBitmap *bitmap = held(app, p, shown.index, keep);
  images_fit fit;
  int x, top;
  if (bitmap == NULL) {
    player_pen_say(&app->pen, PICTURES_UNREADABLE, PLAYER_MARGIN, 110 + shown.y);
    return;
  }
  app->pd->graphics->getBitmapData(bitmap, &width, &height, &rowbytes, NULL, NULL);
  fit = images_fit_box(width, height, frame_height);
  x = (PLAYER_SCREEN_WIDTH - fit.width) / 2;
  top = (PLAYER_SCREEN_HEIGHT - frame_height - 4 - fit.height) / 2;
  if (fit.scale < 1.0f)
    app->pd->graphics->drawScaledBitmap(bitmap, x, top + shown.y, fit.scale, fit.scale);
  else
    app->pd->graphics->drawBitmap(bitmap, x, top + shown.y, kBitmapUnflipped);
}

static void draw(player_app *app, void *ctx) {
  player_pictures *p = (player_pictures *)ctx;
  gallery_frame frame = gallery_frame_now(&p->gallery);
  int rule = PLAYER_SCREEN_HEIGHT - app->pen.frame_height - 4;
  const gallery_picture *current = gallery_current(&p->gallery);
  char where[64];
  text_buffer out;
  int i;
  if (frame.leaving.index >= 0) draw_one(app, p, frame.leaving, frame.current.index);
  if (frame.current.index >= 0) draw_one(app, p, frame.current, frame.leaving.index);
  if (frame.leaving.index < 0) {
    /* The one on screen is the only one held; the rest wait on disk. */
    for (i = 0; i < 2; i++)
      if (p->slots[i].index != frame.current.index) release(app, &p->slots[i]);
  }
  app->pd->graphics->drawLine(0, rule, PLAYER_SCREEN_WIDTH, rule, 1, kColorBlack);
  if (current != NULL && current->caption != NULL) player_pen_frame_say(&app->pen, current->caption, PLAYER_MARGIN, rule + 2);
  text_begin(&out, where, sizeof where);
  if (p->gallery.count > 1) {
    text_add_number(&out, (uint64_t)p->gallery.selected + 1);
    text_add(&out, " of ");
    text_add_number(&out, (uint64_t)p->gallery.count);
    text_add(&out, PICTURES_STEP);
  } else {
    text_add(&out, PICTURES_CLOSE);
  }
  player_pen_frame_say(&app->pen, where, PLAYER_SCREEN_WIDTH - PLAYER_MARGIN - player_pen_frame_width(&app->pen, where, strlen(where)),
                       rule + 2);
}

static void leave(player_app *app, void *ctx) {
  player_pictures *p = (player_pictures *)ctx;
  if (p->reader != NULL) {
    /* The app ends with the pictures up: the reader they hold goes with them. */
    p->reader->lent = false;
    player_reader_screen.leave(app, p->reader);
  }
  release(app, &p->slots[0]);
  release(app, &p->slots[1]);
  gallery_free(&p->gallery);
  player_free(app->pd, p);
}

/* The reader they hold follows the body; the captions are the frame's, laid out each draw. */
static void refit(player_app *app, void *ctx) { player_reader_screen.refit(app, ((player_pictures *)ctx)->reader); }

const player_screen player_pictures_screen = {update, draw, leave, refit};
