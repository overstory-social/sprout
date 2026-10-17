/*
 * Reading a wheel of words (ui/wheel.h) back from what the fake PlaydateAPI drew: each word is a label
 * drawn into a bitmap and placed along its ray, and the front is the one label drawn inverted. The
 * screen's wheel is named by each call, so the builder's, the nickname's, the shelf's and the
 * download list's are read alike.
 */
#ifndef PLAYER_WHEEL_SUPPORT_H
#define PLAYER_WHEEL_SUPPORT_H

#include <stdbool.h>

#include "support.h"
#include "ui/wheel.h"

/* The label of `w`'s whose turned bitmap is placement `n` of this frame, or NULL. */
const wheel_label *wheel_placed(const wheel *w, int n);
/* The text drawn into a label's flat bitmap, and the font it was drawn in; its text, or "(no text)". */
const fake_run *wheel_label_run(const wheel_label *label);
const char *wheel_label_text(const wheel_label *label);
/* Whether a label's word is dotted: its first character, in the flat bitmap, has white among its black. */
bool wheel_label_greyed(const wheel_label *label);
/* The placement drawn inverted this frame: the front; -1 where there is none. */
int wheel_front_placed(void);
/* The word at `w`'s front, wherever the turning disc has carried it; "(no front)" where there is none. */
const char *wheel_front(const wheel *w);
/* The placement of `w`'s label for entry `index` this frame, or -1. */
int wheel_placed_entry(const wheel *w, size_t index);

#endif
