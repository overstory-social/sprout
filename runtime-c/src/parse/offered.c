/*
 * A phrase an object's synonym gives, typed where that object is out of reach (the spec's Parsing > Synonyms, When
 * nothing matches). The phrase reads only in readings its object takes part in, so where a noun it took names nothing
 * in reach, the line is `not_here`, not `unknown`, when every such noun would name the object were it in reach. The
 * object is tried alone, live in the world, by what it is called, so no answer says where it is.
 */
#include <string.h>

#include "../expr/expr.h"
#include "parse.h"

sprout_eval_status parse_offered_out_of_reach(const parse_fill_context *fill, const parse_placement *placement,
                                              bool *named) {
  const sprout_frame *frame = fill->nouns.frame;
  const sprout_typed_phrase *phrase = placement->phrase;
  parse_fill_context alone = *fill;
  parse_candidate candidate;
  size_t i;
  bool missing = false;
  *named = false;
  if (phrase == NULL || phrase->only == NULL) return SPROUT_EVAL_OK;
  memset(&candidate, 0, sizeof candidate);
  /* Only what the turn holds now: one destroyed is no longer in the world. */
  candidate.instance = sprout_draft_instance(frame->draft, (sprout_str){phrase->only, strlen(phrase->only)});
  if (candidate.instance == NULL || !expr_live(frame, candidate.instance->id)) return SPROUT_EVAL_OK;
  EXPR_NEED(parse_address_of(frame, candidate.instance, &candidate.address));
  alone.candidates = &candidate;
  alone.candidate_count = 1;
  for (i = 0; i < placement->count; i++) {
    const parse_span *span = &placement->spans[i];
    const parse_filled *filled = placement->fills[i];
    parse_words typed;
    parse_filled found;
    if (filled->fills != PARSE_FILLS_NOTHING) continue;
    missing = true;
    typed.words = placement->words.words + span->start + filled->start;
    typed.count = filled->end - filled->start;
    EXPR_NEED(parse_fill_slot(&alone, &phrase->verb->roles[span->role], typed, &found));
    if (found.fills != PARSE_FILLS_OPTIONS && found.fills != PARSE_FILLS_OUTWARD) return SPROUT_EVAL_OK;
  }
  *named = missing;
  return SPROUT_EVAL_OK;
}
