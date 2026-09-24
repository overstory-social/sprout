// A noun a visitor typed, resolved against what they can reach (the
// spec's Names › Articles; Verbs › Slots, Set roles; Properties › Where
// types come from). An article or a determiner is optional before it, so
// the words are tried as typed and then without their first word where
// that is one. A role's kind narrows what may fill it and is never a
// source of refusal text: a thing that answers and is not of the kind
// makes the phrase not match. Among several that fit, the ones whose
// whole name was typed are preferred to those answering to a noun; where
// several remain, the visitor is asked `which`, unless they are written
// alike, when no answer could tell them apart: the nearest is meant, and
// among equally near ones a draw from the turn's seed (the spec's
// Spawning), so no world depends on an order it never chose. Every
// candidate a noun is tried against is one step, and so is the draw.

import { DETERMINERS, CONNECTORS } from '../../declare/addressing.js';
import { kindName } from '../../declare/kinds.js';
import type { ResolvedRole } from '../../declare/verbs.js';
import type { Budget } from '../budget.js';
import type { Draw } from '../draws.js';
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

/** What resolving a noun reads besides the candidates: the turn's meter and its draws. */
export interface NounContext {
  readonly budget: Budget;
  readonly draws: Draw;
}

/** What a run of words names among candidates. */
export type NounFound =
  | { readonly found: 'one'; readonly id: InstanceId }
  /** Several fit and differ, nearest first: the visitor is asked which. */
  | { readonly found: 'which'; readonly candidates: readonly InstanceId[] }
  /** Nothing among the candidates answers to the words. */
  | { readonly found: 'nothing' }
  /** Something answers, and none of what answers may fill the role. */
  | { readonly found: 'unfit' };

/**
 * What a set role's run names: every thing, in the order typed,
 * duplicates collapsed; or what its first noun that names no one thing
 * found, with where that noun runs among the run's words.
 */
export type RunFound =
  | { readonly found: 'set'; readonly ids: readonly InstanceId[] }
  | (NounFound & { readonly start: number; readonly end: number });

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
  const typed = forms(words).map((form) => form.join(' '));
  const [name, ...rest] = address.nouns.map((noun) => noun.join(' '));
  if (name !== undefined && typed.includes(name)) return 'name';
  return rest.some((noun) => typed.includes(noun)) ? 'noun' : null;
}

/** What one noun names among `candidates`, nearest first, for `role`. */
export function nounIn(
  words: readonly string[],
  role: ResolvedRole,
  candidates: readonly Candidate[],
  context: NounContext,
): NounFound {
  const { budget } = context;
  const answering: { candidate: Candidate; by: 'name' | 'noun' }[] = [];
  for (const candidate of candidates) {
    budget.spend();
    const by = answersTo(words, candidate.address);
    if (by !== null) answering.push({ candidate, by });
  }
  if (answering.length === 0) return { found: 'nothing' };
  const fitting = answering.filter(({ candidate }) => fits(role, candidate.instance));
  if (fitting.length === 0) return { found: 'unfit' };
  const byName = fitting.filter(({ by }) => by === 'name');
  const pool = (byName.length > 0 ? byName : fitting).map(({ candidate }) => candidate);
  if (pool.length === 1) return { found: 'one', id: pool[0]!.instance.id };
  const written = new Set(pool.map(({ address }) => writtenAs(address)));
  if (written.size === 1) return { found: 'one', id: nearestOf(pool, context) };
  return { found: 'which', candidates: pool.map(({ instance }) => instance.id) };
}

/**
 * What a set role's run names: split on `and` and commas literally, each
 * noun resolved on its own (the spec's Set roles), so the cost stays
 * linear in the line. The first noun that names no one thing decides.
 */
export function runIn(
  words: readonly string[],
  role: ResolvedRole,
  candidates: readonly Candidate[],
  context: NounContext,
): RunFound {
  const ids: InstanceId[] = [];
  for (const { start, end } of nounsOfRun(words)) {
    if (start === end) return { found: 'unfit', start, end };
    const found = nounIn(words.slice(start, end), role, candidates, context);
    if (found.found !== 'one') return { ...found, start, end };
    if (!ids.includes(found.id)) ids.push(found.id);
  }
  return { found: 'set', ids };
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

/** The nearest of things written alike, drawn from the turn's stream among equally near ones. */
function nearestOf(alike: readonly Candidate[], context: NounContext): InstanceId {
  const near = Math.min(...alike.map((candidate) => candidate.near));
  const nearest = alike.filter((candidate) => candidate.near === near);
  if (nearest.length === 1) return nearest[0]!.instance.id;
  context.budget.spend();
  return nearest[context.draws.below(nearest.length)]!.instance.id;
}

/** How the engine writes a thing, which is all a visitor has to tell two apart by. */
function writtenAs(address: Address): string {
  return `${address.article} ${address.name.toLowerCase()}`;
}
