// What one reader may still be told this turn (the spec's Limits › Cost
// that scales with people; Other people › What this costs). Output is
// counted per recipient, and a turn never faults because of who else was
// there: the actor's own past the host's figure faults the turn, as any
// budget spent does, and anyone else's cuts them short, so they read what
// was said to them up to the line that did not fit and nothing after it.

import type { InstanceId } from '../runtime/ids.js';
import type { RenderContext } from './render.js';

/**
 * Charge `characters` to `reader`, and say whether they are told them: the
 * actor always is, or the turn faults; anyone else only while it fits.
 */
export function charged(context: RenderContext, reader: InstanceId, characters: number): boolean {
  if (reader === context.actor) {
    context.budget.say(reader, characters);
    return true;
  }
  return context.budget.offer(reader, characters);
}
