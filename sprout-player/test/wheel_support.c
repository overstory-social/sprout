/* Reading a wheel of words back from what was drawn; see wheel_support.h. */
#include "wheel_support.h"

const wheel_label *wheel_placed(const wheel *w, int n) {
  size_t i;
  if (w == NULL || n < 0 || n >= fake->placed_count) return NULL;
  for (i = 0; i < w->label_count; i++)
    if (w->labels[i].turned != NULL && fake_made_index(fake, w->labels[i].turned) == fake->placed[n].made) return &w->labels[i];
  return NULL;
}

const fake_run *wheel_label_run(const wheel_label *label) {
  int made = label != NULL && label->flat != NULL ? fake_made_index(fake, label->flat) : -1;
  return made >= 0 && fake->made[made].run_count > 0 ? &fake->made[made].runs[0] : NULL;
}

const char *wheel_label_text(const wheel_label *label) {
  const fake_run *run = wheel_label_run(label);
  return run != NULL ? run->text : "(no text)";
}

bool wheel_label_greyed(const wheel_label *label) {
  const fake_run *run = wheel_label_run(label);
  int made = run != NULL ? fake_made_index(fake, label->flat) : -1, x, y, white = 0;
  if (made < 0) return false;
  for (y = run->y + 3; y < run->y + FAKE_SANS_LINE - 3; y++)
    for (x = run->x + 1; x < run->x + FAKE_SANS_GLYPH - 1; x++) white += fake_made_pixel(fake, made, x, y) == kColorWhite;
  return white > 0;
}

/* Whether placement `n` has a white pixel drawn: the inverted label, as an unturned one has only black. */
static bool inverted(int n) {
  const fake_made *made = &fake->made[fake->placed[n].made];
  int x, y;
  for (y = 0; y < made->height; y++)
    for (x = 0; x < made->width; x++)
      if (fake_made_pixel(fake, fake->placed[n].made, x, y) == kColorWhite) return true;
  return false;
}

int wheel_front_placed(void) {
  int n;
  for (n = 0; n < fake->placed_count; n++)
    if (inverted(n)) return n;
  return -1;
}

const char *wheel_front(const wheel *w) {
  int n = wheel_front_placed();
  return n >= 0 && wheel_placed(w, n) != NULL ? wheel_label_text(wheel_placed(w, n)) : "(no front)";
}

int wheel_placed_entry(const wheel *w, size_t index) {
  int n;
  for (n = 0; n < fake->placed_count; n++)
    if (wheel_placed(w, n) != NULL && (size_t)(wheel_placed(w, n) - w->labels) == index) return n;
  return -1;
}
