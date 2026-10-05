// The words that fill an exit role (the spec's Verbs › Exits, Links): a
// direction, written out or abbreviated, or the label of an exit or a
// link typed, so what a screen reader speaks can be spoken back. A link
// has no direction, and is taken by its label alone. An article, `my`,
// `this` or `that` at a label's start is dropped, as typed and as written
// (the spec's Names › Articles). Only the ways out that apply where the
// actor stands are asked, which `runtime/exits.ts` says; an exit that
// refuses is among them, named as any exit is, and is answered with its
// words rather than read.

import { DETERMINERS, typedWords } from '../../declare/addressing.js';
import { directionOf, type Direction } from '../../declare/directions.js';
import type { Speech } from '../body.js';
import type { InstanceId } from '../ids.js';

/** One exit or link that applies where the actor stands: its direction, null for a link, its label, and the place it leads to. */
export interface CommandExit {
  readonly direction: Direction | null;
  readonly label: string;
  readonly to: InstanceId;
}

/** An exit that refuses and applies where the actor stands: its direction, its label, and its words, said by the place. */
export interface RefusingExit {
  readonly direction: Direction;
  readonly label: string;
  /** The words, and the place that says them, which is `self` as they render. */
  readonly refuses: { readonly by: InstanceId; readonly said: Speech };
}

/** A way out that applies: one that leads somewhere, or one that refuses. */
export type AppliedWay = CommandExit | RefusingExit;

/**
 * The way `words` name among `ways`, in the order the place declares
 * them: the first in the direction named, else the first whose label the
 * words are; null where they name none.
 */
export function exitNamed<Way extends AppliedWay>(
  words: readonly string[],
  ways: readonly Way[],
): Way | null {
  const direction = words.length === 1 ? directionOf(words[0]!) : null;
  if (direction !== null) {
    const going = ways.find((way) => way.direction === direction);
    if (going !== undefined) return going;
  }
  const typed = labelWords(words).join(' ');
  return ways.find((way) => labelWords(typedWords(way.label)).join(' ') === typed) ?? null;
}

/** A label's words without the article, `my`, `this` or `that` it starts with; a lone word is kept. */
export function labelWords(words: readonly string[]): readonly string[] {
  return words.length > 1 && DETERMINERS.includes(words[0]!) ? words.slice(1) : words;
}
