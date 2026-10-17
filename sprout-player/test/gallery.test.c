/*
 * The gallery's queue and motion (ui/gallery.c) and the fit of a picture to the screen
 * (ui/images.c's images_fit_box and images_folder). The rules: each image once, in the order
 * asked; a step holds the picture stretched the way it will go, then whizzes it out as the next
 * comes in from the other side, and lands with exactly one clack; the crank takes a picture each
 * GALLERY_DEGREES_PER_STEP either way, wrapping; one picture never moves; and a picture is never
 * drawn larger than it is nor larger than the box above the caption line.
 */
#include "support.h"
#include "ui/gallery.h"
#include "ui/images.h"

static void asked(gallery *g) {
  gallery_init(g, &fake->api);
  CHECK(gallery_add(g, "a.png", 5, "a", 1), "a");
  CHECK(gallery_add(g, "b.png", 5, "b", 1), "b");
  CHECK(gallery_add(g, "a.png", 5, "again", 5), "a again");
  CHECK(gallery_add(g, "c.png", 5, NULL, 0), "c");
}

static void a_gallery_holds_each_picture_once_in_the_order_asked(void) {
  gallery g, empty;
  gallery_frame frame;
  begin("queue");
  asked(&g);
  CHECK(g.count == 3, "three pictures: %zu", g.count);
  CHECK(strcmp(gallery_current(&g)->image, "a.png") == 0 && strcmp(gallery_current(&g)->caption, "a") == 0,
        "the first, with its first caption");
  CHECK(g.pictures[2].caption == NULL, "no caption is NULL");
  frame = gallery_frame_now(&g);
  CHECK(frame.current.index == 0 && frame.current.y == 0 && frame.leaving.index == -1, "at rest, the first alone");
  gallery_init(&empty, &fake->api);
  CHECK(gallery_current(&empty) == NULL && gallery_frame_now(&empty).current.index == -1, "an empty gallery shows nothing");
  gallery_free(&g);
  end();
}

static void a_step_holds_then_whizzes_and_clacks_once(void) {
  gallery g;
  gallery_frame frame;
  int i, clacks = 0, frames = 0;
  begin("step");
  asked(&g);
  gallery_nudge(&g, 1);
  CHECK(strcmp(gallery_current(&g)->image, "b.png") == 0 && g.phase == GALLERY_HOLD, "the next, held first");
  frame = gallery_frame_now(&g);
  CHECK(frame.leaving.index == 0 && frame.current.y == GALLERY_TRAVEL, "the next waits below the screen: %d", frame.current.y);
  for (i = 1; i <= GALLERY_HOLD_FRAMES; i++) {
    CHECK(!gallery_update(&g), "no clack while held");
    if (i < GALLERY_HOLD_FRAMES) CHECK(g.phase == GALLERY_HOLD, "held %d", i);
  }
  CHECK(g.phase == GALLERY_WHIZ_OUT, "then it whizzes");
  CHECK(gallery_frame_now(&g).leaving.y == -GALLERY_STRETCH, "stretched the way it will go: %d", gallery_frame_now(&g).leaving.y);
  while (g.phase != GALLERY_REST && frames < 100) {
    if (gallery_update(&g)) clacks++;
    frames++;
  }
  CHECK(clacks == 1, "one clack: %d", clacks);
  frame = gallery_frame_now(&g);
  CHECK(frame.leaving.index == -1 && frame.current.index == 1 && frame.current.y == 0, "the next at rest");
  CHECK(!gallery_update(&g), "at rest, nothing more");
  gallery_free(&g);
  end();
}

static void the_crank_steps_and_wraps_and_one_picture_does_not_move(void) {
  gallery g, one;
  begin("crank");
  asked(&g);
  CHECK(gallery_turn(&g, GALLERY_DEGREES_PER_STEP - 1) == 0 && g.selected == 0, "short of a step");
  CHECK(gallery_turn(&g, 2) == 1 && g.selected == 1, "a step");
  g.crank = 0;
  CHECK(gallery_turn(&g, -GALLERY_DEGREES_PER_STEP * 2) == -2, "back two");
  CHECK(strcmp(gallery_current(&g)->image, "c.png") == 0 && g.direction == -1, "wrapping");
  CHECK(gallery_frame_now(&g).current.y == -GALLERY_TRAVEL, "a picture going back comes in from above");
  gallery_init(&one, &fake->api);
  CHECK(gallery_add(&one, "only.png", 8, NULL, 0), "only");
  gallery_nudge(&one, 1);
  CHECK(one.phase == GALLERY_REST && one.selected == 0, "one picture does not move");
  gallery_free(&g);
  gallery_free(&one);
  end();
}

static void a_picture_fits_the_box_and_is_never_enlarged(void) {
  images_fit fit;
  char folder[32];
  begin("fit");
  fit = images_fit_box(64, 40, FAKE_SERIF_LINE);
  CHECK(fit.scale == 1.0f && fit.width == 64 && fit.height == 40, "a small picture as it is");
  fit = images_fit_box(800, 100, FAKE_SERIF_LINE);
  CHECK(fit.scale == 0.5f && fit.width == 400 && fit.height == 50, "a wide one to the screen's width");
  fit = images_fit_box(100, 436, FAKE_SERIF_LINE);
  CHECK(fit.height <= 240 - FAKE_SERIF_LINE - 4 && fit.height >= 240 - FAKE_SERIF_LINE - 5, "a tall one above the caption: %d", fit.height);
  CHECK(images_folder("worlds/a.sproutworld", folder, sizeof folder) && strcmp(folder, "worlds/a.sproutworld.assets/") == 0,
        "the assets beside the cartridge: %s", folder);
  CHECK(!images_folder("worlds/a-very-long-name.sproutworld", folder, sizeof folder), "a folder that does not fit is refused");
  end();
}

int main(void) {
  test_program("gallery");
  a_gallery_holds_each_picture_once_in_the_order_asked();
  a_step_holds_then_whizzes_and_clacks_once();
  the_crank_steps_and_wraps_and_one_picture_does_not_move();
  a_picture_fits_the_box_and_is_never_enlarged();
  return finish();
}
