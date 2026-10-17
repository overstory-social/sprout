/*
 * What the sentence builder's test programs share: the app over a cartridge of the corpus, opened
 * and run until the reader is up and driven a frame at a time through the fake PlaydateAPI, and the
 * builder read back from what was drawn. Each word on the disc is a label drawn into a bitmap and
 * placed along its ray; the front is the one label drawn inverted.
 */
#ifndef PLAYER_BUILDER_SUPPORT_H
#define PLAYER_BUILDER_SUPPORT_H

#include <stdbool.h>

#include "support.h"
#include "ui/app.h"
#include "ui/builder.h"
#include "ui/disc.h"

#define LINE FAKE_SERIF_LINE
#define HEADER (LINE + 4)
#define BOTTOM (240 - (LINE * 3 + 8))
#define READER_PANEL (240 - (LINE + 4)) /* the reader's rule above its one line of keys */
#define CENTRE ((HEADER + BOTTOM) / 2)
#define ROOM (400 - 2 * PLAYER_MARGIN)
/* A label: the disc font's line and a pixel above and below; at rest the front one is placed level with the hub's centre, from where words start. */
#define LABEL_HEIGHT (FAKE_SANS_LINE + 2)
#define FRONT_X (DISC_HUB_X + DISC_WORD_AT)
#define FRONT_Y (CENTRE - LABEL_HEIGHT / 2)

/* The app a scenario drives, from arrive_in to leave. */
extern player_app *app;

/* The run of text in the panel below the disc, or NULL. */
const fake_run *panel(void);
/* Whether the reader is the screen up, by its keys in the panel. */
bool on_reader(void);
/* Whether the builder's keys are the panel's words; wrapped, their runs of spaces are one. */
bool keys_shown(void);

/* The builder, where it is the screen up; else NULL. */
player_builder *builder(void);
/* The label of the builder's whose turned bitmap is placement `n` of this frame, or NULL. */
const builder_label *label_placed(int n);
/* The entry a label stands for. */
size_t entry_of(const builder_label *label);
/* The text drawn into a label's flat bitmap, and the font it was drawn in; its text, or "(no text)". */
const fake_run *label_run(const builder_label *label);
const char *label_text(const builder_label *label);
/* The placement of the front label this frame: the one drawn inverted; -1 where there is none. */
int front_placed(void);
/* The word at the front: the inverted label's, wherever the turning disc has carried it. */
const char *front(void);
/* The placement of the label for entry `index` this frame, or -1. */
int placed_entry(size_t index);
/* The sentence so far, as drawn above the disc. */
const char *phrase(void);
/* Whether a transcript row drawn holds `text`. */
bool shown_text(const char *text);

/* The app over the cartridge `world`, the only one on the shelf, opened and run until the reader is up; arrive is over chip_tree. */
void arrive_in(const char *scenario, const char *world);
void arrive(const char *scenario);
/* Frees the app, no label held, and ends the scenario. */
void leave(void);
/* Presses `button` until the front reads `label`, at most `most` times; whether it does. */
bool step_to(PDButtons button, const char *label, int most);

#endif
