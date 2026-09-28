// A noun a visitor typed, resolved against what they can reach (the
// spec's Names › Articles; Verbs › Slots, Set roles; Properties › Where
// types come from). An article or a determiner is optional before it, so
// the words are tried as typed and then without their first word where
// that is one. A role's kind narrows what may fill it and is never a
// source of refusal text: a thing that answers and is not of the kind
// makes the phrase not match. Among several that fit, the ones whose
// whole name was typed are preferred to those answering to a noun; every
// one that remains is a way to read the noun, with how near it is and how
// many words it matched, and the parser ranks the readings they make
// whole (the spec's Parsing › Choosing a reading). Every candidate a noun
// is tried against is one step.

import { DETERMINERS, CONNECTORS } from '../../declare/addressing.js';
import { kindName } from '../../declare/kinds.js';
import type { ResolvedRole } from '../../declare/verbs.js';
import type { Budget } from '../budget.js';
import type { InstanceId } from '../ids.js';
import type { Instance } from '../state.js';
import type { Address } from './address.js';

/** One thing a noun may name, with how it is addressed and how near it is. */
export interface Candidate {
  readonly instance: Instance;
  readonly address: Address;
  /** Its nearness in the range walk: smaller is nearer, and equal only among the equally near. */
  readonly near: number;
}

/** What resolving a noun reads besides the candidates: the turn's meter. */
export interface NounContext {
  readonly budget: Budget;
}

/** One thing a noun may name: how near it is, and how many of the typed words its name matched. */
export interface Named {
  readonly id: InstanceId;
  readonly near: number;
  readonly literal: number;
}

/** What a run of words names among candidates. */
export type NounFound =
  /** Every thing that fits, nearest first. */
  | { readonly found: 'some'; readonly things: readonly Named[] }
  /** Nothing among the candidates answers to the words. */
  | { readonly found: 'nothing' }
  /** Something answers, and none of what answers may fill the role. */
  | { readonly found: 'unfit' };

/** One set a run may name: its things in the order typed, duplicates collapsed, and how they matched. */
export interface NamedSet {
  readonly ids: readonly InstanceId[];
  /** The sum of its things' nearness. */
  readonly near: number;
  readonly literal: number;
}

/**
 * What a set role's run names: every set its nouns may make together;
 * or what its first noun that names nothing it may take found, with
 * where that noun runs among the run's words.
 */
export type RunFound =
  | { readonly found: 'sets'; readonly sets: readonly NamedSet[] }
  | ({ readonly found: 'nothing' | 'unfit' } & { readonly start: number; readonly end: number });

/** Whether `instance` may fill `role`: any thing an open role, one composing its kind a kind's. */
export function fits(role: ResolvedRole, instance: Instance): boolean {
  const filler = role.filler;
  if (filler === null) return false;
  if (filler.fills === 'open') return true;
  if (filler.fills === 'kind') return instance.kind.composes.has(kindName(filler.kind));
  return false;
}

/** The words as typed, and without a leading article or determiner where one leads more words. */
export function forms(words: readonly string[]): (readonly string[])[] {
  const first = words[0];
  if (first !== undefined && words.length > 1 && DETERMINERS.includes(first)) {
    return [words, words.slice(1)];
  }
  return [words];
}

/** How `address` answers to `words`: by its whole name, by a noun, or not at all. */
export function answersTo(words: readonly string[], address: Address): 'name' | 'noun' | null {
  return answering(words, address)?.by ?? null;
}

/** How `address` answers to `words`, and how many of them its name or noun matched. */
function answering(
  words: readonly string[],
  address: Address,
): { readonly by: 'name' | 'noun'; readonly literal: number } | null {
  const typed = forms(words).map((form) => ({ text: form.join(' '), literal: form.length }));
  const [name, ...rest] = address.nouns.map((noun) => noun.join(' '));
  const byName = typed.find((form) => form.text === name);
  if (byName !== undefined) return { by: 'name', literal: byName.literal };
  const byNoun = typed.find((form) => rest.includes(form.text));
  return byNoun === undefined ? null : { by: 'noun', literal: byNoun.literal };
}

/** What one noun names among `candidates`, nearest first, for `role`. */
export function nounIn(
  words: readonly string[],
  role: ResolvedRole,
  candidates: readonly Candidate[],
  context: NounContext,
): NounFound {
  const { budget } = context;
  const answered: { candidate: Candidate; by: 'name' | 'noun'; literal: number }[] = [];
  for (const candidate of candidates) {
    budget.spend();
    const found = answering(words, candidate.address);
    if (found !== null) answered.push({ candidate, ...found });
  }
  if (answered.length === 0) return { found: 'nothing' };
  const fitting = answered.filter(({ candidate }) => fits(role, candidate.instance));
  if (fitting.length === 0) return { found: 'unfit' };
  const byName = fitting.filter(({ by }) => by === 'name');
  const pool = byName.length > 0 ? byName : fitting;
  return {
    found: 'some',
    things: pool.map(({ candidate, literal }) => ({
      id: candidate.instance.id,
      near: candidate.near,
      literal,
    })),
  };
}

/**
 * What a set role's run names: split on `and` and commas literally, each
 * noun resolved on its own (the spec's Set roles), and every set its
 * nouns' things make together, each set a step. The first noun that
 * names nothing it may take decides.
 */
export function runIn(
  words: readonly string[],
  role: ResolvedRole,
  candidates: readonly Candidate[],
  context: NounContext,
): RunFound {
  let sets: NamedSet[] = [{ ids: [], near: 0, literal: 0 }];
  for (const { start, end } of nounsOfRun(words)) {
    if (start === end) return { found: 'unfit', start, end };
    const found = nounIn(words.slice(start, end), role, candidates, context);
    if (found.found !== 'some') return { found: found.found, start, end };
    sets = sets.flatMap((set) =>
      found.things.map((thing) => {
        context.budget.spend();
        return {
          ids: set.ids.includes(thing.id) ? set.ids : [...set.ids, thing.id],
          near: set.near + thing.near,
          literal: set.literal + thing.literal,
        };
      }),
    );
  }
  return { found: 'sets', sets };
}

/**
 * Where a run's nouns stand among its words, split at every connector, a
 * comma before `and` counting as one; an empty one where connectors stand
 * together otherwise, or at an end.
 */
export function nounsOfRun(words: readonly string[]): { start: number; end: number }[] {
  const nouns = [{ start: 0, end: 0 }];
  words.forEach((word, at) => {
    const last = nouns.at(-1)!;
    if (!CONNECTORS.includes(word)) last.end = at + 1;
    else if (word === 'and' && words[at - 1] === ',') last.start = last.end = at + 1;
    else nouns.push({ start: at + 1, end: at + 1 });
  });
  return nouns;
}

/** How the engine writes a thing, which is all a visitor has to tell two apart by. */
export function writtenAs(address: Address): string {
  return `${address.article} ${address.name.toLowerCase()}`;
}
