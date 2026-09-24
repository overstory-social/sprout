// What the words a slot took fill its role with (the spec's Verbs ›
// Slots, Set roles, Value roles, A role-player narrows its own options,
// Exits). A thing role takes one noun, a set role a run of them, an exit
// role a direction or a label; a value role takes any words, and binds
// only a value some participant's `from` hears, so nothing a visitor
// typed reaches a body unless a role-player declared it an option.

import { optionFromWords } from '../../declare/enums.js';
import type { ResolvedRole } from '../../declare/verbs.js';
import type { InstanceId } from '../ids.js';
import { heardBy, type Bound, type Reading } from '../reading.js';
import type { StateReader } from '../state.js';
import type { Value } from '../values.js';
import { exitNamed, type CommandExit } from './exits.js';
import { forms, nounIn, runIn, type Candidate, type NounContext, type NounFound } from './nouns.js';

/** What a slot's words come to for its role. */
export type Filled =
  | { readonly fills: 'bound'; readonly bound: Bound }
  /** A value role's words, bound or not once the reading's participants are known. */
  | { readonly fills: 'words'; readonly words: readonly string[] }
  /** Several things fit and differ, nearest first; the noun that asks runs from `start` to `end` of the slot's words. */
  | {
      readonly fills: 'which';
      readonly candidates: readonly InstanceId[];
      readonly start: number;
      readonly end: number;
    }
  /** Nothing in range answers to the noun running from `start` to `end` of the slot's words. */
  | { readonly fills: 'nothing'; readonly start: number; readonly end: number }
  /** The phrase does not match: something answers and cannot fill the role, or the words name no exit. */
  | { readonly fills: 'unfit' };

/** What filling a slot reads: what the actor can reach, the exits that apply, the meter and the draws. */
export interface FillContext extends NounContext {
  readonly candidates: readonly Candidate[];
  readonly exits: readonly CommandExit[];
}

/** What `words`, taken by a slot, fill `role` with. */
export function fillSlot(
  role: ResolvedRole,
  words: readonly string[],
  context: FillContext,
): Filled {
  const filler = role.filler;
  if (filler?.fills === 'symbol' || filler?.fills === 'integer') return { fills: 'words', words };
  if (filler?.fills === 'exit') {
    context.budget.spend();
    const exit = exitNamed(words, context.exits);
    return exit === null ? { fills: 'unfit' } : { fills: 'bound', bound: { exit } };
  }
  if (role.many) {
    const found = runIn(words, role, context.candidates, context);
    return found.found === 'set'
      ? { fills: 'bound', bound: { set: found.ids } }
      : fromNoun(found, found.start, found.end, true);
  }
  return fromNoun(nounIn(words, role, context.candidates, context), 0, words.length, false);
}

/** What one noun found fills a role with, the noun running from `start` to `end` of the slot's words. */
function fromNoun(found: NounFound, start: number, end: number, many: boolean): Filled {
  switch (found.found) {
    case 'one':
      return { fills: 'bound', bound: many ? { set: [found.id] } : { object: found.id } };
    case 'which':
      return { fills: 'which', candidates: found.candidates, start, end };
    case 'nothing':
      return { fills: 'nothing', start, end };
    case 'unfit':
      return { fills: 'unfit' };
  }
}

/** A name an option may have, which is all a symbol role can bind. */
const OPTION = /^[a-z][a-z0-9_]*$/;

/**
 * The value `words` bind for the value role `role` in `reading`: the
 * option or number they spell, as typed or after a leading article, where
 * a participant hears it; null where none does, and the role is unbound.
 */
export function valueOf(
  role: ResolvedRole,
  words: readonly string[],
  reading: Reading,
  state: StateReader,
): Value | null {
  for (const form of forms(words)) {
    const value = spelt(role, form);
    if (value !== null && heardBy(reading, role, value, state)) return value;
  }
  return null;
}

/** What `words` spell as the role's value: an option's name, or a whole number. */
function spelt(role: ResolvedRole, words: readonly string[]): Value | null {
  if (role.filler?.fills === 'integer') {
    if (words.length !== 1 || !/^-?\d+$/.test(words[0]!)) return null;
    const number = Number(words[0]);
    return Number.isSafeInteger(number) ? number + 0 : null;
  }
  const option = optionFromWords(words.join(' '));
  return OPTION.test(option) ? option : null;
}
