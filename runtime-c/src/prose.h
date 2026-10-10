/*
 * What a turn says, rendered (the spec's The runtime > Effects; Other people > What this costs;
 * Chance > The seed; Limits > Runtime budgets). Each line the turn's bodies recorded is rendered
 * once for each of its readers, in the order said, against the state the turn commits and after
 * every draw the bodies made: a line that names its reader says "you" to them, and what it draws
 * is drawn once however many read it. What each reader reads is charged to their own output, so a
 * crowd costs the host and never the one acting: only the turn's actor past the host's figure
 * faults the turn, and anyone else is cut short at the first whole line that would take them past
 * it and named to the host. Rendering writes nothing.
 */
#ifndef SPROUT_PROSE_H
#define SPROUT_PROSE_H

#include "describe.h"
#include "exec.h"
#include "prose/prose.h"

/* One reader's reading of one line: the paragraphs it renders to for them. */
typedef struct sprout_told {
  sprout_effect_kind kind;
  sprout_str from; /* the object whose body said it */
  sprout_str to;   /* the person who reads it */
  sprout_str visit; /* the visit that person is */
  size_t paragraph_count;
  const sprout_str *paragraphs;
  size_t written_count;
  const sprout_noted *written; /* every passage and one-line passage that gave the words, each once, a passage after any it holds */
  const char *extension, *statement; /* an extension's effect: which statement recorded it */
  sprout_str payload;                /* an extension's effect: its payload as JSON text, empty where the runtime holds no code for it */
} sprout_told;

/* What a turn's lines rendered to, and whom it cut short, in the order it happened. */
typedef struct sprout_rendered {
  bool has_actor;
  sprout_str actor; /* whose turn it is: the person who typed, arrived or left; none in a tick or a wake */
  size_t told_count;
  const sprout_told *told;
  size_t cut_count;
  const sprout_str *cut; /* people, by instance */
} sprout_rendered;

/*
 * Renders every effect the exec recorded, for each of its readers, drawing from the exec's
 * stream where it stands now. `actor` is whose turn it is, or NULL where nobody acted (a tick, a
 * wake). SPROUT_EVAL_FAULT when the actor's output, the steps or the passage depth passes the
 * host's figure, with the exec's fault filled. Everything is held in the turn's arena.
 */
sprout_eval_status sprout_render_effects(const sprout_exec *x, const sprout_str *actor, sprout_rendered *out);

#endif
