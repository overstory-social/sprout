// What the words a slot took fill its role with (the spec's Verbs ›
// Slots, Set roles, Carried roles, Value roles, A role-player narrows its
// own options, Exits). A thing role takes one noun, a set role a run of
// them, an exit role a direction or a label; a value role takes any
// words, and binds only a value some participant's `from` hears, so
// nothing a visitor typed reaches a body unless a role-player declared it
// an option. A carried role takes only what the one typing carries: where
// what they carry does not answer and something further out would fill
// the role, the slot is `outward`, which the world answers with
// `not_carrying`, and a carried thing the noun names always wins over an
// outward one.

import { optionFromWords } from '../../declare/enums.js';
import type { ResolvedRole } from '../../declare/verbs.js';
import { heardBy, type Bound, type Reading } from '../reading.js';
import type { Instance, StateReader } from '../state.js';
import type { Value } from '../values.js';
import { exitNamed, labelWords, type CommandExit } from './exits.js';
import {
  fits,
  forms,
  nounIn,
  runIn,
  thingsIn,
  type Candidate,
  type NounContext,
  type NounFound,
  type PronounNamed,
} from './nouns.js';

/** One way a slot's words fill its role: what it binds, how near, and how many words it matched literally. */
export interface FillOption {
  readonly bound: Bound;
  /** The nearness of what it binds, a set's summed; 0 for an exit. */
  readonly near: number;
  readonly literal: number;
  /** What it binds that a pronoun named, where any is. */
  readonly pronounNamed?: readonly PronounNamed[];
}

/** What a slot's words come to for its role. */
export type Filled =
  /** Every way they fill it, nearest first; the parser ranks the readings they make. */
  | { readonly fills: 'options'; readonly options: readonly FillOption[] }
  /** A value role's words, bound or not once the reading's participants are known. */
  | { readonly fills: 'words'; readonly words: readonly string[] }
  /** Nothing in range answers to the noun running from `start` to `end` of the slot's words. */
  | { readonly fills: 'nothing'; readonly start: number; readonly end: number }
  /**
   * The phrase does not match: something answers and cannot fill the role,
   * each thing that answers as an option a partial reading may name, or
   * the words name no exit or no set, with none.
   */
  | { readonly fills: 'unfit'; readonly things: readonly FillOption[] }
  /** `all`, for a role that takes one thing: each thing it takes in turn, in the order reached (`all.ts`). */
  | { readonly fills: 'all'; readonly things: readonly FillOption[] }
  /**
   * The phrase does not match: the role is carried, nothing carried
   * answers, and each of these, further out, would fill it.
   */
  | { readonly fills: 'outward'; readonly things: readonly FillOption[] };

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
    if (exit === null) return { fills: 'unfit', things: [] };
    return {
      fills: 'options',
      options: [{ bound: { exit }, near: 0, literal: labelWords(words).length }],
    };
  }
  if (role.many) return setFilled(words, role, context);
  return carriedFilled(
    words,
    role.carried,
    (candidates) => nounIn(words, role, candidates, context),
    context,
  );
}

/**
 * What `words`, taken by an intent's slot, fill it with: each thing that
 * fits a role the slot is given to, and only what is carried where any
 * of those roles is carried.
 */
export function fillIntentSlot(
  roles: readonly ResolvedRole[],
  words: readonly string[],
  context: FillContext,
): Filled {
  const fitting = (instance: Instance) => roles.some((role) => fits(role, instance));
  return carriedFilled(
    words,
    roles.some((role) => role.carried),
    (candidates) => thingsIn(words, fitting, candidates, context),
    context,
  );
}

/**
 * What one noun fills a slot with, `find` naming it among candidates: in
 * a carried slot, among what is carried first, and `outward` where only
 * something further out would fill it.
 */
function carriedFilled(
  words: readonly string[],
  carried: boolean,
  find: (candidates: readonly Candidate[]) => NounFound,
  context: FillContext,
): Filled {
  if (!carried) return thingFilled(find(context.candidates), words);
  const held = find(context.candidates.filter((one) => one.carried));
  if (held.found === 'some') return thingFilled(held, words);
  const anywhere = find(context.candidates);
  if (anywhere.found === 'some') {
    const outward = thingFilled(anywhere, words);
    return { fills: 'outward', things: outward.fills === 'options' ? outward.options : [] };
  }
  return thingFilled(held.found === 'unfit' ? held : anywhere, words);
}

/** What a set role's run fills it with, each set an option; in a carried role, as `carriedFilled` says. */
function setFilled(words: readonly string[], role: ResolvedRole, context: FillContext): Filled {
  const run = (candidates: readonly Candidate[]) => runIn(words, role, candidates, context);
  const found = run(
    role.carried ? context.candidates.filter((one) => one.carried) : context.candidates,
  );
  if (found.found === 'sets') {
    return {
      fills: 'options',
      options: found.sets.map(({ ids, near, literal, pronounNamed }) => ({
        bound: { set: ids },
        near,
        literal,
        ...(pronounNamed.length === 0 ? {} : { pronounNamed }),
      })),
    };
  }
  if (role.carried && found.found === 'nothing') {
    const anywhere = run(context.candidates);
    if (anywhere.found === 'sets') {
      // The nearest set's first thing not carried is the one the world names.
      const carried = new Set(
        context.candidates.filter((one) => one.carried).map((one) => one.instance.id),
      );
      const [nearest] = [...anywhere.sets].sort((a, b) => a.near - b.near);
      const thing = nearest!.ids.find((id) => !carried.has(id))!;
      const { near, literal } = nearest!;
      return { fills: 'outward', things: [{ bound: { object: thing }, near, literal }] };
    }
  }
  return found.found === 'nothing'
    ? { fills: 'nothing', start: found.start, end: found.end }
    : { fills: 'unfit', things: [] };
}

/** What one noun found fills a slot with: a thing for each option, or for each thing that cannot fill it. */
function thingFilled(found: NounFound, words: readonly string[]): Filled {
  if (found.found === 'nothing') return { fills: 'nothing', start: 0, end: words.length };
  const options = found.things.map(({ id, near, literal, pronoun }) => ({
    bound: { object: id },
    near,
    literal,
    ...(pronoun === undefined ? {} : { pronounNamed: [{ id, pronoun }] }),
  }));
  return found.found === 'unfit'
    ? { fills: 'unfit', things: options }
    : { fills: 'options', options };
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
