// The words that fill an exit role (the spec's Verbs › Exits, Links): a
// direction, written out or abbreviated, or the label of an exit or a
// link typed, so what a screen reader speaks can be spoken back. A link
// has no direction, and is taken by its label alone. Only the ways out
// that apply where the actor stands are asked, which `runtime/exits.ts`
// says.

import { typedWords } from '../../declare/addressing.js';
import { directionOf, type Direction } from '../../declare/directions.js';
import type { InstanceId } from '../ids.js';

/** One exit or link that applies where the actor stands: its direction, null for a link, its label, and the place it leads to. */
export interface CommandExit {
  readonly direction: Direction | null;
  readonly label: string;
  readonly to: InstanceId;
}

/**
 * The exit `words` name among `exits`, in the order the place declares
 * them: the first in the direction named, else the first whose label the
 * words are; null where they name none.
 */
export function exitNamed(
  words: readonly string[],
  exits: readonly CommandExit[],
): CommandExit | null {
  const direction = words.length === 1 ? directionOf(words[0]!) : null;
  if (direction !== null) {
    const going = exits.find((exit) => exit.direction === direction);
    if (going !== undefined) return going;
  }
  const typed = words.join(' ');
  return exits.find((exit) => typedWords(exit.label).join(' ') === typed) ?? null;
}
