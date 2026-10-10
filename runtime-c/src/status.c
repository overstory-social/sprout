/*
 * Status text: every status has words, so a host never sees a silent outcome
 * (CLAUDE.md, the reviewer's invariants).
 */
#include "sprout.h"

const char *sprout_status_text(sprout_status status) {
  switch (status) {
    case SPROUT_OK:
      return "the call succeeded.";
    case SPROUT_NO_MEMORY:
      return "the host could not give the runtime any more memory.";
    case SPROUT_BAD_HOST:
      return "the host record is missing something the runtime needs: page_bytes, alloc or release.";
    case SPROUT_BAD_SEED:
      return "a seed is a whole number from 0 to 4294967295; the host gave another.";
    case SPROUT_BAD_INPUT:
      return "the runtime could not read those bytes.";
    case SPROUT_FAULT:
      return "the turn was abandoned and the world is as it was; the outcome says why.";
  }
  return "the runtime gave a status it has no words for.";
}
