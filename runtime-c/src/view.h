/*
 * A visitor's view, polled and rendered for them (the spec's The runtime > Turns, The view, Faults).
 * A poll reads the last committed state under the poll's own step budget, draws nothing and writes
 * nothing. What it derives is, in the order the spec lists it: the place's description with the
 * visitor as `actor`; each way out that applies; every other actor in the visitor's range under the pass
 * rules (nobody in the dark); what they carry; and every reading they could make with its consent
 * pass's answer and the options of each value role. It is rendered with the visitor as its one reader.
 * A visitor whose place is gone is shown the engine's `displaced` and offered nothing. A poll that
 * spends its budget shows the engine's `unseen` for the description and keeps every part derived
 * before it ran out. The public call is sprout_view in sprout.h; this header is what the modules that
 * write a view out share.
 */
#ifndef SPROUT_VIEW_H
#define SPROUT_VIEW_H

#include "arena.h"
#include "sprout.h"

/* The arena a view's strings and arrays live in, which sprout_view_free releases. */
sprout_arena *sprout_view_arena(sprout_seen_view *view);

#endif
